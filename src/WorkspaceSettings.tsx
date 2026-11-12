import { WorkspaceRpcErrorNotice } from "./WorkspaceRpcErrorNotice.tsx";
import { localizedWorkspaceView } from "./workspace-default-labels.ts";
import { WorkspaceDeletedColleagues } from "./WorkspaceDeletedColleagues";
import { WorkspaceExtensions } from "./WorkspaceExtensions";
import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { OnboardingRerunResult } from "./workspace-onboarding-state";
import { useWorkspaceLocale, workspacePlatform } from "./workspace-shell-hooks";
import { ArrowPathIcon, CalendarDaysIcon, ChevronDownIcon, Cog6ToothIcon, ComputerDesktopIcon, HomeIcon, LinkIcon, PaintBrushIcon, SparklesIcon, UsersIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { selectableLanguages, type Key, type LocalePreference } from "./i18n";
import HaraLogo from "./mark";
import type { WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";
import WorkspaceRuntimeSettings from "./WorkspaceRuntimeSettings";
import { WorkspaceDefaultRuntime } from "./WorkspaceDefaultRuntime";
import { WorkspaceAppearanceAdvanced, WorkspaceConnections, WorkspaceFeaturePanel, WorkspaceThemeSettings, type useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { WorkspaceSoftwareUpdate, type DesktopVersionInfo } from "./WorkspaceSoftwareUpdate";
import { hasUpdateAttention, type WorkspaceUpdater } from "./workspace-updater-state";
import { SettingsLeaveGuard, type SettingsLeaveAction } from "./settings-leave-guard";
import { settingsAttentionPages } from "./settings-advanced-state";
import { SettingsAdvanced, SettingsAttention, type SettingsAttentionItem } from "./SettingsChrome";
import "./workspace-settings.css";

export type SettingsPage = "colleagues" | "overview" | "connections" | "runtimes" | "schedules" | "plugins" | "skills" | "members" | "general" | "appearance" | "updates";
const pages: Record<SettingsPage, { name: Key; icon: typeof HomeIcon; detail: Key }> = {
  colleagues: { name: "ws.nav.colleagues", icon: UsersIcon, detail: "ws.nav.colleagues" },
  overview: { name: "ws.settings.page.overview", icon: HomeIcon, detail: "ws.settings.detail.overview" },
  connections: { name: "ws.settings.page.connections", icon: LinkIcon, detail: "ws.settings.detail.connections" },
  runtimes: { name: "ws.settings.page.runtimes", icon: ComputerDesktopIcon, detail: "ws.settings.detail.runtimes" },
  plugins: { name: "ws.extensions.title", icon: LinkIcon, detail: "ws.extensions.detail" },
  schedules: { name: "ws.settings.page.schedules", icon: CalendarDaysIcon, detail: "ws.settings.detail.schedules" },
  skills: { name: "ws.settings.page.skills", icon: SparklesIcon, detail: "ws.settings.detail.skills" },
  members: { name: "ws.settings.page.members", icon: UsersIcon, detail: "ws.settings.detail.members" },
  general: { name: "ws.settings.page.general", icon: Cog6ToothIcon, detail: "ws.settings.detail.general" },
  appearance: { name: "ws.settings.page.appearance", icon: PaintBrushIcon, detail: "ws.settings.detail.appearance" },
  updates: { name: "ws.settings.page.updates", icon: ArrowPathIcon, detail: "ws.settings.detail.updates" },
};
export interface WorkspaceSettingsProps { mainModel: WorkspaceDevModel; initialPage: SettingsPage; root: string; production: boolean;
  theme: ReturnType<typeof useStableWorkspaceTheme>; updater: WorkspaceUpdater; versionInfo: DesktopVersionInfo | null;
  onClose(): void; onCreateSkill(workspaceId: string): void;
  /** Present only when the guide is available (Core G4 + all steps shipped); «Run again» resolves false if it could not start. */
  /** `workspaceId`: the workspace the guide belongs to (the main window's); Settings shows the row only while it shows that workspace. */
  onboarding?: SettingsOnboarding }
export interface SettingsOnboarding { workspaceId: string; readOnly: boolean; rerun(): Promise<OnboardingRerunResult> }
/** Keep the live shell mounted/inert below the modal. Escape belongs to SettingsLeaveGuard. */
export function SettingsOverlay({ children, ready, onClose }: { children: ReactNode; ready: boolean; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const { t } = useWorkspaceLocale();
  useEffect(() => () => { const target = previous.current; queueMicrotask(() => { if (target?.isConnected) target.focus(); }); }, []);
  useLayoutEffect(() => { (panel.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? panel.current)?.focus(); }, [ready]);
  return <div className="wss-overlay"><div ref={panel} className="wss-dialog" role="dialog" aria-modal="true" aria-label={t("ws.settings")} tabIndex={-1}
    onKeyDown={event => {
      if (!ready && event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || panel.current?.querySelector('[role="alertdialog"]')) return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]'))
        .filter(node => !node.closest("[inert]") && node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) event.preventDefault();
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>{children}</div></div>;
}
export default function WorkspaceSettings(props: WorkspaceSettingsProps) {
  const { locale, t } = useWorkspaceLocale();
  const [session, setSession] = useState<{ model: WorkspaceDevModel; close(): void } | null>(null), [error, setError] = useState<"" | Key>("");
  const initialWorkspace = useRef(props.mainModel.getSnapshot().workspaceId);
  useEffect(() => { if (!props.production) return; let active = true, owned: { model: WorkspaceDevModel; close(): void } | undefined;
    void props.mainModel.openSettingsSession().then(async value => { owned = value; if (!active) { value.close(); return; }
      await value.model.loadDirectory(); if (initialWorkspace.current) await value.model.selectWorkspace(initialWorkspace.current);
      if (active) setSession(value); else value.close();
    }).catch(() => { if (active) setError("ws.settings.sessionFailed"); });
    return () => { active = false; owned?.close(); };
  }, [props.mainModel, props.production]);
  const ready = !props.production || Boolean(session);
  return <SettingsOverlay ready={ready} onClose={props.onClose}>{ready ? <SettingsContent {...props} model={session?.model ?? props.mainModel} />
    : <div className="hs wsd-app wss-app" lang={locale} data-platform={workspacePlatform()}><aside className="wss-nav"><button className="wss-close" aria-label={t("vg.closeSettings")} onClick={props.onClose}><XMarkIcon className="hico" /></button><h1>{t("ws.settings")}</h1></aside><main className="wss-main"><p role="status">{t(error || "ws.settings.opening")}</p></main></div>}</SettingsOverlay>;
}
export function SettingsContent({ model, initialPage, root, production, theme, updater, versionInfo, onClose, onCreateSkill, onboarding }: WorkspaceSettingsProps & { model: WorkspaceDevModel }) {
  const { locale, preference, t, changeLocale } = useWorkspaceLocale();
  const rawView = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot), view = localizedWorkspaceView(rawView, locale), updates = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
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
    if ((event.metaKey || event.ctrlKey) && event.key === "," || event.key === "Escape" && !scopeOpen) { event.preventDefault(); close(); }
    if (event.key === "Escape" && scopeOpen) { setScopeOpen(false); scopeTrigger.current?.focus(); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [decision, keepEditing, requestLeave, scopeOpen]);
  useEffect(() => { if (!scopeOpen) return; scopeMenu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!scopeMenu.current?.contains(event.target as Node) && !scopeTrigger.current?.contains(event.target as Node)) setScopeOpen(false); };
    document.addEventListener("pointerdown", outside); return () => document.removeEventListener("pointerdown", outside);
  }, [scopeOpen]);
  const switchScope = (workspaceId: string) => { if (workspaceId !== view.workspaceId) requestLeave({ kind: "scope", workspaceId }); else setScopeOpen(false); };
  // «Members» is not released yet, so it has no entry (settings IA audit; DESIGN.md §11.6).
  const workspacePages: SettingsPage[] = ["colleagues", "connections", "runtimes", "schedules", "plugins", "skills", "general"];
  const attention = settingsAttentionPages({ updateAttention: hasUpdateAttention(updates), connections: workspace?.connections });
  const attentionDot = (id: SettingsPage) => attention.has(id) ? <i className="wss-update-dot" role="img" aria-label={t("ws.settings.attention")} /> : null;
  // One-line state for each overview card, from data the page already has (no extra RPC); other cards keep their description.
  const overviewSummary = (id: SettingsPage): string => {
    if (!workspace) return t(pages[id].detail);
    if (id === "colleagues") return t("ws.settings.summary.colleagues", { n: workspace.agents.filter(agent => agent.kind === "colleague" && agent.state !== "archived").length });
    if (id === "connections") { const current = workspace.connections.connections.find(row => row.status === "active" && row.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId));
      const count = t(connectionCount === 1 ? "ws.settings.connectionOne" : "ws.settings.connectionCount", { n: connectionCount });
      return current ? t("ws.settings.summary.connectionCurrent", { count, name: current.label }) : count; }
    if (id === "runtimes") return t("ws.settings.summary.runtimes", { n: (workspace.runtimes?.options ?? []).filter(option => option.registered).length });
    if (id === "general") return `${t(selected?.kind === "team" ? "ws.settings.team" : "ws.settings.personal")} · ${t(selected?.role === "owner" ? "ws.settings.general.owner" : selected?.role === "admin" ? "ws.settings.general.admin" : "ws.settings.general.member")}`;
    return t(pages[id].detail);
  };
  const navItem = (id: SettingsPage) => <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}><span aria-hidden>{createElement(pages[id].icon, { className: "hico" })}</span><span>{t(pages[id].name)}</span>{attentionDot(id)}</button>;
  const key = workspace ? `${workspace.workspaceId}:${workspace.resourceGeneration}:${page}` : "loading";
  return <div className="hs wsd-app wss-app" lang={locale} data-platform={workspacePlatform()}>
    <aside className="wss-nav" inert={Boolean(decision)}><button className="wss-close" aria-label={t("vg.closeSettings")} onClick={close}><XMarkIcon className="hico" /></button><h1>{t("ws.settings")}</h1><nav aria-label={t("ws.settings.navigation")}>
      {navItem("overview")}<div className="wss-nav-group"><strong>{t("ws.settings.workspace")}</strong><small>{t("ws.settings.currentOnly")}</small></div>
      <div className="wss-scope"><button ref={scopeTrigger} aria-haspopup="menu" aria-expanded={scopeOpen} onClick={() => setScopeOpen(value => !value)} disabled={!view.directory?.workspaces.length}>
        <span className="wss-scope-mark">{selected?.label?.slice(0, 1) ?? "H"}</span><span><strong>{selected?.label ?? t("ws.settings.noSpace")}</strong><small>{t(selected?.kind === "team" ? "ws.settings.team" : "ws.settings.personal")} · {t(selected?.role === "owner" ? "ws.settings.owner" : selected?.role === "admin" ? "ws.settings.admin" : "ws.settings.member")}</small></span><ChevronDownIcon className="hico" /></button>
        {scopeOpen ? <div ref={scopeMenu} role="menu" aria-label={t("ws.settings.scope")}><p>{t("ws.settings.scopeNote")}</p>{view.directory?.workspaces.filter(row => row.active).map(row => <button key={row.workspaceId} role="menuitemradio" aria-checked={row.workspaceId === view.workspaceId} onClick={() => switchScope(row.workspaceId)}>{row.label}</button>)}</div> : null}</div>
      {workspacePages.map(navItem)}<div className="wss-nav-group"><strong>{t("ws.settings.device")}</strong><small>{t("ws.settings.allSpaces")}</small></div>{navItem("appearance")}{navItem("updates")}
    </nav><footer><HaraLogo size={19} /><span>Hara {versionInfo?.desktop ?? ""}<small>{t("ws.settings.savedHere")}</small></span></footer></aside>
    <main className="wss-main" ref={body} inert={Boolean(decision)}><header className="wss-heading"><div><p>{t("ws.settings")} / {device ? t("ws.settings.device") : `${t("ws.settings.workspace")} / ${workspace?.label ?? "—"}`}</p><h1>{t(pages[page].name)}</h1></div>
      <span className="wss-scope-chip">{device ? `${t("ws.settings.device")} · ${t("ws.settings.allSpaces")}` : t("ws.settings.currentOnly")}</span></header><p className="wss-description">{t(pages[page].detail)}</p>
      <WorkspaceRpcErrorNotice value={view.error} technicalDetail={view.errorTechnicalDetail} locale={locale} t={t} className="wss-callout" />
      {leaveNotice ? <p className="wss-callout" role="status">{t(leaveNotice)}</p> : null}
      {page === "runtimes" && production && workspace ? <SettingsAttention items={runtimeAttention(workspace, model, t, Boolean(readonly))} /> : null}
      {/* Host-level preference (Core stores it with the theme): it applies to every workspace on this Mac, so it sits outside
          the workspace's read-only fieldset and is labelled with its scope, like Appearance (review of #78, M1). */}
      {page === "runtimes" && production && workspace && model.supportsDefaultRuntime?.() ? <WorkspaceDefaultRuntime model={model} workspace={workspace} /> : null}
      {page === "overview" ? <><h3>{workspace?.label ?? t("ws.settings.workspace")}</h3><div className="wss-overview">{workspacePages.map(id => <button key={id} onClick={() => navigate(id)}><span className="wss-overview-icon">{createElement(pages[id].icon, { className: "hico" })}</span><h2>{t(pages[id].name)}{attentionDot(id)}</h2><p>{overviewSummary(id)}</p><span>{t("ws.settings.manage")} {t(pages[id].name)}</span></button>)}</div>
        {/* Settings can switch workspace; the guide belongs to the main window's, so the row only shows for that one (review of #85, M1). */}
        {onboarding && onboarding.workspaceId === view.workspaceId ? <OnboardingRerunRow key={onboarding.workspaceId} onboarding={onboarding} /> : null}
        <h3>{t("ws.settings.device")} · {t("ws.settings.allSpaces")}</h3><div className="wss-overview">{(["appearance", "updates"] as const).map(id => <button key={id} onClick={() => navigate(id)}><h2>{t(pages[id].name)}{attentionDot(id)}</h2><p>{id === "appearance" ? t("ws.settings.themeSummary") : ["available", "ready"].includes(updates.phase) ? t("ws.settings.updateAvailable", { version: updates.version ?? "" }) : t("ws.settings.updateSummary")}</p><span>{t("ws.settings.open")}</span></button>)}</div></> : null}
      {page === "appearance" ? <div className="wss-page-card"><WorkspaceThemeSettings theme={theme} locale={locale} /><label>{t("ws.settings.language")}<select aria-label={t("ws.settings.language")} value={preference} onChange={event => changeLocale(event.target.value as LocalePreference)}><option value="system">{t("ws.locale.system")}</option>
            {/* Options come from the registry; only `stable` languages are offered (Jeff decision Q7).
                zh-Hant is beta for this release: the translations ship in the locale JSON and the
                contract test still checks them, but the picker must not offer them yet. */}
            {selectableLanguages().map(language => <option key={language.tag} value={language.tag}>{language.nativeName}</option>)}</select></label><WorkspaceAppearanceAdvanced theme={theme} locale={locale} /></div> : page === "updates" ? <WorkspaceSoftwareUpdate controller={updater} info={versionInfo} />
        : page === "overview" ? null : !workspace ? <p role="status">{t(view.loading ? "ws.settings.loading" : "ws.settings.createFirst")}</p>
          // General has nothing to edit; it sits outside the read-only fieldset so every member can still copy the path.
          : page === "general" ? <General workspace={workspace} root={root} role={selected?.role ?? "owner"} kind={selected?.kind ?? "personal"} /> : <fieldset className="wss-content" key={key} disabled={Boolean(readonly)}>
          {readonly ? <p className="wss-callout">{t("ws.settings.readOnly")}</p> : null}
          {page === "colleagues" ? <WorkspaceDeletedColleagues key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspace={workspace} locale={locale} /> : null}
          {page === "connections" ? production ? <WorkspaceConnections model={model} workspace={workspace} onDirty={leaveGuard.setDirty} /> : <p>{t("ws.settings.connectionsLab")}</p> : null}
          {page === "runtimes" ? production ? <WorkspaceRuntimeSettings model={model} workspace={workspace} onDirty={leaveGuard.setDirty} /> : <p>{t("ws.settings.runtimeLab")}</p> : null}
          {page === "plugins" ? <WorkspaceExtensions model={model} workspaceId={workspace.workspaceId} generation={workspace.resourceGeneration} onDirty={leaveGuard.setDirty} /> : null}
          {page === "schedules" || page === "skills" ? <WorkspaceFeaturePanel model={model} workspace={workspace} kind={page} onDirty={leaveGuard.setDirty}
            onCreateSkill={page === "skills" ? () => requestLeave({ kind: "skill", workspaceId: workspace.workspaceId }) : undefined} /> : null}
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
  const [copied, setCopied] = useState(false), path = `${root}/project/${workspace.workspaceId}`;
  return <section className="wss-page-card"><h2>{workspace.label}</h2><dl><dt>{t("ws.settings.general.kind")}</dt><dd>{t(kind === "team" ? "ws.settings.team" : "ws.settings.personal")}</dd><dt>{t("ws.settings.general.role")}</dt><dd>{t(role === "owner" ? "ws.settings.general.owner" : role === "admin" ? "ws.settings.general.admin" : "ws.settings.general.member")}</dd><dt>{t("ws.settings.general.history")}</dt><dd>{workspace.conversation.pastTaskCount ?? 0}</dd><dt>{t("ws.settings.general.calls")}</dt><dd>{workspace.conversation.usage.modelCalls}{t("ws.settings.general.notBill")}</dd></dl><p>{t(kind === "personal" ? "ws.settings.general.personalNote" : "ws.settings.general.teamNote")}</p>
    <SettingsAdvanced page="general" items={[t("ws.settings.general.id"), t("ws.settings.localData")]}>
      <dl><dt>{t("ws.settings.general.id")}</dt><dd>{workspace.workspaceId}</dd><dt>{t("ws.settings.localData")}</dt><dd><code>{path}</code></dd></dl>
      <button type="button" onClick={() => void navigator.clipboard.writeText(path).then(() => setCopied(true)).catch(() => setCopied(false))}>{t(copied ? "ws.settings.general.pathCopied" : "ws.settings.general.copyPath")}</button>
    </SettingsAdvanced></section>;
}
/** Engine page: a running download is pinned above the page with its cancel action (settings IA audit, runtimes). */
function runtimeAttention(workspace: WorkspaceDevSnapshot, model: WorkspaceDevModel, t: ReturnType<typeof useWorkspaceLocale>["t"], readonly: boolean): SettingsAttentionItem[] {
  return (workspace.runtimes?.operations ?? []).filter(operation => operation.state === "downloading").map(operation => ({ id: `download-${operation.id}`, tone: "progress" as const,
    text: t("ws.runtimes.attention.downloading", { name: workspace.runtimes?.options.find(option => option.runtimeId === operation.runtimeId)?.label ?? operation.runtimeId }),
    action: { label: t("ws.runtimes.cancelInstall"), disabled: readonly, onClick: () => void model.cancelRuntime(operation.id) } }));
}

/** «Getting started · Run again» on the overview (design §2 branches: re-enter; plan O4). */
function OnboardingRerunRow({ onboarding }: { onboarding: SettingsOnboarding }) {
  const { t } = useWorkspaceLocale();
  const [busy, setBusy] = useState(false), [result, setResult] = useState<OnboardingRerunResult | null>(null);
  const readOnly = onboarding.readOnly || result === "readOnly";
  return <div className="wss-setting-row wss-onboarding-rerun"><div><strong>{t("ws.onboarding.rerun.title")}</strong>
    <p>{t(readOnly ? "ws.onboarding.rerun.readOnly" : "ws.onboarding.rerun.note")}</p>
    {result === "failed" ? <p role="alert">{t("ws.onboarding.rerun.failed")}</p> : null}</div>
    <button type="button" disabled={busy || readOnly} onClick={() => { setBusy(true); setResult(null);
      // «busy» (a save already running) is not a failure, so it shows nothing (review of #85, L2).
      void onboarding.rerun().then(value => setResult(value === "busy" ? null : value)).catch(() => setResult("failed")).finally(() => setBusy(false)); }}>{t("ws.onboarding.rerun.action")}</button>
  </div>;
}
