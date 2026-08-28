import type { Locale } from "./i18n";

const TOKEN_PLAN_AGENT_MODEL_CAPABILITIES: Readonly<Record<string, { zh: string; en: string }>> = Object.freeze({
  "qwen3.8-max": { zh: "视觉 · 推理 · 1M · 夜间 5 折", en: "vision · reasoning · 1M · 50% off at night" },
  "qwen3.8-flash": { zh: "视觉 · 推理 · 1M · 快速", en: "vision · reasoning · 1M · fast" },
  "qwen3.7-max": { zh: "文本 · 推理 · 1M", en: "text · reasoning · 1M" },
  "qwen3.7-plus": { zh: "视觉 · 推理 · 1M", en: "vision · reasoning · 1M" },
  "qwen3.6-flash": { zh: "视觉 · 推理 · 1M", en: "vision · reasoning · 1M" },
  "deepseek-v4-pro-0813": { zh: "文本 · 推理 · 夜间 5 折", en: "text · reasoning · 50% off at night" },
  "deepseek-v4-pro": { zh: "文本 · 推理", en: "text · reasoning" },
  "deepseek-v4-flash-0731": { zh: "文本 · 推理", en: "text · reasoning" },
  "glm-5.2": { zh: "文本 · 推理", en: "text · reasoning" },
});

const bareModel = (model: string): string => model.trim().split("/").slice(-1)[0]?.toLowerCase() ?? "";

export function providerModelDescription(providerId: string, model: string, locale: Locale): string | undefined {
  if (providerId !== "token-plan") return undefined;
  return TOKEN_PLAN_AGENT_MODEL_CAPABILITIES[bareModel(model)]?.[locale];
}

export const TOKEN_PLAN_AGENT_MODEL_IDS = Object.freeze(Object.keys(TOKEN_PLAN_AGENT_MODEL_CAPABILITIES));
