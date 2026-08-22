import { memo, useEffect, useState, type CSSProperties, type ReactNode } from "react";
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

function Face({ variant }: { variant: number }): ReactNode {
  return (
    <>
      <i className="agent-art-hair" />
      <i className="agent-art-ear is-left" />
      <i className="agent-art-ear is-right" />
      <i className="agent-art-face">
        <b className="agent-art-eye is-left" />
        <b className="agent-art-eye is-right" />
        <b className="agent-art-mouth" />
        {variant === 2 || variant === 5 ? <b className="agent-art-glasses" /> : null}
      </i>
    </>
  );
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
        <>
          <span className="agent-portrait-art"><Face variant={visual.variant} /><i className="agent-art-outfit" /></span>
          <span className="agent-portrait-initials">{agentInitials(identity?.displayName || name)}</span>
        </>
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
  return (
    <span
      className={`agent-character-art is-variant-${visual.variant} is-${state}${reduced ? " is-reduced" : ""}${className ? ` ${className}` : ""}`}
      style={visualStyle(agentRef, identity)}
      aria-hidden
      data-character={visual.archetype}
    >
      <span className="agent-character-head"><Face variant={visual.variant} /></span>
      <span className="agent-character-body"><i /><b>{identity?.emoji || agentInitials(identity?.displayName || name).slice(0, 1)}</b></span>
      <span className="agent-character-arm is-left" />
      <span className="agent-character-arm is-right" />
      <span className="agent-character-leg is-left" />
      <span className="agent-character-leg is-right" />
    </span>
  );
});
