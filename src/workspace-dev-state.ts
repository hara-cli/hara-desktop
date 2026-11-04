import { parseWorkspaceAssistantPreview, type WorkspaceAssistantPreview } from "./assistant-preview.ts";
import type { MessageTimingInput } from "./message-timing.ts";
import { parseMessageTimingReport, type MessageTimingReport } from "./message-timing.ts";
import { mcpReviewList, mcpReviewDetail, type McpReviewList, type McpReviewDetail } from "./workspace-mcp-review.ts";
import { extensionView, type ExtensionChange, type ExtensionProposal, type WorkspaceExtensionsView } from "./workspace-extensions.ts";
import type { RuntimeVersionStatus } from "./runtime-version-drift.ts";
import { parseRuntimeDiagnosticReceipt, parseRuntimeStageReports, sameRuntimeStageIdentity, type RuntimeDiagnosticReceipt, type RuntimeStageReport } from "./runtime-stage-events.ts";
// Pure view state for the opt-in native Workspace Dev. A view/default is never execution authority.
import { runtimeProxyView, type WorkspaceRuntimeProxyView } from "./workspace-runtime-proxy.ts";
import { WorkspaceRpcWaitError, WorkspaceViewError } from "./workspace-dev-errors.ts";
import { connectionRecoveryReason, workspaceRecoveryIdentity } from "./workspace-resume.ts";
import type { UpdatePreferences } from "./workspace-updater-state";
import type { AgentRuntimeId, AgentRuntimeOption } from "./client";
export interface WorkspaceDevRpc { request<T>(method: string, params: Record<string, unknown>): Promise<T>; supportsCapability?(capability: string): boolean; setAssistantPreviewListener?(listener: (value: WorkspaceAssistantPreview | null) => void): void; timingNow?(): MessageTimingInput | null }
export interface WorkspaceTaskRecord { taskId: string; objective: string; status: string; colleague: string }
export interface WorkspaceInheritanceView { state: "not_needed" | "pending" | "verified" | "rolled_back"; handoff: boolean }
export interface WorkspaceDevDirectory { revision: number; activeWorkspaceId: string | null;
  workspaces: { workspaceId: string; label: string; role: string; active: boolean; kind?: "personal" | "team" }[]; syntheticOnly: boolean; executionMode?: "synthetic" | "ark-real-key" | "workspace" }
export type RuntimePermissionTier = "full-protected" | "controlled";
export interface WorkspaceDevAgent { agentId: string; kind: "main" | "colleague"; state: string;
  configRevision?: number; agentEpoch?: number; description?: string; permissionTier?: RuntimePermissionTier;
  identity: { displayName: string; title?: string; emoji?: string; avatar?: string }; runtime: { id: string; label: string; available: boolean }; brand?: "hara" }
export interface ColleagueCreateDraft { username: string; displayName: string; title: string; instructions: string;
  project: string; runtimeId: AgentRuntimeId; permissionTier: RuntimePermissionTier }
export type WorkspaceDevApproval = { id: string; workspaceId: string; resourceGeneration: string; agentId: string; expiresAt: string;
  channelId?: string;
  status?: "pending" | "approved" | "rejected" | "expired"; risk?: "high" | "normal"; paid?: boolean; externalSend?: boolean; destructive?: boolean;
} & ({ kind?: "agent_create"; draft: ColleagueCreateDraft; projectOptions?: string[]; catalogRevision?: number }
  | { kind: "extension_call"; draft: { sourceName: string; toolName: string; target: string; action: "read" | "exec" } }
  | { kind: "schedule_create"; draft: { title: string; task: string; timing: string; tz: string } });
export type WorkspaceDevMessage = ({ role: "user"; content: string } | { role: "assistant"; text: string; tools: string[] }
  | { role: "tool"; results: { id: string; name: string; content: string; isError: boolean }[] }) & { createdAt?: string };
export type WorkspaceQuestionConversation = Pick<WorkspaceDevSnapshot["conversation"], "state" | "taskState" | "pendingQuestion" | "resumeAdmission" | "blockReason">;
export interface WorkspaceDevQuestion { id: string; reason: "lookup_missing" | "lookup_ambiguous" | "tool_problem" | "budget_warning" | "runaway_guard" | "explicit";
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
  runtimes?: { builtIn: string; options: { runtimeId: string; label: string; installed: boolean; registered: boolean; version: string | null; state: string; generalAgentDriverAvailable: boolean; path?: string; fingerprint?: string | null; source?: string; loginSource?: RuntimeLoginSource; manualInstallation?: { url: string }; extensionsIsolation?: "inherited"; versionStatus?: RuntimeVersionStatus }[];
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
    runtimeStages?: RuntimeStageReport[];
    messageTimings?: MessageTimingReport[];
    permissionTier?: RuntimePermissionTier;
    nativeRisks?: { id: string; runId: string; kind: "outside-workspace-delete" | "external-publish"; state: "observed"; at: string }[];
    nativeSession?: { runtimeId: "codex"; revision: number; status: "empty" | "ready" | "recovery_needed" | "new_session_required";
      contextTokens: number | null; contextLimit: number; lastAttempt: { input: number; output: number; cachedInput: number }; lastResetRequestId: string | null };
    resumeAdmission?: { allowed: boolean; reason: string | null } } }
interface PendingMessage { method: "workspace.session.send" | "workspace.session.resume" | "workspace.session.answer"; payload: Record<string, unknown>;
  message: string; state: "sending" | "unknown"; fromDraft?: boolean }
export type WorkspaceSessionRestart = "keep" | "fresh";
export type RuntimeLoginSource = "host" | "isolated";
export interface WorkspaceDevView { directory: WorkspaceDevDirectory | null; workspaceId: string | null; agentId: string | null;
  localHistoryStart: number; runtimeChanging: boolean; runtimeBlocked: boolean;
  roster: WorkspaceDevAgent[];
  workspace: WorkspaceDevSnapshot | null; draft: string; loading: boolean; sending: boolean; pendingUnknown: boolean; error: string; syncNotice: string; dismissedRecoveryIdentity: string | null }
export interface RuntimeApprovalCard { id: string; runtimeId: string; label: string; version: string; origin: string; sha256: string;
  maxBytes: number; expiresAt: string; target: { platform: string; arch: string }; workspaceId: string; resourceGeneration: string; viewEpoch: number }
export interface WorkspaceRuntimeModels { source?: "live" | "documented"; sourceURL?: string; sourceUrl?: string; runtimeId: string; revision: number; selectedModelId: string | null; selectedEffort?: string | null;
  models: { id: string; label: string; description?: string; recommended?: boolean; supportedReasoningEfforts?: string[]; defaultReasoningEffort?: string }[] }
export interface WorkspaceConnectionModels extends Omit<WorkspaceRuntimeModels, "runtimeId"> { connectionId: string; source: "live" | "documented" }
export interface WorkspaceModelConnection { id: string; label: string; status: string; defaultModel: string; defaultReasoning?: string | null; provider?: "openai" | "anthropic"; baseURL?: string; keySaved?: boolean; keyState?: "saved" | "invalid" | "pending"; credentialRequired?: boolean; cleanupPending?: boolean }
export interface LegacyConnectionPreview { id: string; label: string; provider: "openai" | "anthropic"; baseURL: string; defaultModel: string; keySaved: boolean; source: string }
export interface WorkspacePreferenceView { revision: number; theme: "system" | "light" | "dark"; readOnly: boolean; recovered: boolean; executionDetails?: "brief" | "detailed"; collapseDetails?: boolean; alwaysShowTimingDiagnostics?: boolean; updates?: UpdatePreferences }
export interface WorkspaceFeatureView { revision: number; workspaceId: string; schedules: { id: string; name: string; source?: string; anchor?: { conversationId: string; messageId: string; agentId: string }; schedule: { kind: string; expr?: string; display?: string; runAt?: number; everyMs?: number }; enabled: boolean; agentId?: string; task?: string; tz?: string }[]; skills: { id: string; description: string; enabled: boolean; version: string; availableVersion: string; locked: boolean; source: "global" | "private" }[];
  scheduler?: { schedules: { id: string; nextRunAt: number | null; awaitingHandoff: boolean; lastRun: { state: string; reason: string | null; occurredAt: number } | null }[] } }

export class WorkspaceDevModel {
  private view: WorkspaceDevView = { directory: null, workspaceId: null, agentId: null, localHistoryStart: 0, runtimeChanging: false, runtimeBlocked: false, roster: [], workspace: null, draft: "", loading: false, sending: false, pendingUnknown: false, error: "", syncNotice: "", dismissedRecoveryIdentity: null };
  private readonly listeners = new Set<() => void>();
  private preview: WorkspaceAssistantPreview | null = null;
  private readonly previewListeners = new Set<() => void>();
  private previewRequest?: { key: string; epoch: number; requestId: string; runId?: string; painted: boolean };
  getAssistantPreviewSnapshot = (): WorkspaceAssistantPreview | null => this.preview;
  subscribeAssistantPreview = (listener: () => void) => { this.previewListeners.add(listener); return () => { this.previewListeners.delete(listener); }; };
  private setPreview(value: WorkspaceAssistantPreview | null): void {
    if (this.preview === value) return; this.preview = value;
    for (const listener of this.previewListeners) listener();
  }
  private clearPreview(): void { this.previewRequest = undefined; this.setPreview(null); }
  assistantPreview(value: unknown): void {
    if (value === null) { this.clearPreview(); return; }
    const frame = parseWorkspaceAssistantPreview(value), expected = this.previewRequest, workspace = this.view.workspace;
    if (!frame || !expected || expected.epoch !== this.epoch || expected.key !== this.key() || !workspace
      || frame.requestId !== expected.requestId || frame.workspaceId !== workspace.workspaceId || frame.resourceGeneration !== workspace.resourceGeneration
      || frame.agentId !== workspace.selectedAgentId || frame.sessionId !== workspace.conversation.sessionId
      || expected.runId && expected.runId !== frame.runId) return;
    const before = this.preview;
    if (before ? frame.attemptId !== before.attemptId || frame.nativeTurnId !== before.nativeTurnId || frame.itemId !== before.itemId
      || frame.seq !== before.seq + 1 || !frame.text.startsWith(before.text) : frame.seq !== 1) return;
    expected.runId = frame.runId; this.setPreview(frame);
  }
  async paintAssistantPreview(frame: WorkspaceAssistantPreview): Promise<void> {
    const current = this.preview, expected = this.previewRequest, timing = this.rpc.timingNow?.();
    if (!current || !expected || expected.painted || expected.epoch !== this.epoch || expected.key !== this.key() || !timing
      || current.attemptId !== frame.attemptId || current.itemId !== frame.itemId || current.seq < frame.seq) return;
    expected.painted = true;
    try { await this.rpc.request("workspace.session.paint", { workspaceId: frame.workspaceId, expectedGeneration: frame.resourceGeneration,
      agentId: frame.agentId, sessionId: frame.sessionId, runId: frame.runId, attemptId: frame.attemptId, timing }); } catch { /* Optional observation only. */ }
  }
  private readonly drafts = new Map<string, string>();
  private readonly localHistoryStarts = new Map<string, { sessionId: string; offset: number; boundary: string }>();
  private readonly runtimeChanges = new Set<string>();
  private readonly runtimeModelFailures = new Set<string>();
  private readonly runtimeModelRequests = new Map<string, number>();
  private runtimeModelRequest = 0;
  /** Per-agent suppress of the Soft Dark resume card after clear / new chat / explicit dismiss. */
  private readonly dismissedRecovery = new Map<string, string>();
  private readonly pending = new Map<string, PendingMessage>();
  private readonly nativeResets = new Map<string, { requestId: string; state: "sending" | "unknown" }>();
  private readonly questionPauses = new Set<string>();
  private readonly asyncAnswers = new Set<string>();
  private readonly approvalDecisions = new Set<string>();
  private readonly mcpReviewRecords = new Map<string, { workspaceId: string; generation: string; epoch: number }>();
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
    if (!settingsOnly) rpc.setAssistantPreviewListener?.(value => this.assistantPreview(value));
  }
  getSnapshot = (): WorkspaceDevView => this.view;
  supportsRuntimePermissions(): boolean { return this.rpc.supportsCapability?.("workspace.runtime-permissions.v1") === true; }
  supportsRuntimeStages(): boolean { return this.rpc.supportsCapability?.("workspace.runtime-stage-events.v1") === true; }
  runtimeStageReports(): RuntimeStageReport[] {
    const workspace = this.view.workspace;
    if (!workspace || !this.supportsRuntimeStages()) return [];
    return parseRuntimeStageReports(workspace.conversation.runtimeStages, { workspaceId: workspace.workspaceId,
      resourceGeneration: workspace.resourceGeneration, agentId: workspace.selectedAgentId,
      sessionId: workspace.conversation.sessionId, history: workspace.conversation.history });
  }
  /** The renderer supplies only an existing, current attempt identity, never a report body or output path. */
  async exportRuntimeDiagnostic(report: RuntimeStageReport): Promise<RuntimeDiagnosticReceipt> {
    if (!this.supportsRuntimeStages()) throw new WorkspaceViewError("ws.stages.unsupported");
    const workspace = this.view.workspace, epoch = this.epoch;
    const original = this.runtimeStageReports().find(row => sameRuntimeStageIdentity(row, report));
    if (!workspace || !original) throw new WorkspaceViewError("ws.notice.scopeChanged");
    let value: unknown;
    try { value = await this.rpc.request("workspace.runtime.diagnostics.export", { workspaceId: workspace.workspaceId,
      expectedGeneration: workspace.resourceGeneration, agentId: workspace.selectedAgentId,
      sessionId: original.sessionId, runId: original.runId, attemptId: original.attemptId }); }
    catch { throw new WorkspaceViewError("ws.stages.exportFailed"); }
    const current = this.view.workspace;
    if (epoch !== this.epoch || !current || current.workspaceId !== workspace.workspaceId
      || current.resourceGeneration !== workspace.resourceGeneration || current.selectedAgentId !== workspace.selectedAgentId
      || current.conversation.sessionId !== original.sessionId
      || !this.runtimeStageReports().some(row => sameRuntimeStageIdentity(row, original))) throw new WorkspaceViewError("ws.notice.scopeChanged");
    const receipt = parseRuntimeDiagnosticReceipt(value);
    if (!receipt) throw new WorkspaceViewError("ws.stages.exportFailed");
    return receipt;
  }
  supportsLocalChannels(): boolean { return this.rpc.supportsCapability?.("workspace.local-channels.v1") === true; }
  supportsColleagueSchedules(): boolean { return this.rpc.supportsCapability?.("workspace.colleague-schedules.v1") === true; }
  supportsConnectionModels(): boolean { return this.rpc.supportsCapability?.("workspace.connection-models.v1") === true; }
  supportsNativeSessions(): boolean { return this.rpc.supportsCapability?.("workspace.native-session.v1") === true; }
  /** Core peer collaboration: @mention widening, channel_peer_wake and channel_sync. */
  supportsLocalChannelPeers(): boolean { return this.rpc.supportsCapability?.("workspace.local-channels.peer.v1") === true; }
  supportsLocalChannelPass(): boolean { return this.rpc.supportsCapability?.("workspace.channel-pass.v1") === true; }
  supportsLocalChannelQueue(): boolean { return this.rpc.supportsCapability?.("workspace.channel-queue.v1") === true; }
  supportsLocalChannelAutonomy(): boolean { return this.rpc.supportsCapability?.("workspace.channel-autonomy.v1") === true; }
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
    const workspace = this.view.workspace, agent = workspace?.agents.find(row => row.agentId === workspace.selectedAgentId);
    const runtime = agent?.runtime;
    this.view.runtimeBlocked = Boolean(runtime && (runtime.available === false
      || workspace?.runtimeOptions && !workspace.runtimeOptions.some(row => row.id === runtime.id && row.available)
      || this.runtimeModelFailures.has(this.runtimeBindingKey())));
    if (this.questionPauses.has(key) || this.pending.get(key)?.state === "sending") this.view.sending = true;
    const nativeReset = this.nativeResets.get(key);
    if (nativeReset) { this.view.sending = nativeReset.state === "sending"; this.view.pendingUnknown = nativeReset.state === "unknown"; }
    for (const listener of this.listeners) listener();
  }
  private key(snapshot = this.view.workspace): string { return snapshot ? JSON.stringify([snapshot.workspaceId, snapshot.resourceGeneration, snapshot.selectedAgentId]) : ""; }
  private runtimeBindingKey(): string {
    const workspace = this.view.workspace, agent = workspace?.agents.find(row => row.agentId === workspace.selectedAgentId);
    return agent?.runtime ? JSON.stringify([this.key(), agent.runtime.id, agent.configRevision, agent.agentEpoch]) : "";
  }
  private valid(snapshot: WorkspaceDevSnapshot, workspaceId: string, agentId?: string): void {
    if (snapshot?.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && snapshot.executionMode !== this.executionMode) || snapshot.workspaceId !== workspaceId || !snapshot.resourceGeneration
      || (agentId && snapshot.selectedAgentId !== agentId) || !Array.isArray(snapshot.agents)
      || !Array.isArray(snapshot.conversation?.history)) throw new WorkspaceViewError("ws.notice.invalidView");
    if (snapshot.conversation.messageTimings !== undefined) {
      if (!Array.isArray(snapshot.conversation.messageTimings) || snapshot.conversation.messageTimings.length > 16) throw new WorkspaceViewError("ws.notice.invalidView");
      snapshot.conversation.messageTimings = snapshot.conversation.messageTimings.map(value => {
        const report = parseMessageTimingReport(value);
        if (!report || report.workspaceId !== snapshot.workspaceId || report.resourceGeneration !== snapshot.resourceGeneration
          || report.agentId !== snapshot.selectedAgentId || report.sessionId !== snapshot.conversation.sessionId) throw new WorkspaceViewError("ws.notice.invalidView");
        return report;
      });
    }
  }
  private apply(snapshot: WorkspaceDevSnapshot): void {
    if (this.view.workspace && this.view.workspace.resourceGeneration !== snapshot.resourceGeneration) { this.epoch++; this.clearPreview(); }
    if (this.preview && (snapshot.conversation.sessionId !== this.preview.sessionId
      || snapshot.conversation.runId === this.preview.runId && (!(["running", "draining"].includes(snapshot.conversation.state))
        || snapshot.conversation.history.slice(this.preview.historyStart).some(message => message.role === "assistant" && message.text)))) this.clearPreview();
    const key = this.key(snapshot), pending = this.pending.get(key);
    const identity = workspaceRecoveryIdentity(snapshot.conversation);
    const reset = this.nativeResets.get(key), resetVerified = Boolean(reset && snapshot.conversation.nativeSession?.lastResetRequestId === reset.requestId);
    if (resetVerified) { this.nativeResets.delete(key); if (identity) this.dismissedRecovery.set(key, identity); }
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
        : snapshot.inheritance?.state === "rolled_back" ? "ws.notice.inheritanceRolledBack"
        : resetVerified ? "ws.native.newReady" : reset?.state === "unknown" ? "ws.native.resetUnknown" : "" });
  }
  async loadDirectory(): Promise<void> {
    const epoch = this.epoch; const directory = await this.rpc.request<WorkspaceDevDirectory>("workspace.list", {});
    if (directory.syntheticOnly !== this.syntheticOnly || (!this.syntheticOnly && directory.executionMode !== this.executionMode)) throw new WorkspaceViewError("ws.notice.modeMismatch");
    if (epoch === this.epoch) this.update({ directory });
  }
  async selectWorkspace(workspaceId: string): Promise<void> {
    const epoch = ++this.epoch; this.clearPreview();
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
    const epoch = ++this.epoch; this.clearPreview();
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
  async listConnectionModels(agentId: string, connectionId: string): Promise<WorkspaceConnectionModels> {
    if (!this.supportsConnectionModels()) throw new WorkspaceViewError("ws.connectionModels.upgrade");
    const result = await this.workspaceRequest<WorkspaceConnectionModels>("workspace.connection.listModels", { agentId, connectionId });
    if (result.connectionId !== connectionId || !["live", "documented"].includes(result.source)
      || !Number.isSafeInteger(result.revision) || !Array.isArray(result.models)
      || result.models.some(row => typeof row.id !== "string" || typeof row.label !== "string"
        || row.supportedReasoningEfforts !== undefined && (!Array.isArray(row.supportedReasoningEfforts)
          || row.supportedReasoningEfforts.some(level => typeof level !== "string")))) throw new WorkspaceViewError("ws.notice.invalidView");
    return result;
  }
  async selectConnectionModel(connectionId: string, modelId: string, expectedRevision: number, effort: string | null): Promise<void> {
    await this.workspaceRequest("workspace.connection.select", { connectionId, modelId, effort, expectedRevision });
    await this.refresh();
  }
  async legacyConnections(): Promise<LegacyConnectionPreview[]> { return this.workspaceRequest("workspace.connection.legacy"); }
  async importConnection(sourceId: string): Promise<void> {
    await this.workspaceRequest("workspace.connection.import", { sourceId, approved: true, expectedRevision: this.view.workspace!.connections.revision }); await this.refresh();
  }
  private assertRuntimeProxyScope(workspaceId: string, generation: string): void {
    const workspace = this.view.workspace;
    if (workspace?.workspaceId !== workspaceId || workspace.resourceGeneration !== generation) throw new WorkspaceViewError("ws.notice.scopeChanged");
  }
  supportsExtensionManager(): boolean { return this.rpc.supportsCapability?.("workspace.extensions.manager.v1") === true; }
  supportsExtensions(): boolean { return this.rpc.supportsCapability?.("workspace.extensions.v1") === true; }
  private assertExtensionScope(workspaceId: string, generation: string, agent?: { agentId: string; agentEpoch: number }): void {
    this.assertRuntimeProxyScope(workspaceId, generation);
    if (!this.supportsExtensions()) throw new WorkspaceViewError("ws.extensions.unavailable");
    if (agent && !this.view.workspace?.agents.some(row => row.agentId === agent.agentId && row.agentEpoch === agent.agentEpoch && row.state === "active")) throw new WorkspaceViewError("ws.notice.scopeChanged");
  }
  async extensions(workspaceId: string, generation: string, agent?: { agentId: string; agentEpoch: number }): Promise<WorkspaceExtensionsView> {
    this.assertExtensionScope(workspaceId, generation, agent);
    const value = await this.workspaceRequest<unknown>(agent ? "workspace.agents.extensions.list" : "workspace.extensions.list", agent ?? {});
    this.assertExtensionScope(workspaceId, generation, agent); return extensionView(value, workspaceId, generation, agent);
  }
  async proposeExtensions(change: ExtensionChange, expectedRevision: number, workspaceId: string, generation: string): Promise<ExtensionProposal> {
    this.assertExtensionScope(workspaceId, generation, change.target === "agent" ? change : undefined);
    const value = await this.workspaceRequest<ExtensionProposal>("workspace.extensions.propose", { change, expectedRevision });
    this.assertExtensionScope(workspaceId, generation, change.target === "agent" ? change : undefined);
    if (value.workspaceId !== workspaceId || value.resourceGeneration !== generation || value.revision !== expectedRevision
      || !/^[a-f0-9-]{36}$/u.test(value.proposalId) || JSON.stringify(value.change) !== JSON.stringify({ ...change, allowedTools: [...change.allowedTools].sort() })) throw new WorkspaceViewError("ws.extensions.saveUnknown");
    return value;
  }
  async approveExtensions(proposal: ExtensionProposal, approved: boolean): Promise<WorkspaceExtensionsView> {
    const { workspaceId, resourceGeneration: generation, change } = proposal;
    this.assertExtensionScope(workspaceId, generation, change.target === "agent" ? change : undefined);
    const value = await this.workspaceRequest<unknown>("workspace.extensions.approve", { proposalId: proposal.proposalId, approved, expectedRevision: proposal.revision });
    this.assertExtensionScope(workspaceId, generation, change.target === "agent" ? change : undefined);
    return extensionView(value, workspaceId, generation, change.target === "agent" ? change : undefined);
  }
  supportsMcpOwnerReview(): boolean { return this.rpc.supportsCapability?.("workspace.extensions.owner-review.v1") === true; }
  private assertMcpReviewScope(workspaceId: string, generation: string, recordId?: string): void {
    this.assertExtensionScope(workspaceId, generation);
    const workspace = this.view.workspace!, agent = workspace.agents.find(row => row.agentId === workspace.selectedAgentId);
    if (!this.supportsMcpOwnerReview() || !agent || agent.kind !== "main" || agent.state !== "active") throw new WorkspaceViewError("ws.mcpReview.owner_required");
    if (recordId) {
      const record = this.mcpReviewRecords.get(recordId);
      if (!record || record.workspaceId !== workspaceId || record.generation !== generation || record.epoch !== this.epoch) throw new WorkspaceViewError("ws.notice.scopeChanged");
    }
  }
  async mcpReviews(workspaceId: string, generation: string): Promise<McpReviewList> {
    this.assertMcpReviewScope(workspaceId, generation);
    const value = mcpReviewList(await this.workspaceRequest("workspace.extensions.review.list"), workspaceId, generation);
    this.assertMcpReviewScope(workspaceId, generation); this.mcpReviewRecords.clear();
    for (const source of value.sources) if (source.recordId) this.mcpReviewRecords.set(source.recordId, { workspaceId, generation, epoch: this.epoch });
    return value;
  }
  async describeMcpReview(recordId: string, workspaceId: string, generation: string): Promise<McpReviewDetail> {
    this.assertMcpReviewScope(workspaceId, generation, recordId);
    const value = await this.workspaceRequest("workspace.extensions.review.describe", { recordId });
    this.assertMcpReviewScope(workspaceId, generation, recordId); return mcpReviewDetail(value, workspaceId, generation, recordId);
  }
  async decideMcpReview(action: "inspect" | "approve" | "revoke", recordId: string, workspaceId: string, generation: string): Promise<McpReviewDetail> {
    this.assertMcpReviewScope(workspaceId, generation, recordId);
    if (!["inspect", "approve", "revoke"].includes(action)) throw new WorkspaceViewError("ws.notice.scopeChanged");
    const value = await this.workspaceRequest("workspace.extensions.review." + action, { recordId, confirmed: true });
    this.assertMcpReviewScope(workspaceId, generation, recordId); return mcpReviewDetail(value, workspaceId, generation, recordId);
  }
  async cancelMcpReview(recordId: string, workspaceId: string, generation: string): Promise<void> {
    this.assertMcpReviewScope(workspaceId, generation, recordId);
    await this.workspaceRequest("workspace.extensions.review.cancel", { recordId }); this.mcpReviewRecords.delete(recordId);
  }
  async runtimeProxy(workspaceId: string, generation: string): Promise<WorkspaceRuntimeProxyView> {
    this.assertRuntimeProxyScope(workspaceId, generation);
    const value = await this.workspaceRequest<unknown>("workspace.runtime.proxy.get");
    return runtimeProxyView(value, workspaceId, generation);
  }
  async saveRuntimeProxy(proxyUrl: string | null, expectedRevision: number, workspaceId: string, generation: string): Promise<WorkspaceRuntimeProxyView> {
    this.assertRuntimeProxyScope(workspaceId, generation);
    const value = await this.workspaceRequest<unknown>("workspace.runtime.proxy.set", { proxyUrl, expectedRevision });
    return runtimeProxyView(value, workspaceId, generation);
  }
  async detectRuntimes(): Promise<void> {
    const key = this.runtimeBindingKey(), epoch = this.epoch;
    this.runtimeModelRequests.set(key, ++this.runtimeModelRequest);
    try { await this.workspaceRequest("workspace.runtime.detect"); await this.refresh(); }
    catch (cause) {
      if (epoch === this.epoch && key === this.runtimeBindingKey()) { this.runtimeModelFailures.add(key); this.update({}); }
      throw cause;
    }
  }
  async codexLoginInstructions(): Promise<{ runtimeId: "codex"; shell: "posix" | "powershell"; command: string }> {
    const result = await this.workspaceRequest<{ runtimeId: "codex"; shell: "posix" | "powershell"; command: string }>("workspace.runtime.loginInstructions", { runtimeId: "codex" });
    if (result.runtimeId !== "codex" || !["posix", "powershell"].includes(result.shell) || typeof result.command !== "string" || !result.command.trim() || result.command.length > 32_768 || /[\r\n\0]/.test(result.command)) throw new Error("Invalid private Codex login guidance");
    return result;
  }
  async registerLocalRuntime(runtimeId: string, fingerprint: string, workspaceId: string, generation: string, loginSource: RuntimeLoginSource): Promise<void> {
    if (loginSource !== "host" && loginSource !== "isolated") throw new WorkspaceViewError("ws.notice.invalidView");
    if (this.view.workspaceId !== workspaceId || this.view.workspace?.resourceGeneration !== generation) throw new WorkspaceViewError("ws.notice.localConfirmationExpired");
    await this.workspaceRequest("workspace.runtime.registerLocal", { runtimeId, fingerprint, approved: true, loginSource }); await this.refresh();
  }
  async listRuntimeModels(runtimeId: string): Promise<WorkspaceRuntimeModels> {
    const workspace = this.view.workspace, epoch = this.epoch, key = this.runtimeBindingKey();
    const bound = workspace?.agents.find(row => row.agentId === workspace.selectedAgentId)?.runtime?.id === runtimeId;
    const request = ++this.runtimeModelRequest;
    if (bound) this.runtimeModelRequests.set(key, request);
    const current = () => bound && epoch === this.epoch && key === this.runtimeBindingKey() && this.runtimeModelRequests.get(key) === request;
    try {
      const result = await this.workspaceRequest<WorkspaceRuntimeModels>("workspace.runtime.listModels", { runtimeId });
      if (result.runtimeId !== runtimeId || result.source !== undefined && result.source !== "live" && result.source !== "documented" || !Number.isSafeInteger(result.revision) || !Array.isArray(result.models)
        || result.selectedEffort !== undefined && result.selectedEffort !== null && typeof result.selectedEffort !== "string"
        || result.models.some(row => typeof row.id !== "string" || typeof row.label !== "string"
          || row.supportedReasoningEfforts !== undefined && (!Array.isArray(row.supportedReasoningEfforts)
            || row.supportedReasoningEfforts.some(level => typeof level !== "string"))
          || row.defaultReasoningEffort !== undefined && typeof row.defaultReasoningEffort !== "string")) throw new WorkspaceViewError("ws.notice.invalidView");
      if (current()) {
        if (result.models.length) this.runtimeModelFailures.delete(key); else this.runtimeModelFailures.add(key);
        this.update({});
      }
      return result;
    } catch (cause) {
      if (current()) { this.runtimeModelFailures.add(key); this.update({}); }
      throw cause;
    }
  }
  async selectRuntimeModel(runtimeId: string, modelId: string, expectedRevision: number, effort?: string | null): Promise<void> {
    await this.workspaceRequest("workspace.runtime.selectModel", { runtimeId, modelId, expectedRevision, ...(effort !== undefined ? { effort } : {}) });
    await this.refresh();
  }
  async setAgentPermissionTier(agent: WorkspaceDevAgent, permissionTier: RuntimePermissionTier): Promise<void> {
    if (!this.supportsRuntimePermissions()) throw new WorkspaceViewError("ws.permissions.upgrade");
    if (!agent.configRevision || !agent.agentEpoch || !["full-protected", "controlled"].includes(permissionTier)) throw new WorkspaceViewError("ws.notice.invalidView");
    const workspace = this.view.workspace, epoch = this.epoch, key = this.key();
    if (!workspace || !workspace.agents.some(row => row.agentId === agent.agentId && row.configRevision === agent.configRevision && row.agentEpoch === agent.agentEpoch)
      || ["running", "draining"].includes(workspace.conversation.state) || this.view.sending || this.view.pendingUnknown) throw new WorkspaceViewError("ws.permissions.busy");
    const targetKey = JSON.stringify([workspace.workspaceId, workspace.resourceGeneration, agent.agentId]);
    if (this.runtimeChanges.has(targetKey)) throw new WorkspaceViewError("ws.notice.scopeChanged");
    this.runtimeChanges.add(targetKey); this.update({});
    try {
      await this.workspaceRequest("workspace.agents.setPermissionTier", { agentId: agent.agentId, permissionTier, configRevision: agent.configRevision, agentEpoch: agent.agentEpoch });
      this.overviewCache.delete(agent.agentId);
      if (epoch !== this.epoch || key !== this.key()) return;
      await this.refresh();
      if (epoch === this.epoch && this.view.workspace?.agents.find(row => row.agentId === agent.agentId)?.permissionTier !== permissionTier) throw new WorkspaceViewError("ws.notice.invalidView");
    } finally { this.runtimeChanges.delete(targetKey); this.update({}); }
  }
  async setAgentRuntime(agent: WorkspaceDevAgent, runtimeId: AgentRuntimeId, sessionRestart: WorkspaceSessionRestart = "keep"): Promise<void> {
    if (!agent.configRevision || !agent.agentEpoch) throw new WorkspaceViewError("ws.notice.invalidView");
    const workspace = this.view.workspace, key = this.key(), epoch = this.epoch;
    if (!workspace || this.nativeResets.has(key) || (sessionRestart !== "keep" && sessionRestart !== "fresh")
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
  async saveTimingDiagnosticsPreference(alwaysShowTimingDiagnostics: boolean): Promise<WorkspacePreferenceView> {
    const current = await this.preferences(); return this.rpc.request("workspace.preferences.set", { theme: current.theme, expectedRevision: current.revision, alwaysShowTimingDiagnostics });
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
  async approveRuntime(card: RuntimeApprovalCard, approved: boolean, loginSource: RuntimeLoginSource): Promise<void> {
    if (loginSource !== "host" && loginSource !== "isolated") throw new WorkspaceViewError("ws.notice.invalidView");
    const workspace = this.view.workspace;
    if (!workspace || workspace.workspaceId !== card.workspaceId || workspace.resourceGeneration !== card.resourceGeneration || card.viewEpoch !== this.epoch) throw new WorkspaceViewError("ws.notice.installScopeMismatch");
    await this.rpc.request("workspace.runtime.approve", { workspaceId: card.workspaceId, expectedGeneration: card.resourceGeneration, proposalId: card.id, approved, loginSource });
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

  /** The user explicitly retires this native thread. No send, resume, model call or local history
   * rewrite accompanies the reset. Unknown transport outcomes stay latched until a scoped readback. */
  async newNativeSession(): Promise<void> {
    const w = this.view.workspace, key = this.key(), native = w?.conversation.nativeSession;
    if (!w || !key || !native || !this.supportsNativeSessions() || native.runtimeId !== "codex"
      || w.agents.find(row => row.agentId === w.selectedAgentId)?.runtime.id !== "codex"
      || this.view.sending || this.view.pendingUnknown || this.runtimeChanges.has(key) || this.pending.has(key) || this.nativeResets.has(key)
      || ["running", "draining"].includes(w.conversation.state) || w.conversation.pendingQuestion || w.conversation.pendingInteractions?.length) return;
    const epoch = this.epoch, reset = { requestId: this.nonce(), state: "sending" as "sending" | "unknown" };
    this.nativeResets.set(key, reset); this.update({ sending: true, error: "", syncNotice: "" });
    try {
      const receipt = await this.rpc.request<{ requestId: string; revision: number }>("workspace.session.new", {
        workspaceId: w.workspaceId, expectedGeneration: w.resourceGeneration, agentId: w.selectedAgentId,
        expectedRevision: w.conversation.revision, expectedNativeRevision: native.revision, requestId: reset.requestId, approved: true });
      if (receipt.requestId !== reset.requestId || !Number.isSafeInteger(receipt.revision) || receipt.revision <= native.revision) throw new WorkspaceViewError("ws.notice.invalidReceipt");
      this.nativeResets.delete(key);
      const identity = workspaceRecoveryIdentity(w.conversation); if (identity) this.dismissedRecovery.set(key, identity);
      if (epoch === this.epoch && this.key() === key) {
        this.update({ sending: false, pendingUnknown: false }); await this.refresh();
        if (epoch === this.epoch && this.key() === key) this.update({ syncNotice: "ws.native.newReady" });
      }
    } catch (error) {
      if (this.nativeResets.get(key) !== reset) return; // a scoped snapshot already verified this nonce
      if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
        this.nativeResets.delete(key);
        if (this.key() === key) this.update({ sending: false, pendingUnknown: false, error: "ws.native.resetRejected" });
      } else {
        reset.state = "unknown";
        if (this.key() === key) {
          this.update({ sending: false, pendingUnknown: true, syncNotice: "ws.native.resetUnknown" });
          await this.refresh();
        }
      }
    } finally { this.update({}); }
  }

  async send(resume = false, answer?: { questionId: string; message: string; fromDraft?: boolean }): Promise<void> {
    const workspace = this.view.workspace, key = this.key();
    if (!workspace || !key || this.runtimeChanges.has(key) || this.nativeResets.has(key) || this.view.sending || ["running", "draining"].includes(workspace.conversation.state)) return;
    const retained = this.pending.get(key);
    if (retained || this.questionPauses.has(key)) return;
    // Desk preflight: retain drafts and pending questions; Core still owns run admission.
    if (!answer && this.view.runtimeBlocked) { this.update({ error: "ws.runtimeAccess.runBlocked" }); return; }
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
    this.previewRequest = { key, epoch: this.epoch, requestId: String(pending.payload.requestId), painted: false }; this.setPreview(null);
    this.pending.set(key, pending); this.update({ sending: true, pendingUnknown: false, error: "",
      dismissedRecoveryIdentity: (!resume && !answer) ? (workspaceRecoveryIdentity(workspace.conversation) ?? this.view.dismissedRecoveryIdentity) : this.view.dismissedRecoveryIdentity });
    try {
      const accepted = await this.rpc.request<{ runId?: string }>(pending.method, pending.payload);
      if (this.previewRequest?.requestId === pending.payload.requestId && accepted?.runId) {
        if (this.previewRequest.runId && this.previewRequest.runId !== accepted.runId) this.clearPreview();
        else this.previewRequest.runId = accepted.runId;
      }
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
    if (this.nativeResets.get(key)?.state === "unknown") { await this.refresh(); return; }
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
  async respond(card: WorkspaceDevApproval, approved: boolean, draft?: ColleagueCreateDraft): Promise<void> {
    const workspace = this.view.workspace;
    if (!workspace || card.workspaceId !== workspace.workspaceId || card.agentId !== workspace.selectedAgentId
      || card.resourceGeneration !== workspace.resourceGeneration || !workspace.approvals.some(current => current.id === card.id)) return;
    const decisionKey = JSON.stringify([card.workspaceId, card.resourceGeneration, card.id]);
    if (this.approvalDecisions.has(decisionKey)) return;
    this.approvalDecisions.add(decisionKey);
    const epoch = this.epoch;
    try { await this.rpc.request("workspace.approval.respond", { workspaceId: card.workspaceId, expectedGeneration: card.resourceGeneration, approvalId: card.id, approved,
      ...(approved && card.kind !== "schedule_create" && card.kind !== "extension_call" && draft ? { draft } : {}) });
      if (epoch === this.epoch) await this.refresh();
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof WorkspaceRpcWaitError) { this.update({ syncNotice: "ws.notice.approvalPending" }); await this.refresh(); }
      else this.update({ error: String(error) });
    } finally { this.approvalDecisions.delete(decisionKey); }
  }
  async cancel(): Promise<void> {
    this.clearPreview();
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
