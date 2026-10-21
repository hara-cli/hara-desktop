import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspaceLocale, workspacePlatform } from "./workspace-shell-hooks";
import { ArrowPathIcon, ChevronDownIcon, ClockIcon, Cog6ToothIcon, ComputerDesktopIcon, HomeIcon, LinkIcon, PaintBrushIcon, SparklesIcon, UsersIcon } from "@heroicons/react/24/outline";
import { type Key, type LocalePreference } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import HaraLogo from "./mark";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import WorkspaceRuntimeSettings from "./WorkspaceRuntimeSettings";
import { WorkspaceConnections, WorkspaceFeaturePanel, WorkspaceThemeSettings, type useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { WorkspaceSoftwareUpdate, type DesktopVersionInfo } from "./WorkspaceSoftwareUpdate";
import { hasUpdateAttention, type WorkspaceUpdater } from "./workspace-updater-state";
import { SettingsLeaveGuard, type SettingsLeaveAction } from "./settings-leave-guard";
import "./workspace-settings.css";

export type SettingsPage = "overview" | "connections" | "runtimes" | "schedules" | "skills" | "members" | "general" | "appearance" | "updates";
const pages: Record<SettingsPage, { name: Key; icon: typeof HomeIcon; detail: Key }> = {
  overview: { name: "ws.settings.page.overview", icon: HomeIcon, detail: "ws.settings.detail.overview" },
  connections: { name: "ws.settings.page.connections", icon: LinkIcon, detail: "ws.settings.detail.connections" },
  runtimes: { name: "ws.settings.page.runtimes", icon: ComputerDesktopIcon, detail: "ws.settings.detail.runtimes" },
  schedules: { name: "ws.settings.page.schedules", icon: ClockIcon, detail: "ws.settings.detail.schedules" },
  skills: { name: "ws.settings.page.skills", icon: SparklesIcon, detail: "ws.settings.detail.skills" },
  members: { name: "ws.settings.page.members", icon: UsersIcon, detail: "ws.settings.detail.members" },
  general: { name: "ws.settings.page.general", icon: Cog6ToothIcon, detail: "ws.settings.detail.general" },
  appearance: { name: "ws.settings.page.appearance", icon: PaintBrushIcon, detail: "ws.settings.detail.appearance" },
  updates: { name: "ws.settings.page.updates", icon: ArrowPathIcon, detail: "ws.settings.detail.updates" },
};
export interface WorkspaceSettingsProps { mainModel: WorkspaceDevModel; initialPage: SettingsPage; root: string; production: boolean;
  theme: ReturnType<typeof useStableWorkspaceTheme>; updater: WorkspaceUpdater; versionInfo: DesktopVersionInfo | null;
  onClose(): void; onCreateSkill(workspaceId: string): void }
export default function WorkspaceSettings(props: WorkspaceSettingsProps) {
  const { locale, t } = useWorkspaceLocale();
  const [session, setSession] = useState<{ model: WorkspaceDevModel; close(): void } | null>(null), [error, setError] = useState<"" | Key>("");
  const initialWorkspace = useRef(props.mainModel.getSnapshot().workspaceId);
  useEffect(() => { let active = true, owned: { model: WorkspaceDevModel; close(): void } | undefined;
    void props.mainModel.openSettingsSession().then(async value => { owned = value; if (!active) { value.close(); return; }
      await value.model.loadDirectory(); if (initialWorkspace.current) await value.model.selectWorkspace(initialWorkspace.current);
      if (active) setSession(value); else value.close();
    }).catch(() => { if (active) setError("ws.settings.sessionFailed"); });
    return () => { active = false; owned?.close(); };
  }, [props.mainModel]);
  if (!session) return <div className="hs wsd-app wss-app" lang={locale} data-platform={workspacePlatform()}><aside className="wss-nav"><div className="hs-titlebar-drag" data-tauri-drag-region="" aria-hidden="true" /><button onClick={props.onClose}>{t("ws.settings.back")}</button><h1>{t("ws.settings")}</h1></aside><main className="wss-main"><p role="status">{t(error || "ws.settings.opening")}</p></main></div>;
  return <SettingsContent {...props} model={session.model} />;
}
export function SettingsContent({ model, initialPage, root, production, theme, updater, versionInfo, onClose, onCreateSkill }: WorkspaceSettingsProps & { model: WorkspaceDevModel }) {
  const { locale, preference, t, changeLocale } = useWorkspaceLocale();
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), updates = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  const [page, setPage] = useState<SettingsPage>(initialPage), [scopeOpen, setScopeOpen] = useState(false), [leaveNotice, setLeaveNotice] = useState<"" | Key>("");
  const scopeTrigger = useRef<HTMLButtonElement>(null), scopeMenu = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const cancelLeave = useRef<HTMLButtonElement>(null), discardLeave = useRef<HTMLButtonElement>(null), returnFocus = useRef<HTMLElement | null>(null);
  const source = useRef({ model, page }); source.current = { model, page };
  const commit = useRef<(action: SettingsLeaveAction) => void>(() => {});
  commit.current = action => {
    setLeaveNotice(""); setScopeOpen(false);
    if (action.kind === "page") { setPage(action.page as SettingsPage); body.current?.scrollTo(0, 0); }
    else if (action.kind === "scope") { scopeTrigger.current?.focus(); void model.selectWorkspace(action.workspaceId); }
    else if (action.kind === "skill") onCreateSkill(action.workspaceId);
    else onClose();
  };
  const [leaveGuard] = useState(() => new SettingsLeaveGuard(() => { const current = source.current.model.getSnapshot();
    return { workspaceId: current.workspaceId, generation: current.workspace?.resourceGeneration ?? null, page: source.current.page };
  }, action => commit.current(action)));
  const decision = useSyncExternalStore(leaveGuard.subscribe, leaveGuard.getSnapshot, leaveGuard.getSnapshot);
  const requestLeave = useCallback((action: SettingsLeaveAction) => {
    if (!leaveGuard.getSnapshot()) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveGuard.request(action);
  }, [leaveGuard]);
  const keepEditing = useCallback(() => { leaveGuard.cancel(); }, [leaveGuard]);
  const selected = view.directory?.workspaces.find(row => row.workspaceId === view.workspaceId), workspace = view.workspace;
  const connectionCount = workspace?.connections.connections.filter(row => row.status === "active").length ?? 0;
  const device = page === "appearance" || page === "updates", readonly = selected && !["owner", "admin"].includes(selected.role);
  const navigate = (next: SettingsPage) => { if (next !== page) requestLeave({ kind: "page", page: next }); };
  const close = () => requestLeave({ kind: "close" });
  useEffect(() => { if (decision) cancelLeave.current?.focus(); else if (returnFocus.current?.isConnected) returnFocus.current.focus(); }, [decision]);
  useEffect(() => { const key = (event: KeyboardEvent) => {
    if (decision) {
      if (event.key === "Escape") { event.preventDefault(); keepEditing(); }
      else if (event.key === "Tab") { event.preventDefault(); (document.activeElement === cancelLeave.current ? discardLeave : cancelLeave).current?.focus(); }
      else if (event.metaKey && event.key === ",") event.preventDefault();
      return;
    }
    if (event.metaKey && event.key === "," || event.key === "Escape" && !scopeOpen) { event.preventDefault(); close(); }
    if (event.key === "Escape" && scopeOpen) { setScopeOpen(false); scopeTrigger.current?.focus(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [decision, keepEditing, requestLeave, scopeOpen]);
  useEffect(() => { if (!scopeOpen) return; scopeMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!scopeMenu.current?.contains(event.target as Node) && !scopeTrigger.current?.contains(event.target as Node)) setScopeOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [scopeOpen]);
  const switchScope = (workspaceId: string) => { if (workspaceId !== view.workspaceId) requestLeave({ kind: "scope", workspaceId }); else setScopeOpen(false); };
  const workspacePages: SettingsPage[] = ["connections", "runtimes", "schedules", "skills", ...(selected?.kind === "team" ? ["members" as const] : []), "general"];
  const navItem = (id: SettingsPage) => <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}><span aria-hidden>{createElement(pages[id].icon, { className: "hico" })}</span><span>{t(pages[id].name)}</span>{id === "updates" && hasUpdateAttention(updates) ? <i className="wss-update-dot" /> : null}</button>;
  const key = workspace ? `${workspace.workspaceId}:${workspace.resourceGeneration}:${page}` : "loading";
  return <div className="hs wsd-app wss-app" lang={locale} data-platform={workspacePlatform()}>
    <aside className="wss-nav" inert={Boolean(decision)}><div className="hs-titlebar-drag" data-tauri-drag-region="" aria-hidden="true" /><button className="wss-back" onClick={close}>{t("ws.settings.back")}</button><h1>{t("ws.settings")}</h1><nav aria-label={t("ws.settings.navigation")}>
      {navItem("overview")}<div className="wss-nav-group"><strong>{t("ws.settings.workspace")}</strong><small>{t("ws.settings.currentOnly")}</small></div>
      <div className="wss-scope"><button ref={scopeTrigger} aria-haspopup="menu" aria-expanded={scopeOpen} onClick={() => setScopeOpen(value => !value)} disabled={!view.directory?.workspaces.length}>
        <span className="wss-scope-mark">{selected?.label?.slice(0, 1) ?? "H"}</span><span><strong>{selected?.label ?? t("ws.settings.noSpace")}</strong><small>{t(selected?.kind === "team" ? "ws.settings.team" : "ws.settings.personal")} · {t(selected?.role === "owner" ? "ws.settings.owner" : selected?.role === "admin" ? "ws.settings.admin" : "ws.settings.member")}</small></span><ChevronDownIcon className="hico" /></button>
        {scopeOpen ? <div ref={scopeMenu} role="menu" aria-label={t("ws.settings.scope")}><p>{t("ws.settings.scopeNote")}</p>{view.directory?.workspaces.filter(row => row.active).map(row => <button key={row.workspaceId} role="menuitemradio" aria-checked={row.workspaceId === view.workspaceId} onClick={() => switchScope(row.workspaceId)}>{row.label}</button>)}</div> : null}</div>
      {workspacePages.map(navItem)}<div className="wss-nav-group"><strong>{t("ws.settings.device")}</strong><small>{t("ws.settings.allSpaces")}</small></div>{navItem("appearance")}{navItem("updates")}
    </nav><footer><HaraLogo size={19} /><span>Hara {versionInfo?.desktop ?? ""}<small>{t("ws.settings.savedHere")}</small></span></footer></aside>
    <main className="wss-main" ref={body} inert={Boolean(decision)}><header className="wss-heading"><div><p>{t("ws.settings")} / {device ? t("ws.settings.device") : `${t("ws.settings.workspace")} / ${workspace?.label ?? "—"}`}</p><h1>{t(pages[page].name)}</h1></div>
      <span className="wss-scope-chip">{device ? `${t("ws.settings.device")} · ${t("ws.settings.allSpaces")}` : t("ws.settings.currentOnly")}</span></header><p className="wss-description">{t(pages[page].detail)}</p>
      {view.error ? <p className="wss-callout" role="alert">{workspaceMessageText(t, view.error)}</p> : null}
      {leaveNotice ? <p className="wss-callout" role="status">{t(leaveNotice)}</p> : null}
      {page === "overview" ? <><h3>{workspace?.label ?? t("ws.settings.workspace")}</h3><div className="wss-overview">{workspacePages.filter(id => id !== "members").map(id => <button key={id} onClick={() => navigate(id)}><span className="wss-overview-icon">{createElement(pages[id].icon, { className: "hico" })}</span><h2>{t(pages[id].name)}</h2><p>{id === "connections" ? t(connectionCount === 1 ? "ws.settings.connectionOne" : "ws.settings.connectionCount", { n: connectionCount }) : id === "runtimes" ? t("ws.settings.runtimeSummary") : t(pages[id].detail)}</p><span>{t("ws.settings.manage")} {t(pages[id].name)}</span></button>)}</div>
        <h3>{t("ws.settings.device")} · {t("ws.settings.allSpaces")}</h3><div className="wss-overview">{(["appearance", "updates"] as const).map(id => <button key={id} onClick={() => navigate(id)}><h2>{t(pages[id].name)}</h2><p>{id === "appearance" ? t("ws.settings.themeSummary") : ["available", "ready"].includes(updates.phase) ? t("ws.settings.updateAvailable", { version: updates.version ?? "" }) : t("ws.settings.updateSummary")}</p><span>{t("ws.settings.open")}</span></button>)}</div></> : null}
      {page === "appearance" ? <div className="wss-page-card"><WorkspaceThemeSettings theme={theme} locale={locale} /><label>{t("ws.settings.language")}<select aria-label={t("ws.settings.language")} value={preference} onChange={event => changeLocale(event.target.value as LocalePreference)}><option value="system">{t("ws.locale.system")}</option><option value="en">English</option><option value="zh-Hans">简体中文</option><option value="zh-Hant">繁體中文</option></select></label></div> : page === "updates" ? <WorkspaceSoftwareUpdate controller={updater} info={versionInfo} />
        : page === "overview" ? null : !workspace ? <p role="status">{t(view.loading ? "ws.settings.loading" : "ws.settings.createFirst")}</p> : <fieldset className="wss-content" key={key} disabled={Boolean(readonly)}>
          {readonly ? <p className="wss-callout">{t("ws.settings.readOnly")}</p> : null}
          {page === "connections" ? production ? <WorkspaceConnections model={model} workspace={workspace} onDirty={leaveGuard.setDirty} /> : <p>{t("ws.settings.connectionsLab")}</p> : null}
          {page === "runtimes" ? production ? <WorkspaceRuntimeSettings model={model} workspace={workspace} /> : <p>{t("ws.settings.runtimeLab")}</p> : null}
          {page === "schedules" || page === "skills" ? <WorkspaceFeaturePanel model={model} workspace={workspace} kind={page} onDirty={leaveGuard.setDirty} onCreateSkill={() => requestLeave({ kind: "skill", workspaceId: workspace.workspaceId })} /> : null}
          {page === "general" ? <General workspace={workspace} root={root} role={selected?.role ?? "owner"} kind={selected?.kind ?? "personal"} /> : null}
          {page === "members" ? <p>{t("ws.settings.membersUnavailable")}</p> : null}
        </fieldset>}
    </main>
    {decision ? <div className="wss-discard-backdrop"><section className="wss-discard-dialog" role="alertdialog" aria-modal="true" aria-labelledby="wss-discard-title" aria-describedby="wss-discard-description">
      <h2 id="wss-discard-title">{t("ws.settings.discard.title")}</h2><p id="wss-discard-description">{t("ws.settings.discard.body")}</p>
      <div className="wsd-card-actions"><button ref={cancelLeave} onClick={keepEditing}>{t("ws.settings.discard.keep")}</button><button ref={discardLeave} className="wsd-primary" onClick={() => {
        if (leaveGuard.confirm() === "stale") setLeaveNotice("ws.settings.discard.stale");
      }}>{t("ws.settings.discard.leave")}</button></div>
    </section></div> : null}
  </div>;
}
function General({ workspace, root, role, kind }: { workspace: WorkspaceDevSnapshot; root: string; role: string; kind: string }) {
  const { t } = useWorkspaceLocale();
  return <section className="wss-page-card"><h2>{workspace.label}</h2><dl><dt>{t("ws.settings.general.id")}</dt><dd>{workspace.workspaceId}</dd><dt>{t("ws.settings.general.kind")}</dt><dd>{t(kind === "team" ? "ws.settings.team" : "ws.settings.personal")}</dd><dt>{t("ws.settings.general.role")}</dt><dd>{t(role === "owner" ? "ws.settings.general.owner" : role === "admin" ? "ws.settings.general.admin" : "ws.settings.general.member")}</dd><dt>{t("ws.settings.localData")}</dt><dd><code>{root}/project/{workspace.workspaceId}</code></dd><dt>{t("ws.settings.general.history")}</dt><dd>{workspace.conversation.pastTaskCount ?? 0}</dd><dt>{t("ws.settings.general.calls")}</dt><dd>{workspace.conversation.usage.modelCalls}{t("ws.settings.general.notBill")}</dd></dl><p>{t(kind === "personal" ? "ws.settings.general.personalNote" : "ws.settings.general.teamNote")}</p></section>;
}
