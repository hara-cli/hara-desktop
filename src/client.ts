// hara serve client — JSON-RPC 2.0 over WebSocket (protocol v1, mirrors hara-cli src/serve/protocol.ts).
// Request/response correlation + typed event callbacks; the UI layer stays purely declarative.

export interface Discovery {
  host: string;
  port: number;
  token: string;
  pid: number;
  version: string;
}

export type ApprovalMode = "suggest" | "auto-edit" | "full-auto";

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  model: string;
  approval?: ApprovalMode;
  /** Identity route persisted by Hara serve. Missing only for older engine/session files. */
  profileId?: string;
  /** Durable Personal/company audience. Missing only on legacy session files. */
  spaceId?: string;
  updatedAt: string;
  source?: "interactive" | "gateway" | "cron";
  sourceName?: string;
  /** Stable automation identity for cron runs. Older engines only expose sourceName. */
  jobId?: string;
  archived?: boolean;
  /** Explicit conversational identity. Missing means the built-in main Hara agent. */
  agentRef?: string;
}

/** Authoritative identity returned by session.create. Newer engines include enough metadata for Desktop
 * to surface the live draft immediately; optional fields keep Desktop compatible with older sidecars. */
export interface CreatedSessionInfo {
  sessionId: string;
  title?: string;
  cwd?: string;
  model: string;
  profileId?: string;
  spaceId?: string;
  approval?: ApprovalMode;
  updatedAt?: string;
  source?: "interactive";
  agentRef?: string;
}

export type ExternalSessionSourceId = "runtime" | "codex" | "claude";
export type ExternalRuntimeAgentKind = "codex" | "claude";
export type ExternalRuntimeEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ExternalRuntimeClaudePermissionMode = "manual" | "acceptEdits" | "plan" | "auto" | "dontAsk";
export type ExternalRuntimeCodexSandboxMode = "read-only" | "workspace-write";
export type ExternalRuntimeServiceTier = "fast";
export interface ExternalRuntimeLaunchOptions {
  model?: string;
  effort?: ExternalRuntimeEffort;
  permissionMode?: ExternalRuntimeClaudePermissionMode;
  sandboxMode?: ExternalRuntimeCodexSandboxMode;
  serviceTier?: ExternalRuntimeServiceTier;
}
export type ExternalTerminalKey = "enter" | "esc" | "up" | "down" | "left" | "right" | "tab" | "shift+tab" | "ctrl+c" | "ctrl+d" | "ctrl+l";
export type ExternalSessionSourceState = "ready" | "adapter_required" | "not_installed" | "error";
export type ExternalSessionState = "stored" | "idle" | "working" | "waiting" | "error" | "unknown";

export interface ExternalSessionSourceInfo {
  id: ExternalSessionSourceId;
  label: string;
  state: ExternalSessionSourceState;
  version?: string;
  reason?: "official_adapter_not_bundled" | "command_not_found" | "probe_failed";
  capabilities: {
    listMetadata: boolean;
    read: boolean;
    create: boolean;
    fork: boolean;
    resume: boolean;
    observeLive: boolean;
    submit: boolean;
    steer: boolean;
    interrupt: boolean;
    terminalView?: boolean;
    terminalInput?: boolean;
  };
}

export interface ExternalSessionInfo {
  /** Hara-owned opaque digest, never the provider-native thread/session ID. */
  id: string;
  sourceId: ExternalSessionSourceId;
  title: string;
  /** Basename only; Serve keeps the full local path private. */
  workspaceName: string;
  workspaceId: string;
  state: ExternalSessionState;
  createdAt: string;
  updatedAt: string;
  origin?: "cli" | "vscode" | "exec" | "appServer" | "subAgent" | "haraRuntime" | "unknown";
  agentKind?: ExternalRuntimeAgentKind | "other";
  ephemeral: boolean;
}

export interface ExternalSessionListResult {
  sources: ExternalSessionSourceInfo[];
  sessions: ExternalSessionInfo[];
  page: { limit: number; hasMore: boolean; nextCursor?: string };
}

export interface ExternalSessionMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
}

export interface ExternalSessionReadResult {
  session: ExternalSessionInfo;
  messages: ExternalSessionMessage[];
  readOnly: boolean;
  controlMode?: "history" | "managed" | "live";
}

export interface ExternalSessionForkResult extends ExternalSessionReadResult {
  sourceSessionId: string;
}

export interface ExternalTurnResult {
  sessionId: string;
  turnId: string;
  status: "completed" | "interrupted" | "failed";
  reply: string;
  error?: string;
}

export interface ExternalSteerResult {
  sessionId: string;
  turnId: string;
  accepted: true;
}

export interface ExternalTerminalSnapshot {
  sessionId: string;
  text: string;
  state: ExternalSessionState;
  updatedAt: string;
}

export interface AgentInfo {
  ref: string;
  name: string;
  description: string;
  /** Public presentation profile only; never contains the private role/system prompt. */
  identity?: AgentPublicIdentity;
  home: string;
  scope: "main" | "global" | "project";
  project?: string;
  model?: string;
  /** Agent override; absence follows the selected Space/connection default. */
  reasoningEffort?: string;
  readOnly?: boolean;
  /** Verified install provenance. The private blueprint prompt is never returned by the engine. */
  blueprint?: AgentBlueprintProvenance;
  spaceId?: string;
  owner: "personal" | "organization" | "external";
  allowedActions: Array<"chat" | "edit_profile" | "archive">;
  revision?: string;
}

export interface AgentBlueprintInstallInput {
  id: string;
  version: string;
  publisher: string;
  source: string;
  sourceRevision: string;
  license: string;
}

export interface AgentBlueprintProvenance extends AgentBlueprintInstallInput {
  digest: string;
}

export interface AgentPublicIdentity {
  version: 1;
  displayName: string;
  title?: string;
  bio?: string;
  traits?: string[];
  emoji?: string;
  avatar?: string;
  theme?: string;
  accent?: string;
  character?: string;
  source: "hara" | "openclaw" | "hermes" | "claude" | "organization" | "plugin" | "derived";
}

export interface AgentOfficeInfo {
  id: string;
  name: string;
  cwd: string;
  kind: "workspace" | "project" | "lobby";
  project?: string;
  agentRefs: string[];
}

export interface AgentCatalog {
  agents: AgentInfo[];
  offices: AgentOfficeInfo[];
  currentOfficeId: string;
  /** Personal Agent refs recoverably hidden from Hara's active staff directory. */
  dismissedAgentRefs?: string[];
}

export interface SpaceInfo {
  id: string;
  name: string;
  kind: "personal" | "organization";
  profileId: string;
  /** All known routes in this Space. Older engines omit this migration hint. */
  profileIds?: string[];
  active: boolean;
  tenantId?: string;
  authoritative: boolean;
  agentProfilePermission: "edit" | "view";
  /** Organization credential health; expired/invalid Spaces stay visible but are not switchable. */
  accessState?: OrganizationAccessState;
  /** Company-admin policy for member-owned model credentials; omitted means fail-closed. */
  personalModelConnections?: "allowed" | "blocked";
}

export interface SpaceDirectory {
  activeId: string;
  activeProfileId: string;
  activeSource: "flag" | "env" | "pin" | "default" | "fallback";
  switchLocked: boolean;
  spaces: SpaceInfo[];
}

export type CronJobStatus = "ok" | "error" | "running" | "timed_out";

export interface AutomationSchedulerInfo {
  installed: boolean;
  supported: boolean;
  platform?: string;
  detail?: string;
}

export interface AutomationDeliverySummary {
  /** Delivery targets are intentionally redacted before they cross into the renderer. */
  kind: "none" | "feishu" | "weixin" | "telegram" | "webhook" | "other";
  label: string;
  mode?: "always" | "on-output" | "on-error";
}

export interface CronJobInfo {
  id: string;
  name: string;
  mode: string;
  cwd: string;
  enabled: boolean;
  /** Full task text is available only over the authenticated local Desktop connection. */
  task?: string;
  taskPreview?: string;
  /** Parseable schedule value for editing; schedule remains the human-readable presentation. */
  scheduleSpec?: string;
  tz?: string;
  nextRunAt?: number;
  /** Preview calculation exceeded the bounded list budget; the scheduler itself remains active. */
  nextRunDeferred?: boolean;
  createdAt?: number;
  runningSince?: number;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  delivery?: AutomationDeliverySummary;
  deliverMode?: "always" | "on-output" | "on-error";
  alertAfter?: number;
  lastRunAt?: number;
  lastStatus?: CronJobStatus;
  lastError?: string;
  schedule?: string; // human description ("every 30m", "cron 0 9 * * *")
}

export interface AutomationRunInfo {
  id: string;
  title: string;
  cwd: string;
  source: "gateway" | "cron";
  sourceName?: string;
  jobId?: string;
  updatedAt: string;
  status?: CronJobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  needsAttention?: boolean;
}

export interface AutomationListResult {
  jobs: CronJobInfo[];
  sessions: AutomationRunInfo[];
  scheduler?: AutomationSchedulerInfo;
}

export interface AutomationDraftInput {
  name: string;
  schedule: string;
  task: string;
  cwd?: string;
  tz?: string;
  mode?: "print" | "org" | "command";
  /** Optional result delivery. Raw targets are write-only and never returned by automation.list. */
  deliver?: string;
  deliverMode?: "always" | "on-output" | "on-error";
  /** Explicitly remove a previously saved write-only target. Omission preserves it during updates. */
  clearDeliver?: boolean;
  alertAfter?: number;
}

export interface AutomationScheduleValidation {
  schedule: string;
  description: string;
  nextRuns: number[];
  nextRunDeferred?: boolean;
}

export type ArtifactKind = "presentation" | "spreadsheet" | "document";

export interface ArtifactLockRef {
  id: string;
  version: string;
  sha256: string;
}

export interface ArtifactRecord {
  protocol: "artifact/1";
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  currentRevisionId: string;
  origin?: string;
  dataResidency?: "local" | "cn" | "global";
  capabilityLock?: ArtifactLockRef;
  templateLock?: ArtifactLockRef;
}

export interface ArtifactRevision {
  revisionId: string;
  artifactId: string;
  parentRevisionId?: string;
  baseRevisionId: string;
  actor: "user" | "agent" | "migration";
  taskRunId?: string;
  contentRef: string;
  assetRefs: string[];
  contentDigest: string;
  changedPaths: string[];
  createdAt: string;
}

export interface ArtifactContentInfo {
  contentRef: string;
  extension: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
}

export interface ArtifactDetails {
  artifact: ArtifactRecord;
  currentRevision: ArtifactRevision;
  content: ArtifactContentInfo;
}

export interface PresentationBlock {
  id: string;
  type: string;
  literal?: unknown;
  [key: string]: unknown;
}

export interface PresentationSlide {
  id: string;
  claim: string;
  takeawayTitle: string;
  notes?: string;
  blocks: PresentationBlock[];
}

export interface PresentationProject {
  schemaVersion: "hara.presentation/1";
  title: string;
  widthEmu: number;
  heightEmu: number;
  brief: Record<string, unknown>;
  theme?: Record<string, unknown>;
  template?: Record<string, unknown>;
  slides: PresentationSlide[];
}

export interface PresentationArtifactDetails extends ArtifactDetails {
  project: PresentationProject;
  warnings?: Array<{ code: string; message: string; slideId?: string }>;
}

export type PresentationExportFormat = "json" | "html" | "pdf" | "pptx";

export interface ArtifactSummary {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  currentRevisionId: string;
  updatedAt: string;
  extension: string;
  mediaType: string;
  byteSize: number;
}

export interface ArtifactListResult {
  artifacts: ArtifactSummary[];
  invalid: number;
  truncated: boolean;
}

export interface ArtifactFinding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  suggestion?: string;
}

export interface ArtifactValidationReport {
  reportId: string;
  revisionId: string;
  validatorId: string;
  validatorVersion: string;
  createdAt: string;
  snapshotDigest?: string;
  status: "pass" | "revise" | "blocked";
  findings: ArtifactFinding[];
}

export interface ArtifactExportReceipt {
  receiptId: string;
  artifactId: string;
  revisionId: string;
  createdAt: string;
  format: string;
  fidelity: "visual-fidelity" | "template-editable" | "semantic-editable" | "roundtrip";
  validationReportId: string;
  output: {
    mediaType: string;
    byteSize: number;
    sha256: string;
  };
  warnings: Array<{
    code: string;
    severity: "warning";
    message: string;
    path?: string;
    suggestion?: string;
  }>;
}

export interface PanelSpec {
  id: string;
  title: string;
  command: string;
  args?: string[];
  port?: number;
  /** Project markers declared by the plugin. A detected panel must never launch without a project owner. */
  detect?: string[];
}

/** A panel applicable to a specific project (manifest `detect` markers matched its cwd). */
export interface ProjectPanel extends PanelSpec {
  plugin: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  skills: number;
  agents: number;
  mcpServers: number;
  panels?: PanelSpec[];
}

export interface SkillInfo {
  id: string;
  description: string;
  source: string;
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  location: "cloud" | "local" | "managed";
  auth: "api-key" | "oauth" | "none" | "managed";
  defaultModel: string;
  defaultBaseURL?: string;
  customBaseURL: boolean;
  knownModels?: readonly string[];
  /** Provider/model-specific reasoning choices available before the first live catalog probe. */
  knownModelEntries?: Array<{ id: string; effortLevels: string[] }>;
  legacy?: boolean;
}

export interface ProviderSettingsState {
  current: {
    provider: string;
    model: string;
    baseURL?: string;
    location: "cloud" | "local" | "managed";
    auth: "api-key" | "oauth" | "none" | "managed";
    keyConfigured: boolean;
    authenticated: boolean;
    profileId: string;
    profileKind: "byok" | "gateway";
    profileSource: "flag" | "env" | "pin" | "default" | "fallback";
    editable: boolean;
    environmentOverride?: boolean;
    /** Default reasoning dial for new work on this route. Missing means provider/model default. */
    reasoningEffort?: string;
    effortLevels?: string[];
    /** Managed device-token lifecycle; absent for Personal and legacy control planes. */
    tokenExpiresAt?: string;
    tokenExpired?: boolean;
  };
  providers: ProviderCatalogEntry[];
  /** Saved personal/BYOK identities. Absent on older bundled engines. Credentials are never returned. */
  connections?: ProviderConnection[];
  /** A launch override or project pin prevents changing the default connection for new sessions. */
  switchLocked?: boolean;
}

export interface ProviderConnection {
  id: string;
  label: string;
  provider: string;
  model: string;
  baseURL?: string;
  location: "cloud" | "local";
  auth: "api-key" | "oauth" | "none";
  keyConfigured: boolean;
  authenticated: boolean;
  active: boolean;
  legacyPersonal: boolean;
  removable: boolean;
  /** Redacted display hint such as ••••1234. Never a usable credential. */
  keyHint?: string;
  createdAt?: string;
  reasoningEffort?: string;
  effortLevels?: string[];
}

export interface ProviderSettingsInput {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  activatePersonal?: boolean;
  reasoningEffort?: string;
  clearReasoningEffort?: boolean;
}

export interface ProviderConnectionCreateInput extends ProviderSettingsInput {
  id: string;
  label: string;
  activate?: boolean;
}

export interface ProviderSettingsTestResult {
  ok: boolean;
  models: string[];
  entries?: ModelCatalogEntry[];
  error?: string;
}

export interface ProjectProfileUnpinResult {
  removed: boolean;
  providers: ProviderSettingsState;
  organizations: OrganizationConnectionsState;
}

export interface GatewayStatus {
  platform: "weixin" | "feishu" | string;
  label: string;
  configuration: "ready" | "process-only" | "missing" | "incomplete" | "unreadable";
  configured: boolean;
  running: boolean;
  runningInstances: number;
  runtimeState: "starting" | "connected" | "degraded" | "stopped" | "failed" | "unknown" | "unreadable";
  pid?: number;
  startedAt?: number;
  lastConnectedAt?: number;
  lastPollAt?: number;
  lastMessageAt?: number;
  lastErrorAt?: number;
  lastErrorCode?: string;
  recommendation: string;
}

export type GatewayLoginPhase =
  | "waiting"
  | "scanned"
  | "confirmed"
  | "cancelled"
  | "timed-out"
  | "failed";

export interface GatewayLoginSnapshot {
  id: string;
  platform: "weixin";
  phase: GatewayLoginPhase;
  qrPayload?: string;
  qrRevision: number;
  startedAt: number;
  updatedAt: number;
  deadlineAt: number;
  errorCode?: "network" | "invalid-response" | "qr-expired" | "local-state";
}

export type OrganizationAccessState = "valid" | "permanent" | "expiring" | "expired" | "legacy" | "invalid";

export interface OrganizationServiceSummary {
  service: "MODEL_CONTROL" | "DESK_TASKS" | "COLLAB" | "EXTENSION_CATALOG";
  mode: "HARA_HOSTED" | "CUSTOMER_HOSTED";
  accountRegion: "CN" | "GLOBAL";
  host: string;
  status: "ACTIVE";
  capabilitiesVersion: number;
  configVersion: number;
}

export interface OrganizationConnection {
  id: string;
  /** Immutable audience returned by Hara CLI; unlike id, this changes on legacy re-enrollment. */
  spaceId?: string;
  label: string;
  tenantId?: string;
  tenantName?: string;
  active: boolean;
  gatewayUrl: string;
  gatewayHost: string;
  model: string;
  /** Server-authorized models for this scoped organization credential. */
  availableModels?: string[];
  /** Company-admin default for new work. Missing means provider/model automatic. */
  reasoningEffort?: string;
  effortLevels?: string[];
  enrolledAt?: string;
  expiresAt?: string;
  /** Explicit no-date-expiry policy; the credential remains revocable and budgeted. */
  tokenNeverExpires?: boolean;
  accessState: OrganizationAccessState;
  /** Redacted active organization services. No endpoint credential enters the renderer. */
  services?: OrganizationServiceSummary[];
}

export interface OrganizationConnectionsState {
  activeId: string;
  activeSource: "flag" | "env" | "pin" | "default" | "fallback";
  switchLocked: boolean;
  connections: OrganizationConnection[];
}

export interface OrganizationEnrollmentInput {
  id: string;
  label?: string;
  gatewayUrl: string;
  code: string;
  activate?: boolean;
}

export interface OrganizationConnectionCheck {
  id: string;
  ok: boolean;
  checkedAt: number;
}

export type LearningScope = "personal" | "project" | "organization";
export type LearningKind =
  | "business_rule"
  | "user_preference"
  | "workflow"
  | "correction"
  | "failure_pattern"
  | "action_ownership";
export type LearningStatus = "pending" | "approved" | "rejected" | "revoked" | "submitted";

export interface LearningEvidence {
  id: string;
  taskHash: string;
  fingerprint: string;
  summary: string;
  source: string;
  sourceVersion: string;
  observedAt: string;
}

export interface LearningCandidate {
  version: 1;
  id: string;
  clientId: string;
  remoteId?: string;
  patternKey: string;
  kind: LearningKind;
  scope: LearningScope;
  summary: string;
  rationale?: string;
  status: LearningStatus;
  stability: "tentative" | "stable";
  occurrenceCount: number;
  distinctTaskCount: number;
  evidence: LearningEvidence[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: "user" | "organization";
  reviewNote?: string;
  submittedAt?: string;
  sourceVersion: string;
}

export interface LearningListResult {
  learnings: LearningCandidate[];
  summary: { total: number; pending: number; approved: number; stable: number };
  organization: {
    active: boolean;
    profileId?: string;
    submitAvailable: boolean;
    syncAvailable: boolean;
  };
}

export type DeskTaskState = "open" | "claimed" | "done" | "cancelled";
export type DeskTaskKind = "feedback" | "dispatch";
export type DeskRisk = "low" | "high";

export interface DeskConnection {
  profileId: string;
  configured: boolean;
  needsRebind?: boolean;
  /** Opaque, non-secret epoch that changes when this profile's Desk binding changes. */
  bindingRevision?: string;
  host?: string;
  agentId?: string;
  owner?: string;
}

export interface DeskConnectionsState {
  connections: DeskConnection[];
  legacyUnbound: boolean;
}

export interface DeskAgent {
  id: string;
  name: string;
  owner: string;
  client: string;
  role: "member" | "owner";
  createdAt: number;
  lastSeen: number;
  revoked: boolean;
}

export interface DeskTask {
  id: string;
  kind: DeskTaskKind;
  title: string;
  excerpt: string;
  risk: DeskRisk;
  state: DeskTaskState;
  createdBy: string;
  claimedBy: string | null;
  ackedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeskTaskDetail extends DeskTask {
  body: string;
}

export interface DeskEvent {
  id: number;
  taskId: string;
  actor: string;
  action: string;
  detail: string;
  at: number;
  title?: string;
  kind?: DeskTaskKind;
}

export interface DeskCircle {
  id: string;
  name: string;
  owner: string;
  createdAt: number;
}

export interface DeskSnapshot {
  profileId: string;
  fetchedAt: number;
  me: DeskAgent;
  tasks: DeskTask[];
  agents: DeskAgent[];
  events: DeskEvent[];
  circles: DeskCircle[];
  truncated: boolean;
}

export interface DeskTaskDetails {
  profileId: string;
  task: DeskTaskDetail;
  events: DeskEvent[];
}

/** `vision-sidecar` is accepted only while connecting to an older engine and is treated as unsupported. */
export type ImageInputMode = "native" | "vision-sidecar" | "unsupported" | "unknown";

export interface EffectiveAttachmentCapabilities {
  image: {
    mode: ImageInputMode;
    /** Missing only when an older Serve does not advertise its authoritative image bound. */
    maxBytes?: number;
    /** @deprecated New engines never advertise a secondary image model. */
    viaModel?: string;
  };
  textFile: "inline-text";
  directory: "bounded-inventory-and-tools";
  binaryFile: "agent-tool";
}

export interface ModelCatalogEntry {
  id: string;
  providerId: string;
  available?: boolean;
  effortLevels: string[];
  attachmentCapabilities?: EffectiveAttachmentCapabilities;
}

export interface SessionAttachmentIntent {
  clientId?: string;
  kind: "image" | "file" | "directory";
  path: string;
  mediaType?: string;
}

export type SessionSubmitMode = "start_or_steer" | "start_if_idle" | "steer";

export type SessionNotSubmittedReason =
  | "not_idle"
  | "no_active_turn"
  | "expected_turn_mismatch"
  | "configuration_mismatch"
  | "active_turn_not_steerable"
  | "attachments_not_steerable"
  | "empty_input";

export interface SessionTurnResult {
  reply: string;
  usage: { input: number; output: number };
  ctx?: CtxInfo;
  taskId: string;
  turnId: string;
  status?: "paused";
  stopReason?: "deadline" | "task_round_budget" | "max_rounds" | "strategy_stall";
}

export type SessionSubmitResult =
  | ({ submission: "started" } & SessionTurnResult)
  | { submission: "steered"; taskId: string; turnId: string }
  | {
      submission: "not_submitted";
      reason: SessionNotSubmittedReason;
      activeTurnId?: string;
      expectedTurnId?: string;
      detail?: string;
    };

export interface UserAttachmentView {
  kind: "image" | "file" | "directory";
  name: string;
  mediaType?: string;
  byteSize?: number;
  strategy:
    | "native-image"
    | "vision-sidecar"
    | "inline-or-agent-tool"
    | "directory-inventory";
}

export interface ClientHistoryMessage {
  role: string;
  text: string;
  attachments?: UserAttachmentView[];
}

export interface ReadOnlySessionResult {
  sessionId: string;
  title: string;
  cwd: string;
  model: string;
  profileId?: string;
  spaceId?: string;
  approval?: ApprovalMode;
  agentRef?: string;
  history: ClientHistoryMessage[];
  readOnly: true;
}

export interface SessionForkTarget {
  targetProfileId: string;
  targetModel: string;
  /** Durable data/permission Space; independent from the model connection used for billing. */
  targetSpaceId: string;
  /** Literal true makes cross-connection history transfer impossible to trigger accidentally. */
  transferHistory: true;
}

export interface InitializeResult {
  name: string;
  version: string;
  protocol: number;
  cwd: string;
  provider: string;
  model: string;
  setupState?: "ready" | "needs-credentials";
  capabilities?: { methods?: string[]; events?: string[]; features?: string[] };
}

/** Context watermark — how full the model's window was on the last turn (serve ≥0.117). */
export interface CtxInfo {
  lastInput: number;
  window: number;
  pct: number;
}

export type TaskLifecycleState = "running" | "waiting" | "paused" | "completed" | "blocked";
export type TaskLifecyclePhase =
  | "restored"
  | "starting"
  | "thinking"
  | "responding"
  | "tool"
  | "approval"
  | "checkpoint"
  | "steering"
  | "stopping"
  | "finished";

export interface TaskLifecycleEvent {
  version: 1;
  /** Present in Hara CLI 0.130.0+. Optional so Desktop can still attach to an older local engine. */
  streamId?: string;
  /** Strictly increases within streamId. */
  sequence?: number;
  sessionId: string;
  taskId: string;
  turnId: string;
  objective: string;
  state: TaskLifecycleState;
  taskStatus: Exclude<TaskLifecycleState, "waiting">;
  phase: TaskLifecyclePhase;
  at: string;
  updatedAt: string;
  lastOutcome?: "completed" | "error" | "empty" | "halted" | "interrupted";
  brief?: { intent: "answer" | "investigate" | "change"; goal: string };
  checkpoint: {
    done: number;
    total: number;
    current?: string;
    owner?: string;
    blockedStep?: string;
    blockReason?: string;
    nextStep?: string;
    artifacts?: string[];
    facts?: Record<string, string | number | boolean>;
    capabilities?: Record<string, {
      state: "available" | "unavailable" | "blocked" | "unknown";
      detail?: string;
    }>;
    completion?: {
      state: "verified" | "awaiting_user";
      evidence: string[];
      waitingFor?: string;
      dependency?: {
        kind: "missing_secret" | "missing_authority" | "physical_action" | "material_choice" | "external_state" | "destructive_confirmation";
        detail: string;
        evidence: string[];
        capability?: string;
        manualAction?: {
          /** Display/copy only. Desktop never executes this command. */
          command?: string;
          /** Display/copy-only check that confirms the external action took effect. */
          verifyCommand?: string;
          resumePhrase?: string;
          hints?: Array<{ term: string; detail: string }>;
        };
      };
    };
  };
  detail?: string;
  approval?: { id: string; question: string };
}

export type WorkforceCapability =
  | "orchestration"
  | "files"
  | "code"
  | "browser"
  | "research"
  | "design"
  | "office"
  | "communication"
  | "other";
export type WorkforceActorState =
  | "queued"
  | "working"
  | "waiting"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkforceActivity =
  | "planning"
  | "reading"
  | "writing"
  | "running"
  | "reviewing"
  | "awaiting_approval"
  | "delivering"
  | "idle";

export interface WorkforceActor {
  actorId: string;
  parentActorId?: string;
  kind: "root" | "subagent" | "external";
  role?: string;
  capability: WorkforceCapability;
  state: WorkforceActorState;
  activity: WorkforceActivity;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface WorkforceStateEvent {
  version: 1;
  streamId: string;
  sequence: number;
  sessionId: string;
  taskId: string;
  turnId: string;
  mode: "snapshot";
  actors: WorkforceActor[];
}

export type ServerEvent =
  | { method: "event.turn_start"; sessionId: string; taskId?: string; turnId?: string }
  | ({ method: "event.task_state" } & TaskLifecycleEvent)
  | ({ method: "event.workforce_state" } & WorkforceStateEvent)
  | { method: "event.text"; sessionId: string; delta: string }
  | { method: "event.reasoning"; sessionId: string; delta: string }
  | { method: "event.tool"; sessionId: string; name: string; preview: string }
  | { method: "event.diff"; sessionId: string; text: string }
  | { method: "event.notice"; sessionId: string; text: string }
  | {
      method: "event.surface";
      sessionId: string;
      kind: "presentation" | "spreadsheet" | "document" | "design" | "browser" | "capability";
      title: string;
      resource:
        | { type: "artifact"; artifactId: string; revisionId: string }
        | { type: "url"; url: string };
    }
  | { method: "event.turn_end"; sessionId: string; reply: string; error?: string; status?: string; taskId?: string; turnId?: string; usage: { input: number; output: number }; ctx?: CtxInfo }
  | { method: "approval.request"; sessionId: string; approvalId: string; question: string; allowAlways?: boolean }
  | { method: "external.event.turn_start"; sessionId: string; turnId: string }
  | { method: "external.event.text"; sessionId: string; turnId: string; delta: string }
  | { method: "external.event.tool"; sessionId: string; turnId: string; name: string; preview: string }
  | { method: "external.event.notice"; sessionId: string; turnId: string; text: string }
  | {
      method: "external.event.turn_end";
      sessionId: string;
      requestedSessionId: string;
      turnId: string;
      reply: string;
      status: "completed" | "interrupted" | "failed";
      error?: string;
    }
  | {
      method: "external.approval.request";
      sessionId: string;
      approvalId: string;
      question: string;
      allowAlways?: boolean;
    };

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

export class HaraClient {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private methods = new Set<string>();
  private events = new Set<string>();
  private features = new Set<string>();
  private closeWaiters = new Set<{
    resolve: () => void;
    timer: number;
  }>();
  onEvent: (e: ServerEvent) => void = () => {};
  onClose: () => void = () => {};

  async connect(host: string, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${host}:${port}`);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error(`cannot reach ws://${host}:${port}`));
      ws.onclose = () => {
        this.ws = null;
        for (const p of this.pending.values()) p.reject(new Error("connection closed"));
        this.pending.clear();
        for (const waiter of this.closeWaiters) {
          window.clearTimeout(waiter.timer);
          waiter.resolve();
        }
        this.closeWaiters.clear();
        this.onClose();
      };
      ws.onmessage = (ev) => {
        let m: any;
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.id !== undefined && m.id !== null && this.pending.has(m.id)) {
          const p = this.pending.get(m.id)!;
          this.pending.delete(m.id);
          if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
          else p.resolve(m.result);
        } else if (m.method) {
          this.onEvent({ method: m.method, ...(m.params ?? {}) } as ServerEvent);
        }
      };
    });
  }

  private call<T = any>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  async initialize(token: string): Promise<InitializeResult> {
    const result = await this.call<InitializeResult>("initialize", { token });
    this.methods = new Set(result.capabilities?.methods ?? []);
    this.events = new Set(result.capabilities?.events ?? []);
    this.features = new Set(result.capabilities?.features ?? []);
    return result;
  }
  supports(method: string): boolean {
    return this.methods.has(method);
  }
  supportsEvent(event: string): boolean {
    return this.events.has(event);
  }
  supportsFeature(feature: string): boolean {
    return this.features.has(feature);
  }
  /** Resolve only after the transport has actually closed, including the close-before-wait race. */
  waitForClose(timeoutMs = 4_000): Promise<void> {
    if (!this.ws) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let waiter: {
        resolve: () => void;
        timer: number;
      };
      const timer = window.setTimeout(() => {
        this.closeWaiters.delete(waiter);
        reject(new Error("timed out waiting for the Hara engine connection to close"));
      }, timeoutMs);
      waiter = { resolve, timer };
      this.closeWaiters.add(waiter);
    });
  }
  /** Gracefully stop the authenticated local engine before a Desktop updater relaunch. */
  async shutdownServer(): Promise<{ accepted: true }> {
    const result = await this.call<{ accepted: boolean }>("server.shutdown", {});
    if (!result.accepted) throw new Error("the Hara engine did not accept the shutdown request");
    await this.waitForClose();
    return { accepted: true };
  }
  listSessions(cwd?: string) {
    return this.call<{ sessions: SessionInfo[] }>("session.list", cwd ? { cwd } : {});
  }
  /** Local coding-agent session metadata. Personal Space only; native IDs, paths and transcripts stay in Serve. */
  async listExternalSources(): Promise<{ sources: ExternalSessionSourceInfo[] } | null> {
    if (this.methods.size > 0 && !this.supports("external.sources.list")) return null;
    try {
      return await this.call("external.sources.list", {});
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  async listExternalSessions(input: {
    sourceId?: ExternalSessionSourceId;
    cursor?: string;
    limit?: number;
    search?: string;
  } = {}): Promise<ExternalSessionListResult | null> {
    if (this.methods.size > 0 && !this.supports("external.sessions.list")) return null;
    try {
      return await this.call("external.sessions.list", input);
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  async createExternalSession(input: {
    sourceId: "runtime";
    cwd: string;
    agentKind: ExternalRuntimeAgentKind;
    title?: string;
    launch?: ExternalRuntimeLaunchOptions;
  }): Promise<ExternalSessionReadResult | null> {
    if (this.methods.size > 0 && !this.supports("external.sessions.create")) return null;
    try {
      return await this.call("external.sessions.create", input);
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  readExternalSession(sessionId: string) {
    return this.call<ExternalSessionReadResult>("external.sessions.read", { sessionId });
  }
  async resumeExternalSession(sessionId: string): Promise<ExternalSessionReadResult | null> {
    if (this.methods.size > 0 && !this.supports("external.sessions.resume")) return null;
    try {
      return await this.call("external.sessions.resume", { sessionId });
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  forkExternalSession(sessionId: string) {
    return this.call<ExternalSessionForkResult>("external.sessions.fork", { sessionId });
  }
  submitExternalSession(sessionId: string, text: string) {
    return this.call<ExternalTurnResult>("external.sessions.submit", { sessionId, text });
  }
  steerExternalSession(sessionId: string, text: string) {
    return this.call<ExternalSteerResult>("external.sessions.steer", { sessionId, text });
  }
  interruptExternalSession(sessionId: string) {
    return this.call<Record<string, never>>("external.sessions.interrupt", { sessionId });
  }
  terminalSnapshot(sessionId: string) {
    return this.call<ExternalTerminalSnapshot>("external.sessions.terminal.snapshot", { sessionId });
  }
  terminalInput(sessionId: string, text: string) {
    return this.call<Record<string, never>>("external.sessions.terminal.input", { sessionId, text });
  }
  terminalKey(sessionId: string, key: ExternalTerminalKey) {
    return this.call<Record<string, never>>("external.sessions.terminal.key", { sessionId, key });
  }
  createSession(opts?: { cwd?: string; approval?: ApprovalMode; agentRef?: string; profileId?: string; spaceId?: string }) {
    return this.call<CreatedSessionInfo>("session.create", opts ?? {});
  }
  /** Persistent Agent identities and their project/team offices (feature-detected for compatibility). */
  async listAgents(opts?: { sessionId?: string; cwd?: string }): Promise<AgentCatalog | null> {
    if (this.methods.size > 0 && !this.supports("agents.list")) return null;
    try {
      return await this.call("agents.list", opts ?? {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  async updateAgentProfile(input: {
    ref: string;
    expectedRevision: string;
    profile: Omit<AgentPublicIdentity, "version" | "source">;
    execution?: { model?: string | null; reasoningEffort?: string | null };
    sessionId?: string;
    cwd?: string;
  }): Promise<{ agent?: AgentInfo; catalog: AgentCatalog }> {
    return this.call("agents.update-profile", input);
  }
  createAgent(input: {
    id: string;
    description?: string;
    instructions?: string;
    blueprint?: AgentBlueprintInstallInput;
    profile: Omit<AgentPublicIdentity, "version" | "source">;
    cwd?: string;
  }) {
    return this.call<{ agent?: AgentInfo; catalog: AgentCatalog }>("agents.create", input);
  }
  archiveAgent(input: { ref: string; expectedRevision: string; sessionId?: string; cwd?: string }) {
    return this.call<{ ref: string; archived: true; catalog: AgentCatalog }>("agents.archive", input);
  }
  async listSpaces(cwd?: string): Promise<SpaceDirectory | null> {
    if (this.methods.size > 0 && !this.supports("spaces.list")) return null;
    try {
      return await this.call("spaces.list", cwd ? { cwd } : {});
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  useSpace(spaceId: string, cwd?: string) {
    return this.call<SpaceDirectory>("spaces.use", { spaceId, ...(cwd ? { cwd } : {}) });
  }
  listPlugins() {
    return this.call<{ plugins: PluginInfo[] }>("plugins.list", {});
  }
  setPlugin(name: string, enabled: boolean) {
    return this.call<{ name: string; enabled: boolean }>("plugins.set", { name, enabled });
  }
  listSkills(cwd?: string) {
    return this.call<{ skills: SkillInfo[] }>("skills.list", cwd ? { cwd } : {});
  }
  /** Model catalog + effort levels (serve ≥0.116). Null on older serves. */
  async listModels(opts?: { sessionId?: string; cwd?: string }): Promise<{
    models: string[];
    entries?: ModelCatalogEntry[];
    current: string;
    /** Connection/Space default, which can differ from a session's current override. */
    defaultModel?: string;
    currentAvailable?: boolean;
    recommendedModel?: string;
    profileId?: string;
    /** Missing/null means provider/model automatic. */
    defaultReasoningEffort?: string | null;
    effort: string | null;
    effortLevels: string[];
    attachmentCapabilities?: EffectiveAttachmentCapabilities;
  } | null> {
    try {
      return await this.call("models.list", opts ?? {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Redacted provider catalog and current connection (serve ≥0.126). */
  async listProviderSettings(cwd?: string): Promise<ProviderSettingsState | null> {
    if (this.methods.size > 0 && !this.supports("settings.providers.list")) return null;
    try {
      return await this.call("settings.providers.list", cwd ? { cwd } : {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  testProviderSettings(input: ProviderSettingsInput, cwd?: string) {
    return this.call<ProviderSettingsTestResult>("settings.providers.test", { ...input, ...(cwd ? { cwd } : {}) });
  }
  saveProviderSettings(input: ProviderSettingsInput, cwd?: string) {
    return this.call<ProviderSettingsState>("settings.providers.save", { ...input, ...(cwd ? { cwd } : {}) });
  }
  createProviderConnection(input: ProviderConnectionCreateInput, cwd?: string) {
    return this.call<ProviderSettingsState>("settings.providers.connections.create", { ...input, ...(cwd ? { cwd } : {}) });
  }
  testProviderConnection(id: string, cwd?: string) {
    return this.call<ProviderSettingsTestResult>("settings.providers.connections.test", { id, ...(cwd ? { cwd } : {}) });
  }
  useProviderConnection(id: string, cwd?: string) {
    return this.call<ProviderSettingsState>("settings.providers.connections.use", { id, ...(cwd ? { cwd } : {}) });
  }
  removeProviderConnection(id: string, cwd?: string) {
    return this.call<ProviderSettingsState>("settings.providers.connections.remove", { id, ...(cwd ? { cwd } : {}) });
  }
  /** Explicitly remove the project profile override governing cwd. Existing sessions remain pinned. */
  async unpinProjectProfile(cwd?: string): Promise<ProjectProfileUnpinResult | null> {
    if (this.methods.size > 0 && !this.supports("settings.profiles.unpin")) return null;
    try {
      return await this.call("settings.profiles.unpin", cwd ? { cwd } : {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Redacted local connector health (serve ≥0.132). Null on older bundled engines. */
  async listGatewayStatuses(): Promise<GatewayStatus[] | null> {
    if (this.methods.size > 0 && !this.supports("settings.gateways.list")) return null;
    try {
      const result = await this.call<{ gateways: GatewayStatus[] }>("settings.gateways.list", {});
      return result.gateways;
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Start an in-process connector login owned by the local serve engine (serve ≥0.134). */
  async startGatewayLogin(platform: "weixin"): Promise<GatewayLoginSnapshot | null> {
    if (this.methods.size > 0 && !this.supports("settings.gateways.login.start")) return null;
    try {
      const result = await this.call<{ login: GatewayLoginSnapshot }>("settings.gateways.login.start", { platform });
      return result.login;
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  gatewayLoginStatus(platform: "weixin", id: string) {
    return this.call<{ login: GatewayLoginSnapshot }>("settings.gateways.login.status", { platform, id })
      .then((result) => result.login);
  }
  cancelGatewayLogin(platform: "weixin", id: string) {
    return this.call<{ login: GatewayLoginSnapshot }>("settings.gateways.login.cancel", { platform, id })
      .then((result) => result.login);
  }
  /** User-added organization routes. Codes are one-shot request fields and tokens never cross this API. */
  async listOrganizationConnections(cwd?: string): Promise<OrganizationConnectionsState | null> {
    if (this.methods.size > 0 && !this.supports("settings.organizations.list")) return null;
    try {
      return await this.call("settings.organizations.list", cwd ? { cwd } : {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  enrollOrganizationConnection(input: OrganizationEnrollmentInput, cwd?: string) {
    return this.call<OrganizationConnectionsState>("settings.organizations.enroll", { ...input, ...(cwd ? { cwd } : {}) });
  }
  useOrganizationConnection(id: string, cwd?: string) {
    return this.call<OrganizationConnectionsState>("settings.organizations.use", { id, ...(cwd ? { cwd } : {}) });
  }
  removeOrganizationConnection(id: string, cwd?: string) {
    return this.call<OrganizationConnectionsState>("settings.organizations.remove", { id, ...(cwd ? { cwd } : {}) });
  }
  checkOrganizationConnection(id: string, cwd?: string) {
    return this.call<OrganizationConnectionCheck>("settings.organizations.check", { id, ...(cwd ? { cwd } : {}) });
  }
  /** Reviewable execution-time learning. Candidate content is already redacted by Core; raw transcripts
   * and credentials never cross this API. */
  async listLearnings(cwd?: string): Promise<LearningListResult | null> {
    if (this.methods.size > 0 && !this.supports("learning.list")) return null;
    try {
      return await this.call("learning.list", { ...(cwd ? { cwd } : {}), limit: 1_000 });
    } catch (error: any) {
      if (error?.code === -32601) return null;
      throw error;
    }
  }
  reviewLearning(
    id: string,
    decision: "approve" | "reject" | "revoke",
    expectedRevision: number,
    cwd?: string,
  ) {
    return this.call<{ learning: LearningCandidate }>("learning.review", {
      id,
      decision,
      expectedRevision,
      ...(cwd ? { cwd } : {}),
    });
  }
  submitOrganizationLearning(id: string, cwd?: string) {
    return this.call<{
      remoteId: string;
      status: string;
      revision: number;
      candidate: LearningCandidate;
    }>("learning.submit", { id, ...(cwd ? { cwd } : {}) });
  }
  syncOrganizationLearnings(cwd?: string) {
    return this.call<{ version: number; learnings: LearningCandidate[] }>(
      "learning.sync",
      cwd ? { cwd } : {},
    );
  }
  /** Local, redacted Desk binding inventory. Null means the bundled engine predates native Groups. */
  async listDeskConnections(): Promise<DeskConnectionsState | null> {
    if (this.methods.size > 0 && !this.supports("desk.connections.list")) return null;
    try {
      return await this.call("desk.connections.list", {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Explicit organization-pinned read. Entering Groups never calls this method automatically. */
  async deskSnapshot(profileId: string, state?: DeskTaskState): Promise<DeskSnapshot | null> {
    if (this.methods.size > 0 && !this.supports("desk.snapshot")) return null;
    try {
      return await this.call("desk.snapshot", {
        profileId,
        ...(state ? { state } : {}),
      });
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Task identity remains pinned to the organization that opened it, even after a later switch. */
  async getDeskTask(profileId: string, taskId: string): Promise<DeskTaskDetails | null> {
    if (this.methods.size > 0 && !this.supports("desk.task.get")) return null;
    try {
      return await this.call("desk.task.get", { profileId, taskId });
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  addAutomation(name: string, schedule: string, task: string, cwd?: string) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.add", { name, schedule, task, ...(cwd ? { cwd } : {}) });
  }
  addAutomationDraft(input: AutomationDraftInput) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.add", { ...input });
  }
  validateAutomationSchedule(schedule: string, tz?: string, idJob?: string) {
    return this.call<AutomationScheduleValidation>("automation.validate", {
      schedule,
      ...(tz !== undefined ? { tz } : {}),
      ...(idJob ? { id: idJob } : {}),
    });
  }
  updateAutomation(idJob: string, input: AutomationDraftInput) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.update", {
      id: idJob,
      ...input,
    });
  }
  async runAutomation(idJob: string) {
    const result = await this.call<{ id: string; ok: boolean; error?: string }>("automation.run", {
      id: idJob,
    });
    if (!result.ok) throw new Error(result.error || "Automation run failed.");
    return result;
  }
  toggleAutomation(idJob: string, enabled: boolean) {
    return this.call("automation.toggle", { id: idJob, enabled });
  }
  deleteAutomation(idJob: string) {
    return this.call("automation.delete", { id: idJob });
  }
  installAutomationScheduler() {
    return this.call<{ scheduler: AutomationSchedulerInfo }>("automation.scheduler.install", {});
  }
  renameSession(sessionId: string, title: string) {
    return this.call<{ sessionId: string; title: string }>("session.rename", { sessionId, title });
  }
  archiveSession(sessionId: string, archived = true) {
    return this.call<{ sessionId: string; archived: boolean }>("session.archive", { sessionId, archived });
  }
  setSessionModel(sessionId: string, model?: string, effort?: string) {
    return this.call<{ sessionId: string; model: string; effort: string | null }>("session.set-model", { sessionId, model, effort });
  }
  /** Automation timeline data (serve ≥0.116). Gracefully returns null on older serves (-32601). */
  async listAutomation(): Promise<AutomationListResult | null> {
    try {
      return await this.call("automation.list", {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  /** Local-first Office Artifact runtime (serve ≥0.128). Null list means the connected engine is older. */
  async listArtifacts(): Promise<ArtifactListResult | null> {
    if (this.methods.size > 0 && !this.supports("artifact.list")) return null;
    try {
      return await this.call("artifact.list", {});
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  importArtifact(sourcePath: string, opts?: { title?: string; kind?: ArtifactKind }) {
    return this.call<ArtifactDetails>("artifact.import", { sourcePath, ...(opts ?? {}) });
  }
  getArtifact(artifactId: string) {
    return this.call<ArtifactDetails>("artifact.get", { artifactId });
  }
  listArtifactRevisions(artifactId: string) {
    return this.call<{ artifactId: string; revisions: ArtifactRevision[] }>("artifact.revisions", { artifactId });
  }
  validateArtifact(artifactId: string, revisionId: string) {
    return this.call<{ report: ArtifactValidationReport }>("artifact.validate", { artifactId, revisionId });
  }
  exportArtifact(input: {
    artifactId: string;
    revisionId: string;
    validationReportId: string;
    destinationPath: string;
  }) {
    return this.call<{ receipt: ArtifactExportReceipt }>("artifact.export", input);
  }
  createPresentation(input: { title?: string; project?: PresentationProject } = {}) {
    return this.call<PresentationArtifactDetails>("presentation.create", input);
  }
  importPresentation(sourcePath: string, opts?: { title?: string }) {
    return this.call<PresentationArtifactDetails>("presentation.import", { sourcePath, ...(opts ?? {}) });
  }
  updatePresentation(input: {
    artifactId: string;
    baseRevisionId: string;
    project: PresentationProject;
  }) {
    return this.call<PresentationArtifactDetails>("presentation.update", input);
  }
  getPresentation(artifactId: string, revisionId?: string) {
    return this.call<PresentationArtifactDetails>("presentation.get", {
      artifactId,
      ...(revisionId ? { revisionId } : {}),
    });
  }
  validatePresentation(artifactId: string, revisionId: string) {
    return this.call<{ report: ArtifactValidationReport }>("presentation.validate", { artifactId, revisionId });
  }
  exportPresentation(input: {
    artifactId: string;
    revisionId: string;
    validationReportId: string;
    destinationPath: string;
    format: PresentationExportFormat;
  }) {
    return this.call<{ receipt: ArtifactExportReceipt }>("presentation.export", input);
  }
  renderPresentation(project: PresentationProject) {
    return this.call<{ html: string }>("presentation.render", { project });
  }
  getPresentationPreview(artifactId: string, revisionId: string) {
    return this.call<{ html: string; revisionId: string }>("presentation.preview", { artifactId, revisionId });
  }
  createPresentationPreviewFile(artifactId: string, revisionId: string) {
    return this.call<{ path: string; revisionId: string }>("presentation.preview-file", { artifactId, revisionId });
  }
  resumeSession(sessionId: string, legacyApproval?: ApprovalMode) {
    return this.call<{
      sessionId: string;
      model: string;
      profileId?: string;
      spaceId?: string;
      approval?: ApprovalMode;
      agentRef?: string;
      history: ClientHistoryMessage[];
      task?: { id: string; objective: string; status: Exclude<TaskLifecycleState, "waiting">; turnId: string; updatedAt: string };
    }>("session.resume", { sessionId, ...(legacyApproval ? { approval: legacyApproval } : {}) });
  }
  setSessionApproval(sessionId: string, approval: ApprovalMode) {
    return this.call<{ sessionId: string; approval: ApprovalMode }>("session.set-approval", {
      sessionId,
      approval,
    });
  }
  readSession(sessionId: string) {
    return this.call<ReadOnlySessionResult>("session.history", { sessionId });
  }
  /** One Core-owned routing decision: start if idle, otherwise steer the authoritative live turn.
   * Feature-detect before calling so mixed-version Desktop/CLI installations keep their legacy path. */
  submit(
    sessionId: string,
    text: string,
    attachments?: SessionAttachmentIntent[],
    options?: {
      mode?: SessionSubmitMode;
      expectedTurnId?: string;
      expectedModel?: string;
      expectedEffort?: string;
      newTask?: boolean;
    },
  ) {
    const mode = options?.mode ?? "start_or_steer";
    return this.call<SessionSubmitResult>("session.submit", {
      sessionId,
      text,
      ...(attachments?.length ? { attachments } : {}),
      ...(mode !== "start_or_steer" ? { mode } : {}),
      ...(options?.expectedTurnId ? { expectedTurnId: options.expectedTurnId } : {}),
      ...(options?.expectedModel
        ? { expectedModel: options.expectedModel, expectedEffort: options.expectedEffort ?? "" }
        : {}),
      ...(options?.newTask ? { newTask: true } : {}),
    });
  }
  send(sessionId: string, text: string, attachments?: SessionAttachmentIntent[]) {
    return this.call<SessionTurnResult>(
      "session.send",
      { sessionId, text, ...(attachments?.length ? { attachments } : {}) },
    );
  }
  steer(sessionId: string, text: string, expectedTurnId: string) {
    return this.call<{ accepted: true; taskId: string; turnId: string }>("session.steer", {
      sessionId,
      text,
      expectedTurnId,
    });
  }
  /** Fuzzy project-file lookup for the @-mention autocomplete (serve ≥0.117). Null on older serves. */
  async filesSearch(query: string, opts?: { sessionId?: string; cwd?: string; limit?: number }): Promise<{ files: string[]; cwd: string } | null> {
    try {
      return await this.call("files.search", { query, ...(opts ?? {}) });
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  sessionContext(sessionId: string) {
    return this.call<CtxInfo & { sessionId: string; total: number; rows: { label: string; tokens: number; pct: number }[] }>("session.context", { sessionId });
  }
  compactSession(sessionId: string) {
    return this.call<{ sessionId: string; ctx: CtxInfo; notes: number; history: ClientHistoryMessage[] }>("session.compact", { sessionId });
  }
  rewindSession(sessionId: string, n: number) {
    return this.call<{ sessionId: string; history: ClientHistoryMessage[] }>("session.rewind", { sessionId, n });
  }
  deleteSession(sessionId: string) {
    return this.call<{ sessionId: string; deleted: boolean }>("session.delete", { sessionId });
  }
  forkSession(sessionId: string, target?: SessionForkTarget) {
    return this.call<{
      sessionId: string;
      title: string;
      model: string;
      profileId?: string;
      spaceId?: string;
      agentRef?: string;
      history: ClientHistoryMessage[];
    }>("session.fork", { sessionId, ...(target ?? {}) });
  }
  /** Panels applicable to a project cwd (serve ≥0.119). Null on older serves. */
  async projectPanels(opts: { sessionId?: string; cwd?: string }): Promise<{ cwd: string; panels: ProjectPanel[] } | null> {
    try {
      return await this.call("project.panels", opts);
    } catch (e: any) {
      if (e?.code === -32601) return null;
      throw e;
    }
  }
  interrupt(sessionId: string) {
    return this.call("session.interrupt", { sessionId });
  }
  approvalReply(approvalId: string, allow: boolean, always = false) {
    return this.call("approval.reply", { approvalId, allow, always });
  }
  close() {
    this.ws?.close();
  }
  get connected(): boolean {
    return !!this.ws;
  }
}

/** A native Presentation result is useful in the conversational Workbench only when the connected
 * engine can both offer the owner-bound surface and support the editor's exact-revision draft/save flow. */
export function supportsNativePresentationWorkspace(
  client: Pick<HaraClient, "supports" | "supportsEvent"> | null | undefined,
): boolean {
  return !!client
    && client.supportsEvent("event.surface")
    && client.supports("presentation.update")
    && client.supports("presentation.render")
    && client.supports("presentation.preview");
}
