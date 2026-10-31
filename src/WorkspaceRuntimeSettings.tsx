import { useEffect, useRef, useState } from "react";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { runtimeOperationText } from "./workspace-settings-copy";
import { type Key } from "./i18n";
import type { RuntimeApprovalCard, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";

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

export default function WorkspaceRuntimeSettings({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const { t } = useWorkspaceLocale();
  const [card, setCard] = useState<RuntimeApprovalCard | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState<"" | Key>("");
  const [detecting, setDetecting] = useState(true), [checked, setChecked] = useState(false);
  const [local, setLocal] = useState<NonNullable<WorkspaceDevSnapshot["runtimes"]>["options"][number] | null>(null);
  const saveFence = useRef(false);
  useEffect(() => { setLocal(null); }, [workspace.workspaceId, workspace.resourceGeneration]);
  useEffect(() => { let active = true; void model.detectRuntimes().then(() => { if (active) setChecked(true); })
    .catch(() => { if (active) setNotice("ws.runtimes.detectFailed"); }).finally(() => { if (active) setDetecting(false); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const downloading = workspace.runtimes?.operations.some(row => row.state === "downloading") ?? false;
  useEffect(() => { if (!downloading) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [downloading, model]);
  const propose = async (id: string) => { setPending(true); setNotice(""); try { setCard(await model.proposeRuntime(id)); }
    catch { setNotice("ws.runtimes.proposalFailed"); } finally { setPending(false); } };
  const decide = async (approved: boolean) => { if (!card || pending) return; setPending(true);
    try { await model.approveRuntime(card, approved); setCard(null); setNotice(approved ? "ws.runtimes.accepted" : "ws.runtimes.cancelledNotice"); }
    catch { setCard(null); setNotice("ws.runtimes.unknown"); } finally { setPending(false); } };
  return <section className="wsd-runtime-settings" aria-label={t("ws.runtimes.title")}><h3>{t("ws.settings.page.runtimes")}</h3><p>{t("ws.runtimes.note")}</p>
    <button disabled={detecting || pending} onClick={() => { setDetecting(true); setChecked(false); setNotice(""); void model.detectRuntimes().then(() => setChecked(true)).catch(() => setNotice("ws.runtimes.detectFailed")).finally(() => setDetecting(false)); }}>{t(detecting ? "ws.runtimes.detecting" : "ws.runtimes.detect")}</button>
    <div className="wsd-runtime-list"><div className="wsd-connection wsd-runtime-row"><div><strong>Pi</strong><small>{t("ws.runtimes.builtIn")}</small><small>{t("ws.runtimes.piNote")}</small></div></div>
    {workspace.runtimes?.options.map(runtime => <div className="wsd-connection wsd-runtime-row" key={runtime.runtimeId}>
      <div><strong>{runtime.label}</strong><small>{runtime.registered ? t("ws.runtimes.registered", { version: runtime.version ?? "" }) : runtime.state === "detected" ? t("ws.runtimes.detected", { version: runtime.version ?? "" }) : runtime.state === "integrity_failed" ? t("ws.runtimes.integrityFailed") : detecting || !checked ? t("ws.runtimes.checking") : t("ws.runtimes.missing")}</small>
      {runtime.path ? <code className="wsd-root">{runtime.path}</code> : null}
      {runtime.registered && !runtime.generalAgentDriverAvailable ? <small>{t("ws.runtimes.driverNote")}</small> : null}</div>
      {runtime.state === "detected" ? <button className="wsd-primary" disabled={pending || detecting} onClick={() => setLocal(runtime)}>{t("ws.runtimes.useLocal")}</button>
        : runtime.state === "not_installed" && !runtime.path ? <button disabled={pending || downloading || detecting || !checked} onClick={() => void propose(runtime.runtimeId)}>{t("ws.runtimes.install")}</button> : null}
    </div>)}</div>
    {workspace.runtimes?.operations.map(operation => <div className="wsd-runtime-operation" key={operation.id}><span>{operation.runtimeId} · {runtimeOperationText(t, operation.state)}</span>
      {operation.state === "downloading" ? <button onClick={() => void model.cancelRuntime(operation.id)}>{t("ws.runtimes.cancelInstall")}</button> : null}</div>)}
    {notice ? <p role="status">{t(notice)}</p> : null}
    {local ? <section className="wsd-approval wsd-runtime-bind-dialog" role="dialog" aria-label={t("ws.runtimes.confirmLocal")}><h3>{t("ws.runtimes.registerTitle", { name: local.label })}</h3>
      <p>{t("ws.runtimes.bindLead")}</p><div className="wsd-runtime-proof"><small>{t("ws.runtimes.detectedPath")}</small><code>{local.path}</code><small>{t("ws.runtimes.registerNote")}</small></div>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => setLocal(null)}>{t("ws.cancel")}</button><button className="wsd-primary" disabled={pending || !local.fingerprint} onClick={() => { if (!local.fingerprint || saveFence.current) return; saveFence.current = true; setPending(true);
        void model.registerLocalRuntime(local.runtimeId, local.fingerprint, workspace.workspaceId, workspace.resourceGeneration).then(() => { setLocal(null); setNotice("ws.runtimes.registeredNotice"); })
          .catch(() => { setLocal(null); setNotice("ws.runtimes.registerUnknown"); }).finally(() => { saveFence.current = false; setPending(false); }); }}>{t("ws.runtimes.register")}</button></div></section> : null}
    {card ? <section className="wsd-approval" role="dialog" aria-label={t("ws.runtimes.confirmInstall")}><div className="wsd-kicker">{t("ws.approval.kicker")}</div>
      <h3>{t("ws.runtimes.installTitle", { name: card.label, version: card.version })}</h3><p>{card.origin} · {card.target.platform}/{card.target.arch} · {t("ws.runtimes.maxSize", { n: Math.ceil(card.maxBytes / 1024 / 1024) })}</p>
      <details><summary>{t("ws.runtimes.integrity")}</summary><code>{card.sha256}</code><p>{t("ws.runtimes.installNote")}</p></details>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => void decide(false)}>{t("ws.runtimes.notNow")}</button><button className="wsd-primary" disabled={pending} onClick={() => void decide(true)}>{t("ws.runtimes.approve")}</button></div>
    </section> : null}
  </section>;
}
