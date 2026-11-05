import { parseMessageTimingReport, type MessageTimingReport } from "./message-timing.ts";
/** Closed metadata projection. Native output and conversation content never enter this view. */
export const RUNTIME_STAGE_KINDS = ["queued", "retry", "spawn", "cold_start", "first_token", "first_output", "model_roundtrip", "tool_call", "complete"] as const;
export type RuntimeStageKind = typeof RUNTIME_STAGE_KINDS[number];
export const RUNTIME_STAGE_FAILURES = ["not_installed", "version_incompatible", "runtime_auth_required", "runtime_auth_rejected",
  "runtime_network", "runtime_proxy", "invalid_model", "runtime_quota", "runtime_rate_limit", "runtime_permission_denied",
  "runtime_crashed", "project_not_trusted", "timeout", "spawn_failed", "runtime_failed"] as const;
export type RuntimeStageFailure = typeof RUNTIME_STAGE_FAILURES[number];
export type RuntimeStageState = "running" | "completed" | "blocked" | "cancelled" | "error" | "incomplete";
export interface RuntimeStageEvent {
  seq: number; kind: RuntimeStageKind; phase: "start" | "end" | "mark"; offsetMs: number; durationMs: number | null;
  call: number | null; toolName: string | null; targetLabel?: string; outcome: "completed" | "error" | "cancelled" | null;
  source: "host" | "provider_stream" | "native_event"; errorKind: RuntimeStageFailure | null;
}
export interface RuntimeStageReport {
  provenance?: { startedAt: string; coreInstanceId: string };
  schemaVersion: 1; workspaceId: string; resourceGeneration: string; agentId: string; sessionId: string; runId: string; attemptId: string;
  historyStart: number; runtime: { extensionsIsolation?: "inherited"; id: "hara" | "pi" | "opencode" | "codex" | "claude" | "agy" | "gemini" | "kimi" | "copilot" | "cursor" | "grok"; version: string | null;
    loginSource: "host" | "isolated" | "unknown"; model: string | null; effort: string | null; effortSource?: "auto" | "user" | "default" };
  state: RuntimeStageState; durationMs: number | null; errorKind: RuntimeStageFailure | null; events: RuntimeStageEvent[]; droppedEvents: number; contextTokens?: number;
}
export interface RuntimeStageScope { workspaceId: string; resourceGeneration: string; agentId: string; sessionId: string;
  history: readonly { role: string }[] }
export interface RuntimeDiagnosticReceipt { fileName: string; path: string; bytes: number; sha256: string }
const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuid = new RegExp(`^${UUID}$`), workspaceId = new RegExp(`^ws_${UUID}$`), agentId = new RegExp(`^ag_${UUID}$`);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const integer = (value: unknown, max: number, min = 0): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const duration = (value: unknown): value is number | null => value === null || integer(value, 86_400_000);
const member = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);
const failure = (value: unknown): value is RuntimeStageFailure | null => value === null || member(value, RUNTIME_STAGE_FAILURES);
function model(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value === value.trim() && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:+/-]*$/.test(value)
    && !/^(?:https?:|[A-Za-z]:[\\/]|sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|bearer)/i.test(value)
    && !/(?:^|\/)(?:Users|home|credentials?|secrets?)(?:\/|$)/i.test(value) && !/^[a-f0-9]{32,}$/i.test(value);
}
export function isSafeRuntimeTargetLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() && [...value].length <= 40
    && value !== "." && value !== ".."
    && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\/\\<>:@?#]|%2f|%5c|(?:sk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|AKIA[A-Z0-9]{12})|(?:password|token|secret)\s*[:=]|\.(?:pem|key|p12|pfx)$/iu.test(value)
    && !/^(?:\.env(?:\.|$)|\.(?:hara|codex|claude|gemini|kimi|ssh|aws|npmrc)$|credentials?$|secrets?$|auth\.json$)/iu.test(value)
    && !/^[a-f0-9]{24,}(?:\.[a-z0-9]+)?$/iu.test(value);
}
function parseEvent(value: unknown): RuntimeStageEvent | null {
  if (!record(value) || !exact(value, ["seq", "kind", "phase", "offsetMs", "durationMs", "call", "toolName", "outcome", "source", "errorKind", ...(Object.prototype.hasOwnProperty.call(value, "targetLabel") ? ["targetLabel"] : [])])
    || !integer(value.seq, 1_000_000, 1) || !member(value.kind, RUNTIME_STAGE_KINDS) || !member(value.phase, ["start", "end", "mark"])
    || !integer(value.offsetMs, 86_400_000) || !duration(value.durationMs) || !(value.call === null || integer(value.call, 1_000_000, 1))
    || !(value.toolName === null || typeof value.toolName === "string" && value.toolName === value.toolName.trim() && /^[a-z][a-z0-9_]{0,63}$/.test(value.toolName))
    || !(value.outcome === null || member(value.outcome, ["completed", "error", "cancelled"]))
    || !member(value.source, ["host", "provider_stream", "native_event"]) || !failure(value.errorKind)) return null;
  if (Object.prototype.hasOwnProperty.call(value, "targetLabel") && (value.kind !== "tool_call" || !isSafeRuntimeTargetLabel(value.targetLabel))) return null;
  if (value.kind === "queued" && (value.call !== null || value.toolName !== null || value.source !== "host")) return null;
  if (value.durationMs !== null && value.durationMs > value.offsetMs) return null;
  if (["queued", "spawn", "cold_start", "model_roundtrip", "tool_call"].includes(value.kind)) {
    if (value.phase === "mark" || (value.phase === "start"
      ? value.durationMs !== null || value.outcome !== null || value.errorKind !== null
      : value.durationMs === null || value.outcome === null)) return null;
  } else {
    if (value.phase !== "mark" || value.call !== null || value.toolName !== null) return null;
    if (value.kind === "retry") {
      if (value.durationMs !== null || value.outcome !== null || value.source !== "host" || value.errorKind === null) return null;
    } else if (value.kind === "complete") {
      if (value.outcome === null || value.durationMs === null || value.source !== "host") return null;
    } else if (value.durationMs !== null || value.outcome !== null || value.errorKind !== null
      || value.kind === "first_token" && value.source === "host") return null;
  }
  return { seq: value.seq, kind: value.kind, phase: value.phase, offsetMs: value.offsetMs, durationMs: value.durationMs,
    call: value.call, toolName: value.toolName, ...(typeof value.targetLabel === "string" ? { targetLabel: value.targetLabel } : {}), outcome: value.outcome, source: value.source, errorKind: value.errorKind };
}
function validProvenance(value: unknown): value is NonNullable<RuntimeStageReport["provenance"]> {
  return record(value) && exact(value, ["startedAt", "coreInstanceId"]) && typeof value.startedAt === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.startedAt)
    && Number.isFinite(Date.parse(value.startedAt)) && new Date(value.startedAt).toISOString() === value.startedAt
    && typeof value.coreInstanceId === "string" && uuid.test(value.coreInstanceId);
}
export function parseRuntimeStageReport(value: unknown): RuntimeStageReport | null {
  if (!record(value) || !exact(value, ["schemaVersion", "workspaceId", "resourceGeneration", "agentId", "sessionId", "runId", "attemptId", "historyStart", "runtime", "state", "durationMs", "errorKind", "events", "droppedEvents", ...(Object.prototype.hasOwnProperty.call(value, "provenance") ? ["provenance"] : []), ...(Object.prototype.hasOwnProperty.call(value, "contextTokens") ? ["contextTokens"] : [])])
    || Object.prototype.hasOwnProperty.call(value, "provenance") && !validProvenance(value.provenance)
    || value.schemaVersion !== 1 || typeof value.workspaceId !== "string" || !workspaceId.test(value.workspaceId)
    || typeof value.agentId !== "string" || !agentId.test(value.agentId)
    || ![value.resourceGeneration, value.sessionId, value.runId, value.attemptId].every(item => typeof item === "string" && uuid.test(item))
    || !integer(value.historyStart, 4000) || !member(value.state, ["running", "completed", "blocked", "cancelled", "error", "incomplete"])
    || !duration(value.durationMs) || !failure(value.errorKind) || Object.prototype.hasOwnProperty.call(value, "contextTokens") && !integer(value.contextTokens, 1_000_000_000)
    || !integer(value.droppedEvents, 1_000_000)
    || !Array.isArray(value.events) || value.events.length > 256 || !record(value.runtime)
    || !exact(value.runtime, ["id", "version", "loginSource", "model", "effort", ...(Object.prototype.hasOwnProperty.call(value.runtime, "extensionsIsolation") ? ["extensionsIsolation"] : []), ...(Object.prototype.hasOwnProperty.call(value.runtime, "effortSource") ? ["effortSource"] : [])])) return null;
  const runtime = value.runtime;
  if (!member(runtime.id, ["hara", "pi", "opencode", "codex", "claude", "agy", "gemini", "kimi", "copilot", "cursor", "grok"])
    || !(runtime.version === null || typeof runtime.version === "string" && runtime.version === runtime.version.trim() && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(runtime.version))
    || !member(runtime.loginSource, ["host", "isolated", "unknown"]) || !model(runtime.model)
    || !(runtime.effort === null || member(runtime.effort, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]))) return null;
  if (Object.prototype.hasOwnProperty.call(runtime, "extensionsIsolation") && (runtime.extensionsIsolation !== "inherited" || !["kimi", "copilot", "cursor", "grok"].includes(runtime.id))) return null;
  if (Object.prototype.hasOwnProperty.call(runtime, "effortSource") && !member(runtime.effortSource, ["auto", "user", "default"])) return null;
  const events: RuntimeStageEvent[] = []; let seq = 0, offset = 0;
  for (const item of value.events) {
    const event = parseEvent(item);
    if (!event || event.seq <= seq || event.offsetMs < offset
      || value.durationMs !== null && event.offsetMs > value.durationMs) return null;
    seq = event.seq; offset = event.offsetMs; events.push(event);
  }
  const terminal = events[events.length - 1];
  if (events.some((event, index) => event.kind === "complete" && index !== events.length - 1)) return null;
  if (value.state === "running" || value.state === "incomplete") {
    if (terminal?.kind === "complete" || value.durationMs !== null) return null;
  } else {
    const expected = value.state === "completed" ? "completed" : value.state === "cancelled" ? "cancelled" : "error";
    if (terminal?.kind !== "complete" || value.durationMs === null || terminal.offsetMs !== value.durationMs
      || terminal.durationMs !== value.durationMs || terminal.outcome !== expected || terminal.errorKind !== value.errorKind) return null;
  }
  const firstMarks = events.filter(event => event.kind === "first_token" || event.kind === "first_output");
  if (new Set(firstMarks.map(event => event.kind)).size !== firstMarks.length) return null;
  return { schemaVersion: 1, ...(validProvenance(value.provenance) ? { provenance: { ...value.provenance } } : {}), workspaceId: value.workspaceId, resourceGeneration: value.resourceGeneration as string,
    agentId: value.agentId, sessionId: value.sessionId as string, runId: value.runId as string, attemptId: value.attemptId as string,
    historyStart: value.historyStart, runtime: { id: runtime.id, ...(runtime.extensionsIsolation === "inherited" ? { extensionsIsolation: "inherited" as const } : {}), version: runtime.version, loginSource: runtime.loginSource,
      model: runtime.model, effort: runtime.effort, ...(member(runtime.effortSource, ["auto", "user", "default"]) ? { effortSource: runtime.effortSource } : {}) }, state: value.state, durationMs: value.durationMs, errorKind: value.errorKind,
    events, droppedEvents: value.droppedEvents, ...(typeof value.contextTokens === "number" ? { contextTokens: value.contextTokens } : {}) };
}
export function parseRuntimeStageReports(value: unknown, scope: RuntimeStageScope): RuntimeStageReport[] {
  if (!Array.isArray(value) || value.length > 16) return [];
  const reports: RuntimeStageReport[] = [], seen = new Set<string>();
  for (const item of value) {
    const report = parseRuntimeStageReport(item);
    if (!report || report.workspaceId !== scope.workspaceId || report.resourceGeneration !== scope.resourceGeneration
      || report.agentId !== scope.agentId || report.sessionId !== scope.sessionId || scope.history[report.historyStart]?.role !== "user"
      || seen.has(report.attemptId)) continue;
    seen.add(report.attemptId); reports.push(report);
  }
  return reports.sort((a, b) => a.historyStart - b.historyStart);
}
export function sameRuntimeStageIdentity(a: RuntimeStageReport, b: RuntimeStageReport): boolean {
  return a.workspaceId === b.workspaceId && a.resourceGeneration === b.resourceGeneration && a.agentId === b.agentId
    && a.sessionId === b.sessionId && a.runId === b.runId && a.attemptId === b.attemptId && a.historyStart === b.historyStart;
}
export function runtimeStageIdentity(report: Pick<RuntimeStageReport, "workspaceId" | "resourceGeneration" | "agentId" | "sessionId" | "runId" | "attemptId">): string {
  return JSON.stringify([report.workspaceId, report.resourceGeneration, report.agentId, report.sessionId, report.runId, report.attemptId]);
}
export function parseRuntimeDiagnosticReceipt(value: unknown): RuntimeDiagnosticReceipt | null {
  if (!record(value) || !exact(value, ["fileName", "path", "bytes", "sha256"]) || typeof value.fileName !== "string"
    || value.fileName.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(value.fileName) || value.fileName.includes("..")
    || typeof value.path !== "string" || value.path.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/.test(value.path)
    || !/^(?:\/|[A-Za-z]:[\\/])/.test(value.path) || value.path.split(/[\\/]/).slice(-1)[0] !== value.fileName
    || value.path.split(/[\\/]/).includes("..") || !integer(value.bytes, 4 * 1024 * 1024, 1)
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return null;
  return { fileName: value.fileName, path: value.path, bytes: value.bytes, sha256: value.sha256 };
}
/** Attach a report after its round, before the next user input, preserving absolute history anchors. */
export function runtimeStagesBefore(reports: readonly RuntimeStageReport[], history: readonly { role: string }[], historyOffset = 0): Map<number, RuntimeStageReport[]> {
  const boundaries = new Map<number, RuntimeStageReport[]>();
  for (const report of reports) {
    const start = report.historyStart - historyOffset;
    if (start < 0 || history[start]?.role !== "user") continue;
    let boundary = history.length;
    for (let index = start + 1; index < history.length; index++) if (history[index].role === "user") { boundary = index; break; }
    const key = boundary + historyOffset, rows = boundaries.get(key) ?? []; rows.push(report); boundaries.set(key, rows);
  }
  return boundaries;
}
export interface RuntimeStageActivity extends Omit<RuntimeStageEvent, "kind"> {
  kind: Exclude<RuntimeStageKind, "first_token" | "first_output">; endRecorded: boolean;
}
export function runtimeStageActivities(report: RuntimeStageReport): RuntimeStageActivity[] {
  const activities: RuntimeStageActivity[] = [], open = new Map<string, number[]>();
  for (const event of report.events) {
    if (event.kind === "first_token" || event.kind === "first_output") continue;
    const kind = event.kind, key = JSON.stringify([kind, event.call, event.toolName]);
    if (event.phase === "start") {
      const indices = open.get(key) ?? []; indices.push(activities.length); open.set(key, indices);
      activities.push({ ...event, kind, endRecorded: false });
    } else if (event.phase === "end") {
      const index = open.get(key)?.shift();
      if (index === undefined) activities.push({ ...event, kind, endRecorded: true });
      else activities[index] = { ...event, kind, seq: activities[index].seq, offsetMs: activities[index].offsetMs, endRecorded: true };
    } else activities.push({ ...event, kind, endRecorded: true });
  }
  return activities;
}
export function formatRuntimeStageMs(value: number | null): string | null {
  if (value === null) return null;
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}

/** Visibility is presentation only; collectors and diagnostic exports retain the complete record. */
export const RUNTIME_STAGE_SLOW_MS = 30_000;
export function showRuntimeStageReport(report: RuntimeStageReport, alwaysShow = false): boolean {
  const measured = report.durationMs ?? report.events[report.events.length - 1]?.offsetMs ?? 0;
  return alwaysShow || report.state === "error" || report.errorKind !== null || measured > RUNTIME_STAGE_SLOW_MS;
}
export function runtimeStageDiagnosticsText(reports: readonly RuntimeStageReport[], timings: readonly MessageTimingReport[] = []): string | null {
  const safe = reports.slice(-16).map(parseRuntimeStageReport).filter((report): report is RuntimeStageReport => report !== null);
  const messageTimings = timings.slice(-16).map(parseMessageTimingReport).filter((row): row is MessageTimingReport => row !== null
    && safe.some(stage => runtimeStageIdentity(stage) === runtimeStageIdentity(row) && stage.historyStart === row.historyStart));
  return safe.length ? JSON.stringify({ schemaVersion: 1, runtimeStages: safe, ...(messageTimings.length ? { messageTimings } : {}) }, null, 2) : null;
}
