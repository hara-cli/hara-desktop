import type { MessageTimingReport } from "./message-timing.ts";
import { runtimeStageActivities, type RuntimeStageReport, type RuntimeStageActivity, type RuntimeStageFailure } from "./runtime-stage-events.ts";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state.ts";
export type WaitConversation = WorkspaceDevSnapshot["conversation"];
export type WaitPhase = "idle" | "preparing" | "queued" | "spawn" | "recovering" | "thinking" | "tool" | "approval" | "question" | "output" | "finalizing" | "completed" | "failed" | "cancelled" | "unknown";
export type TimingAction = "stop" | "login" | "retry" | "new-session" | "runtime-settings" | "proxy-settings" | "model-settings" | "verify";
export interface LocalWaitTiming {
  requestId: string; startedAtMs: number; lastEventAtMs: number; runId: string | null; attemptId: string | null;
  accepted: boolean; unknown: boolean; dispatchElapsedMs: number | null; repliedElapsedMs: number | null; completedElapsedMs: number | null;
}
interface ClockEntry { value: LocalWaitTiming; previous: Set<string>; marker: string }
export const waitScope = (value: Pick<WorkspaceDevSnapshot, "workspaceId" | "resourceGeneration" | "selectedAgentId" | "conversation">) =>
  JSON.stringify([value.workspaceId, value.resourceGeneration, value.selectedAgentId, value.conversation.sessionId]);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
/** Local observation only: no timers, RPC, message text or wall clock. Stable snapshots suit useSyncExternalStore. */
export class LocalWaitClock {
  private readonly entries = new Map<string, ClockEntry>();
  private lastNow = 0;
  private readonly readNow: () => number;
  constructor(now: () => number = () => performance.now()) { this.readNow = now; }
  now = (): number => { const n = this.readNow(); if (finite(n)) this.lastNow = Math.max(n, this.lastNow); return this.lastNow; };
  get(scope: string): LocalWaitTiming | null { return this.entries.get(scope)?.value ?? null; }
  begin(scope: string, requestId: string, previousAttempts: readonly string[]): void {
    const now = this.now();
    if (this.entries.get(scope)?.value.requestId === requestId) return;
    this.entries.delete(scope); this.entries.set(scope, { previous: new Set(previousAttempts), marker: "", value: {
      requestId, startedAtMs: now, lastEventAtMs: now, runId: null, attemptId: null, accepted: false, unknown: false,
      dispatchElapsedMs: null, repliedElapsedMs: null, completedElapsedMs: null } });
    while (this.entries.size > 32) this.entries.delete(this.entries.keys().next().value!);
  }
  accept(scope: string, requestId: string, runId?: string): void { this.patch(scope, requestId, { accepted: true, unknown: false, ...(runId ? { runId } : {}) }); }
  unknown(scope: string, requestId: string): void { this.patch(scope, requestId, { unknown: true }); }
  refuse(scope: string, requestId: string): void { if (this.get(scope)?.requestId === requestId) this.entries.delete(scope); }
  private patch(scope: string, requestId: string, patch: Partial<LocalWaitTiming>): void {
    const entry = this.entries.get(scope); if (!entry || entry.value.requestId !== requestId) return;
    entry.value = { ...entry.value, ...patch };
  }
  preview(scope: string, requestId: string, frame: { runId: string; attemptId: string; seq: number }): void {
    const entry = this.entries.get(scope); if (!entry || entry.value.requestId !== requestId || entry.value.completedElapsedMs !== null) return;
    if (entry.value.attemptId && entry.value.attemptId !== frame.attemptId || entry.value.runId && entry.value.runId !== frame.runId) return;
    entry.marker = "preview:" + frame.seq;
    this.patch(scope, requestId, { accepted: true, runId: frame.runId, attemptId: frame.attemptId, lastEventAtMs: this.now() });
  }
  observe(scope: string, conversation: WaitConversation, reports: readonly RuntimeStageReport[], timings: readonly MessageTimingReport[], approvalIds: readonly string[] = []): void {
    const entry = this.entries.get(scope), local = entry?.value;
    if (!entry || !local || !local.runId || local.completedElapsedMs !== null || conversation.runId !== local.runId) return;
    const candidates = reports.filter(row => row.runId === local.runId && !entry.previous.has(row.attemptId));
    const report = local.attemptId ? candidates.find(row => row.attemptId === local.attemptId) : candidates[candidates.length - 1];
    const matches = timings.filter(row => row.runId === local.runId && !entry.previous.has(row.attemptId));
    const timing = report ? timingFor(report, timings) : local.attemptId ? matches.find(row => row.attemptId === local.attemptId) : matches[matches.length - 1];
    const attemptId = report?.attemptId ?? timing?.attemptId ?? local.attemptId;
    const marker = JSON.stringify([attemptId, report?.events.length, report?.events[report.events.length - 1]?.seq, report?.state,
      report?.contextTokens, timing?.points, conversation.state, conversation.pendingQuestion?.id,
      conversation.pendingInteractions?.map(row => row.requestId), approvalIds]);
    const now = this.now(), elapsed = Math.max(0, now - local.startedAtMs);
    const relative = (point: "T4" | "T8" | "T9"): number => {
      const end = timing?.points[point], start = timing?.points.T0;
      return finite(end) && typeof start === "number" && end >= start ? Math.max(0, end - start) : elapsed;
    };
    const patch: Partial<LocalWaitTiming> = { ...(attemptId ? { attemptId } : {}) };
    if (marker !== entry.marker) { entry.marker = marker; patch.lastEventAtMs = now; }
    if (timing?.points.T4 != null && local.dispatchElapsedMs === null) patch.dispatchElapsedMs = relative("T4");
    if (timing?.points.T8 != null && local.repliedElapsedMs === null) patch.repliedElapsedMs = relative("T8");
    if (timing?.points.T9 != null) patch.completedElapsedMs = relative("T9");
    if (Object.keys(patch).length) this.patch(scope, local.requestId, patch);
  }
}
export function timingFor(report: RuntimeStageReport, timings: readonly MessageTimingReport[]): MessageTimingReport | undefined {
  const keys = ["workspaceId", "resourceGeneration", "agentId", "sessionId", "runId", "attemptId", "historyStart"] as const;
  return timings.find(row => keys.every(key => row[key] === report[key]));
}
export function currentWaitReport(conversation: WaitConversation, reports: readonly RuntimeStageReport[], local: LocalWaitTiming | null): RuntimeStageReport | undefined {
  if (local && !local.runId) return undefined;
  const rows = reports.filter(row => row.runId === (local?.runId ?? conversation.runId)
    && row.sessionId === conversation.sessionId && (!local?.attemptId || row.attemptId === local.attemptId));
  return rows[rows.length - 1];
}
export function formatWaitElapsed(ms: number, completed = false): string {
  const seconds = Math.max(0, ms) / 1000;
  if (completed && seconds < 60) return seconds.toFixed(1) + "s";
  const whole = Math.floor(seconds);
  return whole < 60 ? whole + "s" : Math.floor(whole / 60) + "m " + String(whole % 60).padStart(2, "0") + "s";
}
export interface WaitingView {
  phase: WaitPhase; visible: boolean; elapsedMs: number | null; showSeconds: boolean;
  hint: "spawn_slow" | "long_history" | "silent" | "no_first" | "unknown" | null;
  activity: RuntimeStageActivity | null; toolCount: number; highEffort: boolean; nextWakeMs: number | null;
}
export function deriveWaitingView(input: { conversation: WaitConversation; report?: RuntimeStageReport; timing?: MessageTimingReport;
  local: LocalWaitTiming | null; now: number; sending?: boolean; preview?: boolean; approvalCount?: number; pendingUnknown?: boolean }): WaitingView {
  const { conversation: c, report, timing, local, now } = input;
  const elapsed = local ? Math.max(0, local.completedElapsedMs ?? now - local.startedAtMs) : null;
  const rows = report ? runtimeStageActivities(report) : [], open = (kind: string) => rows.filter(row => row.kind === kind && !row.endRecorded);
  const tool = open("tool_call"), lastTool = rows.filter(row => row.kind === "tool_call");
  const activeTool = tool[tool.length - 1], activity = activeTool ?? lastTool[lastTool.length - 1] ?? null;
  const ask = Boolean(c.pendingQuestion || c.pendingInteractions?.some(row => row.kind === "ask_user_question" && row.delivery === "sync"));
  const approval = Boolean(input.approvalCount || c.pendingInteractions?.some(row => row.kind !== "ask_user_question"));
  const busy = ["running", "draining", "awaiting_user"].includes(c.state) || input.sending || ask || approval || input.pendingUnknown;
  const first = Boolean(input.preview || timing?.points.T5 != null || report?.events.some(row => row.kind === "first_token" || row.kind === "first_output"));
  let phase: WaitPhase = "idle";
  if (local?.runId && local.runId !== c.runId && local.completedElapsedMs === null) phase = "preparing";
  else if (ask) phase = "question";
  else if (approval) phase = "approval";
  else if (input.pendingUnknown && !local?.runId) phase = "unknown";
  else if (input.sending && !local?.runId) phase = "preparing";
  else if (open("queued").length || c.state === "queued") phase = "queued";
  else if (["error", "blocked", "needs_recovery"].includes(c.state) || report?.errorKind) phase = "failed";
  else if (c.state === "cancelled") phase = "cancelled";
  else if (!busy && timing?.points.T9 != null) phase = "completed";
  else if (timing?.points.T8 != null && busy) phase = "finalizing";
  else if (activeTool) phase = "tool";
  else if (input.preview) phase = "output";
  else if (open("spawn").length) phase = "spawn";
  else if (open("cold_start").length) phase = "recovering";
  else if (busy && (timing?.points.T4 != null || open("model_roundtrip").length || first)) phase = "thinking";
  else if (busy) phase = "preparing";
  const live = !["idle", "completed", "failed", "cancelled"].includes(phase);
  const visible = live && (elapsed === null || elapsed >= 400);
  const currentElapsed = phase === "finalizing" && local?.repliedElapsedMs != null ? local.repliedElapsedMs : elapsed;
  const fromT4 = elapsed !== null && local?.dispatchElapsedMs != null ? Math.max(0, elapsed - local.dispatchElapsedMs) : null;
  const silent = local ? Math.max(0, now - local.lastEventAtMs) : 0;
  const long = (report?.historyStart ?? c.history.length) >= 40 || (report?.contextTokens ?? c.nativeSession?.contextTokens ?? 0) >= 16_384;
  let hint: WaitingView["hint"] = null;
  if (phase === "unknown") hint = "unknown";
  else if (live && !["question", "approval", "queued", "finalizing"].includes(phase)) {
    if (!first && (fromT4 ?? elapsed ?? 0) >= 60_000) hint = "no_first";
    else if (silent >= 20_000) hint = "silent";
    else if (!first && fromT4 !== null && fromT4 >= 8000 && long) hint = "long_history";
    else if (phase === "spawn" && elapsed !== null) {
      const start = open("spawn")[0]?.offsetMs ?? 0, base = timing?.points.T2 != null && timing.points.T0 !== null ? timing.points.T2 - timing.points.T0 : 0;
      if (elapsed - base - start > 1500) hint = "spawn_slow";
    }
  }
  const waits: number[] = [];
  if (elapsed !== null && live && local?.completedElapsedMs === null) {
    for (const threshold of [400, 2000]) if (elapsed < threshold) waits.push(threshold - elapsed);
    if (phase === "spawn") {
      const base = timing?.points.T2 != null && timing.points.T0 !== null ? timing.points.T2 - timing.points.T0 : 0;
      const due = 1501 + base + (open("spawn")[0]?.offsetMs ?? 0) - elapsed; if (due > 0) waits.push(due);
    }
    if (!first && fromT4 !== null) for (const threshold of [8000, 60_000]) if (fromT4 < threshold) waits.push(threshold - fromT4);
    if (silent < 20_000) waits.push(20_000 - silent);
    if (!first && fromT4 === null && elapsed < 60_000) waits.push(60_000 - elapsed);
  }
  return { phase, visible, elapsedMs: currentElapsed, showSeconds: currentElapsed !== null && currentElapsed >= 2000,
    hint, activity, toolCount: lastTool.length, highEffort: ["high", "xhigh", "max"].includes(report?.runtime.effort ?? ""),
    nextWakeMs: waits.length ? Math.max(1, Math.min(...waits)) : null };
}
export function timingVerified(report: RuntimeStageReport, timing: MessageTimingReport | undefined, conversation?: WaitConversation): boolean {
  return Boolean(timing && timingFor(report, [timing]) && timing.points.T9 != null && report.state === "completed" && conversation?.runId === report.runId
    && conversation.sessionId === report.sessionId && conversation.completion?.state === "verified" && conversation.taskState === "completed");
}
export interface TimingSummary { totalMs: number | null; totalSource: "message" | "runtime" | "unknown"; prepareMs: number | null;
  startupMs: number | null; firstTokenMs: number | null; generationMs: number | null; toolMs: number | null; toolCalls: number; finalizeMs: number | null }
export function timingSummary(report: RuntimeStageReport, timing?: MessageTimingReport): TimingSummary {
  const diff = (a: keyof MessageTimingReport["points"], b: keyof MessageTimingReport["points"]) => {
    const x = timing?.points[a], y = timing?.points[b]; return typeof x === "number" && typeof y === "number" && y >= x ? y - x : null;
  };
  const rows = runtimeStageActivities(report), spawn = rows.filter(row => row.kind === "spawn" && row.endRecorded && row.durationMs !== null), tools = rows.filter(row => row.kind === "tool_call");
  const measuredTools = tools.filter(row => row.endRecorded && row.durationMs !== null);
  const total = diff("T0", "T9");
  return { totalMs: total ?? report.durationMs, totalSource: total !== null ? "message" : report.durationMs !== null ? "runtime" : "unknown",
    prepareMs: diff("T1", "T3"), startupMs: spawn.length ? spawn.reduce((n, row) => n + row.durationMs!, 0) : null,
    firstTokenMs: diff("T4", "T5"), generationMs: diff("T5", "T8"),
    toolMs: measuredTools.length ? measuredTools.reduce((n, row) => n + row.durationMs!, 0) : null, toolCalls: tools.length, finalizeMs: diff("T8", "T9") };
}
export function failureActions(kind: RuntimeStageFailure | null, options: { unknown?: boolean; canRetry?: boolean; canNewSession?: boolean; contextFull?: boolean } = {}): TimingAction[] {
  if (options.unknown) return ["verify", "runtime-settings"];
  if (options.contextFull) return options.canNewSession ? ["new-session"] : ["runtime-settings"];
  if (kind === "runtime_auth_required" || kind === "runtime_auth_rejected") return ["login"];
  if (kind === "version_incompatible" || kind === "not_installed" || kind === "spawn_failed") return ["runtime-settings"];
  const retry: TimingAction[] = options.canRetry ? ["retry"] : [];
  if (kind === "runtime_network" || kind === "runtime_proxy") return ["proxy-settings", ...retry];
  if (kind === "runtime_rate_limit" || kind === "runtime_quota" || kind === "invalid_model") return [...retry, "model-settings"];
  if (kind === "timeout") return retry.length ? retry : ["runtime-settings"];
  return ["runtime-settings"];
}
