import { XMarkIcon } from "@heroicons/react/24/outline";
import { Avatar } from "./WorkspaceShell";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

export default function WorkspaceGroupInspector({ name, memberIds, agents, locale, inert, onClose, onMembers }: {
  name: string; memberIds: string[]; agents: WorkspaceDevAgent[]; locale: "en" | "zh-Hans" | "zh-Hant";
  inert: boolean; onClose(): void; onMembers(): void;
}) {
  const zh = locale !== "en";
  return <aside id="workspace-inspector" className="vg-inspector vg-group-manage" aria-label={zh ? `${name} · 群管理` : `Manage group ${name}`} inert={inert}>
    <header><h2>{zh ? "群管理" : "Group management"}</h2><button className="hs-icon" aria-label={zh ? "关闭群管理" : "Close group management"} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <div className="vg-colleague-identity"><strong>{name}</strong><span>{zh ? "群" : "Group"} · {memberIds.length} {zh ? "位成员" : "members"}</span></div>
    <section className="vg-context-card"><h3>{zh ? "成员" : "Members"} <span>{memberIds.length}</span></h3>
      <div className="vg-group-members">{memberIds.map(id => { const agent = agents.find(row => row.agentId === id); return <div key={id}><Avatar agent={agent} /><span><strong>{agent?.identity.displayName ?? id}</strong><small>{agent?.identity.title ?? (zh ? "同事" : "Colleague")}</small></span></div>; })}</div>
      <button className="vg-manage-link" onClick={onMembers}>{zh ? "管理成员" : "Manage members"} ↗</button></section>
  </aside>;
}
