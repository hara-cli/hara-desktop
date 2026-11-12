import { useEffect, useId, useRef, useState } from "react";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import type { Key } from "./i18n";
import type { WorkspaceDefaultRuntimeView, WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";

/**
 * «New colleagues use» at the top of the engines page (settings IA audit, engines; Core G1).
 * Stored per workspace (Jeff 2026-11-12; Core reply 2026-11-13), so it sits inside the workspace's read-only fieldset, under
 * the page's own «This workspace only» chip, and its note says other workspaces keep their own. The same value is written by onboarding step one. It only affects colleagues
 * created later; existing colleagues keep their engine. Choosing does not check that the engine works and does not start it.
 * Shown only when Core advertises `workspace.default-runtime.v1`.
 */
export function WorkspaceDefaultRuntime({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const { t } = useWorkspaceLocale();
  const { workspaceId, resourceGeneration: generation } = workspace;
  const [value, setValue] = useState<WorkspaceDefaultRuntimeView | null>(null), [notice, setNotice] = useState<"" | Key>(""), [saving, setSaving] = useState(false);
  const busy = useRef(false), noteId = useId(), scopeId = useId();
  // If even the reload fails, say that instead of «reloaded» (review of #92, L2).
  const reload = () => model.defaultRuntime(workspaceId, generation).then(setValue).catch(() => setNotice("ws.runtimes.default.loadFailed"));
  useEffect(() => { let active = true; setValue(null); setNotice("");
    void model.defaultRuntime(workspaceId, generation).then(next => { if (active) setValue(next); }).catch(() => { if (active) setNotice("ws.runtimes.default.loadFailed"); });
    return () => { active = false; }; }, [model, workspaceId, generation]);
  const enabled = (workspace.runtimes?.options ?? []).filter(option => option.registered && option.generalAgentDriverAvailable !== false);
  // Per the contract's fallback chain, a saved "pi" and null behave the same, so both show as «Pi (default)» (review of #78, M2).
  const current = value?.defaultRuntimeId && value.defaultRuntimeId !== "pi" ? value.defaultRuntimeId : null;
  const known = current === null || enabled.some(option => option.runtimeId === current);
  const save = async (next: string | null) => {
    if (!value || value.readOnly || busy.current) return; busy.current = true; setSaving(true); setNotice("");
    // Optimistic lock: write against the revision this screen shows, so a change made meanwhile (the guide, another admin)
    // is reported as a conflict instead of being overwritten (review of #92, M1).
    try { setValue(await model.saveDefaultRuntime(next, value.revision, workspaceId, generation)); setNotice("ws.runtimes.default.saved"); }
    // A stale revision or any other failure: show what is saved now and ask to choose again; never overwrite blindly.
    catch { setNotice("ws.runtimes.default.saveFailed"); void reload(); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="wsd-default-runtime" aria-label={t("ws.runtimes.default.title")}>
    <label><strong>{t("ws.runtimes.default.title")}</strong>
      <select aria-describedby={`${noteId} ${scopeId}`} value={current ?? ""} disabled={!value || value.readOnly || saving} onChange={event => void save(event.target.value || null)}>
        <option value="">{t("ws.runtimes.default.pi")}</option>
        {enabled.map(option => <option key={option.runtimeId} value={option.runtimeId}>{option.label}</option>)}
        {!known && current ? <option value={current}>{t("ws.runtimes.default.unavailable", { name: current })}</option> : null}
      </select></label>
    <small id={noteId}>{t("ws.runtimes.default.note")}</small>
    <small id={scopeId}>{t("ws.runtimes.default.scope")}</small>
    {value?.readOnly ? <small role="status">{t("ws.runtimes.default.readOnly")}</small> : null}
    {notice ? <p role={notice === "ws.runtimes.default.saved" ? "status" : "alert"}>{t(notice)}</p> : null}
  </section>;
}
