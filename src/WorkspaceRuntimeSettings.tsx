import { HOST_LOGIN_ONLY_RUNTIMES, inheritsPersonalExtensions, manualRuntimeInstallUrl } from "./runtime-expansion";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceRuntimeProxy } from "./WorkspaceRuntimeProxy";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { runtimeOperationText } from "./workspace-settings-copy";
import { SettingsAdvanced, SettingsRowMenu } from "./SettingsChrome";
import { SettingsActionResult } from "./SettingsActionDialog";
import { SettingsConnectionModelField } from "./SettingsConnectionModelField";
import { type Key } from "./i18n";
import type { RuntimeApprovalCard, RuntimeLoginSource, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";


// Core runtime-form status line (kept local: this module is also loaded standalone by tests).
// Settings never probes models on open (that would start the engine with its sign-in), so it never says
// «ready to use»: Core `ready` only means files and login source were confirmed. «Ready» is reserved
// for a successful model listing (DESIGN.md §11.4; coordinator decision 2026-11-12).
const UNAVAILABLE_REASONS = ["not_installed", "unsafe_file", "legacy_unsupported", "adapter_pending", "detection_failed", "host_login_required"];
function runtimeUseText(t: (key: Key, values?: Record<string, string | number>) => string, use?: string, reason?: string): string | null {
  if (use === "unavailable") return t("ws.rf.status.unavailable", { reason: t(`ws.rf.reason.${UNAVAILABLE_REASONS.includes(reason ?? "") ? reason : "unknown"}` as Key) });
  return use === "ready" ? t("ws.runtimes.status.enabled") : use === "confirm_first_use" ? t("ws.runtimes.status.installedNotEnabled")
    : use === "confirm_update" || use === "detecting" ? t(`ws.rf.status.${use}` as Key) : null;
}
/**
 * The explicit «Check» shared by guide step 1 and Settings › Engines (DESIGN.md §11.4, 2.1.2). Only a user-pressed check
 * lists models; nothing calls this on open. Success with at least one model is the only way an engine reads «Ready».
 * Pi is checked through this workspace's model connection; other engines through their own model listing, which uses
 * the engine's sign-in. Nothing is installed, registered or confirmed; credential values stay in the Host.
 */
/** `missing`: Pi has no model connection to check (review of #98, L3). */
export type EngineCheck = { state: "checking" } | { state: "ok"; models: number } | { state: "failed"; network: boolean; missing?: true };
export const NETWORK_ERROR = /network|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|fetch failed|socket|proxy|TLS|certificate/i;

/** Pi can be checked only when the workspace has a live connection and Core lists connection models. */
export function piCheckable(model: Pick<WorkspaceDevModel, "supportsConnectionModels">, workspace: WorkspaceDevSnapshot): boolean {
  return (workspace.connections?.connections ?? []).some(row => row.status === "active") && model.supportsConnectionModels?.() === true;
}

export async function runEngineCheck(model: Pick<WorkspaceDevModel, "listRuntimeModels" | "listConnectionModels" | "supportsConnectionModels">, workspace: WorkspaceDevSnapshot, id: string): Promise<EngineCheck> {
  try {
    let models: unknown[];
    if (id === "pi") {
      const main = workspace.agents.find(agent => agent.kind === "main");
      const connections = (workspace.connections?.connections ?? []).filter(row => row.status === "active");
      const connection = connections.find(row => row.id === workspace.connections?.defaultConnectionId)?.id ?? connections[0]?.id;
      if (!main || !connection || !piCheckable(model, workspace)) return { state: "failed", network: false, missing: true };
      models = (await model.listConnectionModels(main.agentId, connection)).models;
    } else models = (await model.listRuntimeModels(id)).models;
    return models.length ? { state: "ok", models: models.length } : { state: "failed", network: false };
  } catch (error) {
    return { state: "failed", network: NETWORK_ERROR.test(String(error instanceof Error ? error.message : error)) };
  }
}

/** A successful check belongs to this exact connection and enabled-engine configuration. */
export function engineCheckScope(workspace: WorkspaceDevSnapshot): string {
  return JSON.stringify([workspace.workspaceId, workspace.resourceGeneration,
    workspace.connections?.revision, workspace.connections?.defaultConnectionId,
    (workspace.connections?.connections ?? []).map(row => [row.id, row.status, row.keyState, row.defaultModel]),
    (workspace.runtimes?.options ?? []).map(row => [row.runtimeId, row.registered, row.fingerprint, row.version, row.loginSource, row.use]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export const manualRuntimeGuide = (id: string) => id === "gemini" ? "https://geminicli.com/docs/get-started/installation/"
  : id === "kimi" ? "https://moonshotai.github.io/kimi-code/en/guides/getting-started.html" : null;

function RuntimeSetupDialog({ label, pending, onClose, children }: { label: string; pending: boolean; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null), active = useRef(false);
  const focusFirst = (panel: HTMLDialogElement) => (panel.querySelector<HTMLElement>("input:checked:not(:disabled),button:not(:disabled)") ?? panel).focus({ preventScroll: true });
  useLayoutEffect(() => {
    active.current = true;
    const panel = dialog.current!, previous = document.activeElement as HTMLElement | null;
    const row = previous?.closest<HTMLElement>(".wsd-runtime-row");
    panel.showModal();
    focusFirst(panel);
    return () => {
      active.current = false; panel.close();
      const target = previous?.isConnected ? previous : row?.isConnected ? row : null;
      target?.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    const panel = dialog.current;
    if (pending && panel?.open && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [pending]);
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
    }} onCancel={event => { event.stopPropagation(); event.preventDefault(); if (!pending) onClose(); }} onClose={event => {
      event.stopPropagation(); const panel = event.currentTarget;
      if (!active.current || panel.open || !panel.isConnected) return;
      if (pending) { panel.showModal(); focusFirst(panel); } else onClose();
    }}>
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
export function WorkspaceConnectionForm({ model, existing, firstKey = false, settingsModels, onSaved, onCancel, onDirty, onPending }: { model: WorkspaceDevModel; existing?: WorkspaceModelConnection; firstKey?: boolean; settingsModels?: WorkspaceDevSnapshot; onSaved?: () => void; onCancel?: () => void; onDirty?: (value: boolean) => void; onPending?: (value: boolean) => void }) {
  const { t } = useWorkspaceLocale();
  const [label, setLabel] = useState(existing?.label ?? ""), [provider, setProvider] = useState<"openai" | "anthropic">(existing?.provider ?? "openai");
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? ""), [defaultModel, setDefaultModel] = useState(existing?.defaultModel ?? ""), [apiKey, setKey] = useState("");
  const [saving, setSaving] = useState(false), [unknown, setUnknown] = useState(false), [reloadFailed, setReloadFailed] = useState(false);
  const saveFence = useRef(false), mounted = useRef(false);
  const dirty = label !== (existing?.label ?? "") || provider !== (existing?.provider ?? "openai")
    || baseURL !== (existing?.baseURL ?? "") || defaultModel !== (existing?.defaultModel ?? "") || apiKey !== "";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  const reload = async () => {
    if (saveFence.current) return; saveFence.current = true; setSaving(true); setReloadFailed(false); onPending?.(true);
    try {
      await model.refresh();
      if (!mounted.current) return;
      if (model.getSnapshot().error) { setReloadFailed(true); return; }
      // An unknown write is never resent. Return to the freshly read list so the user can check it.
      setKey(""); onDirty?.(false); onCancel?.();
    } catch { if (mounted.current) setReloadFailed(true); }
    finally { if (mounted.current) { saveFence.current = false; setSaving(false); onPending?.(false); } }
  };
  return <form className="wsd-connection-form" aria-busy={saving} onSubmit={event => { event.preventDefault(); if (saveFence.current || unknown) return; saveFence.current = true;
    const input = { label, provider, baseURL, defaultModel, apiKey };
    setSaving(true); onPending?.(true); void (existing ? model.editConnection(existing.id, input) : model.configureConnection(input)).then(saved => {
      if (!mounted.current) return;
      if (saved) { setKey(""); onDirty?.(false); onSaved?.(); }
      else setUnknown(true);
    }).catch(() => { if (mounted.current) setUnknown(true); }).finally(() => {
      if (mounted.current) { saveFence.current = false; setSaving(false); onPending?.(false); }
    }); }}>
    <label>{t("ws.connections.name")}<input value={label} disabled={saving || unknown} onChange={event => setLabel(event.target.value)} maxLength={80} required /></label>
    <label>{t("ws.connections.protocol")}<select value={provider} disabled={saving || unknown} onChange={event => setProvider(event.target.value as "openai" | "anthropic")}><option value="openai">{t("ws.connections.openai")}</option><option value="anthropic">{t("ws.connections.anthropic")}</option></select></label>
    <label>{t("ws.connections.baseURL")}<input type="url" value={baseURL} disabled={saving || unknown} onChange={event => setBaseURL(event.target.value)} placeholder="https://…" autoComplete="off" required /></label>
    {settingsModels ? <SettingsConnectionModelField model={model} workspace={settingsModels} existing={existing} draft={{ provider, baseURL, keyEdited: apiKey !== "" }} value={defaultModel} disabled={saving || unknown} onChange={setDefaultModel} />
      : <label>{t("ws.connections.model")}<input value={defaultModel} disabled={saving || unknown} onChange={event => setDefaultModel(event.target.value)} autoComplete="off" required /></label>}
    <label>{t("ws.connections.apiKey")}{existing && !existing.credentialRequired ? t("ws.connections.keepKey") : ""}<input type="password" value={apiKey} disabled={saving || unknown} onChange={event => setKey(event.target.value)} autoComplete="new-password" spellCheck={false} required={!existing || existing.credentialRequired} /></label>
    <small>{t(firstKey && !existing ? "ws.connections.keyNoteFirst" : "ws.connections.keyNoteShort")}</small>
    <SettingsActionResult text={reloadFailed ? t("ws.connections.reloadFailed") : unknown ? t(existing ? "ws.connections.editUnknown" : "ws.connections.saveUnknown") : ""} error />
    <div className="wsd-card-actions">{onCancel ? <button type="button" data-settings-cancel disabled={saving} onClick={() => { if (saveFence.current) return; setKey(""); onDirty?.(false); onCancel(); }}>{t("ws.cancel")}</button> : null}
      {unknown ? <button type="button" disabled={saving} onClick={() => void reload()}>{t("ws.connections.reloadAfterUnknown")}</button>
        : <button className="wsd-primary" disabled={saving || Boolean(existing) && !dirty}>{t(saving ? "ws.connections.saving" : "ws.connections.save")}</button>}</div>
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
  // DESIGN.md §11.4 (2.1.2): opening the page never lists models. «Ready» appears only after the user pressed Check and
  // models were listed just now; a failed check keeps «Enabled» and says why in the row.
  const checkScope = engineCheckScope(workspace), liveCheckScope = useRef(checkScope);
  liveCheckScope.current = checkScope;
  const [checks, setChecks] = useState<Record<string, EngineCheck & { at?: number; scope: string }>>({});
  useEffect(() => { setChecks({}); }, [checkScope]);
  const currentCheck = (id: string) => checks[id]?.scope === checkScope ? checks[id] : undefined;
  const check = (id: string) => {
    if (currentCheck(id)?.state === "checking" || pending) return;
    setChecks(current => ({ ...current, [id]: { state: "checking", scope: checkScope } }));
    void runEngineCheck(model, workspace, id).then(result => { if (liveCheckScope.current === checkScope) setChecks(current => ({ ...current, [id]: { ...result, scope: checkScope, at: Date.now() } })); });
  };
  // The time of the check, not a «just now» that stays forever (review of #98, L2).
  const checkedAt = (at?: number) => new Date(at ?? Date.now()).toLocaleTimeString(locale === "en" ? "en" : locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
  const checkStatus = (id: string, enabled: string | null) => {
    const value = currentCheck(id);
    return value?.state === "ok" ? `${t("ws.onboarding.engine.status.ready")} · ${value.models === 1 ? t("ws.runtimes.check.listedAtOne", { time: checkedAt(value.at) }) : t("ws.runtimes.check.listedAt", { n: value.models, time: checkedAt(value.at) })}`
      : value?.state === "checking" ? t("ws.onboarding.engine.status.checking") : enabled;
  };
  /**
   * Screen readers hear the check (review of #98, M1): the status line is a live region that is always present, and the
   * reason sits in a second region that exists before it is filled, since WebKit/VoiceOver skip regions inserted with text.
   */
  const checkWarning = (id: string) => {
    const value = currentCheck(id);
    const text = value?.state !== "failed" ? null : value.missing ? t("ws.onboarding.engine.status.needsConnection")
      : value.network ? t("ws.runtimes.check.network", { proxy: t("ws.runtimeProxy.title") })
      : id === "pi" ? t("ws.runtimes.check.piFailed", { connections: t("ws.settings.page.connections") }) : t("ws.runtimes.check.failed");
    return <span className="wsd-runtime-check-live" aria-live="polite" data-check-live={id}>{text ? <small className="wsd-runtime-check-warn" data-check="failed">{text}</small> : null}</span>;
  };
  // aria-disabled keeps focus on the button while it checks; a disabled button drops focus to the page in WebKit (M1).
  const checkButton = (id: string, label: string) => {
    const waiting = currentCheck(id)?.state === "checking" || pending;
    return <button type="button" className="wsd-runtime-check" data-check-engine={id} aria-label={`${t("ws.onboarding.engine.check")} ${label}`}
      aria-disabled={waiting || undefined} onClick={() => check(id)}>{t(currentCheck(id)?.state === "failed" ? "ws.onboarding.engine.retry" : "ws.onboarding.engine.check")}</button>;
  };
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
  return <section className="wsd-runtime-settings" aria-label={t("ws.runtimes.title")}><h3>{t("ws.settings.page.runtimes")}</h3><p>{t("ws.runtimes.note")}</p><p className="wsd-runtime-ready-note">{t("ws.onboarding.engine.readyNote")}</p>
    <button disabled={detecting || pending} onClick={() => { setDetecting(true); setChecked(false); setNotice(""); void model.detectRuntimes().then(() => setChecked(true)).catch(() => setNotice("ws.runtimes.detectFailed")).finally(() => setDetecting(false)); }}>{t(detecting ? "ws.runtimes.detecting" : "ws.runtimes.detect")}</button>
    {workspace.runtimes?.detection?.completedAt ? <p role="status" className="wsd-runtime-checked">{t("ws.rf.lastChecked", { time: new Date(workspace.runtimes.detection.completedAt).toLocaleTimeString(locale === "en" ? "en" : locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) })}{workspace.runtimes.detection.running || workspace.runtimes.detection.incomplete.length ? ` · ${t("ws.rf.stillChecking")}` : ""}</p> : null}
    <div className="wsd-runtime-list"><div className="wsd-connection wsd-runtime-row" data-engine="pi"><div><strong>Pi</strong><small>{t("ws.runtimes.builtIn")}</small><small>{t("ws.runtimes.piNote")}</small>
      <small data-runtime-status="pi" aria-live={piCheckable(model, workspace) ? "polite" : undefined}>{piCheckable(model, workspace) ? checkStatus("pi", t("ws.runtimes.status.enabled")) : t("ws.onboarding.engine.status.needsConnection")}</small>{checkWarning("pi")}</div>
      {piCheckable(model, workspace) ? checkButton("pi", "Pi") : null}</div>
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
    <WorkspaceRuntimeProxy key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} onDirty={onDirty} advanced />
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
      // Only an enabled engine can be checked; «Installed · not enabled» and missing engines have nothing to list yet.
      const checkable = runtime.registered && runtime.use === "ready";
      const users = (workspace.agents ?? []).filter(agent => agent.state !== "archived" && agent.runtime.id === runtime.runtimeId).map(agent => agent.identity.displayName);
      return <div className="wsd-connection wsd-runtime-row" key={runtime.runtimeId} role="group" aria-label={runtime.label} tabIndex={-1}>
      <div><strong>{runtime.label}</strong>{inheritsPersonalExtensions(runtime.runtimeId) ? <small data-runtime-acceptance="unverified">{t("ws.runtimeExpansion.unverified")}</small> : null}<small data-runtime-use={runtime.use} data-runtime-status={runtime.runtimeId} aria-live={checkable ? "polite" : undefined}>{formStatus ? `${checkable ? checkStatus(runtime.runtimeId, formStatus) : formStatus}${runtime.version ? ` · ${runtime.version}` : ""}` : runtime.registered ? t("ws.runtimes.registered", { version: runtime.version ?? "" }) : runtime.state === "detected" ? t("ws.runtimes.detected", { version: runtime.version ?? "" }) : runtime.state === "integrity_failed" ? t("ws.runtimes.integrityFailed") : runtime.state === "detection_failed" ? t("ws.runtimes.detectFailed") : runtime.state === "detecting" || detecting || !checked ? t("ws.runtimes.checking") : t("ws.runtimes.missing")}</small>{checkable ? checkWarning(runtime.runtimeId) : null}
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
      {checkable || runtime.registered && runtime.loginSource === "isolated" && runtime.fingerprint && runtime.runtimeId !== "agy" ? <div className="wsd-runtime-actions">
        {checkable ? checkButton(runtime.runtimeId, runtime.label) : null}
        {runtime.registered && runtime.loginSource === "isolated" && runtime.fingerprint && runtime.runtimeId !== "agy" ? <SettingsRowMenu label={runtime.label} disabled={pending}
          items={[{ id: "switch-host", label: t("ws.runtimeAccess.switchHost"), onSelect: () => { setLoginSource("host"); setLocal(runtime); } }]} /> : null}
      </div> : null}
      {runtime.state === "detected" && runtime.use ? <small data-first-use="true">{t("ws.rf.firstUseNote")}</small>
        : runtime.state === "detected" ? <button className="wsd-primary" disabled={pending || detecting} onClick={() => { setLoginSource(runtime.runtimeId === "agy" ? "isolated" : "host"); setLocal(runtime); }}>{t("ws.runtimes.useLocal")}</button>
        : runtime.state === "not_installed" && manualRuntimeInstallUrl(runtime.runtimeId) ? <div><p>{t("ws.runtimeExpansion.manualInstall")}</p><a href={manualRuntimeInstallUrl(runtime.runtimeId)!} target="_blank" rel="noopener noreferrer">{t("ws.runtimeExpansion.instructions")}</a></div>
        : runtime.state === "not_installed" && !runtime.path && !manualRuntimeGuide(runtime.runtimeId) ? <button disabled={pending || downloading || detecting || !checked} onClick={() => void propose(runtime.runtimeId)}>{t("ws.runtimes.install")}</button> : null}
    </div>;
  }
}
