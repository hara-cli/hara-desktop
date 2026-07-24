// hara serve client — JSON-RPC 2.0 over WebSocket (protocol v1, mirrors hara-cli src/serve/protocol.ts).
// Request/response correlation + typed event callbacks; the UI layer stays purely declarative.

export interface Discovery {
  host: string;
  port: number;
  token: string;
  pid: number;
  version: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  model: string;
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
  alertAfter?: number;
}

export interface AutomationScheduleValidation {
  schedule: string;
  description: string;
  nextRuns: number[];
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

export interface PanelSpec {
  id: string;
  title: string;
  command: string;
  args?: string[];
  port?: number;
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
}

export interface ProviderSettingsInput {
  provider: string;
  model: string;
  baseURL?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  activatePersonal?: boolean;
}

export interface ProviderSettingsTestResult {
  ok: boolean;
  models: string[];
  error?: string;
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

export type OrganizationAccessState = "valid" | "expiring" | "expired" | "legacy" | "invalid";

export interface OrganizationConnection {
  id: string;
  label: string;
  active: boolean;
  gatewayUrl: string;
  gatewayHost: string;
  model: string;
  enrolledAt?: string;
  expiresAt?: string;
  accessState: OrganizationAccessState;
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

export interface InitializeResult {
  name: string;
  version: string;
  protocol: number;
  cwd: string;
  provider: string;
  model: string;
  setupState?: "ready" | "needs-credentials";
  capabilities?: { methods?: string[]; events?: string[] };
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
  checkpoint: { done: number; total: number; current?: string; owner?: string };
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
  | { method: "event.turn_end"; sessionId: string; reply: string; error?: string; status?: string; taskId?: string; turnId?: string; usage: { input: number; output: number }; ctx?: CtxInfo }
  | { method: "approval.request"; sessionId: string; approvalId: string; question: string };

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
    return result;
  }
  supports(method: string): boolean {
    return this.methods.has(method);
  }
  supportsEvent(event: string): boolean {
    return this.events.has(event);
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
  createSession(opts?: { cwd?: string; approval?: string }) {
    return this.call<{ sessionId: string; model: string; profileId?: string }>("session.create", opts ?? {});
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
    current: string;
    profileId?: string;
    effort: string | null;
    effortLevels: string[];
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
  addAutomation(name: string, schedule: string, task: string, cwd?: string) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.add", { name, schedule, task, ...(cwd ? { cwd } : {}) });
  }
  addAutomationDraft(input: AutomationDraftInput) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.add", { ...input });
  }
  validateAutomationSchedule(schedule: string, tz?: string) {
    return this.call<AutomationScheduleValidation>("automation.validate", {
      schedule,
      ...(tz ? { tz } : {}),
    });
  }
  updateAutomation(idJob: string, input: AutomationDraftInput) {
    return this.call<{ id: string; name: string; schedule: string }>("automation.update", {
      id: idJob,
      ...input,
    });
  }
  runAutomation(idJob: string) {
    return this.call<{ id: string; ok: boolean; error?: string }>("automation.run", { id: idJob });
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
  resumeSession(sessionId: string) {
    return this.call<{
      sessionId: string;
      model: string;
      profileId?: string;
      history: { role: string; text: string }[];
      task?: { id: string; objective: string; status: Exclude<TaskLifecycleState, "waiting">; turnId: string; updatedAt: string };
    }>("session.resume", { sessionId });
  }
  send(sessionId: string, text: string, images?: { path: string; mediaType?: string }[]) {
    return this.call<{ reply: string; usage: { input: number; output: number }; ctx?: CtxInfo; taskId: string; turnId: string }>("session.send", { sessionId, text, ...(images && images.length ? { images } : {}) });
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
    return this.call<{ sessionId: string; ctx: CtxInfo; notes: number; history: { role: string; text: string }[] }>("session.compact", { sessionId });
  }
  rewindSession(sessionId: string, n: number) {
    return this.call<{ sessionId: string; history: { role: string; text: string }[] }>("session.rewind", { sessionId, n });
  }
  deleteSession(sessionId: string) {
    return this.call<{ sessionId: string; deleted: boolean }>("session.delete", { sessionId });
  }
  forkSession(sessionId: string) {
    return this.call<{ sessionId: string; title: string; model: string; history: { role: string; text: string }[] }>("session.fork", { sessionId });
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
