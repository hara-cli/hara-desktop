import { useEffect, useRef, useState } from "react";
import { ToggleSwitch } from "./ToggleSwitch";
import { WorkspaceConnectionForm } from "./WorkspaceRuntimeSettings";
import type { LegacyConnectionPreview, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceFeatureView, WorkspaceModelConnection, WorkspacePreferenceView } from "./workspace-dev-state";
import { bindThemePreference, loadThemePreference, saveThemePreference, type ThemePreference } from "./theme";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { settingsStateText } from "./workspace-settings-copy";
import { makeT, type Key, type Locale } from "./i18n";
import { applyAppearance, loadAppearance, saveAppearance, type VioletAppearance } from "./violet-appearance";

export function useStableWorkspaceTheme(model: WorkspaceDevModel) {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference);
  const [appearance, setAppearance] = useState(loadAppearance);
  useEffect(() => applyAppearance(appearance), [appearance]);
  const [settings, setSettings] = useState<WorkspacePreferenceView | null>(null), [notice, setNotice] = useState<"" | Key>("");
  const busy = useRef(false);
  useEffect(() => { let active = true; void model.preferences().then(value => { if (active) { setSettings(value); setPreference(value.theme); saveThemePreference(value.theme); } })
    .catch(() => { if (active) setNotice("ws.theme.loadFailed"); }); return () => { active = false; }; }, [model]);
  useEffect(() => bindThemePreference(preference), [preference]);
  const change = async (value: ThemePreference) => {
    if (!settings || settings.readOnly || busy.current) return false; busy.current = true;
    try { const current = await model.preferences(); const saved = await model.savePreference(value, current.revision); setSettings(saved); setPreference(saved.theme); saveThemePreference(saved.theme); setNotice(""); return true; }
    catch { setNotice("ws.theme.saveUnknown"); return false; }
    finally { busy.current = false; }
  };
  const changeDetails = async (executionDetails: "brief" | "detailed", collapseDetails: boolean) => {
    if (!settings || settings.readOnly || busy.current) return; busy.current = true;
    try { const saved = await model.saveDisplayPreference(executionDetails, collapseDetails); setSettings(saved); setNotice(""); }
    catch { setNotice("ws.theme.displayUnknown"); } finally { busy.current = false; }
  };
  const changeAppearance = (next: Partial<VioletAppearance>) => {
    setAppearance(current => { const value = { ...current, ...next }; saveAppearance(value); return value; });
  };
  const chooseTheme = async (value: "violet-glass" | "obsidian" | "daylight") => {
    if (await change(value === "daylight" ? "light" : "dark")) changeAppearance({ darkTheme: value === "obsidian" ? "obsidian" : "violet-glass" });
  };
  return { preference, settings, notice, change, changeDetails, appearance, changeAppearance, chooseTheme };
}
export function WorkspaceThemeSettings({ theme, locale }: { theme: ReturnType<typeof useStableWorkspaceTheme>; locale?: Locale }) {
  const current = useWorkspaceLocale(), t = locale ? makeT(locale) : current.t;
  const appearance = theme.appearance ?? loadAppearance();
  const currentTheme = theme.preference === "light" ? "daylight" : appearance.darkTheme;
  return <section aria-label={t("ws.settings.appearance")}>
    <div className="vg-theme-options" role="group" aria-label={t("vg.appearance")}>{(["violet-glass", "obsidian", "daylight"] as const).map(value => <button type="button" key={value} className={`vg-theme-card ${value}`} aria-pressed={theme.preference !== "system" && currentTheme === value}
      disabled={!theme.settings || theme.settings.readOnly} onClick={() => void theme.chooseTheme(value)}><span className="vg-theme-swatch" aria-hidden /><strong>{value === "violet-glass" ? "Violet Glass" : value === "obsidian" ? "Obsidian" : "Daylight"}</strong><small>{t(value === "violet-glass" ? "vg.theme.violet" : value === "obsidian" ? "vg.theme.obsidian" : "vg.theme.daylight")}</small></button>)}</div>
    <label>{t("ws.theme.title")}<select aria-label={t("ws.theme.title")} value={theme.preference} disabled={!theme.settings || theme.settings.readOnly}
    onChange={event => void theme.change(event.target.value as ThemePreference)}><option value="system">{t("ws.theme.system")}</option><option value="light">{t("ws.theme.light")}</option><option value="dark">{t("ws.theme.dark")}</option></select></label>
    <small>{t("ws.theme.note")}</small>
    {(["transparency", "motion"] as const).map(kind => <div className="vg-material-pref" key={kind}><h3>{t(kind === "motion" ? "vg.motion" : "vg.transparency")}</h3><div role="group" aria-label={t(kind === "motion" ? "vg.motion" : "vg.transparency")}>{(kind === "motion" ? ["off", "reduced", "standard"] as const : ["off", "standard", "enhanced"] as const).map(value => <button key={value} type="button" aria-pressed={appearance[kind] === value} onClick={() => theme.changeAppearance({ [kind]: value })}>{t(`vg.${value}`)}</button>)}</div></div>)}
    <p className="vg-brand-note"><span aria-hidden />{t("vg.brand")} · #7C3AED</p>
    <label>{t("ws.display.mode")}<select aria-label={t("ws.display.mode")} value={theme.settings?.executionDetails ?? "brief"} disabled={!theme.settings || theme.settings.readOnly}
      onChange={event => void theme.changeDetails(event.target.value as "brief" | "detailed", theme.settings?.collapseDetails !== false)}><option value="brief">{t("ws.display.brief")}</option><option value="detailed">{t("ws.display.detailed")}</option></select></label>
    <div className="wss-setting-row"><span>{t("ws.display.collapse")}</span><ToggleSwitch label={t("ws.display.collapse")} checked={theme.settings?.collapseDetails !== false} disabled={!theme.settings || theme.settings.readOnly}
      onCheckedChange={checked => void theme.changeDetails(theme.settings?.executionDetails ?? "brief", checked)} /></div>
    {theme.notice ? <p role="status">{t(theme.notice)}</p> : null}</section>;
}
export function WorkspaceConnections({ model, workspace, onDirty }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; onDirty?: (value: boolean) => void }) {
  const { t } = useWorkspaceLocale();
  const [editing, setEditing] = useState<WorkspaceModelConnection | null>(null), [adding, setAdding] = useState(false);
  const [legacy, setLegacy] = useState<LegacyConnectionPreview[]>([]), [confirmImport, setConfirmImport] = useState<LegacyConnectionPreview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkspaceModelConnection | null>(null), [notice, setNotice] = useState<"" | Key>("");
  const [pending, setPending] = useState(false), fence = useRef(false);
  const migrationPending = workspace.connections.migrationPending === true, unavailable = workspace.connections.unavailable === true;
  const readOnly = workspace.connections.readOnly === true || migrationPending || unavailable;
  useEffect(() => { onDirty?.(Boolean(editing || adding)); return () => onDirty?.(false); }, [editing, adding, onDirty]);
  useEffect(() => { let active = true; void model.legacyConnections().then(rows => { if (active) setLegacy(rows); }).catch(() => { if (active) setNotice("ws.connections.legacyUnavailable"); });
    return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const perform = async (action: () => Promise<void>) => { if (fence.current) return; fence.current = true; setPending(true); setNotice("");
    try { await action(); setConfirmDelete(null); setConfirmImport(null); }
    catch { setNotice("ws.connections.unknown"); }
    finally { fence.current = false; setPending(false); } };
  return <section aria-label={t("ws.connections.title")}><h3>{t("ws.connections.heading")}</h3>
    {readOnly ? <p role="alert">{migrationPending ? t("ws.connections.migrationPending")
      : unavailable ? t("ws.connections.unavailable") : workspace.connections.recovered ? t("ws.connections.recovered") : t("ws.connections.newerStore")}</p> : null}
    {migrationPending && !workspace.connections.recovered ? <button disabled={pending} onClick={() => void perform(async () => {
      await model.workspaceRequest("workspace.connection.migration.retry", { expectedRevision: workspace.connections.revision, approved: true }); await model.refresh();
    })}>{workspace.connections.connections.some(row => row.keySaved === false) ? t("ws.connections.confirmMigrate", { n: workspace.connections.connections.filter(row => !row.credentialRequired).length, workspace: workspace.label }) : t("ws.connections.retryMigration")}</button> : null}
    {workspace.connections.connections.filter(row => row.status === "active").map(connection => <div className="wsd-connection" key={connection.id}>
      <strong>{connection.label}{connection.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId) ? <span className="wsd-pill">{t(migrationPending || connection.credentialRequired ? "ws.connections.originalPending" : "ws.connections.current")}</span> : null}</strong>
      <small>{t(connection.provider === "anthropic" ? "ws.connections.anthropic" : "ws.connections.openai")} · {connection.defaultModel}</small><code className="wsd-root">{connection.baseURL}</code><small>{t("ws.connections.mask", { state: t(connection.keyState === "invalid" ? "ws.connections.invalidKey" : connection.credentialRequired ? "ws.connections.keyRequired" : connection.keySaved === false || migrationPending ? "ws.connections.pending" : "ws.connections.savedKey") })}</small>
      <div className="wsd-card-actions"><button disabled={pending || readOnly || connection.id === workspace.connections.defaultConnectionId} onClick={() => void perform(() => model.changeConnection(connection.id))}>{t("ws.connections.setCurrent")}</button>
        <button disabled={pending || readOnly} onClick={() => { setEditing(connection); setAdding(false); }}>{t("ws.connections.edit")}</button><button disabled={pending || readOnly} onClick={() => setConfirmDelete(connection)}>{t("ws.connections.delete")}</button></div>
    </div>)}
    {workspace.connections.connections.filter(row => row.cleanupPending).map(connection => <div className="wsd-connection" key={`cleanup-${connection.id}`}><strong>{connection.label} · {t("ws.connections.cleanupPending")}</strong><p>{t("ws.connections.cleanupNote")}</p>
      <button disabled={pending || readOnly} onClick={() => void perform(async () => { await model.workspaceRequest("workspace.connection.cleanup", { connectionId: connection.id, expectedRevision: workspace.connections.revision, approved: true }); await model.refresh(); })}>{t("ws.connections.cleanup")}</button></div>)}
    <button disabled={pending || readOnly} onClick={() => { setAdding(current => !current); setEditing(null); }}>{t("ws.connections.add")}</button>
    {!readOnly && (adding || editing || workspace.connections.connections.length === 0) ? <WorkspaceConnectionForm key={editing?.id ?? "new"} model={model} existing={editing ?? undefined} onDirty={onDirty} onCancel={() => { setEditing(null); setAdding(false); }} onSaved={() => { setEditing(null); setAdding(false); }} /> : null}
    {legacy.length ? <details className="wsd-legacy-import"><summary>{t("ws.connections.legacyFound")}</summary><p>{t("ws.connections.importNote")}</p>
      {legacy.map(row => <div className="wsd-connection" key={row.id}><strong>{row.label}</strong><small>{row.provider} · {row.defaultModel}</small><code>{row.baseURL}</code><small>{t("ws.connections.mask", { state: t("ws.connections.pending") })}</small>
        <button disabled={pending || readOnly || !row.keySaved} onClick={() => setConfirmImport(row)}>{t("ws.connections.import")}</button></div>)}</details> : null}
    {confirmImport ? <section className="wsd-approval" role="dialog" aria-label={t("ws.connections.confirmImport")}><h3>{t("ws.connections.importTitle", { name: confirmImport.label })}</h3><p>{confirmImport.provider} · {confirmImport.defaultModel}</p><code>{confirmImport.baseURL}</code><p>{t("ws.connections.importConfirmNote")}</p>
      <button disabled={pending} onClick={() => setConfirmImport(null)}>{t("ws.cancel")}</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.importConnection(confirmImport.id))}>{t("ws.connections.importConfirm")}</button></section> : null}
    {confirmDelete ? <section className="wsd-approval" role="dialog" aria-label={t("ws.connections.confirmDelete")}><h3>{t("ws.connections.deleteTitle", { name: confirmDelete.label })}</h3><p>{t("ws.connections.deleteNote")}</p>
      <button disabled={pending} onClick={() => setConfirmDelete(null)}>{t("ws.cancel")}</button><button disabled={pending || readOnly} onClick={() => void perform(() => model.changeConnection(confirmDelete.id, true))}>{t("ws.connections.deleteConfirm")}</button></section> : null}
    {notice ? <p role="status">{t(notice)}</p> : null}
  </section>;
}
export function WorkspaceFeaturePanel({ model, workspace, kind, onClose, onDirty, onCreateSkill }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; kind: "schedules" | "skills"; onClose?: () => void; onDirty?: (value: boolean) => void; onCreateSkill?: () => void }) {
  const { locale, t } = useWorkspaceLocale();
  const [value, setValue] = useState<WorkspaceFeatureView | null>(null), [notice, setNotice] = useState<"" | Key>(""), [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<{ id: string; content: string } | null>(null), [upgrade, setUpgrade] = useState<WorkspaceFeatureView["skills"][number] | null>(null);
  const busy = useRef(false);
  useEffect(() => { onDirty?.(Boolean(editor)); return () => onDirty?.(false); }, [editor, onDirty]);
  useEffect(() => { let active = true; void model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list").then(rows => { if (active) setValue(rows); })
    .catch(() => { if (active) setNotice("ws.features.loadFailed"); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const runningSchedule = Boolean(value?.scheduler?.schedules.some(row => row.lastRun?.state === "running"));
  useEffect(() => { if (!runningSchedule) return; let active = true; const timer = setInterval(() => {
    void model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list").then(rows => { if (active) setValue(rows); }).catch(() => { if (active) setNotice("ws.schedules.checking"); });
  }, 1500); return () => { active = false; clearInterval(timer); }; }, [model, runningSchedule, workspace.workspaceId, workspace.resourceGeneration]);
  const update = async (id: string, enabled: boolean, version?: string) => { if (!value || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.features.update", { kind: kind === "skills" ? "skill" : "schedule", id, enabled, expectedRevision: value.revision, ...(version ? { version } : {}) })); setUpgrade(null); }
    catch { setNotice("ws.features.saveUnknown"); } finally { busy.current = false; setPending(false); } };
  const editSkill = async (id: string) => { if (busy.current) return; busy.current = true; setPending(true);
    try { const row = await model.workspaceRequest<{ id: string; content: string }>("workspace.skill.read", { id }); setEditor({ id: row.id, content: row.content }); }
    catch { setNotice("ws.skills.readFailed"); } finally { busy.current = false; setPending(false); } };
  const saveSkill = async () => { if (!value || !editor || busy.current) return; busy.current = true; setPending(true);
    try { setValue(await model.workspaceRequest<WorkspaceFeatureView>("workspace.skill.fork", { id: editor.id, content: editor.content, expectedRevision: value.revision, approved: true })); setEditor(null); }
    catch { setNotice("ws.skills.saveUnknown"); } finally { busy.current = false; setPending(false); } };
  return <section className="wsd-feature-panel" aria-label={t(kind === "skills" ? "ws.skills.title" : "ws.schedules.title")}>{onClose ? <button onClick={onClose}>{t("ws.settings.back")}</button> : null}
    <h2>{t(kind === "skills" ? "ws.settings.page.skills" : "ws.settings.page.schedules")}</h2><p>{t("ws.features.scope", { workspace: workspace.label })}</p>
    {!value ? <p role="status">{t(notice || "ws.settings.loading")}</p> : kind === "skills" ? <>
      {onCreateSkill ? <button onClick={onCreateSkill}>{t("ws.skills.create")}</button> : null}
      <p>{t("ws.skills.note")}</p>
      {!value.skills.length ? <p>{t("ws.skills.empty")}</p> : value.skills.map(row => <div className="wsd-connection" key={row.id}><strong>{row.id}</strong><p>{row.description}</p>
        <small>{t(row.source === "private" ? "ws.skills.private" : "ws.skills.global")} · {row.version.slice(0, 12)} · {t(row.locked ? "ws.skills.pinned" : "ws.skills.disabled")}</small>
        <label><ToggleSwitch label={t("ws.skills.allow")} disabled={pending} checked={row.enabled} onCheckedChange={checked => void update(row.id, checked, row.version)} />{t("ws.skills.allow")}</label>
        {row.locked ? <button disabled={pending} onClick={() => void editSkill(row.id)}>{t("ws.skills.edit")}</button> : null}
        {row.locked && row.source === "global" && row.availableVersion !== row.version ? <button disabled={pending} onClick={() => setUpgrade(row)}>{t("ws.skills.review")}</button> : null}</div>)}
      {upgrade ? <section className="wsd-approval" role="dialog" aria-label={t("ws.skills.confirmUpdate")}><h3>{t("ws.skills.updateTitle", { name: upgrade.id })}</h3><p>{t("ws.skills.updateNote", { from: upgrade.version.slice(0, 12), to: upgrade.availableVersion.slice(0, 12) })}</p>
        <button disabled={pending} onClick={() => setUpgrade(null)}>{t("ws.cancel")}</button><button disabled={pending} onClick={() => void update(upgrade.id, upgrade.enabled, upgrade.availableVersion)}>{t("ws.skills.update")}</button></section> : null}
      {editor ? <section className="wsd-approval" role="dialog" aria-label={t("ws.skills.editPrivate")}><h3>{t("ws.skills.privateTitle", { name: editor.id })}</h3><p>{t("ws.skills.editNote")}</p>
        <textarea aria-label={t("ws.skills.instructions")} value={editor.content} maxLength={64000} onChange={event => setEditor(current => current ? { ...current, content: event.target.value } : null)} />
        <button disabled={pending} onClick={() => setEditor(null)}>{t("ws.cancel")}</button><button disabled={pending} onClick={() => void saveSkill()}>{t("ws.skills.save")}</button></section> : null}</> : <>
      <p className="wss-callout">{t("ws.schedules.legacyNote")}</p>
      <p className="wss-callout">{t("ws.schedules.colleagueNote")}</p>
      {!value.schedules.length ? <p>{t("ws.schedules.empty")}</p> : value.schedules.map(row => { const status = value.scheduler?.schedules.find(item => item.id === row.id); return <div className="wsd-connection" key={row.id}><strong>{row.name}</strong><code>{row.schedule.expr ?? row.schedule.display}</code>
        <small>{t(row.enabled ? "ws.schedules.enabled" : "ws.schedules.off")}</small>
        <small>{status?.awaitingHandoff ? t("ws.schedules.handoff") : status?.lastRun ? t("ws.schedules.last", { state: settingsStateText(t, status.lastRun.state), reason: status.lastRun.reason ? ` · ${status.lastRun.reason}` : "" }) : t("ws.schedules.never")}</small>
        <small>{t("ws.schedules.next", { time: status?.nextRunAt ? new Date(status.nextRunAt).toLocaleString(locale) : "—" })}</small>
        {status?.lastRun ? <details><summary>{t("ws.schedules.history")}</summary><p>{new Date(status.lastRun.occurredAt).toLocaleString(locale)} · {settingsStateText(t, status.lastRun.state)}</p></details> : null}</div>; })}</>}
    {notice && value ? <p role="status">{t(notice)}</p> : null}</section>;
}
