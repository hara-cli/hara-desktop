import type { AgentInfo, AgentRuntimeId, AgentRuntimeOption } from "./client";
import { formatMessage, isLocale, messageText, type Locale } from "./i18n-runtime.ts";

/** Accepts the legacy "zh" alias plus the full three-language set. */
type LabelLocale = Locale | "zh";

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

/**
 * Engine display names. `hara` and `pi` are translated; the rest are product names and
 * stay as written (audit §1.1 listed them as "engine name is Simplified" only because
 * the two authored labels were Simplified for every Chinese reader).
 */
export function agentRuntimeLabel(id: AgentRuntimeId, locale: LabelLocale): string {
  const normalized: Locale = isLocale(locale) ? locale : "zh-Hans";
  if (id === "hara") return messageText(normalized, "ws.runtimeName.haraCompatFixed");
  if (id === "pi") return messageText(normalized, "ws.runtimeName.piBuiltInFixed");
  return { codex: "Codex", claude: "Claude Code", opencode: "OpenCode", agy: "Antigravity", gemini: "Gemini CLI", kimi: "Kimi Code", copilot: "GitHub Copilot", cursor: "Cursor", grok: "Grok Build" }[id];
}

/** Display-only policy notice; permissions remain in the Host. */
export function runtimePersonalExtensionsNotice(runtimeId: string, locale: LabelLocale): string {
  const normalized: Locale = isLocale(locale) ? locale : "zh-Hans";
  return ["kimi", "copilot", "cursor", "grok"].includes(runtimeId)
    ? formatMessage(normalized, "ws.runtimeExpansion.extensionsInherited")
    : "";
}
