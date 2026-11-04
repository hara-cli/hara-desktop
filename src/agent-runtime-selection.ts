import type { AgentInfo, AgentRuntimeId, AgentRuntimeOption } from "./client";

/** Renderer preflight only. The engine independently authenticates the audience, owner and revisions.
 * Availability is advertised by the actual general-Agent driver registry, not CLI detection or a model. */
export function agentRuntimeSelection(agent: AgentInfo, runtimeId: AgentRuntimeId, options: readonly AgentRuntimeOption[]) {
  const binding = agent.runtime;
  if (!binding || binding.version !== 1 || binding.spaceId !== "personal" || agent.spaceId !== binding.spaceId
    || binding.agentRef !== agent.ref || agent.owner !== "personal" || !agent.allowedActions.includes("edit_profile")
    || !agent.revision || !Number.isSafeInteger(binding.revision) || binding.revision < 0
    || binding.runtimeId === runtimeId || !options.some((option) => option.id === runtimeId && option.available)) return null;
  return { ref: agent.ref, runtimeId, expectedRevision: binding.revision, expectedAgentRevision: agent.revision };
}

export function agentRuntimeLabel(id: AgentRuntimeId, locale: "en" | "zh"): string {
  if (id === "hara") return locale === "zh" ? "Hara · 现有相容引擎" : "Hara · compatibility engine";
  if (id === "pi") return locale === "zh" ? "Pi · 内建" : "Pi · built-in";
  return { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", agy: "Antigravity", gemini: "Gemini CLI", kimi: "Kimi Code", copilot: "GitHub Copilot", cursor: "Cursor", grok: "Grok Build" }[id];
}

export const PERSONAL_EXTENSIONS_COPY = {
  en: "This runtime will bring along your computer’s personal extensions (plugins / hooks / MCP).",
  "zh-Hans": "会带上你本机的个人扩展（插件／hooks／MCP）。",
  "zh-Hant": "會帶上你本機的個人擴充功能（外掛／hooks／MCP）。",
} as const;
/** Display-only policy notice; permissions remain in the Host. */
export function runtimePersonalExtensionsNotice(runtimeId: string, locale: "en" | "zh" | "zh-Hans" | "zh-Hant"): string {
  return ["kimi", "copilot", "cursor", "grok"].includes(runtimeId) ? PERSONAL_EXTENSIONS_COPY[locale === "zh" ? "zh-Hans" : locale] : "";
}
