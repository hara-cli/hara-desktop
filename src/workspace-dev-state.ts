// Pure view state for the opt-in native Workspace Dev. A view/default is never execution authority.
import { WorkspaceRpcWaitError, WorkspaceViewError } from "./workspace-dev-errors.ts";
import { connectionRecoveryReason, workspaceRecoveryIdentity } from "./workspace-resume.ts";
import type { UpdatePreferences } from "./workspace-updater-state";
import type { AgentRuntimeId, AgentRuntimeOption } from "./client";
export interface WorkspaceDevRpc { request<T>(method: string, params: Record<string, unknown>): Promise<T>; supportsCapability?(capability: string): boolean }
export interface WorkspaceTaskRecord { taskId: string; objective: string; status: string; colleague: string }
export interface WorkspaceInheritanceView { state: "not_needed" | "pending" | "verified" | "rolled_back"; handoff: boolean }
export interface WorkspaceDevDirectory { revision: number; activeWorkspaceId: string | null;
  workspaces: { workspaceId: string; label: string; role: string; active: boolean; kind?: "personal" | "team" }[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace" }
export interface WorkspaceDevAgent { agentId: string; kind: "main" | "colleague"; state: string;
  configRevision?: number; agentEpoch?: number; description?: string;
  identity: { displayName: string; title?: string; emoji?: string; avatar?: string }; runtime: { id: string; label: string; available: boolean }; brand?: "hara" }
export interface WorkspaceDevApproval { id: string; workspaceId: string; resourceGeneration: string; agentId: string; expiresAt: string;
  channelId?: string;
  status?: "pending" | "approved" | "rejected" | "expired"; risk?: "high" | "normal"; paid?: boolean; externalSend?: boolean; destructive?: boolean;
  draft: { username: string; displayName: string; title: string; instructions: string; runtimeId: "pi" } }
export type WorkspaceDevMessage = ({ role: "user"; content: string } | { role: "assistant"; text: string; tools: string[] }
  | { role: "tool"; results: { id: string; name: string; content: string; isError: boolean }[] }) & { createdAt?: string };
export type WorkspaceQuestionConversation = Pick<WorkspaceDevSnapshot["conversation"], "state" | "taskState" | "pendingQuestion" | "resumeAdmission" | "blockReason">;
export interface WorkspaceDevQuestion { id: string; reason: "lookup_missing" | "lookup_ambiguous" | "tool_problem" | "budget_warning" | "explicit";
  question: string; options: string[]; taskId: string; runId: string; step?: string; header?: string; intent?: "rename_target" }
/** Core unified interaction (workspace.interaction.v2). pendingQuestion remains the sync legacy shape. */
export type WorkspaceDevInteraction =
  | { requestId: string; kind: "ask_user_question"; delivery: "sync" | "async"; questions: { question: string; header?: string; options: string[] }[];
    metadata: { reason: WorkspaceDevQuestion["reason"]; intent?: "rename_target"; taskId: string; runId: string } }
  | { requestId: string; kind: "permission"; delivery: "sync"; action: string; summary: string; metadata: { runId: string } }
  | { requestId: string; kind: "plan_review"; delivery: "sync"; plan: string; metadata: { taskId: string; runId: string } };
export type WorkspaceDevAsyncAsk = Extract<WorkspaceDevInteraction, { kind: "ask_user_question" }>;
/** Non-blocking asks only. They never replace or lock the composer; an older Core simply sends none. */
export function workspaceAsyncAsks(conversation: { pendingInteractions?: WorkspaceDevInteraction[] } | null | undefined): WorkspaceDevAsyncAsk[] {
  return (conversation?.pendingInteractions ?? []).filter((row): row is WorkspaceDevAsyncAsk => row.kind === "ask_user_question" && row.delivery === "async");
}
export interface WorkspaceDevSnapshot { workspaceId: string; resourceGeneration: string; label: string; selectedAgentId: string;
  runtimeOptions?: AgentRuntimeOption[];
  colleagueLimit?: number;
  inheritance?: WorkspaceInheritanceView;
  agents: WorkspaceDevAgent[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace";
  runtimes?: { builtIn: string; options: { runtimeId: string; label: string; installed: boolean; registered: boolean; version: string | null; state: string; generalAgentDriverAvailable: boolean; path?: string; fingerprint?: string | null; source?: string }[];
    operations: { id: string; runtimeId: string; state: string }[] };
  budget?: { maxTokens: number; maxRequests: number; requests: number; inputTokens: number; outputTokens: number; uncertainReservedTokens: number; paused: boolean };
  connections: { revision: number; defaultConnectionId: string | null; activeConnectionId?: string | null; readOnly?: boolean; recovered?: boolean; migrationPending?: boolean; unavailable?: boolean; connections: WorkspaceModelConnection[] };
  /** Account-native, read-only projection from Core. Absent on older Core means unknown. */
  accountUsage?: { agentId: string; state: "ok" | "limit_reached" | "parse_unavailable";
    view: { runtimeId: string; connectionId: string | null; scope: string; authority: string | null;
      availability: "available" | "exhausted" | "unknown"; fresh: boolean; fetchedAt: string | null; resetAt: string | null } }[];
  approvals: WorkspaceDevApproval[]; conversation: { revision: number; state: string; sessionId: string; taskId: string | null; runId: string | null;
    taskState: string | null; objective: string; history: WorkspaceDevMessage[]; pastTaskCount: number; updatedAt?: string; unreadCount?: number;
    usage: { modelCalls: number; inputTokens: number; outputTokens: number }; runUsage: { modelCalls: number; inputTokens: number; outputTokens: number };
    completion: { state: string; evidence?: string[] } | null; blockReason?: string | null; pendingQuestion?: WorkspaceDevQuestion | null;
    pendingInteractions?: WorkspaceDevInteraction[];
    resumeAdmission?: { allowed: boolean; reason: string | null } } }
interface PendingMessage { method: "workspace.session.send" | "workspace.session.resume" | "workspace.session.answer"; payload: Record<string, unknown>;
  message: string; state: "sending" | "unknown"; fromDraft?: boolean }
export type WorkspaceSessionRestart = "keep" | "fresh";
export interface WorkspaceDevView { directory: WorkspaceDevDirectory | null; workspaceId: string | null; agentId: string | null;
  localHistoryStart: number; runtimeChanging: boolean;
  roster: WorkspaceDevAgent[];
  workspace: WorkspaceDevSnapshot | null; draft: string; loading: boolean; sending: boolean; pendingUnknown: boolean; error: string; syncNotice: string; dismissedRecoveryIdentity: string | null }
export interface RuntimeApprovalCard { id: string; runtimeId: string; label: string; version: string; origin: string; sha256: string;
  maxBytes: number; expiresAt: string; target: { platform: string; arch: string }; workspaceId: string; resourceGeneration: string; viewEpoch: number }
export interface WorkspaceRuntimeModels { runtimeId: string; revision: number; selectedModelId: string | null;
  models: { id: string; label: string; description?: string; recommended?: boolean }[] }
export interface WorkspaceModelConnection { id: string; label: string; status: string; defaultModel: string; provider?: "openai" | "anthropic"; baseURL?: string; keySaved?: boolean; keyState?: "saved" | "invalid" | "pending"; credentialRequired?: boolean; cleanupPending?: boolean }
export interface LegacyConnectionPreview { id: string; label: string; provider: "openai" | "anthropic"; baseURL: string; defaultModel: string; keySaved: boolean; source: string }
export interface WorkspacePreferenceView { revision: number; theme: "system" | "light" | "dark"; readOnly: boolean; recovered: boolean; executionDetails?: "brief" | "detailed"; collapseDetails?: boolean; updates?: UpdatePreferences }
export interface WorkspaceFeatureView { revision: number; workspaceId: string; schedules: { id: string; name: string; schedule: { kind: string; expr?: string; display?: string }; enabled: boolean; agentId?: string; task?: string; tz?: string }[]; skills: { id: string; description: string; enabled: boolean; version: string; availableVersion: string; locked: boolean; source: "global" | "private" }[];
  scheduler?: { schedules: { id: string; nextRunAt: number | null; awaitingHandoff: boolean; lastRun: { state: string; reason: string | null; occurredAt: number } | null }[] } }

export class WorkspaceDevModel {
  private view: WorkspaceDevView = { directory: null, workspaceId: null, agentId: null, localHistoryStart: 0, runtimeChanging: false, roster: [], workspace: null, draft: "", loading: false, sending: false, pendingUnknown: false, error: "", syncNotice: "", dismissedRecoveryIdentity: null };
  private readonly listeners = new Set<() => void>();
  private readonly drafts = new Map<string, string>();
  private readonly localHistoryStarts = new Map<string, { sessionId: string; offset: number; boundary: string }>();
  private readonly runtimeChanges = new Set<string>();
  /** Per-agent suppress of the Soft Dark resume card after clear / new chat / explicit dismiss. */
  private readonly dismissedRecovery = new Map<string, string>();
  private readonly pending = new Map<string, PendingMessage>();
  private readonly questionPauses = new Set<string>();
  private readonly asyncAnswers = new Set<string>();
  private readonly approvalDecisions = new Set<string>();
  private epoch = 0;
  private refreshEpoch: number | null = null;
  private refreshWait: Promise<void> | null = null;
  private refreshDirty = false;
  private overviewEpoch = -1;
  private overviewRoster = "";
  private overviewCache = new Map<string, WorkspaceDevSnapshot>();
  private overviewDirty = new Map<string, number>();
  private overviewPending: { epoch: number; promise: Promise<void> } | null = null;
  private readonly rpc: WorkspaceDevRpc;
  private readonly nonce: () => string;
  private readonly syntheticOnly: boolean;
  private readonly executionMode: string;
  private settingsFactory?: () => Promise<{ model: WorkspaceDevModel; close(): void }>;
  private readonly settingsOnly: boolean;
  constructor(rpc: WorkspaceDevRpc, nonce: () => string = () => crypto.randomUUID(), syntheticOnly = true, executionMode = syntheticOnly ? "synthetic" : "ark-real-key", settingsOnly = false) {
    this.rpc = rpc; this.nonce = nonce; this.syntheticOnly = syntheticOnly; this.executionMode = executionMode; this.settingsOnly = settingsOnly;
  }
  getSnapshot = (): WorkspaceDevView => this.view;
  supportsLocalChannels(): boolean { return this.rpc.supportsCapability?.("workspace.local-channels.v1") === true; }
  supportsColleagueSchedules(): boolean { return this.rpc.supportsCapability?.("workspace.colleague-schedules.v1") === true; }
  /** Core peer collaboration: @mention widening, channel_peer_wake and channel_sync. */
  supportsLocalChannelPeers(): boolean { return this.rpc.supportsCapability?.("workspace.local-channels.peer.v1") === true; }
  async localChannelRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const workspace = this.view.workspace;
    if (!workspace || workspace.workspaceId !== params.workspaceId || workspace.resourceGeneration !== params.expectedGeneration
      || (!method.startsWith("workspace.channels.") && method !== "workspace.approval.respond")) throw new WorkspaceViewError("ws.notice.scopeChanged");
    return this.rpc.request<T>(method, params);
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  setSettingsFactory(factory: () => Promise<{ model: WorkspaceDevModel; close(): void }>) { this.settingsFactory = factory; }
  openSettingsSession() { if (!this.settingsFactory) return Promise.reject(new WorkspaceViewError("ws.notice.settingsNotReady")); return this.settingsFactory(); }
  private update(next: Partial<WorkspaceDevView>): void {
    this.view = { ...this.view, ...next };
    // Scoped pending records own the dispatch latch, including when returning to an earlier view.
    const key = this.key();
    this.view.runtimeChanging = this.runtimeChanges.has(key);
    if (this.questionPauses.has(key) || this.pending.get(key)?.state === "sending") this.view.sending = true;
    for (const listener of this.listeners) listener();
  }
  private key(snapshot = this.view.workspace): string { return snapshot ? JSON.stringify([snapshot.workspaceId, snapshot.resourceGeneration, snapshot.selectedAgentId]) : ""; }
  private valid(snapshot: WorkspaceDevSnapshot, workspaceId: string, agentId?: string): void {
    if (snapshot?.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && snapshot.executionMode !== this.executionMode) || snapshot.workspaceId !== workspaceId || !snapshot.resourceGeneration
      || (agentId && snapshot.selectedAgentId !== agentId) || !Array.isArray(snapshot.agents)
      || !Array.isArray(snapshot.conversation?.history)) throw new WorkspaceViewError("ws.notice.invalidView");
  }
  private apply(snapshot: WorkspaceDevSnapshot): void {
    if (this.view.workspace && this.view.workspace.resourceGeneration !== snapshot.resourceGeneration) this.epoch++;
    const key = this.key(snapshot), pending = this.pending.get(key);
    const identity = workspaceRecoveryIdentity(snapshot.conversation);
    // A newer run replaces a prior dismiss; keep suppress only while the identity still matches.
    const dismissed = identity && this.dismissedRecovery.get(key) === identity ? identity : null;
    if (identity && this.dismissedRecovery.get(key) && this.dismissedRecovery.get(key) !== identity) this.dismissedRecovery.delete(key);
    const localStart = this.localHistoryStarts.get(key);
    this.update({ workspace: snapshot, workspaceId: snapshot.workspaceId, agentId: snapshot.selectedAgentId, roster: snapshot.agents,
      localHistoryStart: localStart && localStart.sessionId === snapshot.conversation.sessionId
        && (localStart.offset === 0 || JSON.stringify(snapshot.conversation.history[localStart.offset - 1]) === localStart.boundary)
        ? localStart.offset : 0,
      draft: this.drafts.get(key) ?? "", pendingUnknown: pending?.state === "unknown", sending: pending?.state === "sending", loading: false, error: "",
      dismissedRecoveryIdentity: dismissed,
      syncNotice: snapshot.inheritance?.state === "pending" ? "ws.notice.inheritancePending"
        : snapshot.inheritance?.state === "rolled_back" ? "ws.notice.inheritanceRolledBack" : "" });
  }
  async loadDirectory(): Promise<void> {
    const epoch = this.epoch; const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
    if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== this.executionMode)) throw new WorkspaceViewError("ws.notice.modeMismatch");
    if (epoch === this.epoch) this.update({ directory });
  }
  async selectWorkspace(workspaceId: string): Promise<void> {
    const epoch = ++this.epoch;
    this.update({ workspaceId, agentId: null, roster: [], workspace: null, draft: "", loading: true, sending: false, pendingUnknown: false, error: "", syncNotice: "" });
    try {
      const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
      if (epoch !== this.epoch) return;
      if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== this.executionMode)) throw new WorkspaceViewError("ws.notice.modeMismatch");
      if (!directory.workspaces.some(row => row.workspaceId === workspaceId && row.active)) throw new WorkspaceViewError("ws.notice.workspaceUnavailable");
      this.update({ directory });
      const snapshot = await this.rpc.request<WorkspaceDevSnapshot>(this.settingsOnly ? "workspace.settings.select" : "workspace.select", { workspaceId, expectedRevision: directory.revision });
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
      ? { syncNotice: "ws.notice.syncing" } : { error: String(error) }); }
    finally {
      refreshed();
      if (this.refreshEpoch === epoch) {
        this.refreshEpoch = null; this.refreshWait = null; const again = this.refreshDirty; this.refreshDirty = false;
        if (again && epoch === this.epoch) queueMicrotask(() => { void this.refresh(); });
      }
    }
  }
  setDraft(draft: string): void { const key = this.key(); if (this.runtimeChanges.has(key)) return; if (key) this.drafts.set(key, draft); this.update({ draft }); }
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
    } catch { if (epoch === this.epoch) this.update({ error: "ws.connections.saveUnknown" }); return false; }
  }
  async workspaceRequest<T>(method: string, extra: Record<string, unknown> = {}): Promise<T> {
    const workspace = this.view.workspace, epoch = this.epoch;
    if (!workspace) throw new WorkspaceViewError("ws.notice.selectWorkspace");
    const value = await this.rpc.request<T>(method, { ...extra, workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration });
    if (epoch !== this.epoch) throw new WorkspaceViewError("ws.notice.scopeChanged");
    return value;
  }
  async readOverview(snapshot: WorkspaceDevSnapshot, { reuseUnchanged = false } = {}): Promise<{ snapshots: WorkspaceDevSnapshot[]; incomplete: boolean }> {
    if (snapshot !== this.view.workspace) throw new Error("Overview view changed");
    const epoch = this.epoch;
    const roster = JSON.stringify(snapshot.agents.map(agent => agent.agentId));
    if (this.overviewEpoch !== epoch || this.overviewRoster !== roster) {
      this.overviewEpoch = epoch; this.overviewRoster = roster;
      this.overviewCache.clear(); this.overviewDirty.clear(); this.overviewPending = null;
    }
    if (!reuseUnchanged) this.invalidateOverview();
    this.overviewCache.set(snapshot.selectedAgentId, snapshot);
    if (this.overviewPending?.epoch === epoch) {
      await this.overviewPending.promise;
      if (epoch !== this.epoch || !this.view.workspace) throw new Error("Overview view changed");
      return this.readOverview(this.view.workspace, { reuseUnchanged: true });
    }
    const agents = snapshot.agents.filter(agent => agent.agentId !== snapshot.selectedAgentId
      && (!this.overviewCache.has(agent.agentId) || this.overviewDirty.has(agent.agentId)));
    const pending = { epoch, promise: Promise.resolve() };
    this.overviewPending = pending;
    pending.promise = (async () => {
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, agents.length) }, async () => {
        while (cursor < agents.length && epoch === this.epoch && this.overviewRoster === roster) {
          const agent = agents[cursor++], revision = this.overviewDirty.get(agent.agentId);
          try {
            const value = await this.rpc.request<WorkspaceDevSnapshot>("workspace.snapshot", { workspaceId: snapshot.workspaceId, agentId: agent.agentId });
            this.valid(value, snapshot.workspaceId, agent.agentId);
            if (epoch !== this.epoch || this.overviewRoster !== roster) continue;
            if (value.resourceGeneration !== snapshot.resourceGeneration) throw new Error("Overview generation changed");
            this.overviewCache.set(agent.agentId, value);
            if (revision === this.overviewDirty.get(agent.agentId)) this.overviewDirty.delete(agent.agentId);
          } catch {
            if (epoch === this.epoch && this.overviewRoster === roster) this.overviewCache.delete(agent.agentId);
          }
        }
      }));
    })();
    try { await pending.promise; }
    finally { if (this.overviewPending === pending) this.overviewPending = null; }
    if (epoch !== this.epoch || this.view.workspace?.resourceGeneration !== snapshot.resourceGeneration) throw new Error("Overview view changed");
    const current = this.view.workspace;
    return { snapshots: [current, ...current.agents.flatMap(agent => agent.agentId === current.selectedAgentId ? [] : this.overviewCache.get(agent.agentId) ?? [])],
      incomplete: current.agents.some(agent => agent.agentId !== current.selectedAgentId && (!this.overviewCache.has(agent.agentId) || this.overviewDirty.has(agent.agentId))) };
  }
  workspaceChanged(workspaceId: string, agentId?: string): void {
    if (workspaceId !== this.view.workspaceId) return;
    if (agentId) this.overviewDirty.set(agentId, (this.overviewDirty.get(agentId) ?? 0) + 1);
    else this.invalidateOverview();
    void this.refresh();
  }
  invalidateOverview(): void {
    for (const agent of this.view.workspace?.agents ?? []) this.overviewDirty.set(agent.agentId, (this.overviewDirty.get(agent.agentId) ?? 0) + 1);
  }
  async editConnection(connectionId: string, input: Record<string, unknown>): Promise<boolean> {
    const epoch = this.epoch;
    try { await this.workspaceRequest("workspace.connection.edit", { connectionId, input, expectedRevision: this.view.workspace!.connections.revision }); await this.refresh(); return true; }
    catch { if (epoch === this.epoch) this.update({ error: "ws.connections.editUnknown" }); return false; }
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
    if (this.view.workspaceId !== workspaceId || this.view.workspace?.resourceGeneration !== generation) throw new WorkspaceViewError("ws.notice.localConfirmationExpired");
    await this.workspaceRequest("workspace.runtime.registerLocal", { runtimeId, fingerprint, approved: true }); await this.refresh();
  }
  async listRuntimeModels(runtimeId: string): Promise<WorkspaceRuntimeModels> {
    const result = await this.workspaceRequest<WorkspaceRuntimeModels>("workspace.runtime.listModels", { runtimeId });
    if (result.runtimeId !== runtimeId || !Number.isSafeInteger(result.revision) || !Array.isArray(result.models)
      || result.models.some(row => typeof row.id !== "string" || typeof row.label !== "string")) throw new WorkspaceViewError("ws.notice.invalidView");
    return result;
  }
  async selectRuntimeModel(runtimeId: string, modelId: string, expectedRevision: number): Promise<void> {
    await this.workspaceRequest("workspace.runtime.selectModel", { runtimeId, modelId, expectedRevision });
    await this.refresh();
  }
  async setAgentRuntime(agent: WorkspaceDevAgent, runtimeId: AgentRuntimeId, sessionRestart: WorkspaceSessionRestart = "keep"): Promise<void> {
    if (!agent.configRevision || !agent.agentEpoch) throw new WorkspaceViewError("ws.notice.invalidView");
    const workspace = this.view.workspace, key = this.key(), epoch = this.epoch;
    if (!workspace || (sessionRestart !== "keep" && sessionRestart !== "fresh")
      || (sessionRestart === "fresh" && (workspace.selectedAgentId !== agent.agentId || this.pending.has(key) || this.view.sending || this.view.pendingUnknown
        || ["running", "draining"].includes(workspace.conversation.state) || workspace.conversation.pendingQuestion
        || workspace.conversation.pendingInteractions?.length))) throw new WorkspaceViewError("ws.notice.scopeChanged");
    const targetKey = JSON.stringify([workspace.workspaceId, workspace.resourceGeneration, agent.agentId]);
    if (this.runtimeChanges.has(targetKey)) throw new WorkspaceViewError("ws.notice.scopeChanged");
    this.runtimeChanges.add(targetKey); this.update({});
    try {
      await this.workspaceRequest("workspace.agents.setRuntime", { agentId: agent.agentId, runtimeId, configRevision: agent.configRevision, agentEpoch: agent.agentEpoch });
      // Desk-only reset: never claim or send an engine-session restart. Keep Core history and task bindings.
      if (sessionRestart === "fresh") {
        this.drafts.delete(key);
        this.localHistoryStarts.set(key, { sessionId: workspace.conversation.sessionId, offset: workspace.conversation.history.length,
          boundary: JSON.stringify(workspace.conversation.history[workspace.conversation.history.length - 1]) ?? "" });
        const identity = workspaceRecoveryIdentity(workspace.conversation);
        if (identity) this.dismissedRecovery.set(key, identity);
        this.overviewCache.delete(agent.agentId);
        if (epoch === this.epoch && key === this.key()) this.update({ draft: "", localHistoryStart: workspace.conversation.history.length, dismissedRecoveryIdentity: identity });
      }
      if (epoch !== this.epoch || key !== this.key()) return;
      await this.refresh();
      if (epoch === this.epoch && this.view.workspace?.agents.find(row => row.agentId === agent.agentId)?.runtime.id !== runtimeId)
        throw new WorkspaceViewError("ws.notice.invalidView");
    } finally { this.runtimeChanges.delete(targetKey); this.update({}); }
  }
  async updateAgentPersona(agent: WorkspaceDevAgent, profile: { displayName: string; title?: string; emoji?: string; avatar?: string }): Promise<void> {
    if (!agent.configRevision || !agent.agentEpoch) throw new WorkspaceViewError("ws.notice.invalidView");
    await this.workspaceRequest("workspace.agents.updatePersona", { agentId: agent.agentId, input: { profile }, configRevision: agent.configRevision, agentEpoch: agent.agentEpoch });
    await this.refresh();
  }
  async preferences(): Promise<WorkspacePreferenceView> { return this.rpc.request("workspace.preferences.get", {}); }
  async savePreference(theme: string, expectedRevision: number): Promise<WorkspacePreferenceView> { return this.rpc.request("workspace.preferences.set", { theme, expectedRevision }); }
  async saveDisplayPreference(executionDetails: "brief" | "detailed", collapseDetails: boolean): Promise<WorkspacePreferenceView> {
    const current = await this.preferences(); return this.rpc.request("workspace.preferences.set", { theme: current.theme, expectedRevision: current.revision, executionDetails, collapseDetails });
  }
  async saveUpdatePreferences(updates: UpdatePreferences): Promise<void> {
    const current = await this.preferences(); await this.rpc.request("workspace.preferences.set", { theme: current.theme, expectedRevision: current.revision, updates });
  }
  async activity(): Promise<{ running: number }> { return this.rpc.request("workspace.activity", {}); }
  async prepareUpdate(): Promise<{ id: string }> { return this.rpc.request("workspace.update.prepare", { approved: true }); }
  async releaseUpdate(id: string): Promise<void> { await this.rpc.request("workspace.update.release", { id }); }
  async proposeRuntime(runtimeId: string): Promise<RuntimeApprovalCard> {
    const workspace = this.view.workspace; if (!workspace) throw new WorkspaceViewError("ws.notice.selectWorkspace"); const epoch = this.epoch;
    const card = await this.rpc.request<Omit<RuntimeApprovalCard, "workspaceId" | "resourceGeneration" | "viewEpoch">>("workspace.runtime.propose",
      { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration, runtimeId });
    if (epoch !== this.epoch) throw new WorkspaceViewError("ws.notice.installViewChanged");
    return { ...card, workspaceId: workspace.workspaceId, resourceGeneration: workspace.resourceGeneration, viewEpoch: epoch };
  }
  async approveRuntime(card: RuntimeApprovalCard, approved: boolean): Promise<void> {
    const workspace = this.view.workspace;
    if (!workspace || workspace.workspaceId !== card.workspaceId || workspace.resourceGeneration !== card.resourceGeneration || card.viewEpoch !== this.epoch) throw new WorkspaceViewError("ws.notice.installScopeMismatch");
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
  supportsUserQuestions(): boolean { return this.rpc.supportsCapability?.("workspace.user-interaction.v1") === true; }
  async pauseQuestion(questionId: string): Promise<void> {
    const w = this.view.workspace;
    if (!w || w.conversation.pendingQuestion?.id !== questionId || !this.supportsUserQuestions() || this.view.sending || this.view.pendingUnknown) return;
    const key = this.key(); if (this.questionPauses.has(key)) return; this.questionPauses.add(key); this.update({ sending: true, error: "" });
    try { await this.rpc.request("workspace.session.pause-question", { workspaceId: w.workspaceId, expectedGeneration: w.resourceGeneration, agentId: w.selectedAgentId, questionId }); }
    catch { if (this.key() === key) this.update({ error: "ws.question.pauseUnknown" }); }
    finally { this.questionPauses.delete(key); if (this.key() === key) this.update({ sending: false }); await this.refresh(); }
  }
  supportsAsyncQuestions(): boolean { return this.rpc.supportsCapability?.("workspace.interaction.v2") === true; }
  /** Answer one open async card of the running task. It is a scoped state write, never a new message/task. */
  async answerAsync(questionId: string, message: string, fromDraft = false): Promise<void> {
    const w = this.view.workspace, key = this.key(), text = message.trim();
    if (!w || !key || !text || text === "/continue" || !this.supportsAsyncQuestions()) return;
    if (!workspaceAsyncAsks(w.conversation).some(row => row.requestId === questionId)) { this.update({ error: "ws.question.stale" }); return; }
    const flight = `${key}:${questionId}`; if (this.asyncAnswers.has(flight)) return; this.asyncAnswers.add(flight);
    try {
      await this.rpc.request("workspace.session.answer-async", { workspaceId: w.workspaceId, expectedGeneration: w.resourceGeneration, agentId: w.selectedAgentId, questionId, message: text });
      if (fromDraft && this.drafts.get(key)?.trim() === text) { this.drafts.set(key, ""); if (this.key() === key) this.update({ draft: "" }); }
    } catch { if (this.key() === key) this.update({ error: "ws.question.async.unknown" }); }
    finally { this.asyncAnswers.delete(flight); if (this.key() === key) await this.refresh(); }
  }
  async answer(questionId: string, message: string): Promise<void> {
    if (this.view.workspace?.conversation.pendingQuestion?.id !== questionId) { this.update({ error: "ws.question.stale" }); return; }
    return this.send(false, { questionId, message });
  }
  /** The chat composer is the only free-text input: while a sync question is pending, its draft answers
   * that displayed question through the same scoped answer path, and the draft clears once accepted. */
  async answerDraft(): Promise<void> {
    const question = this.view.workspace?.conversation.pendingQuestion; if (!question) return;
    return this.send(false, { questionId: question.id, message: this.view.draft, fromDraft: true });
  }

  /** User cleared chat / started new / explicitly declined resume: hide the Soft Dark resume card for this run. */
  dismissRecovery(): void {
    const workspace = this.view.workspace, key = this.key();
    if (!workspace || !key) return;
    const identity = workspaceRecoveryIdentity(workspace.conversation);
    if (!identity) return;
    this.dismissedRecovery.set(key, identity);
    this.update({ dismissedRecoveryIdentity: identity });
  }

  /** Soft Dark clear / new-context: suppress pending resume for the current unfinished run. History stays Core-owned. */
  clearConversationResume(): void { this.dismissRecovery(); }

  async send(resume = false, answer?: { questionId: string; message: string; fromDraft?: boolean }): Promise<void> {
    const workspace = this.view.workspace, key = this.key();
    if (!workspace || !key || this.runtimeChanges.has(key) || this.view.sending || ["running", "draining"].includes(workspace.conversation.state)) return;
    const retained = this.pending.get(key);
    if (retained || this.questionPauses.has(key)) return;
    if (!workspace.connections.defaultConnectionId) { this.update({ error: this.syntheticOnly ? "ws.notice.syntheticRequired" : "ws.notice.connectionRequired" }); return; }
    const question = workspace.conversation.pendingQuestion;
    if (question && (!answer || answer.questionId !== question.id)) { this.update({ error: "ws.question.answerRequired" }); return; }
    if (answer && (!question || !this.supportsUserQuestions())) { this.update({ error: "ws.question.unsupported" }); return; }
    const message = answer ? answer.message.trim() : resume ? "/continue" : this.view.draft.trim(); if (!message) return;
    if (answer && message === "/continue") { this.update({ error: "ws.question.answerRequired" }); return; }
    resume ||= message === "/continue" || Boolean(answer);
    if (resume && connectionRecoveryReason(workspace.conversation)) {
      this.update({ error: "ws.notice.resumeConnection" }); return;
    }
    if (resume && workspace.conversation.resumeAdmission?.allowed === false) {
      this.update({ error: "ws.notice.resumeBudget" }); return;
    }
    const pending: PendingMessage = {
      method: answer ? "workspace.session.answer" : resume ? "workspace.session.resume" : "workspace.session.send", message, state: "sending", ...(answer?.fromDraft ? { fromDraft: true } : {}),
      payload: { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
        agentId: workspace.selectedAgentId, message, requestId: this.nonce(), ...(answer ? { questionId: answer.questionId } : { source: "ui" }) } };
    // A normal send archives the old task in Core; suppress its resume card so clear/new work is not forced back.
    if (!resume && !answer) {
      const identity = workspaceRecoveryIdentity(workspace.conversation);
      if (identity) { this.dismissedRecovery.set(key, identity); }
    }
    this.pending.set(key, pending); this.update({ sending: true, pendingUnknown: false, error: "",
      dismissedRecoveryIdentity: (!resume && !answer) ? (workspaceRecoveryIdentity(workspace.conversation) ?? this.view.dismissedRecoveryIdentity) : this.view.dismissedRecoveryIdentity });
    try {
      await this.rpc.request(pending.method, pending.payload);
      if (this.pending.get(key) !== pending) return; this.pending.delete(key);
      if ((pending.method !== "workspace.session.answer" || pending.fromDraft) && this.drafts.get(key)?.trim() === pending.message) this.drafts.set(key, "");
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
        syncNotice: "ws.notice.acceptancePending" });
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
        || !["accepted", "rejected", "unknown"].includes(receipt.state) || (receipt.state === "accepted" && !receipt.runId)) throw new WorkspaceViewError("ws.notice.invalidReceipt");
      if (receipt.state === "unknown") {
        if (this.key() === key) this.update({ syncNotice: "ws.notice.receiptPending" }); return;
      }
      this.pending.delete(key);
      if (receipt.state === "accepted" && (pending.method !== "workspace.session.answer" || pending.fromDraft) && this.drafts.get(key)?.trim() === pending.message) this.drafts.set(key, "");
      if (this.key() === key) {
        this.update({ sending: false, pendingUnknown: false, draft: this.drafts.get(key) ?? "", error: "", syncNotice: "" });
        await this.refresh();
        if (receipt.state === "rejected" && this.key() === key) this.update({ error: "ws.notice.requestRejected" });
      }
    } catch (error) {
      if (this.key() === key && this.pending.get(key) === pending) this.update({ error: error instanceof WorkspaceRpcWaitError ? "" : String(error),
        syncNotice: "ws.notice.receiptUnavailable" });
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
      if (error instanceof WorkspaceRpcWaitError) { this.update({ syncNotice: "ws.notice.approvalPending" }); await this.refresh(); }
      else this.update({ error: String(error) });
    } finally { this.approvalDecisions.delete(decisionKey); }
  }
  async cancel(): Promise<void> {
    const workspace = this.view.workspace; if (!workspace?.conversation.runId) return; const epoch = this.epoch;
    try { await this.rpc.request("workspace.session.cancel", { workspaceId: workspace.workspaceId, expectedGeneration: workspace.resourceGeneration,
      agentId: workspace.selectedAgentId, runId: workspace.conversation.runId }); if (epoch === this.epoch) await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof WorkspaceRpcWaitError) { this.update({ syncNotice: "ws.notice.cancelPending" }); await this.refresh(); }
      else this.update({ error: String(error) });
    }
  }
}
