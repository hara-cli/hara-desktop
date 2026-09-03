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

const VOLCENGINE_AGENT_PLAN_MODEL_CAPABILITIES: Readonly<Record<string, { zh: string; en: string }>> = Object.freeze({
  "auto": { zh: "智能调度 · 效果与速度均衡", en: "automatic routing · quality/speed balanced" },
  "doubao-seed-evolving": { zh: "文本 · 1M · Coding/Agent · 周更", en: "text · 1M · coding/agent · weekly updates" },
  "doubao-seed-2.1-turbo": { zh: "视觉 · 推理 · 256K · Agent", en: "vision · reasoning · 256K · agent" },
  "doubao-seed-2.0-lite": { zh: "文本 · 256K · 标准", en: "text · 256K · standard" },
  "doubao-seed-2.0-mini": { zh: "文本 · 256K · 极速", en: "text · 256K · fastest" },
  "glm-5.3-flash": { zh: "视觉 · 推理 · 1M", en: "vision · reasoning · 1M" },
  "glm-5.3": { zh: "文本 · 1M · 始终思考", en: "text · 1M · always thinking" },
  "deepseek-v4-pro": { zh: "文本 · 推理 · 1M", en: "text · reasoning · 1M" },
  "deepseek-v4-flash": { zh: "文本 · 推理 · 1M", en: "text · reasoning · 1M" },
  "minimax-m3": { zh: "视觉 · 推理 · 1M", en: "vision · reasoning · 1M" },
  "kimi-k2.7-code": { zh: "视觉/视频 · 推理 · 256K · 代码", en: "image/video · reasoning · 256K · code" },
  "kimi-k3": { zh: "视觉 · 推理 · 1M · Medium 及以上", en: "vision · reasoning · 1M · Medium plan or higher" },
  "ark-code-latest": { zh: "控制台所选模型 · Responses", en: "console-selected model · Responses" },
  "glm-latest": { zh: "文本 · 1M · 始终思考", en: "text · 1M · always thinking" },
});

const bareModel = (model: string): string => model.trim().split("/").slice(-1)[0]?.toLowerCase() ?? "";

export function providerModelDescription(providerId: string, model: string, locale: Locale): string | undefined {
  const capabilities = providerId === "token-plan"
    ? TOKEN_PLAN_AGENT_MODEL_CAPABILITIES
    : providerId === "volcengine-agent-plan"
      ? VOLCENGINE_AGENT_PLAN_MODEL_CAPABILITIES
      : undefined;
  return capabilities?.[bareModel(model)]?.[locale];
}

export const TOKEN_PLAN_AGENT_MODEL_IDS = Object.freeze(Object.keys(TOKEN_PLAN_AGENT_MODEL_CAPABILITIES));
export const VOLCENGINE_AGENT_PLAN_MODEL_IDS = Object.freeze(Object.keys(VOLCENGINE_AGENT_PLAN_MODEL_CAPABILITIES));
