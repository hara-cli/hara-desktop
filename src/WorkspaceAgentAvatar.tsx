import { createContext, useContext, useState } from "react";
import HaraLogo from "./mark";
import { agentAvatarAccent, agentAvatarInitials, agentAvatarStyle, renderableAgentAvatar } from "./agent-visual";
import type { WorkspaceDevAgent } from "./workspace-dev-state";

export const WorkspaceAgentAppearance = createContext(false);

function AvatarImage({ src, initials }: { src: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? initials : <img src={src} alt="" draggable={false} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
}

/** Sidebar, group speech and the header share one safe public identity rendering. */
export function WorkspaceAgentAvatar({ agent, large = false }: { agent?: WorkspaceDevAgent; large?: boolean }) {
  const appearanceSupported = useContext(WorkspaceAgentAppearance);
  const sizeClass = large ? " lg is-large" : "";
  if (!agent || agent.kind === "main") {
    return <span aria-hidden="true" className={`hs-ava wsd-avatar hara is-main${sizeClass}`}><HaraLogo size={large ? 28 : 24} /></span>;
  }
  const { agentId, identity } = agent;
  const avatar = renderableAgentAvatar(identity);
  const initials = agentAvatarInitials(identity.displayName);
  const shape = appearanceSupported ? agentAvatarStyle(identity.avatarStyle) ?? "circle" : undefined;
  return <span aria-hidden="true" className={`hs-ava wsd-avatar hd-colleague-avatar${sizeClass}`}
    data-avatar-style={shape}
    style={{ background: agentAvatarAccent(agentId, identity, appearanceSupported), color: "#1a1325",
      borderRadius: shape ? undefined : "50%", overflow: "hidden" }}>
    {avatar ? <AvatarImage key={avatar} src={avatar} initials={initials} /> : initials}
  </span>;
}
