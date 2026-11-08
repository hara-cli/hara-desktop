import { HOST_LOGIN_ONLY_RUNTIMES, inheritsPersonalExtensions, manualRuntimeInstallUrl, runtimeEffortVisible } from "./runtime-expansion";
import { WorkspaceRuntimeVersion } from "./WorkspaceRuntimeVersion";
import { runtimeVersionFor } from "./runtime-version-drift";
import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeId } from "./client";
import { makeT } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import { WorkspaceAgentRuntimePicker } from "./AgentRuntimePicker";
import { ShellDialog } from "./WorkspaceShell";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceRuntimeModels, WorkspaceConnectionModels, WorkspaceSessionRestart, RuntimeLoginSource, RuntimePermissionTier } from "./workspace-dev-state";

type ModelCard = WorkspaceRuntimeModels & { source?: "live" | "documented"; connectionId?: string };
const effortChoice = (value: string | null | undefined): string => value === "auto" ? "" : value ?? "";

export default function WorkspaceRuntimeAccess({ agent, workspace, locale, compact = false, listModels, listConnectionModels, connectionModelSupported, onApplyRuntime, permissionSupported = false, onApplyPermissionTier, onApplyModel, onApplyConnectionModel, onRescan, onRegisterRuntime, onRuntimeDirectory }: {
  agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; locale: "en" | "zh-Hans" | "zh-Hant"; compact?: boolean;
  listModels(runtimeId: string): Promise<WorkspaceRuntimeModels>;
  listConnectionModels(agentId: string, connectionId: string): Promise<WorkspaceConnectionModels>;
  connectionModelSupported: boolean;
  permissionSupported?: boolean;
  onApplyPermissionTier?(tier: RuntimePermissionTier): Promise<void>;
  onApplyRuntime(runtimeId: AgentRuntimeId, sessionRestart: WorkspaceSessionRestart): Promise<void>;
  onApplyModel(runtimeId: string, modelId: string, revision: number, effort: string | null): Promise<void>;
  onApplyConnectionModel(connectionId: string, modelId: string, revision: number, effort: string | null): Promise<void>;
  onRescan(): Promise<void>;
  onRegisterRuntime(runtimeId: string, fingerprint: string, loginSource: RuntimeLoginSource): Promise<void>;
  onRuntimeDirectory(): void;
}) {
  const t = makeT(locale);
  const pi = agent.runtime.id === "pi";
  const connection = workspace.connections?.connections.find(row => row.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId) && row.status === "active");
  const owner = JSON.stringify([workspace.workspaceId, workspace.resourceGeneration, agent.agentId]);
  const scope = JSON.stringify([owner, agent.runtime.id, agent.configRevision, agent.agentEpoch, pi ? connection?.id : null, pi ? workspace.connections?.revision : null]);
  const liveScope = useRef(scope); liveScope.current = scope;
  const liveOptions = useRef(workspace.runtimeOptions); liveOptions.current = workspace.runtimeOptions;
  const option = workspace.runtimeOptions?.find(row => row.id === agent.runtime.id);
  const [modelView, setModelView] = useState<{ scope: string; data: ModelCard } | null>(null);
  const models = option?.available && modelView?.scope === scope && modelView.data.runtimeId === agent.runtime.id ? modelView.data : null;
  const [selected, setSelected] = useState("");
  const [effort, setEffort] = useState("");
  const [loginSource, setLoginSource] = useState<RuntimeLoginSource>("host");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [inventoryError, setInventoryError] = useState("");
  const [reload, setReload] = useState(0);
  const modelRequest = useRef(0);
  const saveFence = useRef(false);
  const [directoryOwner, setDirectoryOwner] = useState("");
  const [change, setChange] = useState<{ scope: string; runtimeId: AgentRuntimeId } | null>(null);
  const [restart, setRestart] = useState<WorkspaceSessionRestart>("keep");
  const [local, setLocal] = useState<{ scope: string; runtimeId: string; label: string; fingerprint: string; path?: string } | null>(null);
  const installation = workspace.runtimes?.options.find(row => row.runtimeId === agent.runtime.id);
  // An unrelated missing engine must not turn a bound runtime's inventory failure into discovery.
  const directoryNeeded = option
    ? !option.available && (option.reason === "not_registered" || option.reason === "not_installed")
    : !agent.runtime.available && (installation?.state === "not_installed" || installation?.state === "detected" && !installation.registered);
  const detected = workspace.runtimes?.options.filter(row => row.state === "detected" && !row.registered) ?? [];
  const showDetectedCards = directoryNeeded;
  const missing = directoryNeeded && installation?.state === "not_installed" ? [installation] : [];
  const conversation = workspace.conversation;
  const freshBlocked = !conversation || ["running", "draining"].includes(conversation.state)
    || Boolean(conversation.pendingQuestion || conversation.pendingInteractions?.length);
  useEffect(() => {
    let active = true;
    const request = ++modelRequest.current;
    const current = () => active && liveScope.current === scope && modelRequest.current === request;
    setModelView(null); setSelected(""); setEffort(""); setError(""); setInventoryError(""); setLoading(false);
    if (!option?.available || pi && (!connection || !connectionModelSupported)) return () => { active = false; };
    setLoading(true);
    // Only the current binding supplies model authority. Picker drafts never query models.
    const inventory = pi ? listConnectionModels(agent.agentId, connection!.id).then(result => ({ ...result, runtimeId: "pi" })) : listModels(agent.runtime.id);
    void inventory.then(result => {
      if (!current()) return;
      if (result.runtimeId !== agent.runtime.id) throw new Error("ws.runtimeAccess.modelMismatch");
      setModelView({ scope, data: result }); setSelected(result.selectedModelId ?? ""); setEffort(effortChoice(result.selectedEffort));
    }).catch(cause => { if (current()) setInventoryError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current()) setLoading(false); });
    return () => { active = false; };
  }, [scope, option?.available, listModels, listConnectionModels, connectionModelSupported, reload, locale]);
  const run = async (action: () => Promise<void>) => {
    if (saveFence.current) return;
    saveFence.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { if (liveScope.current === scope) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { saveFence.current = false; setBusy(false); }
  };
  const target = change?.scope === scope ? workspace.runtimeOptions?.find(row => row.id === change.runtimeId) : null;
  const modelError = inventoryError || error;
  const selectedModel = models?.models.find(row => row.id === selected);
  const effortLevels = selectedModel?.supportedReasoningEfforts ?? [];
  const showEffort = runtimeEffortVisible(agent.runtime.id, effortLevels);
  const currentLoginSource = installation?.loginSource ?? "isolated";
  if (compact) return <div className="vg-runtime-strip" aria-label={t("ws.runtimeAccess.compactAria")}>
    {agent.runtime.id === "kimi" ? <span role="note">{t("ws.runtimes.extensionsInherited")}</span> : null}
    <span>{t("ws.permissions.label")} <strong>{t(agent.permissionTier === "full-protected" ? "ws.permissions.full" : agent.permissionTier === "controlled" ? "ws.permissions.controlled" : "ws.permissions.unknown")}</strong></span><span>Runtime <strong>{agent.runtime.label}</strong></span><span>{t("ws.runtimeAccess.model")} <strong>{models?.models.find(row => row.id === models.selectedModelId)?.label ?? (pi ? connection?.defaultModel : null) ?? "—"}</strong></span>
    {showEffort ? <span>{t("ws.runtimeAccess.effort")} <strong>{effortChoice(models?.selectedEffort) || t("ws.runtimeAccess.auto")}</strong></span> : null}<span>{t("ws.runtimeAccess.loginSource")} <strong>{t(currentLoginSource === "host" ? "ws.runtimeAccess.host" : "ws.runtimeAccess.isolated")}</strong></span>
  </div>;
  return <div className="vg-runtime-access">
    <section className="vg-context-card vg-p0-card">
      <p>{t("ws.runtimeAccess.bound", { name: agent.identity.displayName, runtime: agent.runtime.label })}</p>
      <dl className="vg-runtime-summary"><dt>{t("ws.runtimeAccess.model")}</dt><dd>{models?.models.find(row => row.id === models.selectedModelId)?.label ?? (pi ? connection?.defaultModel : null) ?? "—"}</dd>{showEffort ? <><dt>{t("ws.runtimeAccess.effort")}</dt><dd>{effortChoice(models?.selectedEffort) || t("ws.runtimeAccess.auto")}</dd></> : null}<dt>{t("ws.runtimeAccess.loginSource")}</dt><dd>{agent.runtime.id === "pi" ? "—" : t(currentLoginSource === "host" ? "ws.runtimeAccess.host" : "ws.runtimeAccess.isolated")}</dd></dl>
      <label className="vg-permission-tier">{t("ws.permissions.label")}
        <select aria-label={t("ws.permissions.label")} value={agent.permissionTier ?? "unknown"} disabled={!permissionSupported || !onApplyPermissionTier || busy || freshBlocked}
          onChange={event => { const tier = event.target.value; if (tier === "full-protected" || tier === "controlled") void run(() => onApplyPermissionTier!(tier)); }}>
          {!agent.permissionTier ? <option value="unknown">{t("ws.permissions.unknown")}</option> : null}
          <option value="full-protected">{t("ws.permissions.full")}</option><option value="controlled">{t("ws.permissions.controlled")}</option>
        </select>
      </label>
      <p>{t("ws.permissions.help")}</p>
      {conversation?.taskId && conversation.permissionTier ? <p>{t("ws.permissions.current", { tier: t(conversation.permissionTier === "full-protected" ? "ws.permissions.full" : "ws.permissions.controlled") })}</p> : null}
      {!permissionSupported ? <p role="status">{t("ws.permissions.upgrade")}</p> : null}
      <WorkspaceRuntimeVersion runtimeId={agent.runtime.id} binding={runtimeVersionFor(workspace.runtimes?.options, agent.runtime.id)} t={t} />
      {installation?.registered && installation.loginSource === "isolated" && installation.fingerprint && installation.runtimeId !== "agy" ? <button disabled={busy} onClick={() => { setLoginSource("host"); setLocal({ scope, runtimeId: installation.runtimeId, label: installation.label, fingerprint: installation.fingerprint!, path: installation.path }); }}>{t("ws.runtimeAccess.switchHost")}</button> : null}
      {workspace.runtimeOptions ? <WorkspaceAgentRuntimePicker agent={agent} options={workspace.runtimeOptions} locale={locale} saving={busy}
        onApply={runtimeId => { if (runtimeId === agent.runtime.id) return; setRestart("keep"); setError(""); setChange({ scope, runtimeId }); }} /> : null}
      {directoryNeeded && !workspace.runtimeOptions?.some(row => row.available) ? <p role="status">{t("ws.runtimeAccess.empty")}</p> : null}
      {!option?.available && (!showDetectedCards || !detected.some(row => row.runtimeId === agent.runtime.id)) && !missing.some(row => row.runtimeId === agent.runtime.id)
        ? <p role="alert">{t("ws.runtimeAccess.unavailable", { runtime: agent.runtime.label })}</p> : null}
      {showDetectedCards ? detected.map(row => <div key={row.runtimeId}><p>{t("ws.runtimeAccess.detected", { runtime: row.label })}</p>
        <button disabled={busy || !row.fingerprint} onClick={() => { setError(""); setLoginSource(row.runtimeId === "agy" ? "isolated" : "host"); setLocal({ scope, runtimeId: row.runtimeId, label: row.label, fingerprint: row.fingerprint!, path: row.path }); }}>{t("ws.runtimeAccess.register")}</button></div>) : null}
      {missing.map(row => <div key={row.runtimeId}><p>{t("ws.runtimeAccess.missing", { runtime: row.label })}</p>{row.runtimeId === "gemini" || row.runtimeId === "kimi" ? <p>{t("ws.runtimes.manualInstall")} <a href={row.runtimeId === "gemini" ? "https://geminicli.com/docs/get-started/installation/" : "https://moonshotai.github.io/kimi-code/en/guides/getting-started.html"} target="_blank" rel="noreferrer">{t("ws.runtimes.manualGuide")}</a></p> : null}</div>)}
      <div className="vg-runtime-recovery-actions">
        <button type="button" className="vg-runtime-rescan" disabled={busy} onClick={() => void run(async () => {
          modelRequest.current++; setScanning(true); setLoading(false); setModelView(null); setSelected("");
          try { await onRescan(); setReload(value => value + 1); } finally { setScanning(false); }
        })}>{t(scanning ? "ws.runtimeAccess.scanning" : "ws.runtimeAccess.rescan")}</button>
        {directoryNeeded && directoryOwner !== owner ? <button type="button" className="vg-runtime-install" disabled={busy} onClick={() => { setDirectoryOwner(owner); onRuntimeDirectory(); }}>{t("ws.runtimeAccess.install")} <span aria-hidden="true">↗</span></button> : null}
      </div>
    </section>
    {!option?.available && manualRuntimeInstallUrl(agent.runtime.id) ? <p role="status">{t("ws.runtimeExpansion.manualInstall")} <a href={manualRuntimeInstallUrl(agent.runtime.id)!} target="_blank" rel="noopener noreferrer">{t("ws.runtimeExpansion.instructions")}</a></p> : null}
    {inheritsPersonalExtensions(agent.runtime.id) ? <p role="status" data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
        {inheritsPersonalExtensions(agent.runtime.id) ? <p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p> : null}
    <section className="vg-context-card vg-p0-card vg-runtime-model-card"><h3>{t("ws.runtimeAccess.modelTitle")}</h3>
      {loading || scanning ? <p role="status">{t("ws.connectionModels.loading")}</p> : !models || !models.models.length ? <p role={option?.available ? "alert" : undefined}>{option?.available
        ? (modelError
          ? <>{t("ws.runtimeAccess.modelListUnavailable")} · {workspaceMessageText(t, modelError)}</>
          : pi && !connection ? t("ws.connectionModels.connectFirst") : pi && !connectionModelSupported ? t("ws.connectionModels.upgrade") : t("ws.runtimeAccess.modelListUnavailable"))
        : t("ws.runtimeAccess.bindFirst")}</p> : null}
      {models?.source === "live" ? <p role="status" className="vg-muted">{t("ws.runtimeExpansion.modelsLive")}</p> : null}
      {models?.source === "documented" ? <p role="status" className="vg-muted">{t(pi ? "ws.connectionModels.documented" : "ws.runtimes.documentedModels")}</p> : null}
      <label>{t("ws.runtimeAccess.model")}<select aria-label={t("ws.runtimeAccess.modelTitle")} value={models ? selected : ""} disabled={busy || loading || scanning || !models?.models.length} onChange={event => { setSelected(event.target.value); setEffort(event.target.value === models?.selectedModelId ? effortChoice(models?.selectedEffort) : ""); }}>
        <option value="">{t("ws.runtimeAccess.chooseModel")}</option>{models?.models.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select></label>
      {selected && showEffort && (effortLevels.length ? <label>{t("ws.runtimeAccess.effort")}<select aria-label={t("ws.runtimeAccess.effort")} value={effort} disabled={busy || loading || scanning} onChange={event => setEffort(event.target.value)}><option value="">{t("ws.runtimeAccess.auto")}</option>{effortLevels.map(level => <option key={level} value={level}>{level}</option>)}</select><small>{t(effort ? "ws.runtimeAccess.effortSlow" : "ws.runtimeAccess.autoHint")}</small></label> : <p>{t("ws.runtimeAccess.effortUnknown")}</p>)}
      <button disabled={busy || loading || scanning || !models || !selected || (selected === models.selectedModelId && effort === effortChoice(models.selectedEffort)) || !models.models.some(row => row.id === selected)}
          onClick={() => void run(async () => {
            if (!models || liveScope.current !== scope || models.runtimeId !== agent.runtime.id) throw new Error("ws.runtimeAccess.stale");
            if (pi) {
              if (!models.connectionId || models.connectionId !== connection?.id) throw new Error("ws.runtimeAccess.stale");
              await onApplyConnectionModel(models.connectionId, selected, models.revision, effort || null);
            } else await onApplyModel(agent.runtime.id, selected, models.revision, effort || null);
            if (liveScope.current === scope) setReload(value => value + 1);
          })}>{t("ws.runtimeAccess.applyModel")}</button>
      {modelError && (models || !option?.available) ? <p role="alert">{workspaceMessageText(t, modelError)}</p> : null}
    </section>
    {target && change ? <ShellDialog label={t("ws.runtimeAccess.confirm")} onClose={() => { if (!saveFence.current) setChange(null); }} className="wsd-approval-dialog wsd-runtime-change-dialog">
      <section className="hs-card wsd-approval"><div className="wsd-kicker">{t("ws.runtimeAccess.confirm")}</div>
        <h3>{t("ws.runtimeAccess.target", { name: agent.identity.displayName, runtime: target.label })}</h3>
        {inheritsPersonalExtensions(target.id) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
        {inheritsPersonalExtensions(target.id) ? <p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p> : null}
        <label><input type="radio" name="runtime-restart" checked={restart === "keep"} disabled={busy} onChange={() => setRestart("keep")} />{t("ws.runtimeAccess.keep")}</label>
        <p>{t("ws.runtimeAccess.keepNote", { runtime: target.label })}</p>
        <label><input type="radio" name="runtime-restart" checked={restart === "fresh"} disabled={busy || freshBlocked} onChange={() => setRestart("fresh")} />{t("ws.runtimeAccess.fresh")}</label>
        <p>{t("ws.runtimeAccess.freshNote", { runtime: target.label })}</p>
        {freshBlocked ? <p role="status">{t("ws.runtimeAccess.freshBlocked")}</p> : null}
        <p>{t("ws.runtimeAccess.oneShot")}</p>
        {error ? <p role="alert">{workspaceMessageText(t, error)}</p> : null}
        <div className="wsd-card-actions"><button disabled={busy} onClick={() => setChange(null)}>{t("ws.cancel")}</button>
          <button className="wsd-primary" disabled={busy || target.id === agent.runtime.id || !target.available || (restart === "fresh" && freshBlocked)} onClick={() => void run(async () => {
            if (change.runtimeId === agent.runtime.id || liveScope.current !== change.scope || !liveOptions.current?.some(row => row.id === change.runtimeId && row.available)) throw new Error("ws.runtimeAccess.stale");
            await onApplyRuntime(change.runtimeId, restart);
            setChange(null); setModelView(null); setReload(value => value + 1);
          })}>{t("ws.runtimeAccess.confirmChange")}</button></div>
      </section></ShellDialog> : null}
    {local?.scope === scope ? <ShellDialog label={t("ws.runtimes.confirmLocal")} onClose={() => { if (!saveFence.current) setLocal(null); }} className="wsd-approval-dialog wsd-runtime-change-dialog">
      <section className="hs-card wsd-approval"><h3>{t("ws.runtimes.registerTitle", { name: local.label })}</h3><p>{t("ws.runtimes.bindLead")}</p>
        {local.runtimeId === "kimi" ? <p role="note">{t("ws.runtimes.extensionsInherited")}</p> : null}
        <details className="wsd-runtime-proof wsd-runtime-details"><summary>{t("ws.runtimes.details")}</summary>
          <small>{t("ws.runtimes.detectedPath")}</small><code className="wsd-root wsd-runtime-path">{local.path}</code><p>{t("ws.runtimes.registerNote")}</p>
        </details>
        {inheritsPersonalExtensions(local.runtimeId) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
        {inheritsPersonalExtensions(local.runtimeId) ? <p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p> : null}
        <fieldset><legend>{t("ws.runtimeAccess.loginSource")}</legend><label><input type="radio" name="inspector-login-source" checked={loginSource === "host"} disabled={busy || local.runtimeId === "agy"} onChange={() => setLoginSource("host")} />{t("ws.runtimeAccess.hostRecommendedRuntime", { runtime: local.label })}</label>{!HOST_LOGIN_ONLY_RUNTIMES.includes(local.runtimeId) ? <label><input type="radio" name="inspector-login-source" checked={loginSource === "isolated"} disabled={busy} onChange={() => setLoginSource("isolated")} />{t("ws.runtimeAccess.isolated")}</label> : null}</fieldset>
        {error ? <p role="alert">{workspaceMessageText(t, error)}</p> : null}
        <div className="wsd-card-actions"><button disabled={busy} onClick={() => setLocal(null)}>{t("ws.cancel")}</button>
          <button className="wsd-primary" disabled={busy} onClick={() => void run(async () => {
            if (liveScope.current !== local.scope) throw new Error("ws.runtimeAccess.stale");
            await onRegisterRuntime(local.runtimeId, local.fingerprint, loginSource); setLocal(null); setReload(value => value + 1);
          })}>{t("ws.runtimes.register")}</button></div>
      </section></ShellDialog> : null}
  </div>;
}
