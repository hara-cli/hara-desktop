import { XMarkIcon, CheckCircleIcon, ClockIcon, CommandLineIcon } from "@heroicons/react/24/outline";
import { Avatar, type ShellOverview } from "./WorkspaceShell";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot } from "./workspace-dev-state";
import type { makeT } from "./i18n";
import { taskStatus } from "./workspace-shell-state";
type Translate = ReturnType<typeof makeT>;

export function WorkspaceOverview({ shell, agents, t, onOpen }: { shell: ShellOverview; agents: WorkspaceDevAgent[]; t: Translate; onOpen(id: string): void }) {
  const running = shell.snapshots.filter(row => ["running", "draining"].includes(row.conversation.state));
  const metrics = [[t("vg.colleagues"), agents.length], [t("vg.running"), running.length], [t("vg.pending"), shell.waiting.length],
    [t("vg.completed"), shell.tasks.filter(row => row.status === "completed").length]];
  return <section className="vg-overview" aria-label={t("vg.overview")}>
    <div className="vg-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    {shell.incomplete ? <p role="status">{t("vg.partial")} <button onClick={shell.refresh}>{t("ws.tasks.retry")}</button></p> : null}
    <h2>{t("vg.active")}</h2><div className="vg-agent-grid">{agents.map(agent => {
      const snapshot = shell.snapshots.find(row => row.selectedAgentId === agent.agentId);
      const attention = shell.waiting.some(row => row.agentId === agent.agentId);
      const active = snapshot && ["running", "draining"].includes(snapshot.conversation.state);
      return <button className="vg-agent-card" key={agent.agentId} onClick={() => onOpen(agent.agentId)}>
        <Avatar agent={agent} large /><strong>{agent.identity.displayName}</strong>
        <span className={`vg-status ${attention ? "approval" : active ? "running" : "idle"}`}><span aria-hidden>{attention ? "!" : active ? "↻" : "·"}</span>{t(attention ? "vg.approval" : active ? "vg.running" : "vg.idle")}</span>
        <p>{snapshot?.conversation.objective || agent.identity.title || t("ws.role.colleague")}</p><small>{t("vg.view")} ↗</small>
      </button>;
    })}</div>{!agents.length ? <p>{t("vg.noColleagues")}</p> : null}
  </section>;
}

export default function WorkspaceInspector({ workspace, agent, shell, t, inert, onClose, onAttention }: {
  workspace: WorkspaceDevSnapshot | null; agent?: WorkspaceDevAgent; shell: ShellOverview; t: Translate; inert: boolean; onClose(): void; onAttention(): void;
}) {
  const conversation = workspace?.conversation, state = taskStatus(conversation?.taskState ?? conversation?.state);
  const waiting = shell.waiting.filter(row => row.agentId === agent?.agentId);
  const tools = [...new Set((conversation?.history ?? []).flatMap(row => row.role === "assistant" ? row.tools : []))].slice(-8);
  const connection = workspace?.connections.connections.find(row => row.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId));
  const usage = conversation?.usage;
  return <aside id="workspace-inspector" className="vg-inspector" aria-label={t("vg.inspector")} inert={inert}>
    <header><h2>{t("vg.inspector")}</h2><button className="hs-icon" aria-label={t("vg.inspector.close")} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    {workspace && agent ? <><section className="vg-context-card"><div className="vg-context-person"><Avatar agent={agent} large /><strong>{agent.identity.displayName}</strong></div>
      <span className={`vg-status ${waiting.length ? "approval" : state === "running" || state === "accepted" ? "running" : "idle"}`}>
        {state === "completed" ? <CheckCircleIcon className="hico" /> : <ClockIcon className="hico" />}
        {t(waiting.length ? "vg.approval" : `ws.tasks.status.${state}`)}</span>
      {conversation?.objective ? <p>{conversation.objective}</p> : null}
      <h3>{t("vg.tools")}</h3>{tools.length ? <div className="vg-tool-tags">{tools.map(tool => <span key={tool}><CommandLineIcon className="hico" />{tool}</span>)}</div> : <p className="vg-muted">{t("vg.tools.empty")}</p>}
      <h3>{t("vg.usage")}</h3><strong className="vg-token-count">{((usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)).toLocaleString()}</strong>
      <dl><dt>{t("vg.model")}</dt><dd>{connection?.defaultModel ?? t("vg.none")}</dd><dt>{t("ws.settings.page.runtimes")}</dt><dd>{agent.runtime.label}</dd></dl>
    </section>{waiting.length ? <section className="vg-attention"><span className="vg-status approval">! {t("vg.approval")}</span><p>{waiting[0].title}</p><button className="hs-btn sec" onClick={onAttention}>{t("ws.await.open")} · {waiting.length}</button></section> : null}</>
      : <p className="vg-muted">{t("vg.context.empty")}</p>}
  </aside>;
}
