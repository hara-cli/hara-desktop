import { useEffect, useRef, useState } from "react";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import type { Key } from "./i18n";
import type { WorkspaceDevModel, WorkspaceDevSnapshot, WorkspacePreferenceView } from "./workspace-dev-state";

/**
 * «New colleagues use» at the top of the engines page (settings IA audit, engines; Core G1).
 * The same value is written by onboarding step one. It only affects colleagues created later; existing
 * colleagues keep their engine. Choosing does not check that the engine works and does not start it.
 * Shown only when Core advertises `workspace.preferences.default-runtime.v1`.
 */
export function WorkspaceDefaultRuntime({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const { t } = useWorkspaceLocale();
  const [value, setValue] = useState<WorkspacePreferenceView | null>(null), [notice, setNotice] = useState<"" | Key>(""), [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => { let active = true; void model.preferences().then(next => { if (active) setValue(next); }).catch(() => { if (active) setNotice("ws.runtimes.default.loadFailed"); });
    return () => { active = false; }; }, [model]);
  const enabled = (workspace.runtimes?.options ?? []).filter(option => option.registered && option.generalAgentDriverAvailable !== false);
  const current = value?.defaultRuntimeId ?? null;
  const known = current === null || current === "pi" || enabled.some(option => option.runtimeId === current);
  const save = async (next: string | null) => {
    if (!value || value.readOnly || busy.current) return; busy.current = true; setSaving(true); setNotice("");
    try { const fresh = await model.preferences(); setValue(await model.saveDefaultRuntime(next, fresh.revision)); setNotice("ws.runtimes.default.saved"); }
    catch { setNotice("ws.runtimes.default.saveUnknown"); }
    finally { busy.current = false; setSaving(false); }
  };
  return <section className="wsd-default-runtime" aria-label={t("ws.runtimes.default.title")}>
    <label><strong>{t("ws.runtimes.default.title")}</strong>
      <select value={current ?? ""} disabled={!value || value.readOnly || saving} onChange={event => void save(event.target.value || null)}>
        <option value="">{t("ws.runtimes.default.piFirst")}</option>
        <option value="pi">Pi</option>
        {enabled.map(option => <option key={option.runtimeId} value={option.runtimeId}>{option.label}</option>)}
        {!known && current ? <option value={current}>{t("ws.runtimes.default.unavailable", { name: current })}</option> : null}
      </select></label>
    <small>{t("ws.runtimes.default.note")}</small>
    {value?.readOnly ? <small role="status">{t("ws.runtimes.default.readOnly")}</small> : null}
    {notice ? <p role={notice === "ws.runtimes.default.saved" ? "status" : "alert"}>{t(notice)}</p> : null}
  </section>;
}
