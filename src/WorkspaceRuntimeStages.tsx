import { useEffect, useRef, useState } from "react";
import type { makeT } from "./i18n";
import { formatRuntimeStageMs, runtimeStageActivities, runtimeStageIdentity, showRuntimeStageReport, runtimeStageDiagnosticsText,
  type RuntimeDiagnosticReceipt, type RuntimeStageReport } from "./runtime-stage-events";
import "./runtime-stage-events.css";

import { copyRuntimeDiagnostic } from "./runtime-failure";

type Translate = ReturnType<typeof makeT>;
interface ExportState { key: string; pending: boolean; failed: boolean; receipt: RuntimeDiagnosticReceipt | null }
export function WorkspaceRuntimeStages({ report, t, onExport, disabled = false, alwaysShow = false }: {
  report: RuntimeStageReport; t: Translate; onExport?: (report: RuntimeStageReport) => Promise<RuntimeDiagnosticReceipt>; disabled?: boolean; alwaysShow?: boolean;
}) {
  const key = runtimeStageIdentity(report), liveKey = useRef(key), mounted = useRef(true), fence = useRef<string | null>(null);
  liveKey.current = key;
  const [state, setState] = useState<ExportState | null>(null);
  const [copyState, setCopyState] = useState<{ key: string; state: "copied" | "copyFailed" } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = state?.key === key ? state : null;
  const generate = async () => {
    if (!onExport || disabled || fence.current === key) return;
    fence.current = key; setState({ key, pending: true, failed: false, receipt: null });
    try {
      const receipt = await onExport(report);
      if (mounted.current && liveKey.current === key) setState({ key, pending: false, failed: false, receipt });
    } catch {
      if (mounted.current && liveKey.current === key) setState({ key, pending: false, failed: true, receipt: null });
    } finally { if (fence.current === key) fence.current = null; }
  };
  const copy = async () => {
    if (disabled) return;
    const text = runtimeStageDiagnosticsText([report]); if (!text) return;
    const clipboard = globalThis.navigator?.clipboard;
    const result = await copyRuntimeDiagnostic(text, clipboard ? value => clipboard.writeText(value) : undefined);
    if (mounted.current && liveKey.current === key) setCopyState({ key, state: result });
  };
  if (!showRuntimeStageReport(report, alwaysShow)) return null;
  const firstToken = report.events.find(event => event.kind === "first_token" && event.source !== "host");
  const firstOutput = report.events.find(event => event.kind === "first_output");
  const activities = runtimeStageActivities(report), measured = (value: number | null) => formatRuntimeStageMs(value) ?? t("ws.stages.unknown");
  return <details className={"wsd-runtime-stages" + (alwaysShow ? "" : " is-compact")} data-stage-display={alwaysShow ? "always" : "compact"} data-runtime-attempt={report.attemptId}>
    <summary><span>{t("ws.stages.title")}</span><span className="wsd-runtime-stages-total">{measured(report.durationMs)}</span></summary>
    <div className="wsd-runtime-stages-body">
      <p className="wsd-runtime-stages-status" role="status">{t(`ws.stages.state.${report.state}`)}</p>
      <dl className="wsd-runtime-stages-metadata">
        <div><dt>{t("ws.stages.runtime")}</dt><dd>{report.runtime.id}</dd></div>
        <div><dt>{t("ws.stages.version")}</dt><dd>{report.runtime.version ?? t("ws.stages.unknown")}</dd></div>
        <div><dt>{t("ws.stages.login")}</dt><dd>{t(`ws.stages.login.${report.runtime.loginSource}`)}</dd></div>
        <div><dt>{t("ws.stages.model")}</dt><dd>{report.runtime.model ?? t("ws.stages.unknown")}</dd></div>
        <div><dt>{t("ws.stages.effort")}</dt><dd>{report.runtime.effort ?? t("ws.stages.unknown")}</dd></div>
        <div><dt>{t("ws.stages.total")}</dt><dd>{measured(report.durationMs)}</dd></div>
        <div><dt>{t("ws.stages.first_token")}</dt><dd>{measured(firstToken?.offsetMs ?? null)}</dd></div>
        {firstOutput ? <div><dt>{t("ws.stages.first_output")}</dt><dd>{measured(firstOutput.offsetMs)}</dd></div> : null}
        {report.errorKind ? <div><dt>{t("ws.stages.errorKind")}</dt><dd><code>{report.errorKind}</code></dd></div> : null}
      </dl>
      {!firstToken ? <p className="wsd-runtime-stages-note">{t("ws.stages.firstUnknown")}</p> : null}
      {activities.length ? <ol className="wsd-runtime-stages-list">{activities.map(event => <li key={event.seq}>
        <span>{t(`ws.stages.kind.${event.kind}`, { n: event.call ?? "?", name: event.toolName ?? "?" })}</span>
        <span>{event.endRecorded ? measured(event.durationMs ?? (event.kind === "complete" ? report.durationMs : null))
          : t(report.state === "running" ? "ws.stages.pending" : "ws.stages.missingEnd")}</span>
        {event.outcome === "error" || event.outcome === "cancelled" ? <small>{t(event.outcome === "error" ? "ws.stages.state.error" : "ws.stages.state.cancelled")}</small> : null}
      </li>)}</ol> : <p>{t("ws.stages.empty")}</p>}
      {report.droppedEvents ? <p className="wsd-runtime-stages-note">{t("ws.stages.dropped", { n: report.droppedEvents })}</p> : null}
      <p className="wsd-runtime-stages-note">{t("ws.stages.overlap")}</p>
      <div className="wsd-runtime-stages-export">
        {onExport ? <button type="button" className="hs-btn sec" data-runtime-action="export" onClick={() => void generate()} disabled={disabled || current?.pending === true}>
          {t(current?.pending ? "ws.stages.exporting" : "ws.stages.export")}</button> : null}
        <button type="button" className="hs-btn sec" data-runtime-action="copy" onClick={() => void copy()} disabled={disabled}>{t("ws.stages.copy")}</button>
        {copyState?.key === key ? <p role="status">{t(copyState.state === "copied" ? "ws.runtimeDiagnostic.copied" : "ws.runtimeDiagnostic.copyFailed")}</p> : null}
        {copyState?.key === key && copyState.state === "copyFailed" ? <pre tabIndex={0}>{runtimeStageDiagnosticsText([report])}</pre> : null}
        <p className="wsd-runtime-stages-note">{t("ws.stages.privacy")}</p>
        {current?.failed ? <p role="alert">{t("ws.stages.exportFailed")}</p> : null}
        {current?.receipt ? <div className="wsd-runtime-stages-receipt" role="status"><strong>{t("ws.stages.saved")}</strong>
          <code tabIndex={0}>{current.receipt.path}</code><small>{current.receipt.bytes} bytes · SHA256</small><code>{current.receipt.sha256}</code></div> : null}
      </div>
    </div>
  </details>;
}
