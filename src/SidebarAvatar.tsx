import { UsersIcon } from "@heroicons/react/24/outline";
import { Avatar } from "./WorkspaceShell";
import { agentInitials, agentAvatarAccent, renderableAgentAvatar } from "./agent-visual";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import type { RosterAvatarMember } from "./workspace-roster";

/** The same colleague keeps their colour in a private row and every composite group avatar. */
export function SidebarAvatar({ agent, members = [] }: { agent?: WorkspaceDevAgent; members?: readonly RosterAvatarMember[] }) {
  if (agent?.kind === "main") return <Avatar agent={agent} />;
  if (agent) {
    const identity = { ...agent.identity, version: 1 as const, source: "derived" as const };
    const avatar = renderableAgentAvatar(identity);
    const label = agent.identity.displayName.trim();
    return <span className="hs-ava hd-colleague-avatar" aria-hidden="true" style={{ background: agentAvatarAccent(agent.agentId, identity) }}>
      {avatar ? <img src={avatar} alt="" /> : /^\p{Script=Han}/u.test(label) ? [...label][0] : agentInitials(label)}
    </span>;
  }
  const visible = members.length > 4 ? members.slice(0, 3) : members.slice(0, 4);
  return <span className="hs-ava hd-group-avatar" data-members={Math.min(members.length, 4)} aria-hidden="true">
    {visible.length ? visible.map(member => <i key={member.id} style={{ background: agentAvatarAccent(member.id, { accent: member.accent }) }} />) : <UsersIcon className="hico" />}
    {members.length > 4 ? <b>+{members.length - 3}</b> : null}
  </span>;
}
