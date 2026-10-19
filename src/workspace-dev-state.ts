// Pure view state for the opt-in native Workspace Dev. A view/default is never execution authority.
import { WorkspaceRpcWaitError } from "./workspace-dev-errors.ts";
export interface WorkspaceDevRpc { request<T>(method: string, params: Record<string, unknown>): Promise<T> }
export interface WorkspaceDevDirectory { revision: number; activeWorkspaceId: string | null;
  workspaces: { workspaceId: string; label: string; role: string; active: boolean }[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace" }
export interface WorkspaceDevAgent { agentId: string; kind: "main" | "colleague"; state: string;
  identity: { displayName: string; title?: string }; runtime: { id: string; label: string; available: boolean }; brand?: "hara" }
export interface WorkspaceDevApproval { id: string; workspaceId: string; resourceGeneration: string; agentId: string; expiresAt: string;
  status?: "pending" | "approved" | "rejected" | "expired"; risk?: "high" | "normal"; paid?: boolean; externalSend?: boolean; destructive?: boolean;
  draft: { username: string; displayName: string; title: string; instructions: string; runtimeId: "pi" } }
export type WorkspaceDevMessage = ({ role: "user"; content: string } | { role: "assistant"; text: string; tools: string[] }
  | { role: "tool"; results: { id: string; name: string; content: string; isError: boolean }[] }) & { createdAt?: string };
export interface WorkspaceDevSnapshot { workspaceId: string; resourceGeneration: string; label: string; selectedAgentId: string;
  colleagueLimit?: number;
  agents: WorkspaceDevAgent[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace";
  runtimes?: { builtIn: string; options: { runtimeId: string; label: string; installed: boolean; registered: boolean; version: string | null; state: string; generalAgentDriverAvailable: boolean; path?: string; fingerprint?: string | null; source?: string }[];
    operations: { id: string; runtimeId: string; state: string }[] };
  budget?: { maxTokens: number; maxRequests: number; requests: number; inputTokens: number; outputTokens: number; uncertainReservedTokens: number; paused: boolean };
  connections: { revision: number; defaultConnectionId: string | null; readOnly?: boolean; recovered?: boolean; migrationPending?: boolean; unavailable?: boolean; connections: WorkspaceModelConnection[] };
  approvals: WorkspaceDevApproval[]; conversation: { revision: number; state: string; sessionId: string; taskId: string | null; runId: string | null;
    taskState: string | null; objective: string; history: WorkspaceDevMessage[]; pastTaskCount: number; updatedAt?: string; unreadCount?: number;
    usage: { modelCalls: number; inputTokens: number; outputTokens: number }; runUsage: { modelCalls: number; inputTokens: number; outputTokens: number };
    completion: { state: string; evidence?: string[] } | null; blockReason?: string | null;
    resumeAdmission?: { allowed: boolean; reason: string | null } } }
interface PendingMessage { method: "workspace.session.send" | "workspace.session.resume"; payload: Record<string, unknown>;
  message: string; state: "sending" | "unknown" }
export interface WorkspaceDevView { directory: WorkspaceDevDirectory | null; workspaceId: string | null; agentId: string | null;
  roster: WorkspaceDevAgent[];
  workspace: WorkspaceDevSnapshot | null; draft: string; loading: boolean; sending: boolean; pendingUnknown: boolean; error: string; syncNotice: string }
export interface RuntimeApprovalCard { id: string; runtimeId: string; label: string; version: string; origin: string; sha256: string;
  maxBytes: number; expiresAt: string; target: { platform: string; arch: string }; workspaceId: string; resourceGeneration: string; viewEpoch: number }
export interface WorkspaceModelConnection { id: string; label: string; status: string; defaultModel: string; provider?: "openai" | "anthropic"; baseURL?: string; keySaved?: boolean; cleanupPending?: boolean }
export interface LegacyConnectionPreview { id: string; label: string; provider: "openai" | "anthropic"; baseURL: string; defaultModel: string; keySaved: boolean; source: string }
export interface WorkspacePreferenceView { revision: number; theme: "system" | "light" | "dark"; readOnly: boolean; recovered: boolean }
export interface WorkspaceFeatureView { revision: number; workspaceId: string; schedules: { id: string; name: string; schedule: { kind: string; expr?: string; display?: string }; enabled: boolean }[]; skills: { id: string; description: string; enabled: boolean; version: string; availableVersion: string; locked: boolean; source: "global" | "private" }[] }

export class WorkspaceDevModel {
  private view: WorkspaceDevView = { directory: null, workspaceId: null, agentId: null, roster: [], workspace: null, draft: "", loading: false, sending: false, pendingUnknown: false, error: "", syncNotice: "" };
  private readonly listeners = new Set<() => void>();
  private readonly drafts = new Map<string, string>();
  private readonly pending = new Map<string, PendingMessage>();
  private readonly approvalDecisions = new Set<string>();
  private epoch = 0;
  private refreshEpoch: number | null = null;
  private refreshWait: Promise<void> | null = null;
  private refreshDirty = false;
  private readonly rpc: WorkspaceDevRpc;
  private readonly nonce: () => string;
  private readonly syntheticOnly: boolean;
  private readonly executionMode: string;
  constructor(rpc: WorkspaceDevRpc, nonce: () => string = () => crypto.randomUUID(), syntheticOnly = true, executionMode = syntheticOnly ? "synthetic" : "ark-real-key") {
    this.rpc = rpc; this.nonce = nonce; this.syntheticOnly = syntheticOnly; this.executionMode = executionMode;
  }
  getSnapshot = (): WorkspaceDevView => this.view;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(next: Partial<WorkspaceDevView>): void { this.view = { ...this.view, ...next }; for (const listener of this.listeners) listener(); }
  private key(snapshot = this.view.workspace): string { return snapshot ? JSON.stringify([snapshot.workspaceId, snapshot.resourceGeneration, snapshot.selectedAgentId]) : ""; }
  private valid(snapshot: WorkspaceDevSnapshot, workspaceId: string, agentId?: string): void {
    if (snapshot?.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && snapshot.executionMode !== this.executionMode) || snapshot.workspaceId !== workspaceId || !snapshot.resourceGeneration
      || (agentId && snapshot.selectedAgentId !== agentId) || !Array.isArray(snapshot.agents)
      || !Array.isArray(snapshot.conversation?.history)) throw new Error("Workspace 回應不符合原視圖，已拒絕顯示。");
  }
  private apply(snapshot: WorkspaceDevSnapshot): void {
    if (this.view.workspace && this.view.workspace.resourceGeneration !== snapshot.resourceGeneration) this.epoch++;
    const key = this.key(snapshot), pending = this.pending.get(key);
    this.update({ workspace: snapshot, workspaceId: snapshot.workspaceId, agentId: snapshot.selectedAgentId, roster: snapshot.agents,
      draft: this.drafts.get(key) ?? "", pendingUnknown: pending?.state === "unknown", sending: pending?.state === "sending", loading: false, error: "", syncNotice: "" });
  }
  async loadDirectory(): Promise<void> {
    const epoch = this.epoch; const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
    if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== this.executionMode)) throw new Error("Workspace 模型模式不符；沒有改接其他引擎。");
    if (epoch === this.epoch) this.update({ directory });
  }
  async selectWorkspace(workspaceId: string): Promise<void> {
    const epoch = ++this.epoch;
    this.update({ workspaceId, agentId: null, roster: [], workspace: null, draft: "", loading: true, sending: false, pendingUnknown: false, error: "", syncNotice: "" });
    try {
      const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
      if (epoch !== this.epoch) return;
      if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== this.executionMode)) throw new Error("Workspace 模型模式不符。");
      if (!directory.workspaces.some(row => row.workspaceId === workspaceId && row.active)) throw new Error("這個 Workspace 不可用。");
      this.update({ directory });
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.select", { workspaceId, expectedRevision: directory.revision });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspaceId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update({ loading: false, error: String(error) }); }
  }
  async selectAgent(agentId: string): Promise<void> {
    const workspace = this.view.workspace; if (!workspace || !workspace.agents.some(agent => agent.agentId === agentId)) return;
    const epoch = ++this.epoch;
    this.update({ agentId, workspace: null, draft: "", loading: true, sending: false, pendingUnknown: false, error: "", syncNotice: "" });
    try {
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.agent.select", { workspaceId: workspace.workspaceId,
        expectedGeneration: workspace.resourceGeneration, agentId });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspace.workspaceId, agentId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update({ loading: false, error: String(error) }); }
  }
  async refresh(): Promise<void> {
    const { workspaceId, agentId } = this.view; if (!workspaceId || !agentId) return;
    const epoch = this.epoch;
    if (this.refreshEpoch === epoch) { this.refreshDirty = true; await this.refreshWait; return; }
    this.refreshEpoch = epoch;
    let refreshed!: () => void;
    this.refreshWait = new Promise<void>(resolve => { refreshed = resolve; });
    try {
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.snapshot", { workspaceId, agentId });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspaceId, agentId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update(error instanceof WorkspaceRpcWaitError
      ? { syncNotice: "正在同步最新狀態；後台任務不會因此重送或被判為失敗。" } : { error: String(error) }); }
    finally {
      refreshed();
      if (this.refreshEpoch === epoch) {
        this.refreshEpoch = null; this.refreshWait = null; const again = this.refreshDirty; this.refreshDirty = false;
        if (again && epoch === this.epoch) queueMicrotask(() => { void this.refresh(); });
      }
    }
  }
  setDraft(draft: string): void { const key = this.key(); if (key) this.drafts.set(key, draft); this.update({ draft }); }
  async createWorkspace(label: string): Promise<void> {
    if (!label.trim() || this.view.loading) return; const epoch = this.epoch; this.update({ loading: true, error: "" });
    try {
      const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
      if (epoch !== this.epoch) return;
      const workspace = await this.rpc.request<WorkspaceDevSnapshot>("workspace.create", { label: label.trim(), expectedRevision: directory.revision });
      if (epoch !== this.epoch) return; this.update({ loading: false }); await this.selectWorkspace(workspace.workspaceId);
    } catch (error) { if (epoch === this.epoch) this.update({ loading: false, error: String(error) }); }
  }
  async addSynthetic(): Promise<void> {
    return this.addConnection("workspace.connection.synthetic");
  }
  async addApprovedConnection(): Promise<void> {
    return this.addConnection("workspace.connection.approved");
  }
  async configureConnection(input: { label: string; provider: "openai" | "anthropic"; baseURL: string; defaultModel: string; apiKey: string }): Promise<boolean> {
    const workspace = this.view.workspace; if (!workspace || this.executionMode !== "workspace") return false;
    const epoch = this.epoch;
    try { await this.rpc.request("workspace.connection.add", { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
      expectedRevision: workspace.connections.revision, input });
      if (epoch !== this.epoch) return false; await this.refresh(); return true;
    } catch { if (epoch === this.epoch) this.update({ error: "連接未確認保存，請刷新後核對；不會將密鑰寫入瀏覽器儲存或錯誤記錄。" }); return false; }
  }
  async workspaceRequest<T>(method: string, extra: Record<string, unknown> = {}): Promise<T> {
    const workspace = this.view.workspace, epoch = this.epoch;
    if (!workspace) throw new Error("請先選擇工作空間");
    const value = await this.rpc.request<T>(method, { ...extra, workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration });
    if (epoch !== this.epoch) throw new Error("原工作空間視圖已切換，未自動重送");
    return value;
  }
  async readOverview(snapshot: WorkspaceDevSnapshot): Promise<{ snapshots: WorkspaceDevSnapshot[]; incomplete: boolean }> {
    if (snapshot !== this.view.workspace) throw new Error("Overview view changed");
    const epoch = this.epoch;
    const results = await Promise.allSettled(snapshot.agents.filter(agent => agent.agentId !== snapshot.selectedAgentId).map(async agent => {
      const value = await this.rpc.request<WorkspaceDevSnapshot>("workspace.snapshot", { workspaceId: snapshot.workspaceId, agentId: agent.agentId });
      this.valid(value, snapshot.workspaceId, agent.agentId);
      if (value.resourceGeneration !== snapshot.resourceGeneration) throw new Error("Overview generation changed");
      return value;
    }));
    if (epoch !== this.epoch || this.view.workspace?.resourceGeneration !== snapshot.resourceGeneration) throw new Error("Overview view changed");
    return { snapshots: [snapshot, ...results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])],
      incomplete: results.some(result => result.status === "rejected") };
  }
  async editConnection(connectionId: string, input: Record<string, unknown>): Promise<boolean> {
    const epoch = this.epoch;
    try { await this.workspaceRequest("workspace.connection.edit", { connectionId, input, expectedRevision: this.view.workspace!.connections.revision }); await this.refresh(); return true; }
    catch { if (epoch === this.epoch) this.update({ error: "連接修改未確認，請刷新核對；沒有自動重送或記錄密鑰。" }); return false; }
  }
  async changeConnection(connectionId: string, remove = false): Promise<void> {
    await this.workspaceRequest(remove ? "workspace.connection.delete" : "workspace.connection.select", {
      connectionId, expectedRevision: this.view.workspace!.connections.revision, ...(remove ? { approved: true } : {}) });
    await this.refresh();
  }
  async legacyConnections(): Promise<LegacyConnectionPreview[]> { return this.workspaceRequest("workspace.connection.legacy"); }
  async importConnection(sourceId: string): Promise<void> {
    await this.workspaceRequest("workspace.connection.import", { sourceId, approved: true, expectedRevision: this.view.workspace!.connections.revision }); await this.refresh();
  }
  async detectRuntimes(): Promise<void> { await this.workspaceRequest("workspace.runtime.detect"); await this.refresh(); }
  async registerLocalRuntime(runtimeId: string, fingerprint: string, workspaceId: string, generation: string): Promise<void> {
    if (this.view.workspaceId !== workspaceId || this.view.workspace?.resourceGeneration !== generation) throw new Error("原本機安裝確認已失效");
    await this.workspaceRequest("workspace.runtime.registerLocal", { runtimeId, fingerprint, approved: true }); await this.refresh();
  }
  async preferences(): Promise<WorkspacePreferenceView> { return this.rpc.request("workspace.preferences.get", {}); }
  async savePreference(theme: string, expectedRevision: number): Promise<WorkspacePreferenceView> { return this.rpc.request("workspace.preferences.set", { theme, expectedRevision }); }
  async proposeRuntime(runtimeId: string): Promise<RuntimeApprovalCard> {
    const workspace = this.view.workspace; if (!workspace) throw new Error("請先選工作空間"); const epoch = this.epoch;
    const card = await this.rpc.request<Omit<RuntimeApprovalCard, "workspaceId" | "resourceGeneration" | "viewEpoch">>("workspace.runtime.propose",
      { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration, runtimeId });
    if (epoch !== this.epoch) throw new Error("原安裝提案的視圖已切換");
    return { ...card, workspaceId: workspace.workspaceId, resourceGeneration: workspace.resourceGeneration, viewEpoch: epoch };
  }
  async approveRuntime(card: RuntimeApprovalCard, approved: boolean): Promise<void> {
    const workspace = this.view.workspace;
    if (!workspace || workspace.workspaceId !== card.workspaceId || workspace.resourceGeneration !== card.resourceGeneration || card.viewEpoch !== this.epoch) throw new Error("安裝確認不屬於目前空間");
    await this.rpc.request("workspace.runtime.approve", { workspaceId: card.workspaceId, expectedGeneration: card.resourceGeneration, proposalId: card.id, approved });
    await this.refresh();
  }
  async cancelRuntime(operationId: string): Promise<void> {
    const workspace = this.view.workspace; if (!workspace) return;
    await this.rpc.request("workspace.runtime.cancel", { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration, operationId });
    await this.refresh();
  }
  private async addConnection(method: string): Promise<void> {
    const workspace = this.view.workspace; if (!workspace) return; const epoch = this.epoch;
    try {
      await this.rpc.request(method, { workspaceId: workspace.workspaceId,
        expectedGeneration: workspace.resourceGeneration, expectedRevision: workspace.connections.revision });
      if (epoch === this.epoch) await this.refresh();
    } catch (error) { if (epoch === this.epoch) this.update({ error: String(error) }); }
  }
  async send(resume = false, retryUnknown = false): Promise<void> {
    const workspace = this.view.workspace, key = this.key();
    if (retryUnknown) { await this.verifyPending(); return; } // compatibility: verification is now READ-ONLY, never a resend
    if (!workspace || !key || this.view.sending || ["running", "draining"].includes(workspace.conversation.state)) return;
    const retained = this.pending.get(key);
    if (retained?.state === "unknown" && !retryUnknown) return;
    if (!workspace.connections.defaultConnectionId) { this.update({ error: this.syntheticOnly ? "請先在這個 Workspace 啟用合成連接。" : "請先在這個 Workspace 配置模型連接。" }); return; }
    const message = resume ? "/continue" : this.view.draft.trim(); if (!message) return;
    resume ||= message === "/continue";
    if (resume && workspace.conversation.resumeAdmission?.allowed === false) {
      this.update({ error: "原任務的續跑預算不可用；沒有重跑、增加模型調用或改寫原聊天。請先檢查結果與預算原因。" }); return;
    }
    const pending: PendingMessage = {
      method: resume ? "workspace.session.resume" : "workspace.session.send", message, state: "sending",
      payload: { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
        agentId: workspace.selectedAgentId, message, requestId: this.nonce(), source: "ui" } };
    this.pending.set(key, pending); this.update({ sending: true, pendingUnknown: false, error: "" });
    try {
      await this.rpc.request(pending.method, pending.payload);
      if (this.pending.get(key) !== pending) return; this.pending.delete(key);
      if (this.drafts.get(key)?.trim() === pending.message) this.drafts.set(key, "");
      // A→B→A may return to the exact same pending nonce. Settle its status without applying any
      // stale transcript; refresh starts a new read using the current view's epoch.
      if (this.key() === key) { this.update({ sending: false, pendingUnknown: false, draft: this.drafts.get(key) ?? "" }); await this.refresh(); }
    } catch (error) {
      if (this.pending.get(key) !== pending) return;
      if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
        this.pending.delete(key); // explicit server refusal, not a transport-unknown mutation
        if (this.key() === key) this.update({ sending: false, pendingUnknown: false, error: String(error) });
        return;
      }
      const unknown: PendingMessage = { ...pending, state: "unknown" }; this.pending.set(key, unknown);
      if (this.key() === key) this.update({ sending: false, pendingUnknown: true, error: "",
        syncNotice: "尚在確認原請求是否已接收；不會重新發送。" });
      if (error instanceof WorkspaceRpcWaitError) await this.checkReceipt(key, unknown);
    }
  }
  async verifyPending(): Promise<void> {
    const key = this.key(), pending = this.pending.get(key);
    if (pending?.state === "unknown") await this.checkReceipt(key, pending);
  }
  private async checkReceipt(key: string, pending: PendingMessage): Promise<void> {
    const { workspaceId, expectedGeneration, agentId, requestId } = pending.payload;
    try {
      const receipt = await this.rpc.request<{ workspaceId: string; agentId: string; resourceGeneration: string; requestId: string; state: string; runId: string | null; reason: string | null }>(
        "workspace.session.receipt", { workspaceId, expectedGeneration, agentId, requestId });
      if (this.pending.get(key) !== pending) return;
      if (receipt.workspaceId !== workspaceId || receipt.agentId !== agentId || receipt.resourceGeneration !== expectedGeneration || receipt.requestId !== requestId
        || !["accepted", "rejected", "unknown"].includes(receipt.state) || (receipt.state === "accepted" && !receipt.runId)) throw new Error("回執不符合原 Workspace／代次／同事／請求，已拒絕套用。");
      if (receipt.state === "unknown") {
        if (this.key() === key) this.update({ syncNotice: "尚未找到可確認的原請求回執；保留原訊息，不自動重送。" }); return;
      }
      this.pending.delete(key);
      if (receipt.state === "accepted" && this.drafts.get(key)?.trim() === pending.message) this.drafts.set(key, "");
      if (this.key() === key) {
        this.update({ sending: false, pendingUnknown: false, draft: this.drafts.get(key) ?? "", error: "", syncNotice: "" });
        await this.refresh();
        if (receipt.state === "rejected" && this.key() === key) this.update({ error: "原請求未獲接納；沒有新增模型調用。請檢查原任務的預算與狀態。" });
      }
    } catch (error) {
      if (this.key() === key && this.pending.get(key) === pending) this.update({ error: error instanceof WorkspaceRpcWaitError ? "" : String(error),
        syncNotice: "暫未取得原請求回執；訊息保留，不自動重送。" });
    }
  }
  async respond(card: WorkspaceDevApproval, approved: boolean): Promise<void> {
    const workspace = this.view.workspace;
    if (!workspace || card.workspaceId !== workspace.workspaceId || card.agentId !== workspace.selectedAgentId
      || card.resourceGeneration !== workspace.resourceGeneration || !workspace.approvals.some(current => current.id === card.id)) return;
    const decisionKey = JSON.stringify([card.workspaceId, card.resourceGeneration, card.id]);
    if (this.approvalDecisions.has(decisionKey)) return;
    this.approvalDecisions.add(decisionKey);
    const epoch = this.epoch;
    try { await this.rpc.request("workspace.approval.respond", { workspaceId: card.workspaceId, expectedGeneration: card.resourceGeneration, approvalId: card.id, approved });
      if (epoch === this.epoch) await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof WorkspaceRpcWaitError) { this.update({ syncNotice: "正在只讀核對確認結果；不會重複提交。" }); await this.refresh(); }
      else this.update({ error: String(error) });
    } finally { this.approvalDecisions.delete(decisionKey); }
  }
  async cancel(): Promise<void> {
    const workspace = this.view.workspace; if (!workspace?.conversation.runId) return; const epoch = this.epoch;
    try { await this.rpc.request("workspace.session.cancel", { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
      agentId: workspace.selectedAgentId, runId: workspace.conversation.runId }); if (epoch === this.epoch) await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof WorkspaceRpcWaitError) { this.update({ syncNotice: "正在只讀核對取消狀態；不會重新執行任務。" }); await this.refresh(); }
      else this.update({ error: String(error) });
    }
  }
}
