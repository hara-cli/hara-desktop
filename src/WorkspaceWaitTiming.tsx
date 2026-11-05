import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { makeT } from "./i18n";
import type { ContextCompactionView } from "./context-compaction";
import type { MessageTimingReport } from "./message-timing";
import { copyRuntimeDiagnostic, runtimeCooldownRemaining } from "./runtime-failure";
import { runtimeTurnFailure } from "./workspace-resume";
import { runtimeStageDiagnosticsText, type RuntimeStageReport } from "./runtime-stage-events";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { currentWaitReport, deriveWaitingView, failureActions, formatWaitElapsed, timingFor, timingSummary, timingVerified,
  type LocalWaitTiming, type TimingAction, type WaitConversation } from "./wait-timing";
import "./wait-timing.css";
type T = ReturnType<typeof makeT>;
const noPreview = () => null;
const TOOL_NAMES: Record<string, string> = { read_file: "read", workspace_read: "read", write_file: "write", workspace_write: "write", edit_file: "edit", ls: "list", grep: "search", glob: "search", web_search: "search", agent_list: "lookup", task_intake: "lookup", workspace_verify: "lookup", agent_create: "create", ask_user: "ask", ask_user_question: "ask" };
export function friendlyTool(name: string | null, t: T): string { return t(`ws.wait.tool.${TOOL_NAMES[name ?? ""] ?? "generic"}` as Parameters<T>[0]); }
/** Only this text node ticks. No transcript render or snapshot RPC is scheduled by a second. */
export function WaitElapsed({ local, now, frozen, label }: { local: LocalWaitTiming; now(): number; frozen?: number | null; label: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const paint = () => { const elapsed = frozen ?? Math.max(0, now() - local.startedAtMs);
      if (ref.current) ref.current.textContent = elapsed >= 2000 ? formatWaitElapsed(elapsed, frozen != null) : "";
      if (frozen == null) timer = setTimeout(paint, Math.max(25, 1000 - elapsed % 1000)); };
    paint(); return () => clearTimeout(timer);
  }, [local.startedAtMs, now, frozen]);
  return <span className="wsd-wait-elapsed" ref={ref} aria-label={label} aria-live="off" />;
}
function useWaiting(model: WorkspaceDevModel) {
  const local = useSyncExternalStore(model.subscribeWaitTiming, model.getWaitTimingSnapshot, noPreview);
  const preview = useSyncExternalStore(model.subscribeAssistantPreview, model.getAssistantPreviewSnapshot, noPreview);
  const [, wake] = useState(0), view = model.getSnapshot(), w = view.workspace;
  const report = w ? currentWaitReport(w.conversation, model.runtimeStageReports(), local) : undefined;
  const timing = report && w ? timingFor(report, w.conversation.messageTimings ?? []) : undefined;
  const derived = w ? deriveWaitingView({ conversation: w.conversation, report, timing, local, now: model.waitClock.now(), sending: view.sending,
    preview: Boolean(preview), approvalCount: w.approvals.length, pendingUnknown: view.pendingUnknown }) : null;
  useEffect(() => { if (derived?.nextWakeMs == null) return;
    const timer = setTimeout(() => wake(value => value + 1), derived.nextWakeMs); return () => clearTimeout(timer);
  }, [local, derived?.phase, derived?.hint, derived?.nextWakeMs]);
  return { local, preview, view, w, report, timing, derived };
}
export function WorkspaceDraftTiming({ model, t }: { model: WorkspaceDevModel; t: T }) {
  const { local, derived, report, view, w } = useWaiting(model);
  const canStop = Boolean(w && !view.loading && w.conversation.state === "running"
    && (!local || local.runId === w.conversation.runId));
  const phase = derived?.phase === "finalizing" ? "finalizing" : ["tool", "question", "approval", "queued", "thinking"].includes(derived?.phase ?? "") ? derived!.phase : "output";
  return derived ? <span className="wsd-draft-timing" data-wait-phase={derived.phase}>{t(`ws.wait.${phase}` as Parameters<T>[0], { name: friendlyTool(derived.activity?.toolName ?? null, t), runtime: report?.runtime.id ?? "Hara" })}{phase === "tool" && derived.activity?.targetLabel ? <> · <bdi>{derived.activity.targetLabel}</bdi></> : null}
    {local && derived.showSeconds ? <> · <WaitElapsed local={local} now={model.waitClock.now} frozen={derived.phase === "finalizing" ? local.repliedElapsedMs : null} label={t("ws.wait.elapsed")} /></> : null}
    <button type="button" className="hs-btn sec wsd-wait-stop" disabled={!canStop} onClick={() => { if (canStop) void model.cancel(); }}>{t("ws.wait.action.stop")}</button></span> : null;
}
export function WorkspaceOptimisticMessage({ model, t }: { model: WorkspaceDevModel; t: T }) {
  useSyncExternalStore(model.subscribeWaitTiming, model.getWaitTimingSnapshot, noPreview);
  const text = model.getOptimisticMessage();
  return text ? <div className="hs-msg me wsd-message is-user wsd-optimistic"><div className="hs-bub wsd-bubble">{text}<small>{t("ws.wait.sending")}</small></div></div> : null;
}
export function compactFailureHandled(c: WaitConversation, report?: RuntimeStageReport): boolean {
  return Boolean(report?.errorKind && ["error", "blocked", "needs_recovery"].includes(c.state)
    && c.nativeSession?.status !== "recovery_needed" && c.nativeSession?.status !== "new_session_required");
}
export function WorkspaceWaiting({ model, t, name, runtime, disabled, onSettings }: { model: WorkspaceDevModel; t: T; name: string; runtime: string; disabled: boolean; onSettings(action: TimingAction): void }) {
  const { local, preview, view, w, report, derived } = useWaiting(model);
  const [newSession, setNewSession] = useState(false), dialog = useRef<HTMLDialogElement>(null);
  const [cooldownNow, setCooldownNow] = useState(Date.now);
  const diagnostic = w ? runtimeTurnFailure(w.conversation.blockReason, runtime)?.diagnostic : undefined;
  const cooldown = diagnostic ? runtimeCooldownRemaining(diagnostic, cooldownNow) : 0;
  useEffect(() => { if (cooldown <= 0) return; const timer = setTimeout(() => setCooldownNow(Date.now()), Math.min(1000, cooldown)); return () => clearTimeout(timer); }, [cooldown]);
  useEffect(() => { if (newSession) dialog.current?.showModal(); else dialog.current?.close(); }, [newSession]);
  if (!w || !derived) return null;
  const busy = ["running", "draining"].includes(w.conversation.state);
  const canStop = !disabled && busy && w.conversation.state !== "draining" && (!local || local.runId === w.conversation.runId);
  const canNew = model.supportsNativeSessions() && Boolean(w.conversation.nativeSession);
  const act = (action: TimingAction) => { if (disabled) return; if (action === "stop") { if (canStop) void model.cancel(); }
    else if (action === "verify") void model.verifyPending(); else if (action === "retry") { if (!cooldown) void model.send(true); }
    else if (action === "new-session") setNewSession(true); else onSettings(action); };
  const failure = compactFailureHandled(w.conversation, report);
  const actions = failureActions(report?.errorKind ?? null, { unknown: derived.phase === "unknown", canRetry: !busy && !view.pendingUnknown && !view.runtimeBlocked && w.conversation.resumeAdmission?.allowed === true, canNewSession: canNew, contextFull: w.conversation.nativeSession?.status === "new_session_required" });
  const phaseText = t(`ws.wait.${derived.phase}` as Parameters<T>[0], { runtime, name: friendlyTool(derived.activity?.toolName ?? null, t) });
  const inDraft = Boolean(preview);
  return <>
    {failure ? <div className="wsd-wait-failure" role="status" data-wait-failure={report!.errorKind}>
      <p>{t(`ws.wait.failure.${report!.errorKind}` as Parameters<T>[0])}</p><div className="wsd-wait-actions">{actions.map(action => <button type="button" className="hs-btn sec" key={action} disabled={disabled || action === "retry" && cooldown > 0} onClick={() => act(action)}>{t(`ws.wait.action.${action}`)}</button>)}</div>
      {cooldown > 0 ? <small>{t("ws.runtimeDiagnostic.cooldown", { seconds: Math.ceil(cooldown / 1000) })}</small> : null}
    </div> : derived.visible && !inDraft ? <div className="wsd-wait" data-wait-phase={derived.phase}>
      <div className="wsd-wait-line"><span className="wsd-wait-dot" aria-hidden="true" /><span role="status">{name} · {phaseText}</span>
        {local && derived.showSeconds ? <WaitElapsed local={local} now={model.waitClock.now} frozen={derived.phase === "finalizing" ? local.repliedElapsedMs : null} label={t("ws.wait.elapsed")} /> : <span className="wsd-wait-spacer" />}
        {derived.phase === "unknown" ? <button type="button" className="hs-btn sec" disabled={disabled} onClick={() => act("verify")}>{t("ws.wait.action.verify")}</button>
          : <button type="button" className={"hs-btn sec wsd-wait-stop" + (["silent", "no_first"].includes(derived.hint ?? "") ? " is-emphasized" : "")} onClick={() => act("stop")} disabled={!canStop}>{t("ws.wait.action.stop")}</button>}
      </div>
      {derived.activity ? <div className={"wsd-wait-tool" + (derived.activity.endRecorded ? " is-finished" : "")} key={`${report?.attemptId}:${derived.activity.seq}`}>
        {derived.activity.endRecorded ? t("ws.wait.tool.done", { name: friendlyTool(derived.activity.toolName, t) }) : friendlyTool(derived.activity.toolName, t)}{derived.activity.targetLabel ? <> · <bdi>{derived.activity.targetLabel}</bdi></> : null} · {t("ws.wait.tool.call", { n: derived.activity.call ?? derived.toolCount })}</div> : null}
      {derived.hint ? <p className="wsd-wait-hint" role="status">{t(`ws.wait.hint.${derived.hint}`, { runtime })}{derived.highEffort ? " " + t("ws.wait.hint.high") : ""}
        {derived.hint === "long_history" && canNew ? <> <button type="button" className="hs-btn ghost" disabled={disabled} onClick={() => act("new-session")}>{t("ws.wait.action.new-session")}</button></> : null}</p> : null}
    </div> : null}
    <dialog className="wsd-wait-dialog" ref={dialog} onCancel={() => setNewSession(false)} onClose={() => setNewSession(false)} aria-label={t("ws.wait.newSessionTitle")}>
      <h3>{t("ws.wait.newSessionTitle")}</h3><p>{t("ws.wait.newSessionBusy")}</p><div className="wsd-wait-actions">
        {busy ? <button type="button" className="hs-btn sec" disabled={!canStop} onClick={() => act("stop")}>{t("ws.wait.action.stop")}</button> : <button type="button" className="hs-btn pri" disabled={disabled || view.sending || view.pendingUnknown} onClick={() => { setNewSession(false); void model.newNativeSession(); }}>{t("ws.wait.action.new-session")}</button>}
        <button type="button" className="hs-btn ghost" onClick={() => setNewSession(false)}>{t("ws.wait.close")}</button></div>
    </dialog>
  </>;
}
export function WorkspaceTimingChip({ report, timings = [], conversation, compactions = [], t, disabled, onDiagnostics }: {
  report: RuntimeStageReport; timings?: readonly MessageTimingReport[]; conversation?: WaitConversation; compactions?: readonly ContextCompactionView[]; t: T; disabled?: boolean; onDiagnostics(): void;
}) {
  const [open, setOpen] = useState(false), [copy, setCopy] = useState<"copied" | "copyFailed" | null>(null);
  const root = useRef<HTMLSpanElement>(null), popover = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), pinned = useRef(false), id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const contains = (node: Node | null) => Boolean(node && (root.current?.contains(node) || popover.current?.contains(node)));
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return; }
    const place = () => { const anchor = trigger.current?.getBoundingClientRect(), panel = popover.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const left = Math.max(8, Math.min(window.innerWidth - panel.width - 8, anchor.right - panel.width));
      const top = anchor.top - panel.height - 6 >= 8 ? anchor.top - panel.height - 6 : Math.max(8, Math.min(window.innerHeight - panel.height - 8, anchor.bottom + 6));
      setPosition({ left, top }); };
    place(); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, copy]);
  useEffect(() => { if (!open) return; const outside = (event: PointerEvent) => { if (!contains(event.target as Node)) { setOpen(false); pinned.current = false; } };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside); }, [open]);
  const timing = timingFor(report, timings), summary = timingSummary(report, timing), slow = (summary.totalMs ?? 0) > 30_000;
  const verified = timingVerified(report, timing, conversation);
  const ms = (value: number | null) => value === null ? t("ws.wait.unknownValue") : formatWaitElapsed(value, true);
  const effort = report.runtime.effort, source = report.runtime.effortSource;
  const knownEffort = effort && ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort) ? t(`ws.wait.effort.${effort}` as Parameters<T>[0]) : t("ws.wait.unknownValue");
  const compacted = compactions.some(row => row.sessionId === report.sessionId && row.agentId === report.agentId && row.historyStart <= report.historyStart && row.status === "completed");
  const reasons = slow ? summary.finalizeMs !== null && summary.finalizeMs > 5000 ? "finalize" : ["high", "xhigh", "max"].includes(effort ?? "") ? "high" : "slow" : null;
  return <span className={"wsd-timing-wrap" + (slow ? " is-slow" : "")} ref={root} onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }} onPointerLeave={event => { if (!pinned.current && !contains(event.relatedTarget as Node) && !contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!contains(event.relatedTarget)) { setOpen(false); pinned.current = false; } }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); pinned.current = false; trigger.current?.focus(); } }}>
    <button type="button" ref={trigger} className="wsd-timing-chip" aria-expanded={open} aria-controls={id} aria-label={`${t("ws.wait.details")} · ${ms(summary.totalMs)}`} onClick={() => { pinned.current = !pinned.current; setOpen(pinned.current); }}>
      {ms(summary.totalMs)}{slow ? ` · ${t("ws.wait.slow")}` : ""}{verified ? <span aria-label={t("ws.wait.verified")}> ✓</span> : null}
    </button>
    {open ? createPortal(<div ref={popover} className="wsd-timing-popover" role="region" id={id} aria-label={t("ws.wait.details")} style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }} onPointerLeave={event => { if (!pinned.current && !contains(event.relatedTarget as Node) && !contains(document.activeElement)) setOpen(false); }}>
      <strong>{t("ws.wait.details")} · {ms(summary.totalMs)}</strong><dl>
        {([["prepareLabel", summary.prepareMs], ["startupLabel", summary.startupMs], ["firstLabel", summary.firstTokenMs], ["generationLabel", summary.generationMs]] as const).map(([key, value]) => <div key={key}><dt>{t(`ws.wait.${key}`)}</dt><dd>{ms(value)}</dd></div>)}
        <div><dt>{t("ws.wait.toolLabel")}</dt><dd>{summary.toolCalls ? t("ws.wait.observedTools", { n: summary.toolCalls, duration: ms(summary.toolMs) }) : t("ws.wait.unknownValue")}</dd></div>
        <div><dt>{t("ws.wait.finalizeLabel")}</dt><dd>{ms(summary.finalizeMs)}</dd></div>
        <div><dt>{t("ws.wait.effortLabel")}</dt><dd>{source ? t(`ws.wait.${source === "user" ? "fixed" : source}`) + " → " : ""}{knownEffort}</dd></div>
        <div><dt>{t("ws.wait.contextLabel")}</dt><dd>{compacted ? t("ws.wait.contextCompacted") : report.contextTokens !== undefined ? t("ws.wait.contextTokens", { n: report.contextTokens }) : t("ws.wait.unknownValue")}</dd></div>
      </dl><small>{t(summary.totalSource === "runtime" ? "ws.wait.runtimeTotal" : "ws.wait.overlap")}</small>
      <span className="wsd-wait-actions"><button type="button" className="hs-btn sec" onClick={() => { setOpen(false); pinned.current = false; onDiagnostics(); }}>{t("ws.wait.fullDiagnostics")}</button>
        <button type="button" className="hs-btn ghost" disabled={disabled} onClick={async () => { const text = runtimeStageDiagnosticsText([report], timings); if (text) setCopy(await copyRuntimeDiagnostic(text, navigator.clipboard ? value => navigator.clipboard.writeText(value) : undefined)); }}>{t("ws.wait.copy")}</button></span>
      {copy ? <span role="status">{t(`ws.wait.${copy}`)}</span> : null}{copy === "copyFailed" ? <pre tabIndex={0}>{runtimeStageDiagnosticsText([report], timings)}</pre> : null}
    </div>, document.body) : null}
    {reasons ? <span className="wsd-timing-reason">{t(`ws.wait.hint.${reasons}`)}</span> : null}
  </span>;
}
