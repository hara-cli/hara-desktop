// Pure view state for the opt-in native Workspace Dev. A view/default is never execution authority.
export interface WorkspaceDevRpc { request<T>(method: string, params: Record<string, unknown>): Promise<T> }
export interface WorkspaceDevDirectory { revision: number; activeWorkspaceId: string | null;
  workspaces: { workspaceId: string; label: string; role: string; active: boolean }[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" }
export interface WorkspaceDevAgent { agentId: string; kind: "main" | "colleague"; state: string;
  identity: { displayName: string; title?: string }; runtime: { id: string; label: string; available: boolean }; brand?: "hara" }
export interface WorkspaceDevApproval { id: string; workspaceId: string; resourceGeneration: string; agentId: string; expiresAt: string;
  draft: { username: string; displayName: string; title: string; instructions: string; runtimeId: "pi" } }
export type WorkspaceDevMessage = { role: "user"; content: string } | { role: "assistant"; text: string; tools: string[] }
  | { role: "tool"; results: { id: string; name: string; content: string; isError: boolean }[] };
export interface WorkspaceDevSnapshot { workspaceId: string; resourceGeneration: string; label: string; selectedAgentId: string;
  agents: WorkspaceDevAgent[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key";
  budget?: { maxTokens: number; maxRequests: number; requests: number; inputTokens: number; outputTokens: number; uncertainReservedTokens: number; paused: boolean };
  connections: { revision: number; defaultConnectionId: string | null; connections: { id: string; label: string; status: string; defaultModel: string }[] };
  approvals: WorkspaceDevApproval[]; conversation: { revision: number; state: string; sessionId: string; taskId: string | null; runId: string | null;
    taskState: string | null; objective: string; history: WorkspaceDevMessage[]; pastTaskCount: number;
    usage: { modelCalls: number; inputTokens: number; outputTokens: number }; runUsage: { modelCalls: number; inputTokens: number; outputTokens: number };
    completion: { state: string; evidence?: string[] } | null; blockReason?: string | null } }
interface PendingMessage { method: "workspace.session.send" | "workspace.session.resume"; payload: Record<string, unknown>;
  message: string; state: "sending" | "unknown" }
export interface WorkspaceDevView { directory: WorkspaceDevDirectory | null; workspaceId: string | null; agentId: string | null;
  roster: WorkspaceDevAgent[];
  workspace: WorkspaceDevSnapshot | null; draft: string; loading: boolean; sending: boolean; pendingUnknown: boolean; error: string }

export class WorkspaceDevModel {
  private view: WorkspaceDevView = { directory: null, workspaceId: null, agentId: null, roster: [], workspace: null, draft: "", loading: false, sending: false, pendingUnknown: false, error: "" };
  private readonly listeners = new Set<() => void>();
  private readonly drafts = new Map<string, string>();
  private readonly pending = new Map<string, PendingMessage>();
  private epoch = 0;
  private refreshEpoch: number | null = null;
  private refreshDirty = false;
  private readonly rpc: WorkspaceDevRpc;
  private readonly nonce: () => string;
  private readonly syntheticOnly: boolean;
  constructor(rpc: WorkspaceDevRpc, nonce: () => string = () => crypto.randomUUID(), syntheticOnly = true) { this.rpc = rpc; this.nonce = nonce; this.syntheticOnly = syntheticOnly; }
  getSnapshot = (): WorkspaceDevView => this.view;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(next: Partial<WorkspaceDevView>): void { this.view = { ...this.view, ...next }; for (const listener of this.listeners) listener(); }
  private key(snapshot = this.view.workspace): string { return snapshot ? JSON.stringify([snapshot.workspaceId, snapshot.resourceGeneration, snapshot.selectedAgentId]) : ""; }
  private valid(snapshot: WorkspaceDevSnapshot, workspaceId: string, agentId?: string): void {
    if (snapshot?.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && snapshot.executionMode !== "ark-real-key") || snapshot.workspaceId !== workspaceId || !snapshot.resourceGeneration
      || (agentId && snapshot.selectedAgentId !== agentId) || !Array.isArray(snapshot.agents)
      || !Array.isArray(snapshot.conversation?.history)) throw new Error("Workspace 回應不符合原視圖，已拒絕顯示。");
  }
  private apply(snapshot: WorkspaceDevSnapshot): void {
    if (this.view.workspace && this.view.workspace.resourceGeneration !== snapshot.resourceGeneration) this.epoch++;
    const key = this.key(snapshot), pending = this.pending.get(key);
    this.update({ workspace: snapshot, workspaceId: snapshot.workspaceId, agentId: snapshot.selectedAgentId, roster: snapshot.agents,
      draft: this.drafts.get(key) ?? "", pendingUnknown: pending?.state === "unknown", sending: pending?.state === "sending", loading: false, error: "" });
  }
  async loadDirectory(): Promise<void> {
    const epoch = this.epoch; const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
    if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== "ark-real-key")) throw new Error("Workspace 模型模式不符；沒有改接其他引擎。");
    if (epoch === this.epoch) this.update({ directory });
  }
  async selectWorkspace(workspaceId: string): Promise<void> {
    const epoch = ++this.epoch;
    this.update({ workspaceId, agentId: null, roster: [], workspace: null, draft: "", loading: true, sending: false, pendingUnknown: false, error: "" });
    try {
      const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
      if (epoch !== this.epoch) return;
      if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== "ark-real-key")) throw new Error("Workspace 模型模式不符。");
      if (!directory.workspaces.some(row => row.workspaceId === workspaceId && row.active)) throw new Error("這個 Workspace 不可用。");
      this.update({ directory });
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.select", { workspaceId, expectedRevision: directory.revision });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspaceId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update({ loading: false, error: String(error) }); }
  }
  async selectAgent(agentId: string): Promise<void> {
    const workspace = this.view.workspace; if (!workspace || !workspace.agents.some(agent => agent.agentId === agentId)) return;
    const epoch = ++this.epoch;
    this.update({ agentId, workspace: null, draft: "", loading: true, sending: false, pendingUnknown: false, error: "" });
    try {
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.agent.select", { workspaceId: workspace.workspaceId,
        expectedGeneration: workspace.resourceGeneration, agentId });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspace.workspaceId, agentId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update({ loading: false, error: String(error) }); }
  }
  async refresh(): Promise<void> {
    const { workspaceId, agentId } = this.view; if (!workspaceId || !agentId) return;
    const epoch = this.epoch;
    if (this.refreshEpoch === epoch) { this.refreshDirty = true; return; }
    this.refreshEpoch = epoch;
    try {
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>("workspace.snapshot", { workspaceId, agentId });
      if (epoch !== this.epoch) return; this.valid(snapshot, workspaceId, agentId); this.apply(snapshot);
    } catch (error) { if (epoch === this.epoch) this.update({ error: String(error) }); }
    finally {
      if (this.refreshEpoch === epoch) {
        this.refreshEpoch = null; const again = this.refreshDirty; this.refreshDirty = false;
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
    if (!workspace || !key || this.view.sending || ["running", "draining"].includes(workspace.conversation.state)) return;
    const retained = this.pending.get(key);
    if (retained?.state === "unknown" && !retryUnknown) return;
    if (!workspace.connections.defaultConnectionId) { this.update({ error: this.syntheticOnly ? "請先在這個 Workspace 啟用合成連接。" : "請先在這個 Workspace 配置模型連接。" }); return; }
    const message = resume ? "/continue" : this.view.draft.trim(); if (!message && !retryUnknown) return;
    const pending: PendingMessage = retained && retryUnknown ? { ...retained, state: "sending" } : {
      method: resume ? "workspace.session.resume" : "workspace.session.send", message, state: "sending",
      payload: { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
        agentId: workspace.selectedAgentId, message, requestId: this.nonce() } };
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
      this.pending.set(key, { ...pending, state: "unknown" });
      if (this.key() === key) this.update({ sending: false, pendingUnknown: true, error: `送出結果尚未確認；請核對後用原訊息查詢，勿重複發送。${String(error)}` });
    }
  }
  async respond(card: WorkspaceDevApproval, approved: boolean): Promise<void> {
    const workspace = this.view.workspace;
    if (!workspace || card.workspaceId !== workspace.workspaceId || card.agentId !== workspace.selectedAgentId
      || card.resourceGeneration !== workspace.resourceGeneration || !workspace.approvals.some(current => current.id === card.id)) return;
    const epoch = this.epoch;
    try { await this.rpc.request("workspace.approval.respond", { workspaceId: card.workspaceId, expectedGeneration: card.resourceGeneration, approvalId: card.id, approved });
      if (epoch === this.epoch) await this.refresh();
    } catch (error) { if (epoch === this.epoch) this.update({ error: String(error) }); }
  }
  async cancel(): Promise<void> {
    const workspace = this.view.workspace; if (!workspace?.conversation.runId) return; const epoch = this.epoch;
    try { await this.rpc.request("workspace.session.cancel", { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
      agentId: workspace.selectedAgentId, runId: workspace.conversation.runId }); if (epoch === this.epoch) await this.refresh();
    } catch (error) { if (epoch === this.epoch) this.update({ error: String(error) }); }
  }
}
