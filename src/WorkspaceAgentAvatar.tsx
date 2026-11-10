import { useEffect, useState } from "react";
import HaraLogo from "./mark";
import { agentAvatarAccent, agentAvatarInitials, renderableAgentAvatar } from "./agent-visual";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

/** Sidebar, group speech and the header share one safe public identity rendering. */
export function WorkspaceAgentAvatar({ agent, large = false }: { agent?: WorkspaceDevAgent; large?: boolean }) {
  const main = !agent || agent.kind === "main";
  const identity = agent ? { ...agent.identity, version: 1 as const, source: "derived" as const } : undefined;
  const avatar = !main ? renderableAgentAvatar(identity) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatar]);
  return <span aria-hidden="true" className={`hs-ava wsd-avatar${main ? " hara is-main" : " hd-colleague-avatar"}${large ? " lg is-large" : ""}`}
    style={main ? undefined : { background: agentAvatarAccent(agent!.agentId, identity), color: "#1a1325", borderRadius: "50%", overflow: "hidden" }}>
    {main ? <HaraLogo size={large ? 28 : 24} /> : avatar && !failed
      ? <img src={avatar} alt="" draggable={false} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      : agentAvatarInitials(agent!.identity.displayName)}
  </span>;
}
