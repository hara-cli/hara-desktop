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
  updatedAt: string;
  source?: "interactive" | "gateway" | "cron";
  sourceName?: string;
  /** Stable automation identity for cron runs. Older engines only expose sourceName. */
  jobId?: string;
  archived?: boolean;
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

export interface AutomationListResult {
  jobs: CronJobInfo[];
  sessions: SessionInfo[];
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
}

export interface ProviderSettingsInput {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  activatePersonal?: boolean;
}

export interface ProviderConnectionCreateInput extends ProviderSettingsInput {
  id: string;
  label: string;
  activate?: boolean;
}

export interface ProviderSettingsTestResult {
  ok: boolean;
  models: string[];
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
  label: string;
  active: boolean;
  gatewayUrl: string;
  gatewayHost: string;
  model: string;
  /** Server-authorized models for this scoped organization credential. */
  availableModels?: string[];
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

export type ImageInputMode = "native" | "vision-sidecar" | "unsupported" | "unknown";

export interface EffectiveAttachmentCapabilities {
  image: {
    mode: ImageInputMode;
    /** Missing only when an older Serve does not advertise its authoritative image bound. */
    maxBytes?: number;
    viaModel?: string;
  };
  textFile: "inline-text";
  directory: "bounded-inventory-and-tools";
  binaryFile: "agent-tool";
}

export interface ModelCatalogEntry {
  id: string;
  providerId: string;
  effortLevels: string[];
  attachmentCapabilities?: EffectiveAttachmentCapabilities;
}

export interface SessionAttachmentIntent {
  clientId?: string;
  kind: "image" | "file" | "directory";
  path: string;
  mediaType?: string;
}

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
  approval?: ApprovalMode;
  history: ClientHistoryMessage[];
  readOnly: true;
}

export interface SessionForkTarget {
  targetProfileId: string;
  targetModel: string;
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
  };
  detail?: string;
  approval?: { id: string; question: string };
}

export type ServerEvent =
  | { method: "event.turn_start"; sessionId: string; taskId?: string; turnId?: string }
  | ({ method: "event.task_state" } & TaskLifecycleEvent)
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
  | { method: "approval.request"; sessionId: string; approvalId: string; question: string; allowAlways?: boolean };

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
  createSession(opts?: { cwd?: string; approval?: ApprovalMode }) {
    return this.call<{ sessionId: string; model: string; profileId?: string; approval?: ApprovalMode }>("session.create", opts ?? {});
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
    profileId?: string;
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
      approval?: ApprovalMode;
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
  send(sessionId: string, text: string, attachments?: SessionAttachmentIntent[]) {
    return this.call<{ reply: string; usage: { input: number; output: number }; ctx?: CtxInfo; taskId: string; turnId: string }>(
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
