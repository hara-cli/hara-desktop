import { useEffect, useRef, useState } from "react";
import { type Key } from "./i18n";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { normalizeRuntimeProxyUrl, type WorkspaceRuntimeProxyView } from "./workspace-runtime-proxy.ts";
import type { WorkspaceDevModel } from "./workspace-dev-state";

export function WorkspaceRuntimeProxy({ model, workspaceId, generation, onDirty }: {
  model: WorkspaceDevModel; workspaceId: string; generation: string; onDirty?: (value: boolean) => void;
}) {
  const { t } = useWorkspaceLocale();
  const [settings, setSettings] = useState<WorkspaceRuntimeProxyView | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [needsReload, setNeedsReload] = useState(false);
  const [notice, setNotice] = useState<"" | Key>("");
  const scope = `${workspaceId}:${generation}`, currentScope = useRef(scope), mounted = useRef(false), pending = useRef(false), lifecycle = useRef(0);
  currentScope.current = scope;
  const load = async () => {
    if (!mounted.current || currentScope.current !== scope || pending.current) return;
    const lifecycleId = lifecycle.current;
    pending.current = true; setLoading(true); setNotice("");
    try {
      const value = await model.runtimeProxy(workspaceId, generation);
      if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) { setSettings(value); setDraft(value.proxyUrl ?? ""); setNeedsReload(false); onDirty?.(false); }
    } catch { if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) setNotice("ws.runtimeProxy.loadFailed"); }
    finally { if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) { pending.current = false; setLoading(false); } }
  };
  useEffect(() => {
    mounted.current = true; lifecycle.current++; pending.current = false; setSettings(null); setDraft(""); setSaving(false); void load();
    return () => { mounted.current = false; lifecycle.current++; onDirty?.(false); };
  }, [model, workspaceId, generation]);
  const current = settings?.workspaceId === workspaceId && settings.resourceGeneration === generation ? settings : null;
  const disabled = loading || saving || needsReload || !current || current.readOnly;
  const save = async (input: string) => {
    if (!mounted.current || currentScope.current !== scope || disabled || pending.current || !current) return;
    let proxyUrl: string | null;
    try { proxyUrl = normalizeRuntimeProxyUrl(input); }
    catch { setNotice("ws.runtimeProxy.invalid"); return; }
    const lifecycleId = lifecycle.current;
    pending.current = true; setSaving(true); setNotice(""); onDirty?.(true);
    try {
      const value = await model.saveRuntimeProxy(proxyUrl, current.revision, workspaceId, generation);
      if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) {
        setSettings(value); setDraft(value.proxyUrl ?? ""); onDirty?.(false); setNotice("ws.runtimeProxy.saved");
      }
    } catch { if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) { setNeedsReload(true); setNotice("ws.runtimeProxy.saveUnknown"); } }
    finally { if (mounted.current && lifecycle.current === lifecycleId && currentScope.current === scope) { pending.current = false; setSaving(false); } }
  };
  return <form className="wsd-connection-form" aria-label={t("ws.runtimeProxy.title")} onSubmit={event => { event.preventDefault(); void save(draft); }}>
    <h4>{t("ws.runtimeProxy.title")}</h4><p>{t("ws.runtimeProxy.note")}</p>
    <label>{t("ws.runtimeProxy.address")}<input type="url" value={current ? draft : ""} disabled={disabled} maxLength={2048}
      placeholder={t("ws.runtimeProxy.placeholder")} autoComplete="off" spellCheck={false} onChange={event => {
        setDraft(event.target.value); setNotice(""); onDirty?.(event.target.value !== (current?.proxyUrl ?? ""));
      }} /></label>
    <small>{t("ws.runtimeProxy.inherit")}</small><small>{t("ws.runtimeProxy.route")}</small>
    {current?.readOnly ? <p role="status">{t("ws.runtimeProxy.readOnly")}</p> : null}
    {notice ? <p role={notice === "ws.runtimeProxy.saved" ? "status" : "alert"}>{t(notice)}</p> : null}
    <div className="wsd-card-actions">
      <button type="button" disabled={loading || saving} onClick={() => void load()}>{t("ws.runtimeProxy.reload")}</button>
      <button type="button" disabled={disabled || current?.proxyUrl === null && !draft} onClick={() => void save("")}>{t("ws.runtimeProxy.clear")}</button>
      <button className="wsd-primary" disabled={disabled}>{t(saving ? "ws.runtimeProxy.saving" : "ws.runtimeProxy.save")}</button>
    </div>
  </form>;
}
