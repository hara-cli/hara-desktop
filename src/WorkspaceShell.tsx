import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRightIcon, ClipboardDocumentCheckIcon, InboxStackIcon, UsersIcon } from "@heroicons/react/24/outline";
import HaraLogo from "./mark";
import type { makeT } from "./i18n";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import type { AwaitItem, SidebarSectionId, TaskGroup } from "./workspace-shell-state";
import type { useWorkspaceOverview } from "./workspace-shell-hooks";
type Translate = ReturnType<typeof makeT>;
export type ShellOverview = ReturnType<typeof useWorkspaceOverview>;

const avatarColors = ["#496d59", "#475f88", "#6b5848", "#725780", "#3d7178", "#8c4b5d"];
export function Avatar({ agent, large = false }: { agent?: WorkspaceDevAgent; large?: boolean }) {
  const tone = [...(agent?.agentId ?? "")].reduce((value, character) => value + character.charCodeAt(0), 0) % avatarColors.length;
  return <span aria-hidden="true" className={`hs-ava wsd-avatar ${agent?.kind === "main" ? "hara is-main" : ""} ${large ? "lg is-large" : ""}`}
    style={agent?.kind === "main" ? undefined : { background: avatarColors[tone] }}>
    {agent?.kind === "main" ? <HaraLogo size={large ? 28 : 24} /> : agent?.identity.displayName.slice(0, 1) ?? "H"}
  </span>;
}
export function SidebarSection({ id, title, expanded, onToggle, badge = 0, badgeLabel, pending = false, icon, action, children, t }:
  { id: SidebarSectionId; title: string; expanded: boolean; onToggle: () => void; badge?: number; badgeLabel?: string; pending?: boolean;
    icon: ReactNode; action?: ReactNode; children: ReactNode; t: Translate }) {
  const label = `${t("ws.sec.toggle", { name: title, state: t(expanded ? "ws.sec.expanded" : "ws.sec.collapsed") })}${badge ? `, ${badgeLabel}` : ""}`;
  return <section className={`hs-sec ${expanded ? "" : "closed"}`} aria-label={title}>
    <div className="hs-sec-h"><button className="hs-sec-t" aria-label={label} aria-expanded={expanded} aria-controls={`sec-${id}`} onClick={onToggle}>
      <span className="hs-chev"><ChevronRightIcon className="hico" /></span>{icon}<span className="grow">{title}</span>
      {badge > 0 ? <span className={`hs-sec-n ${pending ? "pending" : ""}`} data-nav-count={id === "colleagues" ? true : undefined} aria-hidden="true">{badge}</span> : null}</button>{action}</div>
    <div className="hs-sec-b" id={`sec-${id}`} inert={!expanded} aria-hidden={!expanded}><div>{children}</div></div>
  </section>;
}
export function ShellDialog({ label, children, onClose, className = "" }: { label: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>("[autofocus],button,input,select,textarea") ?? ref.current)?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="wsd-modal-backdrop"><section ref={ref} className={`wsd-modal ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>{children}</section></div>;
}
export function AwaitBar({ shell, t, onOpen, onApprove, onAll }: { shell: ShellOverview; t: Translate; onOpen: (item: AwaitItem) => void; onApprove: (item: AwaitItem) => void; onAll: () => void }) {
  if (!shell.homeAwaitBar.count && !shell.incomplete && !shell.loading) return null;
  const kindLabel = (item: AwaitItem) => t(item.kind === "approval" ? "ws.await.kind.approval" : item.kind === "review" ? "ws.await.kind.review" : item.kind === "reply" ? "ws.await.kind.reply" : "ws.tasks.status.blocked");
  const title = (item: AwaitItem) => {
    const owner = shell.snapshots[0]?.agents.find(agent => agent.agentId === item.agentId)?.identity.displayName;
    const text = item.kind === "approval" ? t("ws.approval.summary", { name: item.title }) : item.title || t("ws.tasks.untitled");
    return owner ? `${owner} · ${text}` : text;
  };
  return <section className="hs-await" aria-label={t("ws.await.title")}>
    <div className="hs-await-h"><InboxStackIcon className="hico" /><span>{t("ws.await.title")}</span><span className="hs-badge" data-await-count>{shell.homeAwaitBar.count}</span>
      <button className="hs-await-all" onClick={onAll}>{t("ws.await.all")}<ChevronRightIcon className="hico" /></button></div>
    {shell.loading ? <p className="hs-overview-notice" role="status">{t("common.loading")}</p> : null}
    {shell.incomplete ? <p className="hs-overview-notice" role="status">{t("ws.tasks.unavailable")} <button onClick={shell.refresh}>{t("ws.tasks.retry")}</button></p> : null}
    {shell.homeAwaitBar.items.map(item => item.highPriority && item.approval ? <div className="hs-ai" key={item.id} data-approval-id={item.id}>
      <span className="k ap">{kindLabel(item)}</span><span className="t" title={title(item)}>{title(item)}</span>
      <button className="hs-btn sec" onClick={() => onOpen(item)} aria-label={`${t("ws.await.open")}: ${title(item)}`}>{t("ws.await.open")}</button>
      <button className="hs-btn pri" onClick={() => onApprove(item)} aria-label={`${t("ws.await.approve")}: ${title(item)}`}>{t("ws.await.approve")}</button>
    </div> : <button className="hs-ai go" key={item.id} onClick={() => onOpen(item)}>
      <span className={`k ${item.kind === "approval" ? "ap" : "rv"}`}>{kindLabel(item)}</span><span className="t">{title(item)}</span><ChevronRightIcon className="hico chev-go" /></button>)}
  </section>;
}
export function ColleaguesPage({ shell, agents, tab, setTab, t, openAgent, openItem, discuss }: { shell: ShellOverview; agents: WorkspaceDevAgent[]; tab: "people" | "tasks";
  setTab: (value: "people" | "tasks") => void; t: Translate; openAgent: (id: string) => void; openItem: (item: AwaitItem) => void; discuss: () => void }) {
  const groups: TaskGroup[] = ["needsYou", "working", "waiting", "closed"];
  return <section className="wsd-directory">
    <div className="hs-tabs" role="tablist" aria-label={t("ws.nav.colleagues")} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? "people" : event.key === "End" ? "tasks" : tab === "people" ? "tasks" : "people";
      setTab(next); document.getElementById(`ws-tab-${next}`)?.focus();
    }}>
      <button id="ws-tab-people" className="hs-tab" role="tab" aria-controls="ws-panel-people" aria-selected={tab === "people"} tabIndex={tab === "people" ? 0 : -1} onClick={() => setTab("people")}>
        <UsersIcon className="hico" />{t("ws.colleagues.tab.people")}</button>
      <button id="ws-tab-tasks" className="hs-tab" role="tab" aria-controls="ws-panel-tasks" aria-selected={tab === "tasks"} tabIndex={tab === "tasks" ? 0 : -1} onClick={() => setTab("tasks")}>
        <ClipboardDocumentCheckIcon className="hico" />{t("ws.colleagues.tab.tasks")}<span className="hs-badge" data-tasks-count aria-label={t("ws.sec.pending", { n: shell.tasksTabBadge })}>{shell.tasksTabBadge}</span></button>
    </div>
    <div role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`} tabIndex={0} className="hs-tab-panel">
      {tab === "people" ? <><header className="hs-directory-head"><h2>{t("ws.colleagues.title")}</h2><button className="hs-btn pri" onClick={discuss}>{t("ws.colleagues.discuss")}</button></header>
        {!agents.length ? <p>{t("ws.dm.empty")}</p> : agents.map(agent => <button className="hs-row wsd-directory-person" key={agent.agentId} onClick={() => openAgent(agent.agentId)}><Avatar agent={agent} />
          <span className="hs-txt"><strong className="hs-name">{agent.identity.displayName}</strong><span className="pv">{agent.identity.title ?? t("ws.role.colleague")}</span></span><ChevronRightIcon className="hico" /></button>)}</>
        : <><p className="hs-tasks-intro">{t("ws.tasks.intro")}</p><p className="hs-data-note">{t("ws.tasks.currentOnly")}</p>
          {shell.loading ? <p role="status">{t("common.loading")}</p> : null}
          {shell.incomplete ? <p role="status">{t("ws.tasks.unavailable")} <button className="hs-btn sec" onClick={shell.refresh}>{t("ws.tasks.retry")}</button></p> : null}
          {!shell.tasks.length && !shell.waiting.length && !shell.loading && !shell.incomplete ? <p>{t("ws.tasks.empty")}</p> : null}
          {groups.map(group => {
            const approvals = group === "needsYou" ? shell.waiting.filter(item => item.approval) : [];
            const tasks = shell.tasks.filter(task => task.group === group && task.status !== "pending");
            if (!approvals.length && !tasks.length) return null;
            return <section key={group} aria-label={t(`ws.tasks.group.${group}`)}><h3 className="hs-grp">{t(`ws.tasks.group.${group}`)}<span>{approvals.length + tasks.length}</span></h3>
              {approvals.map(item => <article key={item.id} className="hs-task" data-approval-id={item.id}><span className="hs-st need">{t("ws.await.kind.approval")}</span><span className="t"><b>{t("ws.approval.summary", { name: item.title })}</b></span>
                <button className="hs-btn sec" onClick={() => openItem(item)}>{t("ws.tasks.openConversation")}<ChevronRightIcon className="hico" /></button></article>)}
              {tasks.map(task => <article className="hs-task" key={task.id}><span className={`hs-st ${group === "needsYou" ? "need" : ""}`}>{t(`ws.tasks.status.${task.status}`)}</span>
                <span className="t"><b>{task.title || t("ws.tasks.untitled")}</b><span>{shell.snapshots[0]?.agents.find(agent => agent.agentId === task.agentId)?.identity.displayName ?? t("ws.role.colleague")}</span></span>
                <button className="hs-btn sec" onClick={() => openAgent(task.agentId)}>{t("ws.tasks.openConversation")}<ChevronRightIcon className="hico" /></button></article>)}</section>;
          })}</>}
    </div>
  </section>;
}
