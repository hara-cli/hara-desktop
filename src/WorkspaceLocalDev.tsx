import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatBubbleLeftRightIcon, CheckCircleIcon, Cog6ToothIcon, GlobeAltIcon,
  HashtagIcon, ViewColumnsIcon, MagnifyingGlassIcon, PencilSquareIcon, PlusIcon, UserPlusIcon, UsersIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { PaperAirplaneIcon, StopIcon } from "@heroicons/react/24/solid";
import HaraLogo from "./mark";
import { Md } from "./markdown";
import { makeT, type Key } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import type { WorkspaceDevConnection } from "./workspace-dev-rpc";
import { WorkspaceStartupModel } from "./workspace-startup";
import { WorkspaceBoot } from "./WorkspaceBoot";
import { WorkspaceTaskActivity, WorkspaceTaskRecovery } from "./WorkspaceTaskRecovery";
import { WorkspaceAsyncQuestions, WorkspaceUserQuestion } from "./WorkspaceUserQuestion";
import { WorkspaceDevModel, workspaceAsyncAsks, type WorkspaceDevMessage, type WorkspaceDevAgent, type WorkspaceDevApproval, type WorkspaceFeatureView } from "./workspace-dev-state";
import { parseColleagueScheduleRequest, type ColleagueScheduleDraft } from "./colleague-schedule.js";
import { useStableWorkspaceTheme } from "./WorkspaceSettingsPanels";
import { Avatar, AwaitBar, ColleaguesPage, ShellDialog, SidebarSection } from "./WorkspaceShell";
import { useSectionState, useWorkspaceLocale, useWorkspaceOverview, workspacePlatform } from "./workspace-shell-hooks";
import { conversationTimeline, messageContinues, normalizeShellRoute, pendingApprovals, transcriptBlocks, type AwaitItem } from "./workspace-shell-state";
import { captureWorkspaceReadingPosition } from "./workspace-chat-scroll";
import { colleagueUsageView } from "./workspace-account-usage";
import { WorkspaceLocalChannelsModel } from "./workspace-local-channels";
import { channelMemberLabel, LocalChannelComposer, LocalChannelDialog, LocalChannelRows, LocalChannelThread } from "./WorkspaceLocalChannels";
import "./workspace-entry.css";
import "./workspace-local-dev.css";
import "./workspace-theme.css";
import "./workspace-states.css";
import "./workspace-shell-layout.css";
import WorkspaceInspector, { WorkspaceOverview } from "./WorkspaceInspector";
import WorkspaceColleagueInspector from "./WorkspaceColleagueInspector";
import "./violet-tokens.css";
import "./violet-workspace.css";
import WorkspaceSettings, { type SettingsPage } from "./WorkspaceSettings";
import { useWorkspaceUpdater, WorkspaceUpdateNotice } from "./WorkspaceSoftwareUpdate";
const BrowserExtension = lazy(() => import("./WorkspaceBrowserExtension"));

type Translate = ReturnType<typeof makeT>;
const TOOL_LABELS: Record<string, Key> = Object.fromEntries(["task_intake", "task_checkpoint", "todo_write", "workspace_read", "workspace_write", "workspace_verify", "agent_list", "agent_create", "agent_contact"]
  .map(name => [name, `ws.execution.${name}` as Key]));
export function ApprovalCard({ card, model, t, disabled = false, onSettled, inDialog = false }: { card: WorkspaceDevApproval;
  model: { respond(card: WorkspaceDevApproval, approved: boolean): Promise<void>; getSnapshot(): { workspace: { approvals: WorkspaceDevApproval[] } | null } };
  t: Translate; disabled?: boolean; onSettled?: () => void; inDialog?: boolean }) {
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
type ApprovalSettleState = "declined" | "expired" | "aborted";
function parseAgentCreateSettle(content: string): { state: ApprovalSettleState; name?: string } | null {
  try {
    const value = JSON.parse(content) as { created?: unknown; approvalState?: unknown; agent?: { profile?: { displayName?: unknown } }; draft?: { displayName?: unknown }; displayName?: unknown };
    if (value?.created !== false) return null;
    const state = value.approvalState;
    if (state !== "declined" && state !== "expired" && state !== "aborted") return null;
    const name = [value.agent?.profile?.displayName, value.draft?.displayName, value.displayName].find(row => typeof row === "string" && row.trim()) as string | undefined;
    return { state, name };
  } catch { return null; }
}
function SettledApprovalCard({ state, name, t }: { state: ApprovalSettleState; name?: string; t: Translate }) {
  const label = name?.trim() || t("ws.approval.label");
  const copy = state === "declined" ? "ws.approval.settledDeclined" : state === "expired" ? "ws.approval.settledExpired" : "ws.approval.settledAborted";
  return <section className="hs-card wsd-approval wsd-approval-settled" role="status" aria-label={t("ws.approval.settledKicker")}>
    <div className="wsd-kicker">{t("ws.approval.settledKicker")}</div>
    <p>{t(copy, { name: label })}</p>
  </section>;
}
export function Transcript({ history, agent, t, detailed = false }: { history: WorkspaceDevMessage[]; agent?: WorkspaceDevAgent; t: Translate; detailed?: boolean }) {
  let previous: WorkspaceDevMessage | undefined;
  return <>{transcriptBlocks(history).map(item => {
    if (item.kind === "execution") {
      previous = undefined;
      const settled = item.results.flatMap(({ key, result }) => {
        if (result.name !== "agent_create" || result.isError) return [];
        const parsed = parseAgentCreateSettle(result.content);
        return parsed ? [{ key, ...parsed }] : [];
      });
      // Settled approval cards stay visible in brief mode (do not hide inside ops disclosure).
      const settledCards = settled.map(row => <div className="wsd-message-group" key={`settled-${row.key}`}><SettledApprovalCard state={row.state} name={row.name} t={t} /></div>);
      if (!detailed && !item.results.some(({ result }) => result.isError)) {
        return settledCards.length ? <div key={`settled-batch-${item.index}`}>{settledCards}</div> : null;
      }
      return <div className="wsd-message-group" key={`execution-${item.index}`}>
        {settledCards}
        <details className="wsd-execution" open={detailed || undefined}>
        <summary>{t(item.count === 1 ? "ws.execution.one" : "ws.execution.count", { n: item.count })}{" · "}<span>{t("ws.execution.details")}</span></summary>
        <div className="wsd-execution-body">{item.results.map(({ key, result }) => <div key={key}><strong>{TOOL_LABELS[result.name] ? t(TOOL_LABELS[result.name]) : result.name}</strong>
          <pre className={result.isError ? "is-error" : ""}>{result.content.slice(0, 5000)}</pre></div>)}</div></details></div>;
    }
    const { message, index } = item;
    const continuation = messageContinues(previous, message); previous = message;
    if (message.role === "user") return <div className={`hs-msg me wsd-message is-user ${continuation ? "cont" : ""}`} key={`user-${index}`}><div className="hs-bub wsd-bubble">{message.content}</div></div>;
    return <div className={`wsd-message-group ${continuation ? "cont" : ""}`} key={`assistant-${index}`}>
      {!continuation ? <div className="hs-who">{agent?.identity.displayName ?? "Hara"}</div> : null}
      <div className={`hs-msg wsd-message is-agent ${continuation ? "cont" : ""}`}><Avatar agent={agent} /><div className="hs-bub wsd-bubble"><Md text={message.text}
        copyCodeLabel={t("copyCode")} copiedLabel={t("taskCopied")} copyFailedLabel={t("copyFailed")} /></div></div>
    </div>;
  })}</>;
}
export function WorkspaceScreen({ model, disconnected, onReconnect, root, mode, onOpenBrowser }: { model: WorkspaceDevModel; disconnected: string; onReconnect: () => void; root: string;
  mode: "workspace" | "lab"; onOpenBrowser?: () => void }) {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const channels = useMemo(() => new WorkspaceLocalChannelsModel(model), [model]);
  const channelView = useSyncExternalStore(channels.subscribe, channels.getSnapshot, channels.getSnapshot);
  const [channelDialog, setChannelDialog] = useState<"create" | "members" | "invite" | null>(null);
  const channelApprovalActions = useMemo(() => ({ respond: (card: WorkspaceDevApproval, approved: boolean) => channels.respond(card, approved),
    getSnapshot: () => ({ workspace: { approvals: channels.getSnapshot().channel?.approvals ?? [] } }) }), [channels]);
  const { locale, t } = useWorkspaceLocale();
  const [settings, setSettingsState] = useState(false), [creating, setCreating] = useState(false), [name, setName] = useState(() => t("ws.space.default"));
  const [searching, setSearching] = useState(false), [search, setSearch] = useState("");
  const [route, setRoute] = useState(() => normalizeShellRoute(typeof location === "undefined" ? "" : location.hash));
  const [approvalDialog, setApprovalDialog] = useState<{ id: string; scope: string } | null>(null), [focusApproval, setFocusApproval] = useState<string | null>(null);
  const theme = useStableWorkspaceTheme(model);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("overview"), [browser, setBrowser] = useState(false);
  const [inspector, setInspector] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null), nearBottom = useRef(true), selectedRow = useRef<HTMLButtonElement>(null);
  const scroll = useRef<HTMLDivElement>(null), scrollContext = useRef("");
  const scrollResume = useRef<{ key: string; top: number; atBottom: boolean } | null>(null);
  const routedScope = useRef<string | null>(null);
  const channelRouteSelection = useRef<string | null>(null);
  const workspace = view.workspace, agents = workspace?.agents ?? view.roster, agent = agents.find(row => row.agentId === view.agentId);
  const colleagues = useMemo(() => agents.filter(row => row.kind === "colleague" && row.state !== "archived"), [agents]);
  const shell = useWorkspaceOverview(model, workspace), { sections, toggle } = useSectionState(view.workspaceId ?? "none");
  const scope = workspace ? JSON.stringify([workspace.workspaceId, workspace.resourceGeneration]) : "";
  const scheduleSupported = model.supportsColleagueSchedules?.() === true;
  const [features, setScheduleFeatures] = useState<WorkspaceFeatureView | null>(null);
  const [featuresError, setScheduleLoadError] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<{ id: string; scope: string; agentId: string; draft: ColleagueScheduleDraft } | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleNotice, setScheduleNotice] = useState<{ scope: string; agentId: string; name: string } | null>(null);
  const refreshFeatures = useCallback(async () => {
    try { const value = await model.workspaceRequest<WorkspaceFeatureView>("workspace.features.list"); setScheduleFeatures(value); setScheduleLoadError(""); return value; }
    catch (cause) { setScheduleLoadError(cause instanceof Error ? cause.message : String(cause)); return null; }
  }, [model]);
  useEffect(() => { setScheduleFeatures(null); setScheduleLoadError(""); if (scope && scheduleSupported) void refreshFeatures(); }, [scope, scheduleSupported, refreshFeatures]);
  const busy = Boolean(workspace && ["running", "draining"].includes(workspace.conversation.state));
  const hasConnection = Boolean(workspace?.connections.defaultConnectionId), realKey = view.directory?.executionMode === "ark-real-key", production = view.directory?.executionMode === "workspace";
  const colleagueLimit = Number.isSafeInteger(workspace?.colleagueLimit) && workspace!.colleagueLimit! > 0 ? workspace!.colleagueLimit : undefined;
  const accountUsage = new Map((workspace?.accountUsage ?? []).map(row => [row.agentId, row]));
  const selectedUsage = colleagueUsageView(accountUsage.get(view.agentId ?? ""));
  const updates = useWorkspaceUpdater(model, production);
  const inChannel = route.section === "channel";
  const showColleagueInspector = inspector && !browser && route.section === "chat" && agent?.kind === "colleague";
  const showContextInspector = inspector && !browser && route.section !== "chat";
  const selectedChannel = inChannel ? channelView.channel?.channel : undefined;
  const detailedChannel = theme.settings?.executionDetails === "detailed" && theme.settings?.collapseDetails === false;
  const renderChannelTranscript = useCallback((messages: WorkspaceDevMessage[], author?: WorkspaceDevAgent) => <Transcript history={messages} agent={author} t={t} detailed={detailedChannel} />, [t, detailedChannel]);
  const channelFollowing = useCallback((following: boolean) => { nearBottom.current = following; }, []);
  useEffect(() => { void channels.bind(workspace?.workspaceId ?? "", workspace?.resourceGeneration ?? ""); setChannelDialog(null); }, [channels, scope]);
  useEffect(() => { if (workspace) void channels.refresh(); }, [channels, workspace]);
  useEffect(() => {
    if (!scope || channelView.scope !== scope || !channelView.catalog) return;
    let next = route;
    if (routedScope.current !== scope) {
      const initial = routedScope.current === null; routedScope.current = scope;
      if (!initial || route.section === "chat") {
        const preferred = channels.preferredChannelId();
        if (preferred && channelView.catalog.channels.some(row => row.id === preferred)) next = { section: "channel", tab: "people", channelId: preferred };
        else if (!initial && route.section === "channel") next = { section: "chat", tab: "people" };
        if (next !== route) {
          setRoute(next);
          const hash = next.section === "channel" ? `#channels/${next.channelId}` : "";
          history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
        }
      }
    }
    if (next.section !== "channel" || !next.channelId || !channelView.catalog.channels.some(row => row.id === next.channelId)) { channelRouteSelection.current = null; return; }
    const selection = JSON.stringify([scope, next.channelId]);
    // Reconcile a route once. An accepted create may select its new room before onCreated updates the URL.
    if (channelRouteSelection.current === selection) return;
    channelRouteSelection.current = selection;
    if (channelView.channelId !== next.channelId) void channels.select(next.channelId);
  }, [channels, scope, route, channelView.scope, channelView.catalog, channelView.channelId]);
  useEffect(() => { if (!["running", "draining"].includes(channelView.channel?.state ?? "")) return;
    const timer = setInterval(() => { void channels.refresh(); }, 1000); return () => clearInterval(timer);
  }, [channels, channelView.channel?.state]);
  scrollContext.current = JSON.stringify([scope, view.agentId, route]);
  const setSettings = (open: boolean) => {
    if (open && scroll.current) scrollResume.current = { key: scrollContext.current, ...captureWorkspaceReadingPosition(scroll.current) };
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
  // One composer: a pending sync question takes the draft as its answer; a lone async ask takes it while the run continues.
  const question = workspace?.conversation.pendingQuestion ?? null;
  const asyncAsks = workspace && model.supportsAsyncQuestions?.() === true ? workspaceAsyncAsks(workspace.conversation) : [];
  const asyncTarget = busy && asyncAsks.length === 1 ? asyncAsks[0] : null;
  const canAnswerAsync = Boolean(asyncTarget && view.draft.trim() && !disconnected);
  const submitComposer = () => {
    if (asyncTarget) { if (canAnswerAsync) void model.answerAsync(asyncTarget.requestId, view.draft, true); }
    else if (canSend) {
      const draft = !question && scheduleSupported && agent?.kind === "colleague" ? parseColleagueScheduleRequest(view.draft) : null;
      if (draft && agent && scope) {
        setPendingSchedule({ id: crypto.randomUUID(), scope, agentId: agent.agentId, draft });
        setScheduleError(""); setScheduleNotice(null); model.setDraft(""); setInspector(true);
        return;
      }
      void (question ? model.answerDraft() : model.send());
    }
  };
  const confirmSchedule = async () => {
    const pending = pendingSchedule;
    if (!pending || scheduleBusy || !scheduleSupported || pending.scope !== scope || pending.agentId !== workspace?.selectedAgentId || agent?.kind !== "colleague") return;
    setScheduleBusy(true); setScheduleError("");
    try {
      const current = features ?? await refreshFeatures();
      if (!current) throw new Error(locale !== "en" ? "定时列表不可用，请重试。" : "Schedules are unavailable. Retry after refreshing.");
      const value = await model.workspaceRequest<WorkspaceFeatureView>("workspace.schedule.save", { input: {
        id: pending.id, name: pending.draft.name.trim(), schedule: { kind: "cron", expr: pending.draft.schedule.trim() },
        task: pending.draft.task.trim(), tz: pending.draft.tz.trim(), agentId: pending.agentId, enabled: true,
      }, expectedRevision: current.revision, approved: true });
      setScheduleFeatures(value); setPendingSchedule(null); setScheduleNotice({ scope, agentId: pending.agentId, name: pending.draft.name });
    } catch (cause) {
      const current = await refreshFeatures();
      if (current?.schedules.some((row) => row.id === pending.id && row.agentId === pending.agentId)) {
        setPendingSchedule(null); setScheduleNotice({ scope, agentId: pending.agentId, name: pending.draft.name });
      } else setScheduleError(cause instanceof Error ? cause.message : String(cause));
    } finally { setScheduleBusy(false); }
  };
  const updateColleagueSchedule = async (method: string, extra: Record<string, unknown>, ownerAgentId: string | undefined) => {
    const current = features;
    if (!current || !workspace || agent?.kind !== "colleague" || ownerAgentId !== agent.agentId) throw new Error("Colleague schedule context changed");
    const value = await model.workspaceRequest<WorkspaceFeatureView>(method, { ...extra, expectedRevision: current.revision });
    setScheduleFeatures(value); setScheduleLoadError("");
    if (method === "workspace.features.update") await refreshFeatures();
  };
  const navigate = (section: "chat" | "workspace" | "colleagues", tab: "people" | "tasks" = "people") => {
    channels.clearSelection();
    setRoute({ section, tab });
    const hash = section === "chat" ? "" : section === "workspace" ? "#workspace" : tab === "tasks" ? "#colleagues/tasks" : "#colleagues";
    history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  };
  const openChannel = (channelId: string) => {
    setRoute({ section: "channel", tab: "people", channelId });
    history.replaceState(null, "", `${location.pathname}${location.search}#channels/${channelId}`);
    if (channels.getSnapshot().channelId !== channelId) void channels.select(channelId);
  };
  useEffect(() => {
    const update = () => { const next = normalizeShellRoute(location.hash); if (next.section !== "channel") channels.clearSelection(); setRoute(next); };
    window.addEventListener("hashchange", update);
    if (/^#\/?tasks$/.test(location.hash)) history.replaceState(null, "", `${location.pathname}${location.search}#colleagues/tasks`);
    return () => window.removeEventListener("hashchange", update);
  }, [channels]);
  useEffect(() => { if (nearBottom.current && route.section === "chat") end.current?.scrollIntoView({ block: "end", behavior: "auto" }); }, [workspace?.conversation.history.length, workspace?.approvals.length, workspace?.conversation.pendingQuestion?.id, busy, route.section]);
  useEffect(() => { if (nearBottom.current && inChannel && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [channelView.channel?.messages.length, channelView.channel?.approvals.length, channelView.channel?.state, inChannel]);
  useEffect(() => { if (inChannel) { nearBottom.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; } }, [channelView.channelId, inChannel]);
  useEffect(() => { if (!busy) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [model, busy]);
  useEffect(() => { nearBottom.current = true; if (workspace?.selectedAgentId && route.section === "chat") input.current?.focus(); }, [workspace?.selectedAgentId, route.section]);
  useEffect(() => { if (agent?.kind === "colleague" && route.section === "chat") setInspector(true); }, [agent?.agentId, agent?.kind, route.section]);
  useLayoutEffect(() => { const node = input.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(160, Math.max(32, node.scrollHeight))}px`; }, [view.draft, workspace?.selectedAgentId, route.section, workspace?.conversation.pendingQuestion?.id]);
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
    await model.selectAgent(agentId);
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
  const closeSettings = () => { setSettings(false); };
  const modalOpen = settings || creating || !!channelDialog || approvalDialog?.scope === scope;
  const draftSkill = async (workspaceId: string) => {
    if (model.getSnapshot().workspaceId !== workspaceId) await model.selectWorkspace(workspaceId);
    const current = model.getSnapshot().workspace;
    if (current?.workspaceId !== workspaceId) return;
    const main = current.agents.find(row => row.kind === "main");
    if (main) await model.selectAgent(main.agentId);
    if (model.getSnapshot().workspaceId !== workspaceId) return;
    closeSettings(); navigate("chat"); model.setDraft(t("skillCreationPrompt"));
  };
  return <div className="hs wsd-app vg-app" lang={locale} data-platform={workspacePlatform()} data-workspace-mode={mode}><div className="hs-frame"><div className={`hs-win${browser ? " has-browser" : showColleagueInspector || showContextInspector ? " has-inspector" : ""}`}>
    <aside className="hs-side wsd-sidebar" inert={modalOpen}><div className="hs-titlebar-drag" data-tauri-drag-region="" aria-hidden="true" />
      <div className="hs-top"><HaraLogo size={20} /><select className="hs-space" aria-label={t("ws.space.switch")} value={view.workspaceId ?? ""} disabled={view.loading || !view.directory?.workspaces.length}
        onChange={event => { closeSettings(); setSearch(""); setApprovalDialog(null); navigate("chat"); void model.selectWorkspace(event.target.value); }}>
        <option value="" disabled>{t("ws.space.choose")}</option>{view.directory?.workspaces.map(row => <option value={row.workspaceId} key={row.workspaceId} disabled={!row.active}>{row.label}</option>)}
      </select><button className="hs-icon" aria-label={t("ws.search")} aria-expanded={searching} onClick={() => setSearching(value => !value)}><MagnifyingGlassIcon className="hico" /></button>
        <button className="hs-icon" aria-label={t("ws.space.new")} onClick={() => { setName(t("ws.space.default")); setCreating(true); }}><PlusIcon className="hico" /></button></div>
      {searching ? <input className="hs-search" type="search" aria-label={t("ws.search")} placeholder={t("ws.search.placeholder")} value={search} onChange={event => setSearch(event.target.value)} autoFocus /> : null}
      <div className="vg-roster-label">{locale !== "en" ? "Hara 同事" : "Hara colleagues"}</div>
      {view.workspaceId && agents.length ? <>
        {agents.filter(row => row.kind === "main").map(row => <button key={row.agentId} disabled={view.loading} className="hs-row hs-main wsd-contact is-main" aria-label={row.identity.displayName} title={row.identity.displayName} aria-current={route.section === "chat" && row.agentId === view.agentId ? "page" : undefined}
          onClick={() => void openAgent(row.agentId)}><Avatar agent={row} large /><span className="hs-txt"><strong className="hs-name"><span className="nm">{row.identity.displayName}</span><span className="hs-tag brand">{t("ws.main.tag")}</span></strong>
            <span className="pv">{t("ws.main.subtitle")}</span></span></button>)}
        <nav className="hs-sections" aria-label={t("ws.nav.aria")}>
          <SidebarSection id="dms" title={locale !== "en" ? "同事名册" : "Colleague roster"} expanded={sections.dms} onToggle={() => toggle("dms")} t={t} badge={unread} pending={shell.waiting.some(item => colleagues.some(row => row.agentId === item.agentId))}
            badgeLabel={t("ws.sec.unread", { n: unread })} icon={<ChatBubbleLeftRightIcon className="hico sec-ic" />}
            action={<button className="hs-sec-a" aria-label={t("ws.sec.newDm")} onClick={() => navigate("colleagues")} disabled={view.loading}><PencilSquareIcon className="hico" /></button>}>
            {dmRows.filter(row => !search || `${row.agent.identity.displayName} ${row.agent.identity.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <button className="hs-row hs-dm wsd-contact" aria-label={row.agent.identity.displayName} title={row.agent.identity.displayName} disabled={view.loading} key={row.agent.agentId}
              ref={row.agent.agentId === view.agentId ? selectedRow : undefined} aria-current={route.section === "chat" && row.agent.agentId === view.agentId ? "page" : undefined} onClick={() => void openAgent(row.agent.agentId)}>
              <Avatar agent={row.agent} /><span className="hs-txt"><strong className="hs-name"><span className="nm">{row.agent.identity.displayName}</span>{row.agent.identity.title ? <span className="hs-tag">{row.agent.identity.title}</span> : null}</strong><span className="pv">{row.preview}</span></span>
              <span className={`hs-usage-chip ${colleagueUsageView(accountUsage.get(row.agent.agentId)).state}`}
                title={colleagueUsageView(accountUsage.get(row.agent.agentId)).label}>
                {colleagueUsageView(accountUsage.get(row.agent.agentId)).label}
              </span>
              <span className="hs-meta">{row.timestamp && Number.isFinite(Date.parse(row.timestamp)) ? <time className="hs-time" dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time> : null}
                {(shell.activity[row.agent.agentId]?.unread ?? 0) > 0 ? <span className="hs-dot" role="img" aria-label={t("ws.unread", { n: shell.activity[row.agent.agentId].unread })} /> : null}</span></button>)}
            {!colleagues.length ? <p className="hs-empty">{t("ws.dm.empty")}</p> : searching && search && !dmRows.some(row => `${row.agent.identity.displayName} ${row.agent.identity.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ? <p className="hs-empty">{t("ws.search.empty")}</p> : null}
            <button className="hs-row hs-add" aria-label={t("ws.colleagues.discuss")} disabled={view.loading} onClick={() => void discuss()}><UserPlusIcon className="hico" />{t("ws.colleagues.discuss")}</button>
          </SidebarSection>
          <SidebarSection id="channels" title={t("ws.sec.channels")} expanded={sections.channels} onToggle={() => toggle("channels")} t={t} icon={<HashtagIcon className="hico sec-ic" />}
            action={<button className="hs-sec-a" aria-label={t("ws.channels.new")} disabled={!channelView.supported || view.loading || !!disconnected} onClick={() => setChannelDialog("create")}><PlusIcon className="hico" /></button>}>
            <LocalChannelRows view={channelView} t={t} search={search} selected={inChannel ? channelView.channelId : null} onOpen={openChannel} />
            {channelView.supported && !channelView.catalog?.channels.length ? <button className="hs-row hs-add" onClick={() => setChannelDialog("create")} disabled={view.loading || !!disconnected}><PlusIcon className="hico" />{t("ws.channels.new")}</button> : null}
          </SidebarSection>

        </nav>
      </> : <p className="wsd-sidebar-note">{t("ws.space.note")}</p>}
      <footer className="hs-foot"><div className="hs-quota" title={t("ws.quota.note")}><UsersIcon className="hico" /><span>{colleagueLimit ? t("ws.quota.count", { n: colleagues.length, max: colleagueLimit }) : t("ws.quota.current", { n: colleagues.length })}</span>{colleagueLimit ? <i aria-hidden="true"><b style={{ width: `${Math.min(100, colleagues.length / colleagueLimit * 100)}%` }} /></i> : null}</div>
        <div className="hs-row hs-me"><span className="hs-ava" aria-hidden="true">{t("ws.me").slice(0, 1)}</span><span className="grow">{t("ws.me")}</span><button className="hs-set" aria-label={t("ws.settings")} onClick={() => setSettings(true)}><Cog6ToothIcon className="hico" />{t("ws.settings")}</button></div></footer>
    </aside>
    <main className="hs-chat wsd-chat" inert={modalOpen}>
      <header className="hs-head wsd-header">{inChannel ? <span className="hs-ava" aria-hidden="true"><HashtagIcon className="hico" /></span> : <Avatar agent={agent} />}<div className="hs-header-person"><strong>{route.section === "workspace" ? t("vg.workspace") : inChannel ? selectedChannel?.name ?? t("ws.channels.local") : route.section === "colleagues" ? t("ws.nav.colleagues") : agent?.identity.displayName ?? "Hara"}</strong>
        <small>{inChannel ? channelMemberLabel(t, selectedChannel?.memberIds.length ?? 0) : agent ? t(agent.runtime.id === "pi" ? "ws.header.runtime" : "ws.header.otherRuntime", { role: agent.kind === "main" ? t("ws.main.tag") : agent.identity.title ?? t("ws.role.colleague"), runtime: agent.runtime.label }) : t("ws.welcome.title")}</small></div><span className="sp" />
        {inChannel ? <div className="hs-channel-header-actions"><button className="hs-ghost" aria-label={t("ws.channels.members")} onClick={() => setChannelDialog("members")} disabled={!selectedChannel || !!disconnected || ["running", "draining"].includes(channelView.channel?.state ?? "")}><UsersIcon className="hico" />{t("ws.channels.members")}</button>
          <button className="hs-ghost" aria-label={t("ws.channels.invite")} onClick={() => setChannelDialog("invite")}><UserPlusIcon className="hico" />{t("ws.channels.invite")}</button></div> : null}
        {!inChannel && workspace && route.section === "chat" ? <button className="hs-ghost" aria-label={t("ws.resume.dismiss")} title={t("ws.resume.dismiss")} data-clear-chat="true" onClick={() => model.clearConversationResume()} disabled={Boolean(disconnected) || view.sending || busy}>{t("ws.resume.dismiss")}</button> : null}
        {<button className="hs-ghost" aria-label={t("ws.header.browser")} title={t("ws.header.browser")} aria-expanded={browser} aria-controls="workspace-browser-panel" onClick={() => { setBrowser(value => !value); onOpenBrowser?.(); }} disabled={!workspace}><GlobeAltIcon className="hico" />{t("ws.header.browser")}</button>}
        {agent?.kind === "colleague" || route.section !== "chat" ? <button className="hs-icon" aria-label={t(inspector && !browser ? "vg.inspector.close" : "vg.inspector.open")} aria-expanded={inspector && !browser} aria-controls="workspace-inspector" onClick={() => { if (browser) { setBrowser(false); setInspector(true); } else setInspector(value => !value); }}><ViewColumnsIcon className="hico" /></button> : null}
        <button className="hs-icon" aria-label={t("ws.settings")} onClick={() => setSettings(true)}><Cog6ToothIcon className="hico" /></button></header>
      {disconnected ? <div className="wsd-notice" role="alert">{t("ws.disconnected")}<button className="hs-btn sec" onClick={onReconnect}>{t("ws.reconnect")}</button></div> : null}
      {view.error ? <div className="wsd-notice is-error" role="alert">{workspaceMessageText(t, view.error)}</div> : null}
      {view.syncNotice ? <div className="wsd-notice" role="status">{workspaceMessageText(t, view.syncNotice)}</div> : null}
      {agent?.kind === "colleague" && !inChannel && selectedUsage.notice ? <div className="wsd-notice hs-usage-attention" role="status">{selectedUsage.notice}</div> : null}
      {shell.incomplete && agent?.kind !== "main" && !inChannel ? <div className="wsd-notice" role="status" data-overview-incomplete>{t("ws.tasks.unavailable")}<button className="hs-btn sec" onClick={shell.refresh}>{t("ws.tasks.retry")}</button></div> : null}
      <div ref={scroll} className="hs-scroll wsd-scroll" onScroll={event => { const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.scrollTop - area.clientHeight < 180; }}>
        {route.section === "workspace" && workspace ? <WorkspaceOverview shell={shell} agents={colleagues} t={t} onOpen={id => void openAgent(id)} />
          : inChannel && workspace ? <LocalChannelThread key={`${scope}:${channelView.channelId}`} view={channelView} colleagues={agents} t={t} retry={() => { if (route.channelId) void channels.select(route.channelId); }}
          transcript={renderChannelTranscript} model={channels} disabled={Boolean(disconnected)} scrollRoot={scroll} onFollowChange={channelFollowing} onRepair={() => { setSettingsPage("connections"); setSettings(true); }}
          approval={card => <ApprovalCard card={card} model={channelApprovalActions} t={t} disabled={!!disconnected} />} />
          : route.section === "colleagues" && workspace ? <ColleaguesPage shell={shell} agents={colleagues} tab={route.tab} setTab={tab => navigate("colleagues", tab)} t={t} openAgent={id => void openAgent(id)} openItem={item => openItem(item)} discuss={() => void discuss()} />
          : !workspace && view.loading && view.workspaceId ? <p role="status">{t("common.loading")}</p> : !workspace ? <section className="wsd-welcome"><HaraLogo size={48} /><h1>{t("ws.welcome.title")}</h1><p>{t("ws.welcome.body")}</p>
            <button className="hs-btn pri" onClick={() => setCreating(true)} disabled={view.loading}>{t("ws.welcome.create")}</button><small>{t(production ? "ws.welcome.note" : "ws.lab.note")}</small></section>
          : <div className="hs-col wsd-thread">
            {agent?.kind === "main" ? <AwaitBar shell={shell} t={t} onOpen={item => openItem(item)} onApprove={item => openItem(item, true)} onAll={() => navigate("colleagues", "tasks")} /> : null}
            {!hasConnection ? <section className="wsd-connect-card"><h2>{t("ws.connection.title")}</h2><p>{t(production ? "ws.connection.body" : realKey ? "ws.lab.real" : "ws.lab.synthetic")}</p>
              <button className="hs-btn pri" onClick={() => void connect()}>{t(production ? "ws.connection.configure" : realKey ? "ws.connection.approved" : "ws.connection.synthetic")}</button></section> : null}
            {hasConnection && !workspace.conversation.history.length ? <div className="hs-hello"><h2>{t("ws.home.title")}</h2><p>{t("ws.home.hint")}</p><div className="hs-chips"><button className="hs-chip" onClick={() => void discuss()}><UserPlusIcon className="hico" />{t("ws.home.chip.colleague")}</button>
              <button className="hs-chip" onClick={() => model.setDraft(t("ws.home.chip.tasks"))}>{t("ws.home.chip.tasks")}</button></div></div> : null}
            <Transcript history={workspace.conversation.history} agent={agent} t={t} detailed={theme.settings?.executionDetails === "detailed" && theme.settings?.collapseDetails === false} />
            {pendingSchedule?.scope === scope && pendingSchedule.agentId === agent?.agentId ? <section className="vg-chat-schedule-card" aria-label={locale !== "en" ? "确认定时" : "Confirm schedule"}>
              <header><strong>{locale !== "en" ? "确认定时" : "Confirm schedule"}</strong><small>{locale !== "en" ? "挂接同事" : "Colleague"} · {agent.identity.displayName}</small></header>
              <label>{locale !== "en" ? "名称" : "Name"}<input maxLength={60} value={pendingSchedule.draft.name} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, name: event.target.value } })} /></label>
              <label>{locale !== "en" ? "节奏（Cron）" : "Schedule (Cron)"}<input value={pendingSchedule.draft.schedule} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, schedule: event.target.value } })} /></label>
              <label>{locale !== "en" ? "时区" : "Time zone"}<input value={pendingSchedule.draft.tz} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, tz: event.target.value } })} /></label>
              <label>{locale !== "en" ? "指令摘要" : "Instruction"}<textarea rows={3} value={pendingSchedule.draft.task} disabled={scheduleBusy} onChange={(event) => setPendingSchedule({ ...pendingSchedule, draft: { ...pendingSchedule.draft, task: event.target.value } })} /></label>
              {scheduleError ? <p role="alert">{scheduleError}</p> : null}
              <div className="vg-chat-schedule-actions"><button disabled={scheduleBusy || !pendingSchedule.draft.name.trim() || !pendingSchedule.draft.schedule.trim() || !pendingSchedule.draft.task.trim()} onClick={() => void confirmSchedule()}>{scheduleBusy ? (locale !== "en" ? "正在创建…" : "Creating…") : (locale !== "en" ? "确认创建" : "Create schedule")}</button><button disabled={scheduleBusy} onClick={() => { model.setDraft(pendingSchedule.draft.task); setPendingSchedule(null); setScheduleError(""); }}>{locale !== "en" ? "取消" : "Cancel"}</button></div>
            </section> : null}
            {scheduleNotice?.scope === scope && scheduleNotice.agentId === agent?.agentId && !pendingSchedule ? <p className="vg-schedule-notice" role="status">{locale !== "en" ? `已为这位同事创建定时：${scheduleNotice.name}。右侧可管理。` : `Created for this colleague: ${scheduleNotice.name}. Manage it on the right.`}</p> : null}
            {liveApprovals.map(card => <ApprovalCard key={card.id} card={card} model={model} t={t} disabled={Boolean(disconnected)} />)}
            {workspace.conversation.completion?.state === "verified" && workspace.conversation.taskState === "completed" ? <p className="wsd-verified"><CheckCircleIcon className="hico" />{t("ws.verified")} <span>{t("ws.verified.note")}</span></p> : null}
            <WorkspaceTaskRecovery conversation={workspace.conversation} t={t} disabled={Boolean(disconnected) || view.sending || view.pendingUnknown}
              continueDisabled={!hasConnection || busy} dismissedIdentity={view.dismissedRecoveryIdentity}
              onContinue={() => void model.send(true)} onRepair={() => { setSettingsPage("connections");setSettings(true); }}
              onDismiss={() => model.dismissRecovery()} />
            {question ? <WorkspaceUserQuestion key={`${scope}:${question.id}`} conversation={workspace.conversation} t={t}
              disabled={Boolean(disconnected) || view.sending || view.pendingUnknown} supported={model.supportsUserQuestions?.() === true}
              onAnswer={(questionId, answer) => void model.answer(questionId, answer)} onPause={questionId => void model.pauseQuestion(questionId)} onRepair={() => { setSettingsPage("connections"); setSettings(true); }} /> : null}
            {!liveApprovals.length ? <WorkspaceTaskActivity conversation={workspace.conversation} name={agent?.identity.displayName ?? "Hara"} t={t}><Avatar agent={agent} /></WorkspaceTaskActivity> : null}<div ref={end} />
          </div>}
      </div>
      {workspace && inChannel ? <LocalChannelComposer key={`${scope}:${channelView.channelId}`} view={channelView} model={channels} colleagues={colleagues} t={t} disconnected={!!disconnected} hasConnection={hasConnection} configure={() => void connect()} /> : null}
      {workspace && route.section === "chat" ? <footer className="hs-compose wsd-composer-wrap" data-composer={question ? "question" : undefined}><WorkspaceAsyncQuestions asks={asyncAsks} t={t}
          disabled={Boolean(disconnected)} onAnswer={(questionId, answer) => void model.answerAsync(questionId, answer)} /><div className="hs-field wsd-composer"><textarea ref={input} aria-label={t("ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" })} value={view.draft}
        placeholder={!hasConnection ? t("ws.composer.noConnection") : t(question ? "ws.question.composerPlaceholder" : "ws.composer.placeholder", { name: agent?.identity.displayName ?? "Hara" })} disabled={!hasConnection || Boolean(disconnected)} rows={1}
        onChange={event => model.setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitComposer(); } }} />
        <span className="hs-conn">{t("ws.composer.connection")}</span>{busy ? <button className="hs-stop" onClick={() => void model.cancel()} disabled={Boolean(disconnected) || workspace.conversation.state === "draining"}><StopIcon className="hico" />{t("ws.composer.stop")}</button>
          : view.pendingUnknown ? <button className="hs-btn sec" onClick={() => void model.verifyPending()} disabled={Boolean(disconnected)}>{t("ws.composer.verify")}</button> : <button className="hs-send wsd-send" onClick={submitComposer} disabled={!canSend} aria-label={t("ws.composer.send")}><PaperAirplaneIcon className="hico" /></button>}
          {asyncTarget ? <button className="hs-send wsd-send" onClick={submitComposer} disabled={!canAnswerAsync} aria-label={t("ws.question.async.send")}><PaperAirplaneIcon className="hico" /></button> : null}</div>
        <p className="hs-hint"><span>{question ? t("ws.question.composerHint") : t(production ? "ws.composer.hint.local" : realKey ? "ws.lab.real" : "ws.lab.synthetic")}</span><span>{t("ws.composer.hint.keys")}</span></p></footer> : null}
    </main>
    {showColleagueInspector && agent ? <WorkspaceColleagueInspector key={agent.agentId} agent={agent} features={features} supported={scheduleSupported} locale={locale} error={featuresError} inert={Boolean(modalOpen)} onClose={() => setInspector(false)} onRefresh={() => void refreshFeatures()}
      onToggle={(schedule) => updateColleagueSchedule("workspace.features.update", { kind: "schedule", id: schedule.id, enabled: !schedule.enabled }, schedule.agentId)}
      onSave={(schedule, values) => updateColleagueSchedule("workspace.schedule.save", { input: { id: schedule.id, name: values.name.trim(), schedule: { kind: "cron", expr: values.cron.trim() }, tz: values.tz.trim(), task: values.task.trim(), agentId: agent.agentId, enabled: schedule.enabled }, approved: true }, schedule.agentId)}
      onDelete={(schedule) => updateColleagueSchedule("workspace.schedule.delete", { id: schedule.id, approved: true }, schedule.agentId)} />
      : showContextInspector ? <WorkspaceInspector workspace={inChannel ? null : workspace} agent={inChannel ? undefined : agent} shell={shell} t={t} inert={Boolean(modalOpen)} onClose={() => setInspector(false)} onAttention={() => { if (shell.waiting[0]) openItem(shell.waiting[0]); }} /> : null}
    {browser && workspace ? <Suspense fallback={<aside id="workspace-browser-panel" className="hs-browser" role="status">{t("common.loading")}</aside>}><BrowserExtension key={scope} label={workspace.label} locale={locale} inert={Boolean(modalOpen)} onClose={() => setBrowser(false)} /></Suspense> : null}
    <footer className="vg-statusbar" inert={Boolean(modalOpen)}><span className={`vg-connection-dot${disconnected ? " offline" : ""}`} aria-hidden />{t(disconnected ? "vg.disconnected" : "vg.connected")}<span>·</span>{workspace?.label ?? t("vg.workspace")}<span>·</span>{shell.waiting.length} {t("vg.pending")}</footer>
    {production ? <WorkspaceUpdateNotice controller={updates.controller} onView={() => { setSettingsPage("updates"); setSettings(true); }} /> : null}
    {creating ? <ShellDialog label={t("ws.space.new")} onClose={() => setCreating(false)}><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setCreating(false)}><XMarkIcon className="hico" /></button>
      <h2>{t("ws.create.title")}</h2><p>{t("ws.create.body")}</p><label>{t("ws.create.name")}<input aria-label={t("ws.create.name")} value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) void create(); }} /></label>
      <button className="hs-btn pri" onClick={() => void create()} disabled={view.loading || !name.trim()}>{t("ws.space.new")}</button></ShellDialog> : null}
    {channelDialog ? <LocalChannelDialog key={`${scope}:${channelDialog}:${channelView.channelId}`} mode={channelDialog} view={channelView} model={channels} colleagues={colleagues} t={t} onClose={() => setChannelDialog(null)} onCreated={openChannel} /> : null}
    {approvalDialog?.scope === scope ? <ShellDialog label={t("ws.approval.label")} onClose={() => setApprovalDialog(null)} className="wsd-approval-dialog"><button className="hs-icon wsd-close" aria-label={t("ws.close")} onClick={() => setApprovalDialog(null)}><XMarkIcon className="hico" /></button>
      {dialogCard ? <ApprovalCard card={dialogCard} model={model} t={t} inDialog disabled={Boolean(disconnected)} onSettled={() => setApprovalDialog(null)} /> : <p role="status">{t("ws.approval.stale")}</p>}</ShellDialog> : null}
    {settings ? <WorkspaceSettings key={`settings:${view.workspaceId}`} mainModel={model} initialPage={settingsPage} root={root} production={production} theme={theme} updater={updates.controller} versionInfo={updates.info}
      onClose={closeSettings} onCreateSkill={id => void draftSkill(id)} /> : null}
  </div></div></div>;
}
export default function WorkspaceLocalDev({ mode = "workspace" }: { mode?: "workspace" | "lab" }) {
  const { t } = useWorkspaceLocale();
  const startup = useMemo(() => new WorkspaceStartupModel(() => invoke<WorkspaceDevConnection>(mode === "lab" ? "workspace_dev_connection" : "workspace_connection")), [mode]);
  const view = useSyncExternalStore(startup.subscribe, startup.getSnapshot, startup.getSnapshot);
  useEffect(() => { void startup.start();return () => startup.stop(); }, [startup]);
  if (!view.model) return <WorkspaceBoot view={view} t={t} mode={mode} onReconnect={() => void startup.start()} />;
  return <WorkspaceScreen model={view.model} disconnected={view.phase === "disconnected" ? t("ws.disconnected") : ""} root={view.root} mode={mode} onReconnect={() => void startup.start()} />;
}
