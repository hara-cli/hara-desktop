import { memo, useEffect, useState, type CSSProperties } from "react";
import type { AgentPublicIdentity } from "./client";
import { agentInitials, agentVisualTokens, renderableAgentAvatar } from "./agent-visual";
import "./AgentPortrait.css";

type AgentPresenceState = "idle" | "working" | "queued" | "waiting" | "paused" | "blocked" | "failed" | "completed";

interface AgentPortraitProps {
  agentRef: string;
  name: string;
  identity?: AgentPublicIdentity;
  size?: "tiny" | "small" | "medium" | "large";
  state?: AgentPresenceState;
  className?: string;
}

function visualStyle(agentRef: string, identity?: AgentPublicIdentity): CSSProperties {
  const visual = agentVisualTokens(agentRef, identity);
  return {
    "--agent-accent": visual.accent,
    "--agent-accent-alt": visual.accentAlt,
    "--agent-skin": visual.skin,
    "--agent-hair": visual.hair,
    "--agent-hair-alt": visual.hairAlt,
    "--agent-outfit": visual.outfit,
    "--agent-paper": visual.paper,
  } as CSSProperties;
}

export const AgentPortrait = memo(function AgentPortrait({
  agentRef,
  name,
  identity,
  size = "medium",
  state = "idle",
  className = "",
}: AgentPortraitProps) {
  const visual = agentVisualTokens(agentRef, identity);
  const avatar = renderableAgentAvatar(identity);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [avatar]);
  return (
    <span
      className={`agent-portrait is-${size} is-variant-${visual.variant} is-${state}${className ? ` ${className}` : ""}`}
      style={visualStyle(agentRef, identity)}
      aria-hidden
    >
      {avatar && !avatarFailed ? (
        <img src={avatar} alt="" draggable={false} loading="lazy" onError={() => setAvatarFailed(true)} />
      ) : (
        <span className="agent-portrait-fallback">
          <b>{agentInitials(identity?.displayName || name)}</b>
        </span>
      )}
      {identity?.emoji ? <small className="agent-portrait-emoji">{identity.emoji}</small> : null}
      <i className="agent-portrait-presence" />
    </span>
  );
});
