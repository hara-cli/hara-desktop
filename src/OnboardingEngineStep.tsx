import { useEffect, useId, useRef, useState } from "react";
import type { Key } from "./i18n";
import { SettingsAdvanced } from "./SettingsChrome";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { manualRuntimeInstallUrl } from "./runtime-expansion";
import { manualRuntimeGuide, WorkspaceConnectionForm } from "./WorkspaceRuntimeSettings";
import { WorkspaceRuntimeProxy } from "./WorkspaceRuntimeProxy";
import { OnboardingSheet, type OnboardingStepProps } from "./WorkspaceOnboarding";
import type { WorkspaceDevSnapshot } from "./workspace-dev-state";

/**
 * Onboarding step 1 «Default engine» (design §2 ①, hub hd-ob-engine / -none / -proxy; Jeff Q1).
 * Honest status: «Ready» only after the user pressed Check and the engine (or Pi's connection) actually listed models
 * just now; an enabled engine that has not been checked reads «Enabled», like the engines page (Jeff 2026-11-12).
 * Nothing here installs, registers or confirms an engine, and no credential is read: first use is still confirmed when
 * a colleague is created. «Use X, next» writes the per-workspace G1 default (shared with Settings › Engines; Pi is saved
 * as null, i.e. Pi-first) when Core advertises it, then saves G4 `engineChoice`. A failed G1 write stays on this step.
 */
type Check = { state: "checking" } | { state: "ok"; models: number } | { state: "failed"; network: boolean };
type Tone = "ok" | "warn" | "fail" | "draft" | "";
interface Row { id: string; name: string; status: Key; tone: Tone; detail?: string; detailTone?: "warn"; selectable: boolean; dim?: boolean; check?: boolean; link?: string }

export const NETWORK_ERROR = /network|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|socket|proxy|TLS|certificate/i;
type Runtime = NonNullable<WorkspaceDevSnapshot["runtimes"]>["options"][number];

/** Rows in display order: Pi first, then engines that can drive colleagues; not-installed ones last. */
export function engineRows(workspace: WorkspaceDevSnapshot, checks: Record<string, Check>, detecting: boolean, t: (key: Key, values?: Record<string, string | number>) => string): Row[] {
  const connected = workspace.connections.connections.some(row => row.status !== "deleted");
  const fromCheck = (id: string): Partial<Row> | null => {
    const value = checks[id];
    return !value ? null : value.state === "checking" ? { status: "ws.onboarding.engine.status.checking", tone: "draft" }
      : value.state === "ok" ? { status: "ws.onboarding.engine.status.ready", tone: "ok", detail: t("ws.onboarding.engine.listed", { n: value.models }) }
      // DESIGN 2.1.2 §11.4: a failed check still reads «Enabled»; the reason and next step go in the row, in warning colour (review of #83, M1).
      : { status: "ws.runtimes.status.enabled", tone: "", detail: t(value.network ? "ws.onboarding.engine.networkShort" : "ws.onboarding.engine.failedShort"), detailTone: "warn" };
  };
  const pi: Row = connected
    ? { id: "pi", name: t("ws.onboarding.engine.piName"), status: "ws.runtimes.status.enabled", tone: "", detail: t("ws.onboarding.engine.piConnected"), selectable: true, check: true, ...fromCheck("pi") }
    : { id: "pi", name: t("ws.onboarding.engine.piName"), status: "ws.onboarding.engine.status.needsConnection", tone: "warn", detail: t("ws.onboarding.engine.piNote"), selectable: false };
  const options = (workspace.runtimes?.options ?? []).filter(runtime => runtime.generalAgentDriverAvailable !== false && runtime.state !== "legacy_unsupported");
  const row = (runtime: Runtime): Row => {
    const base = { id: runtime.runtimeId, name: runtime.label };
    const link = manualRuntimeGuide(runtime.runtimeId) ?? manualRuntimeInstallUrl(runtime.runtimeId) ?? undefined;
    if (runtime.use === "detecting" || detecting && !runtime.registered && runtime.state !== "detected") return { ...base, status: "ws.onboarding.engine.status.checking", tone: "draft", detail: t("ws.onboarding.engine.checkingNote"), selectable: false, dim: true };
    if (runtime.use === "confirm_first_use" || runtime.use === "confirm_update") return { ...base, status: runtime.use === "confirm_update" ? "ws.onboarding.engine.status.updated" : "ws.onboarding.engine.status.confirm", tone: "warn", detail: t("ws.onboarding.engine.confirmNote"), selectable: true };
    if (runtime.registered && runtime.use !== "unavailable") return { ...base, status: "ws.runtimes.status.enabled", tone: "", detail: t("ws.onboarding.engine.hostLogin"), selectable: true, check: true, ...fromCheck(runtime.runtimeId) };
    if (runtime.use === "unavailable") return { ...base, status: "ws.onboarding.engine.status.unavailable", tone: "fail", detail: runtime.unavailableReason, selectable: false, dim: true };
    if (runtime.state === "detected") return { ...base, status: "ws.runtimes.status.installedNotEnabled", tone: "warn", detail: t("ws.onboarding.engine.enableInSettings"), selectable: false };
    return { ...base, status: "ws.onboarding.engine.status.missing", tone: "", detail: t("ws.onboarding.engine.missingNote"), selectable: false, dim: true, link };
  };
  const rows = options.map(row);
  return [pi, ...rows.filter(item => !item.dim), ...rows.filter(item => item.dim)];
}

export function OnboardingEngineStep({ progress, sheet, next, model, workspace }: OnboardingStepProps) {
  const { t } = useWorkspaceLocale();
  const name = useId();
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [detecting, setDetecting] = useState(true), [detectFailed, setDetectFailed] = useState(false), [connecting, setConnecting] = useState(false);
  const scope = `${workspace.workspaceId}:${workspace.resourceGeneration}`, live = useRef(scope);
  live.current = scope;
  const detect = () => { setDetecting(true); setDetectFailed(false);
    void model.detectRuntimes().catch(() => { if (live.current === scope) setDetectFailed(true); }).finally(() => { if (live.current === scope) setDetecting(false); }); };
  useEffect(() => { setChecks({}); detect(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = engineRows(workspace, checks, detecting, t);
  const connected = workspace.connections.connections.filter(row => row.status !== "deleted");
  const check = (id: string) => {
    setChecks(current => ({ ...current, [id]: { state: "checking" } }));
    const main = workspace.agents.find(agent => agent.kind === "main"), connection = workspace.connections.defaultConnectionId ?? connected[0]?.id;
    const request = id === "pi" ? main && connection && model.supportsConnectionModels() ? model.listConnectionModels(main.agentId, connection) : Promise.reject(new Error("unsupported"))
      : model.listRuntimeModels(id);
    void request.then(result => { if (live.current === scope) setChecks(current => ({ ...current, [id]: result.models.length ? { state: "ok", models: result.models.length } : { state: "failed", network: false } })); })
      .catch(error => { if (live.current === scope) setChecks(current => ({ ...current, [id]: { state: "failed", network: NETWORK_ERROR.test(String(error instanceof Error ? error.message : error)) } })); });
  };
  const selectable = rows.filter(row => row.selectable);
  const initial = progress.engineChoice && selectable.some(row => row.id === progress.engineChoice) ? progress.engineChoice
    : (selectable.find(row => checks[row.id]?.state === "ok") ?? selectable[0])?.id ?? null;
  const [chosen, setChosen] = useState<string | null>(null), [writing, setWriting] = useState(false), [defaultFailed, setDefaultFailed] = useState(false);
  const selected = chosen && selectable.some(row => row.id === chosen) ? chosen : initial;
  const selectedRow = rows.find(row => row.id === selected);
  const networkFailed = Object.values(checks).some(value => value.state === "failed" && value.network);
  const none = !selectable.length && !detecting;
  const choose = async () => {
    if (!selected) return;
    setDefaultFailed(false);
    if (model.supportsDefaultRuntime?.()) {
      setWriting(true);
      try {
        const current = await model.defaultRuntime(workspace.workspaceId, workspace.resourceGeneration);
        if (!current.readOnly) await model.saveDefaultRuntime(selected === "pi" ? null : selected, current.revision, workspace.workspaceId, workspace.resourceGeneration);
      } catch { if (live.current === scope) setDefaultFailed(true); return; }
      finally { if (live.current === scope) setWriting(false); }
    }
    next({ engineChoice: selected });
  };
  return <OnboardingSheet {...sheet} mascot={networkFailed ? "error" : none ? "wait" : detecting ? "think" : "idle"}
    title={t(none ? "ws.onboarding.engine.noneTitle" : "ws.onboarding.engine.title")} sub={t(none ? "ws.onboarding.engine.noneSub" : "ws.onboarding.engine.sub")}
    note={t(selectable.length ? "ws.onboarding.engine.scope" : "ws.onboarding.engine.skipNote")}
    actions={<>
      <button type="button" disabled={detecting || sheet.busy} onClick={detect}>{t(detecting ? "ws.onboarding.engine.status.checking" : "ws.onboarding.engine.checkAgain")}</button>
      {!selectable.length ? <button type="button" disabled={sheet.busy} onClick={() => next({ engineChoice: null })}>{t("ws.onboarding.engine.skip")}</button> : null}
      <button type="button" className="hs-btn pri" disabled={!selectedRow || sheet.busy || writing} onClick={() => void choose()}>
        {selectedRow ? t("ws.onboarding.engine.use", { name: selectedRow.name }) : t("ws.onboarding.engine.next")}</button>
    </>}>
    {!connected.length ? <div className="wob-list wob-hara-model">
      <div className="wob-row"><span className="wob-row-text"><b>{t("ws.onboarding.engine.hara")}</b> <span className="wob-chip is-warn">{t("ws.onboarding.engine.haraMissing")}</span><small>{t("ws.onboarding.engine.haraNote")}</small></span>
        {!connecting ? <button type="button" className="hs-btn pri" disabled={sheet.readOnly} onClick={() => setConnecting(true)}>{t("ws.onboarding.engine.connect")}</button> : null}</div>
      {connecting ? <div className="wob-row-form"><WorkspaceConnectionForm model={model} firstKey={!workspace.connections.connections.some(connection => connection.keySaved)} onSaved={() => setConnecting(false)} onCancel={() => setConnecting(false)} /></div> : null}
    </div> : null}
    {defaultFailed ? <p className="wob-notice is-error" role="alert">{t("ws.onboarding.engine.guideSaveFailed")}</p> : null}
    {detectFailed ? <p className="wob-notice is-error" role="alert">{t("ws.onboarding.engine.detectFailed")}</p> : null}
    {networkFailed ? <p className="wob-warn" role="alert">{t("ws.onboarding.engine.networkFailed", { advanced: t("ws.settings.advanced") })}</p> : null}
    <h3 className="wob-h">{t("ws.onboarding.engine.list")}<small>{t("ws.onboarding.engine.listNote")}</small></h3>
    <div className="wob-list" role="radiogroup" aria-label={t("ws.onboarding.engine.list")}>
      {rows.map(row => <label key={row.id} className={`wob-row${row.id === selected ? " is-selected" : ""}${row.dim ? " is-dim" : ""}`} data-engine={row.id}>
        <input type="radio" name={name} value={row.id} checked={row.id === selected} disabled={!row.selectable || sheet.busy} onChange={() => setChosen(row.id)} />
        <span className="wob-row-text"><b>{row.name}</b> <span className={`wob-chip${row.tone ? ` is-${row.tone}` : ""}`} data-status={row.status}>{t(row.status)}</span>{row.detail ? <small className={row.detailTone ? `is-${row.detailTone}` : undefined}>{row.detail}</small> : null}</span>
        {row.check ? <button type="button" disabled={checks[row.id]?.state === "checking" || sheet.busy} onClick={event => { event.preventDefault(); check(row.id); }}>
          {t(checks[row.id]?.state === "failed" ? "ws.onboarding.engine.retry" : "ws.onboarding.engine.check")}</button> : null}
        {row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer">{t("ws.onboarding.engine.howToInstall")}</a> : null}
      </label>)}
    </div>
    <p className="wob-note">{t("ws.onboarding.engine.readyNote")} {t("ws.onboarding.engine.free")}</p>
    <SettingsAdvanced page="onboarding.engine" persist={false} forceOpen={networkFailed} items={[t("ws.onboarding.engine.proxy")]}>
      <p className="wob-note">{t("ws.onboarding.engine.proxyNote")}</p>
      <WorkspaceRuntimeProxy key={scope} model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} />
    </SettingsAdvanced>
  </OnboardingSheet>;
}
