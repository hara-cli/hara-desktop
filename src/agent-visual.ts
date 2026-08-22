import type { AgentInfo, AgentPublicIdentity } from "./client";

export interface AgentVisualTokens {
  accent: string;
  accentAlt: string;
  skin: string;
  hair: string;
  hairAlt: string;
  outfit: string;
  paper: string;
  variant: number;
  archetype: string;
}

const PALETTES = [
  { accent: "#ff695f", accentAlt: "#f3a36b", skin: "#f3c7a5", hair: "#352624", hairAlt: "#70483e", outfit: "#713f3b", paper: "#f8e7cf" },
  { accent: "#4f9c8f", accentAlt: "#83c5b9", skin: "#dca982", hair: "#262728", hairAlt: "#545052", outfit: "#315e5c", paper: "#dff1e8" },
  { accent: "#d99a32", accentAlt: "#f2c66b", skin: "#f0be92", hair: "#4a2f25", hairAlt: "#8c5b43", outfit: "#7c5825", paper: "#fff0c9" },
  { accent: "#6e88c8", accentAlt: "#9aafe1", skin: "#9f6f55", hair: "#1e2025", hairAlt: "#3f4655", outfit: "#3f4d78", paper: "#e3e9fa" },
  { accent: "#a67bc2", accentAlt: "#cf9ddd", skin: "#edc5ad", hair: "#5a3645", hairAlt: "#9b6176", outfit: "#61436f", paper: "#f2e2f5" },
  { accent: "#d1667b", accentAlt: "#ed9aac", skin: "#7d513e", hair: "#17191b", hairAlt: "#44474d", outfit: "#703543", paper: "#f8dfe5" },
  { accent: "#438db3", accentAlt: "#76bad4", skin: "#e6b995", hair: "#293943", hairAlt: "#52707d", outfit: "#28546b", paper: "#dceef5" },
  { accent: "#7f9a45", accentAlt: "#b2c875", skin: "#c98d68", hair: "#34291f", hairAlt: "#6f5942", outfit: "#4d5f2e", paper: "#e8efd6" },
] as const;

export function stableAgentHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function agentDisplayName(agent: Pick<AgentInfo, "name" | "identity">): string {
  return agent.identity?.displayName?.trim() || agent.name;
}

export function agentPublicTitle(agent: Pick<AgentInfo, "description" | "identity">): string {
  return agent.identity?.title?.trim() || agent.description;
}

export function agentInitials(value: string): string {
  const label = value.trim();
  if (!label) return "A";
  const words = label.split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : label.slice(0, 2)).toUpperCase();
}

export function agentVisualTokens(agentRef: string, identity?: AgentPublicIdentity): AgentVisualTokens {
  const hash = stableAgentHash(`${agentRef}\0${identity?.character ?? ""}`);
  const palette = PALETTES[hash % PALETTES.length];
  return {
    ...palette,
    accent: identity?.accent ?? palette.accent,
    variant: hash % 8,
    archetype: identity?.character ?? `studio-${hash % 8}`,
  };
}

export function renderableAgentAvatar(identity?: AgentPublicIdentity): string | undefined {
  const avatar = identity?.avatar;
  if (!avatar) return undefined;
  if (/^\/(?:avatars|pets)\/[a-z0-9_./-]+$/i.test(avatar)) return avatar;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 128 * 1024) return avatar;
  return undefined;
}
