import { HOST_LOGIN_ONLY_RUNTIMES, inheritsPersonalExtensions, manualRuntimeInstallUrl } from "./runtime-expansion";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceRuntimeProxy } from "./WorkspaceRuntimeProxy";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { runtimeOperationText } from "./workspace-settings-copy";
import { SettingsAdvanced, SettingsRowMenu } from "./SettingsChrome";
import { type Key } from "./i18n";
import type { RuntimeApprovalCard, RuntimeLoginSource, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";


// Core runtime-form status line (kept local: this module is also loaded standalone by tests).
// Settings never probes models (that would start the engine with the Mac's login), so it never says
// «ready to use»: Core `ready` only means files and login source were confirmed. «Ready» is reserved
// for a successful model listing (DESIGN.md §11.4; coordinator decision 2026-11-12).
const UNAVAILABLE_REASONS = ["not_installed", "unsafe_file", "legacy_unsupported", "adapter_pending", "detection_failed", "host_login_required"];
function runtimeUseText(t: (key: Key, values?: Record<string, string | number>) => string, use?: string, reason?: string): string | null {
  if (use === "unavailable") return t("ws.rf.status.unavailable", { reason: t(`ws.rf.reason.${UNAVAILABLE_REASONS.includes(reason ?? "") ? reason : "unknown"}` as Key) });
  return use === "ready" ? t("ws.runtimes.status.enabled") : use === "confirm_first_use" ? t("ws.runtimes.status.installedNotEnabled")
    : use === "confirm_update" || use === "detecting" ? t(`ws.rf.status.${use}` as Key) : null;
}
const manualRuntimeGuide = (id: string) => id === "gemini" ? "https://geminicli.com/docs/get-started/installation/"
  : id === "kimi" ? "https://moonshotai.github.io/kimi-code/en/guides/getting-started.html" : null;

function RuntimeSetupDialog({ label, pending, onClose, children }: { label: string; pending: boolean; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const panel = dialog.current!, previous = document.activeElement as HTMLElement | null;
    const row = previous?.closest<HTMLElement>(".wsd-runtime-row");
    panel.showModal();
    (panel.querySelector<HTMLElement>("input:checked:not(:disabled),button:not(:disabled)") ?? panel).focus({ preventScroll: true });
    return () => {
      panel.close();
      const target = previous?.isConnected ? previous : row?.isConnected ? row : null;
      target?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="wsd-approval wsd-runtime-bind-dialog wsd-runtime-setup-dialog" aria-modal="true" aria-label={label} aria-busy={pending}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([type="radio"]):not(:disabled),input[type="radio"]:checked:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]'))
        .filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    {children}
  </dialog>;
}

/** «Use this Mac's login (recommended)» stays visible; the isolated alternative folds under Advanced.
 * Antigravity can only sign in separately, so its only choice is never folded away. */
function IsolatedLoginChoice({ runtimeId, loginSource, children }: { runtimeId: string; loginSource: RuntimeLoginSource; children: ReactNode }) {
  const { t } = useWorkspaceLocale();
  if (runtimeId === "agy") return <>{children}</>;
  return <SettingsAdvanced page="runtimes.loginSource" persist={false} items={[t("ws.runtimeAccess.isolated")]} customized={loginSource === "isolated" ? [t("ws.runtimeAccess.isolated")] : []}>{children}</SettingsAdvanced>;
}

/** `firstKey`: no connection in this workspace has saved a key yet, so macOS may show a Keychain prompt on save (review of #76, L3). */
export function WorkspaceConnectionForm({ model, existing, firstKey = false, onSaved, onCancel, onDirty }: { model: WorkspaceDevModel; existing?: WorkspaceModelConnection; firstKey?: boolean; onSaved?: () => void; onCancel?: () => void; onDirty?: (value: boolean) => void }) {
  const { t } = useWorkspaceLocale();
  const [label, setLabel] = useState(existing?.label ?? ""), [provider, setProvider] = useState<"openai" | "anthropic">(existing?.provider ?? "openai");
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? ""), [defaultModel, setDefaultModel] = useState(existing?.defaultModel ?? ""), [apiKey, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const saveFence = useRef(false);
  return <form className="wsd-connection-form" onChange={() => onDirty?.(true)} onSubmit={event => { event.preventDefault(); if (saveFence.current) return; saveFence.current = true;
    const input = { label, provider, baseURL, defaultModel, apiKey };
    setSaving(true); void (existing ? model.editConnection(existing.id, input) : model.configureConnection(input)).then(saved => {
      if (saved) { setKey(""); onDirty?.(false); onSaved?.(); }
    }).finally(() => { saveFence.current = false; setSaving(false); }); }}>
    <label>{t("ws.connections.name")}<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} required /></label>
    <label>{t("ws.connections.protocol")}<select value={provider} onChange={event => setProvider(event.target.value as "openai" | "anthropic")}><option value="openai">{t("ws.connections.openai")}</option><option value="anthropic">{t("ws.connections.anthropic")}</option></select></label>
    <label>{t("ws.connections.baseURL")}<input type="url" value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://…" autoComplete="off" required /></label>
    <label>{t("ws.connections.model")}<input value={defaultModel} onChange={event => setDefaultModel(event.target.value)} autoComplete="off" required /></label>
    <label>{t("ws.connections.apiKey")}{existing && !existing.credentialRequired ? t("ws.connections.keepKey") : ""}<input type="password" value={apiKey} onChange={event => setKey(event.target.value)} autoComplete="new-password" spellCheck={false} required={!existing || existing.credentialRequired} /></label>
    <small>{t(firstKey && !existing ? "ws.connections.keyNoteFirst" : "ws.connections.keyNoteShort")}</small>
    <div className="wsd-card-actions">{onCancel ? <button type="button" disabled={saving} onClick={() => { setKey(""); onDirty?.(false); onCancel(); }}>{t("ws.cancel")}</button> : null}
    <button className="wsd-primary" disabled={saving}>{t(saving ? "ws.connections.saving" : "ws.connections.save")}</button></div>
  </form>;
}

export default function WorkspaceRuntimeSettings({ model, workspace, onDirty }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; onDirty?: (value: boolean) => void }) {
  const { t, locale } = useWorkspaceLocale();
  const [loginSource, setLoginSource] = useState<RuntimeLoginSource>("host");
  const [card, setCard] = useState<RuntimeApprovalCard | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState<"" | Key>("");
  const [detecting, setDetecting] = useState(true), [checked, setChecked] = useState(false);
  const [local, setLocal] = useState<NonNullable<WorkspaceDevSnapshot["runtimes"]>["options"][number] | null>(null);
  const saveFence = useRef(false);
  useEffect(() => { setLocal(null); }, [workspace.workspaceId, workspace.resourceGeneration]);
  const [login, setLogin] = useState<{ shell: string; command: string } | null>(null), [loginBusy, setLoginBusy] = useState(false), [loginFailed, setLoginFailed] = useState(false);
  const loginScope = `${workspace.workspaceId}:${workspace.resourceGeneration}`, liveLoginScope = useRef(loginScope);
  liveLoginScope.current = loginScope;
  useEffect(() => { liveLoginScope.current = loginScope; setLogin(null); setLoginBusy(false); setLoginFailed(false); return () => { liveLoginScope.current = ""; }; }, [loginScope]);
  useEffect(() => { let active = true; void model.detectRuntimes().then(() => { if (active) setChecked(true); })
    .catch(() => { if (active) setNotice("ws.runtimes.detectFailed"); }).finally(() => { if (active) setDetecting(false); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const downloading = workspace.runtimes?.operations.some(row => row.state === "downloading") ?? false;
  useEffect(() => { if (!downloading) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [downloading, model]);
  const propose = async (id: string) => { setPending(true); setNotice(""); setLoginSource(id === "agy" ? "isolated" : "host"); try { setCard(await model.proposeRuntime(id)); }
    catch { setNotice("ws.runtimes.proposalFailed"); } finally { setPending(false); } };
  const decide = async (approved: boolean) => { if (!card || pending) return; setPending(true);
    try { await model.approveRuntime(card, approved, loginSource); setCard(null); setNotice(approved ? "ws.runtimes.accepted" : "ws.runtimes.cancelledNotice"); }
    catch { setCard(null); setNotice("ws.runtimes.unknown"); } finally { setPending(false); } };
  const runtimeOptions = workspace.runtimes?.options ?? [];
  // Engines that are not installed fold into one «Other engines · N not installed» row (settings IA audit, runtimes).
  const missingRuntimes = runtimeOptions.filter(runtime => runtime.state === "not_installed" && !runtime.registered);
  return <section className="wsd-runtime-settings" aria-label={t("ws.runtimes.title")}><h3>{t("ws.settings.page.runtimes")}</h3><p>{t("ws.runtimes.note")}</p>
    <WorkspaceRuntimeProxy key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} onDirty={onDirty} />
    <button disabled={detecting || pending} onClick={() => { setDetecting(true); setChecked(false); setNotice(""); void model.detectRuntimes().then(() => setChecked(true)).catch(() => setNotice("ws.runtimes.detectFailed")).finally(() => setDetecting(false)); }}>{t(detecting ? "ws.runtimes.detecting" : "ws.runtimes.detect")}</button>
    {workspace.runtimes?.detection?.completedAt ? <p role="status" className="wsd-runtime-checked">{t("ws.rf.lastChecked", { time: new Date(workspace.runtimes.detection.completedAt).toLocaleTimeString(locale === "en" ? "en" : locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) })}{workspace.runtimes.detection.running || workspace.runtimes.detection.incomplete.length ? ` · ${t("ws.rf.stillChecking")}` : ""}</p> : null}
    <div className="wsd-runtime-list"><div className="wsd-connection wsd-runtime-row"><div><strong>Pi</strong><small>{t("ws.runtimes.builtIn")}</small><small>{t("ws.runtimes.piNote")}</small></div></div>
    {runtimeOptions.filter(runtime => !missingRuntimes.includes(runtime)).map(renderRuntime)}
    {missingRuntimes.length ? <details className="wsd-runtime-details wsd-runtime-missing"><summary>{detecting || !checked ? t("ws.runtimes.otherChecking") : t("ws.runtimes.otherMissing", { n: missingRuntimes.length })}</summary>{missingRuntimes.map(renderRuntime)}</details> : null}</div>
    {workspace.runtimes?.options.some(runtime => runtime.runtimeId === "codex" && runtime.registered && runtime.loginSource !== "host") ? <section className="wsd-codex-login" aria-label={t("ws.resume.codexLogin")}>
      <h4>{t("ws.resume.codexLogin")}</h4><p>{t("ws.resume.loginGuide")}</p>
      <button type="button" disabled={loginBusy} onClick={() => { if (loginBusy) return; setLoginBusy(true); setLoginFailed(false);
        void model.codexLoginInstructions().then(value => { if (liveLoginScope.current === loginScope) setLogin(value); })
          .catch(() => { if (liveLoginScope.current === loginScope) setLoginFailed(true); }).finally(() => { if (liveLoginScope.current === loginScope) setLoginBusy(false); });
      }}>{t(loginBusy ? "common.loading" : "ws.resume.loginCommand")}</button>
      {login ? <><p>{t(login.shell === "powershell" ? "ws.resume.loginPowerShell" : "ws.resume.loginTerminal")}</p><code className="wsd-root">{login.command}</code><p>{t("ws.resume.loginThenRetry")}</p></> : null}
      {loginFailed ? <p role="alert">{t("ws.resume.loginUnavailable")}</p> : null}
    </section> : null}
    {/* A running download is pinned at the top of the page with its cancel action (WorkspaceSettings › runtimeAttention). */}
    {workspace.runtimes?.operations.filter(operation => operation.state !== "downloading").map(operation => <div className="wsd-runtime-operation" key={operation.id}><span>{operation.runtimeId} · {runtimeOperationText(t, operation.state)}</span></div>)}
    {notice ? <p role="status">{t(notice)}</p> : null}
    {local ? <RuntimeSetupDialog label={t("ws.runtimes.confirmLocal")} pending={pending} onClose={() => setLocal(null)}><h3>{t("ws.runtimes.registerTitle", { name: local.label })}</h3>
      <p>{t("ws.runtimes.bindLead")}</p>
      {inheritsPersonalExtensions(local.runtimeId) ? <p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p> : null}
      <details className="wsd-runtime-proof wsd-runtime-details"><summary>{t("ws.runtimes.details")}</summary>
        {inheritsPersonalExtensions(local.runtimeId) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
        {local.version ? <small>{t(local.registered ? "ws.runtimes.registered" : "ws.runtimes.detected", { version: local.version })}</small> : null}<small>{t("ws.runtimes.detectedPath")}</small><code className="wsd-root wsd-runtime-path">{local.path}</code><small>{t("ws.runtimes.registerNote")}</small>
      </details>
      <fieldset><legend>{t("ws.runtimeAccess.loginSource")}</legend><label><input type="radio" name="settings-local-login" checked={loginSource === "host"} disabled={pending || local.runtimeId === "agy"} onChange={() => setLoginSource("host")} />{t("ws.runtimeAccess.hostRecommendedRuntime", { runtime: local.label })}</label>{!HOST_LOGIN_ONLY_RUNTIMES.includes(local.runtimeId) ? <IsolatedLoginChoice runtimeId={local.runtimeId} loginSource={loginSource}><label><input type="radio" name="settings-local-login" checked={loginSource === "isolated"} disabled={pending} onChange={() => setLoginSource("isolated")} />{t("ws.runtimeAccess.isolated")}</label></IsolatedLoginChoice> : null}</fieldset>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => setLocal(null)}>{t("ws.cancel")}</button><button className="wsd-primary" disabled={pending || !local.fingerprint} onClick={() => { if (!local.fingerprint || saveFence.current) return; saveFence.current = true; setPending(true);
        void model.registerLocalRuntime(local.runtimeId, local.fingerprint, workspace.workspaceId, workspace.resourceGeneration, loginSource).then(() => { setLocal(null); setNotice("ws.runtimes.registeredNotice"); })
          .catch(() => { setLocal(null); setNotice("ws.runtimes.registerUnknown"); }).finally(() => { saveFence.current = false; setPending(false); }); }}>{t("ws.runtimes.register")}</button></div></RuntimeSetupDialog> : null}
    {card ? <RuntimeSetupDialog label={t("ws.runtimes.confirmInstall")} pending={pending} onClose={() => void decide(false)}><div className="wsd-kicker">{t("ws.approval.kicker")}</div>
      <h3>{t("ws.runtimes.installTitle", { name: card.label, version: card.version })}</h3>
      {inheritsPersonalExtensions(card.runtimeId) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
        {inheritsPersonalExtensions(card.runtimeId) ? <p role="note" data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</p> : null}<p>{card.origin} · {card.target.platform}/{card.target.arch} · {t("ws.runtimes.maxSize", { n: Math.ceil(card.maxBytes / 1024 / 1024) })}</p>
      <fieldset><legend>{t("ws.runtimeAccess.loginSource")}</legend><label><input type="radio" name="settings-install-login" checked={loginSource === "host"} disabled={pending || card.runtimeId === "agy"} onChange={() => setLoginSource("host")} />{t("ws.runtimeAccess.hostRecommendedRuntime", { runtime: card.label })}</label>{!HOST_LOGIN_ONLY_RUNTIMES.includes(card.runtimeId) ? <IsolatedLoginChoice runtimeId={card.runtimeId} loginSource={loginSource}><label><input type="radio" name="settings-install-login" checked={loginSource === "isolated"} disabled={pending} onChange={() => setLoginSource("isolated")} />{t("ws.runtimeAccess.isolated")}</label></IsolatedLoginChoice> : null}</fieldset>
      <details><summary>{t("ws.runtimes.integrity")}</summary><code>{card.sha256}</code><p>{t("ws.runtimes.installNote")}</p></details>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => void decide(false)}>{t("ws.runtimes.notNow")}</button><button className="wsd-primary" disabled={pending} onClick={() => void decide(true)}>{t("ws.runtimes.approve")}</button></div>
    </RuntimeSetupDialog> : null}
  </section>;
  // Declared after the JSX (hoisted) so the long row body keeps its original position in the file.
  function renderRuntime(runtime: (typeof runtimeOptions)[number]) {
      const unavailableForColleagues = runtime.registered && runtime.generalAgentDriverAvailable === false && runtime.runtimeId !== "kimi";
      // Core runtime-form: a read-only status; first use is confirmed in the colleague form, not here.
      const formStatus = runtimeUseText(t, runtime.use, runtime.unavailableReason);
      const users = (workspace.agents ?? []).filter(agent => agent.state !== "archived" && agent.runtime.id === runtime.runtimeId).map(agent => agent.identity.displayName);
      return <div className="wsd-connection wsd-runtime-row" key={runtime.runtimeId} role="group" aria-label={runtime.label} tabIndex={-1}>
      <div><strong>{runtime.label}</strong>{inheritsPersonalExtensions(runtime.runtimeId) ? <small data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</small> : null}<small data-runtime-use={runtime.use}>{formStatus ? `${formStatus}${runtime.version ? ` · ${runtime.version}` : ""}` : runtime.registered ? t("ws.runtimes.registered", { version: runtime.version ?? "" }) : runtime.state === "detected" ? t("ws.runtimes.detected", { version: runtime.version ?? "" }) : runtime.state === "integrity_failed" ? t("ws.runtimes.integrityFailed") : runtime.state === "detection_failed" ? t("ws.runtimes.detectFailed") : runtime.state === "detecting" || detecting || !checked ? t("ws.runtimes.checking") : t("ws.runtimes.missing")}</small>
      {users.length ? <small data-runtime-users="true">{t("ws.rf.usedBy", { names: users.join("、") })}</small> : null}
      {manualRuntimeInstallUrl(runtime.runtimeId) ? <small>{t("ws.runtimeExpansion.hostLogin")}</small> : null}

      {manualRuntimeGuide(runtime.runtimeId) ? <small>{t(runtime.state === "not_installed" && checked && !detecting ? "ws.runtimes.manualInstall" : "ws.runtimes.hostLoginOnly")} <a href={manualRuntimeGuide(runtime.runtimeId)!} target="_blank" rel="noreferrer">{t("ws.runtimes.manualGuide")}</a></small> : null}
      {unavailableForColleagues ? <small>{t("ws.runtimes.driverNote")}</small> : null}
      {runtime.path || unavailableForColleagues || manualRuntimeInstallUrl(runtime.runtimeId) || runtime.runtimeId === "kimi" ? <details className="wsd-runtime-details"><summary>{t("ws.runtimes.details")}</summary>
        {runtime.path ? <><small>{t("ws.runtimes.detectedPath")}</small><code className="wsd-root wsd-runtime-path">{runtime.path}</code></> : null}
        {manualRuntimeInstallUrl(runtime.runtimeId) ? <small>{t("ws.runtimeExpansion.extensionsInherited")}</small> : null}
        {runtime.runtimeId === "kimi" ? <small>{t("ws.runtimes.extensionsInherited")}</small> : null}
        {unavailableForColleagues ? <small>{t("ws.runtimes.driverDetails")}</small> : null}
      </details> : null}</div>
      {runtime.state === "legacy_unsupported" ? <p role="status">{t("ws.runtimeExpansion.legacyUnsupported")}</p> : null}
      {runtime.registered && runtime.loginSource === "isolated" && runtime.fingerprint && runtime.runtimeId !== "agy" ? <SettingsRowMenu label={runtime.label} disabled={pending}
        items={[{ id: "switch-host", label: t("ws.runtimeAccess.switchHost"), onSelect: () => { setLoginSource("host"); setLocal(runtime); } }]} /> : null}
      {runtime.state === "detected" && runtime.use ? <small data-first-use="true">{t("ws.rf.firstUseNote")}</small>
        : runtime.state === "detected" ? <button className="wsd-primary" disabled={pending || detecting} onClick={() => { setLoginSource(runtime.runtimeId === "agy" ? "isolated" : "host"); setLocal(runtime); }}>{t("ws.runtimes.useLocal")}</button>
        : runtime.state === "not_installed" && manualRuntimeInstallUrl(runtime.runtimeId) ? <div><p>{t("ws.runtimeExpansion.manualInstall")}</p><a href={manualRuntimeInstallUrl(runtime.runtimeId)!} target="_blank" rel="noopener noreferrer">{t("ws.runtimeExpansion.instructions")}</a></div>
        : runtime.state === "not_installed" && !runtime.path && !manualRuntimeGuide(runtime.runtimeId) ? <button disabled={pending || downloading || detecting || !checked} onClick={() => void propose(runtime.runtimeId)}>{t("ws.runtimes.install")}</button> : null}
    </div>;
  }
}
