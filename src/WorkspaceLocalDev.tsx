import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRightIcon, ChatBubbleLeftRightIcon, CheckCircleIcon, ChevronRightIcon, Cog6ToothIcon, GlobeAltIcon,
  HashtagIcon, MagnifyingGlassIcon, PencilSquareIcon, PlusIcon, UserPlusIcon, UsersIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import HaraLogo from "./mark";
import { makeT, type Key, type Locale } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import { WorkspaceDevConnectionClient, type WorkspaceDevConnection } from "./workspace-dev-rpc";
import { WorkspaceDevModel, type WorkspaceDevMessage, type WorkspaceDevAgent, type WorkspaceDevApproval } from "./workspace-dev-state";
import WorkspaceRuntimeSettings from "./WorkspaceRuntimeSettings";
import { WorkspaceConnections, WorkspaceFeaturePanel, WorkspaceThemeSettings, useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { Avatar, AwaitBar, ColleaguesPage, ShellDialog, SidebarSection } from "./WorkspaceShell";
import { useSectionState, useWorkspaceLocale, useWorkspaceOverview, workspacePlatform } from "./workspace-shell-hooks";
import { conversationTimeline, messageContinues, normalizeShellRoute, pendingApprovals, type AwaitItem } from "./workspace-shell-state";
import "./workspace-local-dev.css";
import "./workspace-theme.css";
import "./workspace-states.css";
import "./workspace-shell-layout.css";
import WorkspaceSettings, { type SettingsPage } from "./WorkspaceSettings";
import { useWorkspaceUpdater, WorkspaceUpdateNotice } from "./WorkspaceSoftwareUpdate";
const BrowserExtension = lazy(() => import("./WorkspaceBrowserExtension"));

type Translate = ReturnType<typeof makeT>;
const TOOL_LABELS: Record<string, Key> = Object.fromEntries(["task_intake", "task_checkpoint", "todo_write", "workspace_read", "workspace_write", "workspace_verify", "agent_list", "agent_create", "agent_contact"]
  .map(name => [name, `ws.execution.${name}` as Key]));
export function ApprovalCard({ card, model, t, disabled = false, onSettled, inDialog = false }: { card: WorkspaceDevApproval; model: WorkspaceDevModel; t: Translate; disabled?: boolean; onSettled?: () => void; inDialog?: boolean }) {
  const [pending, setPending] = useState(false), fence = useRef(false);
  const decide = async (approved: boolean) => {
    if (fence.current || disabled) return; fence.current = true; setPending(true);
    try { await model.respond(card, approved);
      if (!model.getSnapshot().workspace?.approvals.some(row => row.id === card.id)) onSettled?.();
    } finally { fence.current = false; setPending(false); }
  };
  return <section className="hs-card wsd-approval" role="group" aria-label={t("ws.approval.label")} id={`${inDialog ? "approval-dialog" : "approval"}-${card.id}`} tabIndex={-1}>
    <div className="wsd-kicker">{t("ws.approval.kicker")}</div><h3>{t("ws.approval.title", { name: card.draft.displayName })}</h3>
    <p>{card.draft.title} <span className="hs-tag">{t("ws.approval.runtime")}</span></p>
    <details><summary>{t("ws.approval.details")}</summary><p>{card.draft.instructions}</p><p>{t("ws.approval.boundary")}</p></details>
    <div className="wsd-card-actions"><button className="hs-btn sec" onClick={() => void decide(false)} disabled={pending || disabled}>{t("ws.approval.decline")}</button>
      <button className="hs-btn pri" onClick={() => void decide(true)} disabled={pending || disabled}>{t("ws.approval.confirm")}</button></div>
  </section>;
}
export function Transcript({ history, agent, t, detailed = false }: { history: WorkspaceDevMessage[]; agent?: WorkspaceDevAgent; t: Translate; detailed?: boolean }) {
  let previous: WorkspaceDevMessage | undefined;
  return <>{history.map((message, index) => {
    if (message.role === "tool") { previous = undefined; return null; }
    const continuation = messageContinues(previous, message); previous = message;
    if (message.role === "user") return <div className={`hs-msg me wsd-message is-user ${continuation ? "cont" : ""}`} key={`user-${index}`}><div className="hs-bub wsd-bubble">{message.content}</div></div>;
    const next = history[index + 1], results = next?.role === "tool" ? next.results : [];
    return <div className={`wsd-message-group ${continuation ? "cont" : ""}`} key={`assistant-${index}`}>
      {message.text.trim() ? <>{!continuation ? <div className="hs-who">{agent?.identity.displayName ?? "Hara"}</div> : null}
        <div className={`hs-msg wsd-message is-agent ${continuation ? "cont" : ""}`}><Avatar agent={agent} /><div className="hs-bub wsd-bubble">{message.text}</div></div></> : null}
      {message.tools.length ? <details className="wsd-execution" open={detailed || undefined}><summary>{t("ws.execution.count", { n: message.tools.length })} <span>{t("ws.execution.details")}</span></summary>
        <div className="wsd-execution-body">{results.map(result => <div key={result.id}><strong>{TOOL_LABELS[result.name] ? t(TOOL_LABELS[result.name]) : result.name}</strong>
          <pre className={result.isError ? "is-error" : ""}>{result.content.slice(0, 5000)}</pre></div>)}</div></details> : null}
    </div>;
  })}</>;
}
export function WorkspaceScreen({ model, disconnected, onReconnect, root, mode, onOpenBrowser }: { model: WorkspaceDevModel; disconnected: string; onReconnect: () => void; root: string;
  mode: "workspace" | "lab"; onOpenBrowser?: () => void }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const { locale, t, changeLocale } = useWorkspaceLocale();
  const [settings, setSettingsState] = useState(false), [creating, setCreating] = useState(false), [name, setName] = useState(() => t("ws.space.default"));
  const [feature, setFeature] = useState<"schedules" | "skills" | null>(null), [searching, setSearching] = useState(false), [search, setSearch] = useState("");
  const [route, setRoute] = useState(() => normalizeShellRoute(typeof location === "undefined" ? "" : location.hash));
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; scope: string } | null>(null), [focusApproval, setFocusApproval] = useState<string | null>(null);
  const theme = useStableWorkspaceTheme(model);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("overview"), [browser, setBrowser] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), nearBottom = useRef(true), selectedRow = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null), scrollContext = useRef("");
  const scrollResume = useRef<{ key: string; top: number; atBottom: boolean } | null>(null);
  const workspace = view.workspace, agents = workspace?.agents ?? view.roster, agent = agents.find(row => row.agentId === view.agentId);
  const colleagues = agents.filter(row => row.kind === "colleague" && row.state !== "archived");
  const shell = useWorkspaceOverview(model, workspace), { sections, toggle } = useSectionState(view.workspaceId ?? "none");
  const scope = workspace ? JSON.stringify([workspace.workspaceId, workspace.resourceGeneration]) : "";
  const busy = Boolean(workspace && ["running", "draining"].includes(workspace.conversation.state));
  const hasConnection = Boolean(workspace?.connections.defaultConnectionId), realKey = view.directory?.executionMode === "ark-real-key", production = view.directory?.executionMode === "workspace";
  const colleagueLimit = Number.isSafeInteger(workspace?.colleagueLimit) && workspace!.colleagueLimit! > 0 ? workspace!.colleagueLimit : undefined;
  const updates = useWorkspaceUpdater(model, production);
  scrollContext.current = JSON.stringify([scope, view.agentId, route]);
  const setSettings = (open: boolean) => {
    if (open && scroll.current) scrollResume.current = { key: scrollContext.current, top: scroll.current.scrollTop, atBottom: nearBottom.current };
    setSettingsState(open);
  };
  useLayoutEffect(() => {
    if (settings || !scrollResume.current || !scroll.current) return;
    const saved = scrollResume.current; scrollResume.current = null;
    if (saved.key === scrollContext.current) scroll.current.scrollTop = saved.atBottom ? scroll.current.scrollHeight : saved.top;
  }, [settings]);

  useEffect(() => { setBrowser(false); }, [scope]);
  const connect = () => production ? (setSettingsPage("connections"), setSettings(true)) : realKey ? model.addApprovedConnection() : model.addSynthetic();
  const canSend = Boolean(workspace && hasConnection && view.draft.trim() && !view.sending && !busy && !view.pendingUnknown && !disconnected);
  const navigate = (section: "chat" | "colleagues", tab: "people" | "tasks" = "people") => {
    setRoute({ section, tab });
    const hash = section === "chat" ? "" : tab === "tasks" ? "#colleagues/tasks" : "#colleagues";
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  };
  useEffect(() => {
    const update = () => setRoute(normalizeShellRoute(location.hash));
    window.addEventListener("hashchange", update);
    if (/^#\/?tasks$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#colleagues/tasks`);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => { if (nearBottom.current && route.section === "chat") end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [workspace?.conversation.history.length, workspace?.approvals.length, busy, route.section]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [model, busy]);
  useEffect(() => { nearBottom.current = true; if (workspace?.selectedAgentId && route.section === "chat") input.current?.focus(); }, [workspace?.selectedAgentId, route.section]);
  useLayoutEffect(() => { const node = input.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(160, Math.max(32, node.scrollHeight))}px`; }, [view.draft, workspace?.selectedAgentId, route.section]);
  useEffect(() => { selectedRow.current?.scrollIntoView({ block: "nearest" }); }, [view.agentId, view.workspaceId, sections.dms, route.section]);
  useEffect(() => {
    if (!focusApproval || !workspace) return;
    const node = document.getElementById(`approval-${focusApproval}`);
    if (node) { node.scrollIntoView({ block: "nearest" }); node.focus(); setFocusApproval(null); }
  }, [focusApproval, workspace]);
  useEffect(() => {
    const open = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSettings(true); } };
    window.addEventListener("keydown", open); return () => window.removeEventListener("keydown", open);
  }, []);
  const openAgent = async (agentId: string, approvalId?: string, confirm = false) => {
    const expected = model.getSnapshot().workspace;
    if (!expected || disconnected) return; navigate("chat");
    if (agentId !== expected.selectedAgentId) await model.selectAgent(agentId);
    const current = model.getSnapshot().workspace;
    if (!current || current.workspaceId !== expected.workspaceId || current.resourceGeneration !== expected.resourceGeneration || current.selectedAgentId !== agentId) return;
    if (approvalId) {
      setFocusApproval(approvalId);
      if (confirm && pendingApprovals(current, Date.now()).some(card => card.id === approvalId)) setApprovalDialog({ id: approvalId, scope: JSON.stringify([current.workspaceId, current.resourceGeneration]) });
    }
  };
  const openItem = (item: AwaitItem, confirm = false) => { void openAgent(item.agentId, item.approval?.id, confirm); };
  const discuss = async () => {
    const expected = model.getSnapshot().workspace, main = expected?.agents.find(row => row.kind === "main");
    if (!expected || !main) return; await openAgent(main.agentId);
    const current = model.getSnapshot().workspace;
    if (current?.workspaceId === expected.workspaceId && current.resourceGeneration === expected.resourceGeneration && current.selectedAgentId === main.agentId) model.setDraft(t("ws.colleagues.prompt"));
  };
  const create = async () => { await model.createWorkspace(name); if (!model.getSnapshot().error) { setCreating(false); navigate("chat"); } };
  const timeline = workspace ? conversationTimeline([workspace], workspace.selectedAgentId, shell.now) : [];
  const liveApprovals = timeline.flatMap(item => item.kind === "approval" ? [item.approval] : []);
  const dialogCard = approvalDialog?.scope === scope ? liveApprovals.find(card => card.id === approvalDialog.id) : undefined;
  const unread = colleagues.reduce((sum, row) => sum + (shell.activity[row.agentId]?.unread ?? 0), 0);
  const dmRows = useMemo(() => colleagues.map(row => {
    const snapshot = shell.snapshots.find(value => value.selectedAgentId === row.agentId);
    const last = snapshot ? [...snapshot.conversation.history].reverse().find(message => message.role !== "tool") : undefined;
    const timestamp = snapshot?.conversation.updatedAt ?? last?.createdAt;
    return { agent: row, preview: last?.role === "user" ? last.content : last?.role === "assistant" ? last.text : row.identity.title ?? t("ws.role.colleague"), timestamp,
      order: Date.parse(timestamp ?? "") || shell.activity[row.agentId]?.observedAt || 0 };
  }).sort((a, b) => b.order - a.order), [colleagues, shell.snapshots, shell.activity, t]);
  const closeSettings = () => { setSettings(false); setFeature(null); };
  const modalOpen = settings || creating || approvalDialog?.scope === scope;
  const draftSkill = async (workspaceId: string) => {
    if (model.getSnapshot().workspaceId !== workspaceId) await model.selectWorkspace(workspaceId);
    const current = model.getSnapshot().workspace;
    if (current?.workspaceId !== workspaceId) return;
    const main = current.agents.find(row => row.kind === "main");
    if (main) await model.selectAgent(main.agentId);
    if (model.getSnapshot().workspaceId !== workspaceId) return;
    closeSettings(); navigate("chat"); model.setDraft(t("skillCreationPrompt"));
  };
  if (production && settings) return <WorkspaceSettings mainModel={model} initialPage={settingsPage} root={root} production theme={theme} updater={updates.controller} versionInfo={updates.info}
    onClose={closeSettings} onCreateSkill={id => void draftSkill(id)} />;
  return <div className="hs wsd-app" lang={locale} data-platform={workspacePlatform()} data-workspace-mode={mode}><div className="hs-frame"><div className={`hs-win${browser ? " has-browser" : ""}`}>
    <aside className="hs-side wsd-sidebar" inert={modalOpen}><div className="hs-titlebar-drag" data-tauri-drag-region="" aria-hidden="true" />
      <div className="hs-top"><HaraLogo size={20} /><select className="hs-space" aria-label={t("ws.space.switch")} value={view.workspaceId ?? ""} disabled={view.loading || !view.directory?.workspaces.length}
        onChange={event => { closeSettings(); setSearch(""); setApprovalDialog(null); navigate("chat"); void model.selectWorkspace(event.target.value); }}>
        <option value="" disabled>{t("ws.space.choose")}</option>{view.directory?.workspaces.map(row => <option value={row.workspaceId} key={row.workspaceId} disabled={!row.active}>{row.label}</option>)}
      </select><button className="hs-icon" aria-label={t("ws.search")} aria-expanded={searching} onClick={() => setSearching(value => !value)}><MagnifyingGlassIcon className="hico" /></button>
        <button className="hs-icon" aria-label={t("ws.space.new")} onClick={() => { setName(t("ws.space.default")); setCreating(true); }}><PlusIcon className="hico" /></button></div>
      {searching ? <input className="hs-search" type="search" aria-label={t("ws.search")} placeholder={t("ws.search.placeholder")} value={search} onChange={event => setSearch(event.target.value)} autoFocus /> : null}
      {view.workspaceId && agents.length ? <>
        {agents.filter(row => row.kind === "main").map(row => <button key={row.agentId} disabled={view.loading} className="hs-row hs-main wsd-contact is-main" aria-label={row.identity.displayName} title={row.identity.displayName} aria-current={route.section === "chat" && row.agentId === view.agentId ? "page" : undefined}
          onClick={() => void openAgent(row.agentId)}><Avatar agent={row} large /><span className="hs-txt"><strong className="hs-name"><span className="nm">{row.identity.displayName}</span><span className="hs-tag brand">{t("ws.main.tag")}</span></strong>
            <span className="pv">{t("ws.main.subtitle")}</span></span></button>)}
        <nav className="hs-sections" aria-label={t("ws.nav.aria")}>
          <SidebarSection id="colleagues" title={t("ws.sec.colleagues")} expanded={sections.colleagues} onToggle={() => toggle("colleagues")} t={t}
            badge={shell.navBadge} pending badgeLabel={t("ws.sec.pending", { n: shell.navBadge })} icon={<UsersIcon className="hico sec-ic" />}
            action={<button className="hs-sec-a" aria-label={t("ws.sec.openColleagues")} aria-current={route.section === "colleagues" ? "page" : undefined} onClick={() => navigate("colleagues")}><ArrowUpRightIcon className="hico" /></button>}>
            {colleagues.filter(row => shell.waiting.some(item => item.agentId === row.agentId) || shell.snapshots.some(snapshot => snapshot.selectedAgentId === row.agentId && ["running", "draining"].includes(snapshot.conversation.state))).map(row => {
              const needsYou = shell.waiting.some(item => item.agentId === row.agentId);
              return <button className="hs-row hs-mini" disabled={view.loading} key={row.agentId} onClick={() => void openAgent(row.agentId)}><Avatar agent={row} /><span className="hs-txt hs-name">{row.identity.displayName}</span>
                <span className="hs-stx">{t(needsYou ? "ws.colleagues.needsYou" : "ws.colleagues.working")}</span><span aria-hidden="true" className={`hs-st-dot ${needsYou ? "need" : "work"}`} /></button>;
            })}
            <button className="hs-row hs-add" onClick={() => navigate("colleagues")}><UsersIcon className="hico" />{t("ws.dm.all", { n: colleagues.length })}<ChevronRightIcon className="hico" /></button>
          </SidebarSection>
          <SidebarSection id="channels" title={t("ws.sec.channels")} expanded={sections.channels} onToggle={() => toggle("channels")} t={t} icon={<HashtagIcon className="hico sec-ic" />}>
            <div className="hs-empty"><b>{t("ws.channels.empty.title")}</b>{t("ws.channels.empty.body")}</div>
          </SidebarSection>
          <SidebarSection id="dms" title={t("ws.sec.dms")} expanded={sections.dms} onToggle={() => toggle("dms")} t={t} badge={unread} pending={shell.waiting.some(item => colleagues.some(row => row.agentId === item.agentId))}
            badgeLabel={t("ws.sec.unread", { n: unread })} icon={<ChatBubbleLeftRightIcon className="hico sec-ic" />}
            action={<button className="hs-sec-a" aria-label={t("ws.sec.newDm")} onClick={() => navigate("colleagues")} disabled={view.loading}><PencilSquareIcon className="hico" /></button>}>
            {dmRows.filter(row => !search || `${row.agent.identity.displayName} ${row.agent.identity.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <button className="hs-row hs-dm wsd-contact" aria-label={row.agent.identity.displayName} title={row.agent.identity.displayName} disabled={view.loading} key={row.agent.agentId}
              ref={row.agent.agentId === view.agentId ? selectedRow : undefined} aria-current={route.section === "chat" && row.agent.agentId === view.agentId ? "page" : undefined} onClick={() => void openAgent(row.agent.agentId)}>
              <Avatar agent={row.agent} /><span className="hs-txt"><strong className="hs-name"><span className="nm">{row.agent.identity.displayName}</span>{row.agent.identity.title ? <span className="hs-tag">{row.agent.identity.title}</span> : null}</strong><span className="pv">{row.preview}</span></span>
              <span className="hs-meta">{row.timestamp && Number.isFinite(Date.parse(row.timestamp)) ? <time className="hs-time" dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time> : null}
                {(shell.activity[row.agent.agentId]?.unread ?? 0) > 0 ? <span className="hs-dot" role="img" aria-label={t("ws.unread", { n: shell.activity[row.agent.agentId].unread })} /> : null}</span></button>)}
            {!colleagues.length ? <p className="hs-empty">{t("ws.dm.empty")}</p> : searching && search && !dmRows.some(row => `${row.agent.identity.displayName} ${row.agent.identity.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ? <p className="hs-empty">{t("ws.search.empty")}</p> : null}
            <button className="hs-row hs-add" aria-label={t("ws.colleagues.discuss")} disabled={view.loading} onClick={() => void discuss()}><UserPlusIcon className="hico" />{t("ws.colleagues.discuss")}</button>
          </SidebarSection>
        </nav>
      </> : <p className="wsd-sidebar-note">{t("ws.space.note")}</p>}
      <footer className="hs-foot"><div className="hs-quota" title={t("ws.quota.note")}><UsersIcon className="hico" /><span>{colleagueLimit ? t("ws.quota.count", { n: colleagues.length, max: colleagueLimit }) : t("ws.quota.current", { n: colleagues.length })}</span>{colleagueLimit ? <i aria-hidden="true"><b style={{ width: `${Math.min(100, colleagues.length / colleagueLimit * 100)}%` }} /></i> : null}</div>
        <div className="hs-row hs-me"><span className="hs-ava" aria-hidden="true">{t("ws.me").slice(0, 1)}</span><span className="grow">{t("ws.me")}</span><button className="hs-set" aria-label={t("ws.settings")} onClick={() => setSettings(true)}><Cog6ToothIcon className="hico" />{t("ws.settings")}</button></div></footer>
    </aside>
    <main className="hs-chat wsd-chat" inert={modalOpen}>
      <header className="hs-head wsd-header"><Avatar agent={agent} /><div className="hs-header-person"><strong>{route.section === "colleagues" ? t("ws.nav.colleagues") : agent?.identity.displayName ?? "Hara"}</strong>
        <small>{agent ? t(agent.runtime.id === "pi" ? "ws.header.runtime" : "ws.header.otherRuntime", { role: agent.kind === "main" ? t("ws.main.tag") : agent.identity.title ?? t("ws.role.colleague"), runtime: agent.runtime.label }) : t("ws.welcome.title")}</small></div><span className="sp" />
        {<button className="hs-ghost" aria-label={t("ws.header.browser")} title={t("ws.header.browser")} aria-expanded={browser} aria-controls="workspace-browser-panel" onClick={() => { setBrowser(value => !value); onOpenBrowser?.(); }} disabled={!workspace}><GlobeAltIcon className="hico" />{t("ws.header.browser")}</button>}
        <button className="hs-icon" aria-label={t("ws.settings")} onClick={() => setSettings(true)}><Cog6ToothIcon className="hico" /></button></header>
      {disconnected ? <div className="wsd-notice" role="alert">{t("ws.disconnected")}<button className="hs-btn sec" onClick={onReconnect}>{t("ws.reconnect")}</button></div> : null}
      {view.error ? <div className="wsd-notice is-error" role="alert">{workspaceMessageText(t, view.error)}</div> : null}
      {view.syncNotice ? <div className="wsd-notice" role="status">{workspaceMessageText(t, view.syncNotice)}</div> : null}
      {shell.incomplete && agent?.kind !== "main" ? <div className="wsd-notice" role="status" data-overview-incomplete>{t("ws.tasks.unavailable")}<button className="hs-btn sec" onClick={shell.refresh}>{t("ws.tasks.retry")}</button></div> : null}
      <div ref={scroll} className="hs-scroll wsd-scroll" onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 180; }}>
        {route.section === "colleagues" && workspace ? <ColleaguesPage shell={shell} agents={colleagues} tab={route.tab} setTab={tab => navigate("colleagues", tab)} t={t} openAgent={id => void openAgent(id)} openItem={item => openItem(item)} discuss={() => void discuss()} />
          : !workspace && view.loading && view.workspaceId ? <p role="status">{t("common.loading")}</p> : !workspace ? <section className="wsd-welcome"><HaraLogo size={48} /><h1>{t("ws.welcome.title")}</h1><p>{t("ws.welcome.body")}</p>
            <button className="hs-btn pri" onClick={() => setCreating(true)} disabled={view.loading}>{t("ws.welcome.create")}</button><small>{t(production ? "ws.welcome.note" : "ws.lab.note")}</small></section>
          : <div className="hs-col wsd-thread">
            {agent?.kind === "main" ? <AwaitBar shell={shell} t={t} onOpen={item => openItem(item)} onApprove={item => openItem(item, true)} onAll={() => navigate("colleagues", "tasks")} /> : null}
            {!hasConnection ? <section className="wsd-connect-card"><h2>{t("ws.connection.title")}</h2><p>{t(production ? "ws.connection.body" : realKey ? "ws.lab.real" : "ws.lab.synthetic")}</p>
              <button className="hs-btn pri" onClick={() => void connect()}>{t(production ? "ws.connection.configure" : realKey ? "ws.connection.approved" : "ws.connection.synthetic")}</button></section> : null}
            {hasConnection && !workspace.conversation.history.length ? <div className="hs-hello"><h2>{t("ws.home.title")}</h2><p>{t("ws.home.hint")}</p><div className="hs-chips"><button className="hs-chip" onClick={() => void discuss()}><UserPlusIcon className="hico" />{t("ws.home.chip.colleague")}</button>
              <button className="hs-chip" onClick={() => model.setDraft(t("ws.home.chip.tasks"))}>{t("ws.home.chip.tasks")}</button></div></div> : null}
            <Transcript history={workspace.conversation.history} agent={agent} t={t} detailed={theme.settings?.executionDetails === "detailed" && theme.settings?.collapseDetails === false} />
            {liveApprovals.map(card => <ApprovalCard key={card.id} card={card} model={model} t={t} disabled={Boolean(disconnected)} />)}
            {workspace.conversation.completion?.state === "verified" && workspace.conversation.taskState === "completed" ? <p className="wsd-verified"><CheckCircleIcon className="hico" />{t("ws.verified")} <span>{t("ws.verified.note")}</span></p> : null}
            {["needs_recovery", "blocked", "cancelled", "interrupted"].includes(workspace.conversation.state) ? <section className="wsd-resume"><strong>{t(workspace.conversation.state === "cancelled" ? "ws.resume.cancelled" : "ws.resume.title")}</strong>
              {workspace.conversation.blockReason ? <p role="alert">{workspace.conversation.blockReason}</p> : null}<p>{t("ws.resume.body")}</p>
              {workspace.conversation.resumeAdmission?.allowed === false ? <p>{t("ws.resume.budget")}</p> : null}
              <button className="hs-btn sec" onClick={() => void model.send(true)} disabled={Boolean(disconnected) || view.sending || view.pendingUnknown || !hasConnection || workspace.conversation.resumeAdmission?.allowed === false}>{t("ws.resume.action")}</button></section> : null}
            {busy && !liveApprovals.length ? <div className="wsd-typing" role="status"><Avatar agent={agent} /><span>{t(workspace.conversation.state === "draining" ? "ws.draining" : "ws.replying", { name: agent?.identity.displayName ?? "Hara" })}</span><i /><i /><i /></div> : null}<div ref={end} />
          </div>}
      </div>
      {workspace && route.section === "chat" ? <footer className="hs-compose wsd-composer-wrap"><div className="hs-field wsd-composer"><textarea ref={input} aria-label={t("ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" })} value={view.draft}
        placeholder={hasConnection ? t("ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" }) : t("ws.composer.noConnection")} disabled={!hasConnection || Boolean(disconnected)} rows={1}
        onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) void model.send(); } }} />
        <span className="hs-conn">{t("ws.composer.connection")}</span>{busy ? <button className="hs-stop" onClick={() => void model.cancel()} disabled={Boolean(disconnected) || workspace.conversation.state === "draining"}><StopIcon className="hico" />{t("ws.composer.stop")}</button>
          : view.pendingUnknown ? <button className="hs-btn sec" onClick={() => void model.verifyPending()} disabled={Boolean(disconnected)}>{t("ws.composer.verify")}</button> : <button className="hs-send wsd-send" onClick={() => void model.send()} disabled={!canSend} aria-label={t("ws.composer.send")}><PaperAirplaneIcon className="hico" /></button>}</div>
        <p className="hs-hint"><span>{t(production ? "ws.composer.hint.local" : realKey ? "ws.lab.real" : "ws.lab.synthetic")}</span><span>{t("ws.composer.hint.keys")}</span></p></footer> : null}
    </main>
    {browser && workspace ? <Suspense fallback={<aside id="workspace-browser-panel" className="hs-browser" role="status">{t("common.loading")}</aside>}><BrowserExtension key={scope} label={workspace.label} locale={locale} inert={Boolean(modalOpen)} onClose={() => setBrowser(false)} /></Suspense> : null}
    {production ? <WorkspaceUpdateNotice controller={updates.controller} onView={() => { setSettingsPage("updates"); setSettings(true); }} /> : null}
    {creating ? <ShellDialog label={t("ws.space.new")} onClose={() => setCreating(false)}><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setCreating(false)}><XMarkIcon className="hico" /></button>
      <h2>{t("ws.create.title")}</h2><p>{t("ws.create.body")}</p><label>{t("ws.create.name")}<input aria-label={t("ws.create.name")} value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) void create(); }} /></label>
      <button className="hs-btn pri" onClick={() => void create()} disabled={view.loading || !name.trim()}>{t("ws.space.new")}</button></ShellDialog> : null}
    {approvalDialog?.scope === scope ? <ShellDialog label={t("ws.approval.label")} onClose={() => setApprovalDialog(null)} className="wsd-approval-dialog"><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setApprovalDialog(null)}><XMarkIcon className="hico" /></button>
      {dialogCard ? <ApprovalCard card={dialogCard} model={model} t={t} inDialog disabled={Boolean(disconnected)} onSettled={() => setApprovalDialog(null)} /> : <p role="status">{t("ws.approval.stale")}</p>}</ShellDialog> : null}
    {settings ? <ShellDialog key={`settings:${view.workspaceId}`} label={t("ws.settings")} onClose={closeSettings} className="wsd-settings"><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={closeSettings}><XMarkIcon className="hico" /></button>
      <h2>{t("ws.settings")}</h2><p>{workspace?.label}</p><p>{t("ws.settings.description")}</p>
      <section aria-label={t("ws.settings.appearance")}><h3>{t("ws.settings.appearance")}</h3><WorkspaceThemeSettings theme={theme} locale={locale} />
        <label>{t("ws.settings.language")}<select aria-label={t("ws.settings.language")} value={locale} onChange={event => changeLocale(event.target.value as Locale)}><option value="en">{t("ws.locale.en")}</option><option value="zh-Hans">{t("ws.locale.hans")}</option><option value="zh-Hant">{t("ws.locale.hant")}</option></select></label></section>
      {workspace ? <>{production ? <WorkspaceConnections key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspace={workspace} />
        : !hasConnection ? <button className="hs-btn pri" onClick={() => void connect()}>{t(realKey ? "ws.connection.approved" : "ws.connection.synthetic")}</button> : null}
        <div className="wsd-card-actions"><button className="hs-btn sec" onClick={() => setFeature("schedules")}>{t("ws.settings.schedules")}</button><button className="hs-btn sec" onClick={() => setFeature("skills")}>{t("ws.settings.skills")}</button></div>
        {feature ? <WorkspaceFeaturePanel key={`${workspace.workspaceId}:${workspace.resourceGeneration}:${feature}`} model={model} workspace={workspace} kind={feature} onClose={() => setFeature(null)} /> : null}
        {production ? <WorkspaceRuntimeSettings key={`${workspace.workspaceId}:${workspace.resourceGeneration}`} model={model} workspace={workspace} /> : <section><h3>{t("ws.settings.runtime")}</h3><p>{t("ws.settings.runtimeLab")}</p></section>}
        <details><summary>{t("ws.settings.localData")}</summary><p className="wsd-root">{root}</p><p>{t("ws.settings.usage", { n: workspace.conversation.pastTaskCount, calls: workspace.conversation.usage.modelCalls })}</p></details></> : <p>{t("ws.space.note")}</p>}
    </ShellDialog> : null}
  </div></div></div>;
}
export default function WorkspaceLocalDev({ mode = "workspace" }: { mode?: "workspace" | "lab" }) {
  const { t } = useWorkspaceLocale();
  const [model, setModel] = useState<WorkspaceDevModel | null>(null), [error, setError] = useState<Key | null>(null), [root, setRoot] = useState(""), [reconnect, setReconnect] = useState(0);
  useEffect(() => {
    let active = true, client: WorkspaceDevConnectionClient | undefined;
    setError(null); setModel(null);
    void (async () => {
      const info = await invoke<WorkspaceDevConnection>(mode === "lab" ? "workspace_dev_connection" : "workspace_connection"); if (!active) return;
      client = new WorkspaceDevConnectionClient(info, () => { if (active) setError("ws.disconnected"); });
      await client.initialize(info.token); if (!active) { client.close(); return; }
      const next = new WorkspaceDevModel(client, undefined, info.syntheticOnly, info.executionMode); client.setChangedListener(id => { if (active && next.getSnapshot().workspaceId === id) void next.refresh(); });
      next.setSettingsFactory(async () => {
        let live = true; const settingsClient = new WorkspaceDevConnectionClient(info, () => {});
        try { await settingsClient.initialize(info.token); const settingsModel = new WorkspaceDevModel(settingsClient, undefined, info.syntheticOnly, info.executionMode, true);
          settingsClient.setChangedListener(id => { if (live && settingsModel.getSnapshot().workspaceId === id) void settingsModel.refresh(); });
          return { model: settingsModel, close() { live = false; settingsClient.close(); } };
        } catch { settingsClient.close(); throw new Error("Settings connection unavailable"); }
      });
      setRoot(info.root); setModel(next); await next.loadDirectory();
      const directory = next.getSnapshot().directory;
      if (active && directory?.activeWorkspaceId && directory.workspaces.some(row => row.workspaceId === directory.activeWorkspaceId && row.active)) await next.selectWorkspace(directory.activeWorkspaceId);
    })().catch(() => { if (active) setError(mode === "lab" ? "ws.boot.labFailed" : "ws.boot.failed"); });
    return () => { active = false; client?.close(); };
  }, [reconnect, mode]);
  if (!model) return <div className="hs wsd-boot"><HaraLogo size={48} /><h1>{mode === "lab" ? "Hara Workspace Lab" : "Hara"}</h1><p>{t(error ?? "ws.boot.connecting")}</p>{error ? <button className="hs-btn sec" onClick={() => setReconnect(value => value + 1)}>{t("ws.reconnect")}</button> : null}<small>{t(mode === "lab" ? "ws.lab.note" : "ws.boot.retained")}</small></div>;
  return <WorkspaceScreen model={model} disconnected={error ? t(error) : ""} root={root} mode={mode} onReconnect={() => setReconnect(value => value + 1)} />;
}
