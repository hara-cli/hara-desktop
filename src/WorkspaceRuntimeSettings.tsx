import { HOST_LOGIN_ONLY_RUNTIMES, inheritsPersonalExtensions, manualRuntimeInstallUrl } from "./runtime-expansion";
import { useEffect, useRef, useState } from "react";
import { WorkspaceRuntimeProxy } from "./WorkspaceRuntimeProxy";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { runtimeOperationText } from "./workspace-settings-copy";
import { type Key } from "./i18n";
import type { RuntimeApprovalCard, RuntimeLoginSource, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";

export function WorkspaceConnectionForm({ model, existing, onSaved, onCancel, onDirty }: { model: WorkspaceDevModel; existing?: WorkspaceModelConnection; onSaved?: () => void; onCancel?: () => void; onDirty?: (value: boolean) => void }) {
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
    <small>{t("ws.connections.keyNote")}</small>
    <small>{t("ws.connections.scopeNote")}</small>
    <div className="wsd-card-actions">{onCancel ? <button type="button" disabled={saving} onClick={() => { setKey(""); onDirty?.(false); onCancel(); }}>{t("ws.cancel")}</button> : null}
    <button className="wsd-primary" disabled={saving}>{t(saving ? "ws.connections.saving" : "ws.connections.save")}</button></div>
  </form>;
}

export default function WorkspaceRuntimeSettings({ model, workspace, onDirty }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; onDirty?: (value: boolean) => void }) {
  const { t } = useWorkspaceLocale();
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
  return <section className="wsd-runtime-settings" aria-label={t("ws.runtimes.title")}><h3>{t("ws.settings.page.runtimes")}</h3><p>{t("ws.runtimes.note")}</p>
    <WorkspaceRuntimeProxy key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} onDirty={onDirty} />
    <button disabled={detecting || pending} onClick={() => { setDetecting(true); setChecked(false); setNotice(""); void model.detectRuntimes().then(() => setChecked(true)).catch(() => setNotice("ws.runtimes.detectFailed")).finally(() => setDetecting(false)); }}>{t(detecting ? "ws.runtimes.detecting" : "ws.runtimes.detect")}</button>
    <div className="wsd-runtime-list"><div className="wsd-connection wsd-runtime-row"><div><strong>Pi</strong><small>{t("ws.runtimes.builtIn")}</small><small>{t("ws.runtimes.piNote")}</small></div></div>
    {workspace.runtimes?.options.map(runtime => <div className="wsd-connection wsd-runtime-row" key={runtime.runtimeId}>
      <div><strong>{runtime.label}</strong><small>{runtime.registered ? t("ws.runtimes.registered", { version: runtime.version ?? "" }) : runtime.state === "detected" ? t("ws.runtimes.detected", { version: runtime.version ?? "" }) : runtime.state === "integrity_failed" ? t("ws.runtimes.integrityFailed") : detecting || !checked ? t("ws.runtimes.checking") : t("ws.runtimes.missing")}</small>
      {manualRuntimeInstallUrl(runtime.runtimeId) ? <><small>{t("ws.runtimeExpansion.hostLogin")}</small><small>{t("ws.runtimeExpansion.extensionsInherited")}</small></> : null}
      {runtime.path ? <code className="wsd-root">{runtime.path}</code> : null}
      {runtime.registered && runtime.loginSource === "isolated" && runtime.fingerprint && runtime.runtimeId !== "agy" ? <button disabled={pending} onClick={() => { setLoginSource("host"); setLocal(runtime); }}>{t("ws.runtimeAccess.switchHost")}</button> : null}
      {runtime.registered && !runtime.generalAgentDriverAvailable ? <small>{t("ws.runtimes.driverNote")}</small> : null}</div>
      {runtime.state === "detected" ? <button className="wsd-primary" disabled={pending || detecting} onClick={() => { setLoginSource(runtime.runtimeId === "agy" ? "isolated" : "host"); setLocal(runtime); }}>{t("ws.runtimes.useLocal")}</button>
        : runtime.state === "not_installed" && manualRuntimeInstallUrl(runtime.runtimeId) ? <div><p>{t("ws.runtimeExpansion.manualInstall")}</p><a href={manualRuntimeInstallUrl(runtime.runtimeId)!} target="_blank" rel="noopener noreferrer">{t("ws.runtimeExpansion.instructions")}</a></div>
        : runtime.state === "not_installed" && !runtime.path ? <button disabled={pending || downloading || detecting || !checked} onClick={() => void propose(runtime.runtimeId)}>{t("ws.runtimes.install")}</button> : null}
    </div>)}</div>
    {workspace.runtimes?.options.some(runtime => runtime.runtimeId === "codex" && runtime.registered && runtime.loginSource !== "host") ? <section className="wsd-codex-login" aria-label={t("ws.resume.codexLogin")}>
      <h4>{t("ws.resume.codexLogin")}</h4><p>{t("ws.resume.loginGuide")}</p>
      <button type="button" disabled={loginBusy} onClick={() => { if (loginBusy) return; setLoginBusy(true); setLoginFailed(false);
        void model.codexLoginInstructions().then(value => { if (liveLoginScope.current === loginScope) setLogin(value); })
          .catch(() => { if (liveLoginScope.current === loginScope) setLoginFailed(true); }).finally(() => { if (liveLoginScope.current === loginScope) setLoginBusy(false); });
      }}>{t(loginBusy ? "common.loading" : "ws.resume.loginCommand")}</button>
      {login ? <><p>{t(login.shell === "powershell" ? "ws.resume.loginPowerShell" : "ws.resume.loginTerminal")}</p><code className="wsd-root">{login.command}</code><p>{t("ws.resume.loginThenRetry")}</p></> : null}
      {loginFailed ? <p role="alert">{t("ws.resume.loginUnavailable")}</p> : null}
    </section> : null}
    {workspace.runtimes?.operations.map(operation => <div className="wsd-runtime-operation" key={operation.id}><span>{operation.runtimeId} · {runtimeOperationText(t, operation.state)}</span>
      {operation.state === "downloading" ? <button onClick={() => void model.cancelRuntime(operation.id)}>{t("ws.runtimes.cancelInstall")}</button> : null}</div>)}
    {notice ? <p role="status">{t(notice)}</p> : null}
    {local ? <section className="wsd-approval wsd-runtime-bind-dialog" role="dialog" aria-label={t("ws.runtimes.confirmLocal")}><h3>{t("ws.runtimes.registerTitle", { name: local.label })}</h3>
      <p>{t("ws.runtimes.bindLead")}</p>
      {inheritsPersonalExtensions(local.runtimeId) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}<div className="wsd-runtime-proof"><small>{t("ws.runtimes.detectedPath")}</small><code>{local.path}</code><small>{t("ws.runtimes.registerNote")}</small></div>
      <fieldset><legend>{t("ws.runtimeAccess.loginSource")}</legend><label><input type="radio" name="settings-local-login" checked={loginSource === "host"} disabled={pending || local.runtimeId === "agy"} onChange={() => setLoginSource("host")} />{t("ws.runtimeAccess.hostRecommendedRuntime", { runtime: local.label })}</label>{!HOST_LOGIN_ONLY_RUNTIMES.includes(local.runtimeId) ? <label><input type="radio" name="settings-local-login" checked={loginSource === "isolated"} disabled={pending} onChange={() => setLoginSource("isolated")} />{t("ws.runtimeAccess.isolated")}</label> : null}</fieldset>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => setLocal(null)}>{t("ws.cancel")}</button><button className="wsd-primary" disabled={pending || !local.fingerprint} onClick={() => { if (!local.fingerprint || saveFence.current) return; saveFence.current = true; setPending(true);
        void model.registerLocalRuntime(local.runtimeId, local.fingerprint, workspace.workspaceId, workspace.resourceGeneration, loginSource).then(() => { setLocal(null); setNotice("ws.runtimes.registeredNotice"); })
          .catch(() => { setLocal(null); setNotice("ws.runtimes.registerUnknown"); }).finally(() => { saveFence.current = false; setPending(false); }); }}>{t("ws.runtimes.register")}</button></div></section> : null}
    {card ? <section className="wsd-approval" role="dialog" aria-label={t("ws.runtimes.confirmInstall")}><div className="wsd-kicker">{t("ws.approval.kicker")}</div>
      <h3>{t("ws.runtimes.installTitle", { name: card.label, version: card.version })}</h3>
      {inheritsPersonalExtensions(card.runtimeId) ? <p data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}<p>{card.origin} · {card.target.platform}/{card.target.arch} · {t("ws.runtimes.maxSize", { n: Math.ceil(card.maxBytes / 1024 / 1024) })}</p>
      <fieldset><legend>{t("ws.runtimeAccess.loginSource")}</legend><label><input type="radio" name="settings-install-login" checked={loginSource === "host"} disabled={pending || card.runtimeId === "agy"} onChange={() => setLoginSource("host")} />{t("ws.runtimeAccess.hostRecommendedRuntime", { runtime: card.label })}</label>{!HOST_LOGIN_ONLY_RUNTIMES.includes(card.runtimeId) ? <label><input type="radio" name="settings-install-login" checked={loginSource === "isolated"} disabled={pending} onChange={() => setLoginSource("isolated")} />{t("ws.runtimeAccess.isolated")}</label> : null}</fieldset>
      <details><summary>{t("ws.runtimes.integrity")}</summary><code>{card.sha256}</code><p>{t("ws.runtimes.installNote")}</p></details>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => void decide(false)}>{t("ws.runtimes.notNow")}</button><button className="wsd-primary" disabled={pending} onClick={() => void decide(true)}>{t("ws.runtimes.approve")}</button></div>
    </section> : null}
  </section>;
}
