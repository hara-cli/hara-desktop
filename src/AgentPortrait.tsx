import { memo, useEffect, useState, type CSSProperties } from "react";
import type { AgentPublicIdentity } from "./client";
import { agentInitials, agentVisualTokens, renderableAgentAvatar } from "./agent-visual";
import type { OfficeActorState } from "./agent-office";
import "./AgentPortrait.css";

interface AgentPortraitProps {
  agentRef: string;
  name: string;
  identity?: AgentPublicIdentity;
  size?: "tiny" | "small" | "medium" | "large";
  state?: OfficeActorState;
  className?: string;
}

interface AgentCharacterProps extends Omit<AgentPortraitProps, "size"> {
  reduced?: boolean;
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

export const AgentCharacter = memo(function AgentCharacter({
  agentRef,
  name,
  identity,
  state = "idle",
  reduced = false,
  className = "",
}: AgentCharacterProps) {
  const visual = agentVisualTokens(agentRef, identity);
  const avatar = renderableAgentAvatar(identity);
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => setAvatarFailed(false), [avatar]);
  return (
    <span
      className={`agent-character-art is-variant-${visual.variant} is-${state}${reduced ? " is-reduced" : ""}${className ? ` ${className}` : ""}`}
      style={visualStyle(agentRef, identity)}
      aria-hidden
      data-character={visual.archetype}
    >
      <span className={`agent-character-head${avatar && !avatarFailed ? " has-avatar" : " is-fallback"}`}>
        {avatar && !avatarFailed ? (
          <img src={avatar} alt="" draggable={false} loading="lazy" onError={() => setAvatarFailed(true)} />
        ) : (
          <b className="agent-character-monogram">{agentInitials(identity?.displayName || name).slice(0, 1)}</b>
        )}
      </span>
      <span className="agent-character-body"><i /><b>{identity?.emoji || agentInitials(identity?.displayName || name).slice(0, 1)}</b></span>
      <span className="agent-character-arm is-left" />
      <span className="agent-character-arm is-right" />
      <span className="agent-character-leg is-left" />
      <span className="agent-character-leg is-right" />
    </span>
  );
});
