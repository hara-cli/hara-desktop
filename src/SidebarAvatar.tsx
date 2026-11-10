import { UsersIcon } from "@heroicons/react/24/outline";
import { WorkspaceAgentAvatar } from "./WorkspaceAgentAvatar";
import { agentAvatarAccent } from "./agent-visual";
import type { WorkspaceDevAgent } from "./workspace-dev-state";
import type { RosterAvatarMember } from "./workspace-roster";

/** The same colleague keeps their colour in a private row and every composite group avatar. */
export function SidebarAvatar({ agent, members = [] }: { agent?: WorkspaceDevAgent; members?: readonly RosterAvatarMember[] }) {
  if (agent) return <WorkspaceAgentAvatar agent={agent} />;
  const visible = members.length > 4 ? members.slice(0, 3) : members.slice(0, 4);
  return <span className="hs-ava hd-group-avatar" data-members={Math.min(members.length, 4)} aria-hidden="true">
    {visible.length ? visible.map(member => <i key={member.id} style={{ background: agentAvatarAccent(member.id, { accent: member.accent }) }} />) : <UsersIcon className="hico" />}
    {members.length > 4 ? <b>+{members.length - 3}</b> : null}
  </span>;
}
