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

type LocalizedCopy = Readonly<{ zh: string; en: string }>;

export type ProviderModelGuideTone = "recommended" | "fast" | "balanced" | "advanced";

interface ProviderModelGuideEntry {
  name: LocalizedCopy;
  option: LocalizedCopy;
  summary: LocalizedCopy;
  facts: Readonly<{ zh: readonly string[]; en: readonly string[] }>;
  tone: ProviderModelGuideTone;
}

export interface ProviderModelPresentation {
  name: string;
  summary: string;
  facts: readonly string[];
  tone: ProviderModelGuideTone;
}

/** Product-facing guidance for the current Coding Plan conversation models. This deliberately describes
 * which work each model suits instead of inventing a total ranking. Temporary promotional discounts stay
 * out of the binary so an expired campaign can never remain advertised by an old Desktop build. */
const VOLCENGINE_CODING_PLAN_MODEL_GUIDANCE: Readonly<Record<string, ProviderModelGuideEntry>> = Object.freeze({
  "ark-code-latest": {
    name: { zh: "Auto（推荐）", en: "Auto (recommended)" },
    option: { zh: "ark-code-latest · 自动平衡效果与速度 · 控制台管理", en: "ark-code-latest · balances quality and speed · console managed" },
    summary: {
      zh: "不想逐个比较模型时选它。Hara 使用稳定别名，具体模型与 Auto 调度由方舟控制台管理。",
      en: "Choose this when you do not want to compare every model. Hara uses the stable alias while Ark Console manages the concrete model and Auto routing.",
    },
    facts: {
      zh: ["技术 ID：ark-code-latest", "控制台切换约 3–5 分钟生效", "适合作为日常默认"],
      en: ["Wire ID: ark-code-latest", "Console changes take about 3–5 minutes", "Best everyday default"],
    },
    tone: "recommended",
  },
  "doubao-seed-evolving": {
    name: { zh: "Doubao Seed Evolving", en: "Doubao Seed Evolving" },
    option: { zh: "长程 Coding / Agent · 周级升级 · 1M", en: "long-running coding / agents · weekly updates · 1M" },
    summary: {
      zh: "适合持续演进的编码能力、复杂任务编排和长程 Agent 工作。统一模型 ID 会持续获得新版能力。",
      en: "For evolving coding ability, complex orchestration, and long-running agent work. Its stable model ID receives frequent capability updates.",
    },
    facts: { zh: ["1M 上下文", "最高 256K 输出", "复杂规划与工具调用"], en: ["1M context", "Up to 256K output", "Complex planning and tool use"] },
    tone: "advanced",
  },
  "doubao-seed-2.1-pro": {
    name: { zh: "Doubao Seed 2.1 Pro", en: "Doubao Seed 2.1 Pro" },
    option: { zh: "复杂开发与深度分析 · 1M · 256K 输出", en: "complex development and deep analysis · 1M · 256K output" },
    summary: { zh: "适合复杂推理、深度分析和较长的多步骤开发任务。", en: "For complex reasoning, deep analysis, and longer multi-step development tasks." },
    facts: { zh: ["1M 上下文", "最高 256K 输出", "旗舰综合能力"], en: ["1M context", "Up to 256K output", "Flagship general capability"] },
    tone: "advanced",
  },
  "doubao-seed-2.1-lite": {
    name: { zh: "Doubao Seed 2.1 Lite", en: "Doubao Seed 2.1 Lite" },
    option: { zh: "日常编码 · 效果与速度均衡 · 1M", en: "everyday coding · balanced quality and speed · 1M" },
    summary: { zh: "适合日常编码、代码解释和常规开发，优先兼顾响应速度与效果。", en: "For everyday coding, code explanation, and routine development with a balance of speed and quality." },
    facts: { zh: ["1M 上下文", "最高 256K 输出", "日常均衡"], en: ["1M context", "Up to 256K output", "Balanced daily use"] },
    tone: "balanced",
  },
  "doubao-seed-2.0-mini": {
    name: { zh: "Doubao Seed 2.0 Mini", en: "Doubao Seed 2.0 Mini" },
    option: { zh: "简单任务与代码补全 · 极速 · 256K", en: "simple tasks and code completion · fastest · 256K" },
    summary: { zh: "适合小改动、代码补全和明确的简单任务；不建议承担复杂长链路工作。", en: "For small edits, code completion, and well-scoped simple tasks; not the first choice for complex long-running work." },
    facts: { zh: ["256K 上下文", "最高 128K 输出", "速度优先"], en: ["256K context", "Up to 128K output", "Speed first"] },
    tone: "fast",
  },
  "minimax-m3": {
    name: { zh: "MiniMax M3", en: "MiniMax M3" },
    option: { zh: "Agent、工具调用与多模态 · 1M", en: "agents, tool use, and multimodal work · 1M" },
    summary: { zh: "适合 Agent 推理、工具调用、代码和长上下文任务，也能处理图片输入。", en: "For agent reasoning, tool use, code, and long-context tasks, with image input support." },
    facts: { zh: ["1M 上下文", "最高 128K 输出", "图片输入"], en: ["1M context", "Up to 128K output", "Image input"] },
    tone: "advanced",
  },
  "glm-5.3": {
    name: { zh: "GLM 5.3", en: "GLM 5.3" },
    option: { zh: "重难点编码 · 始终思考 · 1M · 额度消耗较高", en: "hard coding tasks · always thinking · 1M · higher allowance use" },
    summary: { zh: "适合重难点复杂问题和生产级代码交付；模型始终思考，额度消耗较快。", en: "For difficult problems and production-grade code delivery. Thinking is always on and allowance consumption is higher." },
    facts: { zh: ["1M 上下文", "最高 128K 输出", "不能关闭思考"], en: ["1M context", "Up to 128K output", "Thinking cannot be disabled"] },
    tone: "advanced",
  },
  "glm-latest": {
    name: { zh: "GLM 5.3（兼容别名）", en: "GLM 5.3 (compatibility alias)" },
    option: { zh: "glm-latest · GLM 5.3 兼容别名", en: "glm-latest · GLM 5.3 compatibility alias" },
    summary: { zh: "兼容已有 glm-latest 配置；新配置优先选择明确的 glm-5.3。", en: "Keeps existing glm-latest profiles working; prefer the explicit glm-5.3 ID for new profiles." },
    facts: { zh: ["兼容旧配置", "始终思考", "新建优先 glm-5.3"], en: ["Existing-profile compatibility", "Always thinking", "Prefer glm-5.3 for new profiles"] },
    tone: "advanced",
  },
  "glm-5.3-flash": {
    name: { zh: "GLM 5.3 Flash", en: "GLM 5.3 Flash" },
    option: { zh: "日常多模态 · 低成本 · 1M", en: "everyday multimodal work · lower cost · 1M" },
    summary: { zh: "适合需要图片输入的日常开发与常规 Agent 工作，兼顾能力与成本。", en: "For everyday development and routine agent work that needs image input, balancing capability and cost." },
    facts: { zh: ["1M 上下文", "最高 128K 输出", "图片输入"], en: ["1M context", "Up to 128K output", "Image input"] },
    tone: "balanced",
  },
  "deepseek-v4.1-flash": {
    name: { zh: "DeepSeek V4.1 Flash", en: "DeepSeek V4.1 Flash" },
    option: { zh: "多模态 Agent 与日常开发 · 1M · 384K 输出", en: "multimodal agents and daily development · 1M · 384K output" },
    summary: { zh: "适合图片理解、日常 Agent 工作和需要长输出的开发任务。", en: "For image understanding, everyday agent work, and development tasks that benefit from long output." },
    facts: { zh: ["1M 上下文", "最高 384K 输出", "图片输入"], en: ["1M context", "Up to 384K output", "Image input"] },
    tone: "balanced",
  },
  "deepseek-v4-flash": {
    name: { zh: "DeepSeek V4 Flash", en: "DeepSeek V4 Flash" },
    option: { zh: "快速、经济的编码任务 · 1M · 可关闭思考", en: "fast, economical coding · 1M · optional thinking" },
    summary: { zh: "适合速度和成本优先的常规编码；需要时可关闭深度思考。", en: "For routine coding where speed and economy matter; deep thinking can be disabled when it is unnecessary." },
    facts: { zh: ["1M 上下文", "最高 384K 输出", "思考可开关"], en: ["1M context", "Up to 384K output", "Thinking can be toggled"] },
    tone: "fast",
  },
  "deepseek-v4-pro": {
    name: { zh: "DeepSeek V4 Pro", en: "DeepSeek V4 Pro" },
    option: { zh: "复杂 Agent 与重难点任务 · 1M · 额度消耗较高", en: "complex agents and hard tasks · 1M · higher allowance use" },
    summary: { zh: "适合复杂 Agent 工作和重难点问题；综合能力强，但额度消耗较快。", en: "For complex agent work and difficult problems. It is powerful, but consumes plan allowance more quickly." },
    facts: { zh: ["1M 上下文", "最高 384K 输出", "思考可开关"], en: ["1M context", "Up to 384K output", "Thinking can be toggled"] },
    tone: "advanced",
  },
  "kimi-k2.7-code": {
    name: { zh: "Kimi K2.7 Code", en: "Kimi K2.7 Code" },
    option: { zh: "专业编码 · 图片/视频输入 · 256K", en: "coding specialist · image/video input · 256K" },
    summary: { zh: "适合专业代码任务、长上下文指令遵循，以及需要图片或视频输入的开发工作。", en: "For focused coding, reliable long-context instruction following, and development work with image or video input." },
    facts: { zh: ["256K 上下文", "最高 32K 输出（含思维链）", "图片与视频输入"], en: ["256K context", "Up to 32K output including reasoning", "Image and video input"] },
    tone: "advanced",
  },
  "kimi-k2.8-preview": {
    name: { zh: "Kimi K2.8 Preview", en: "Kimi K2.8 Preview" },
    option: { zh: "代码补全与常规开发 · 高效思考 · 1M", en: "completion and routine development · efficient thinking · 1M" },
    summary: { zh: "适合代码补全和常规开发；思考效率较高，但仍是 Preview 模型。", en: "For code completion and routine development with efficient reasoning; this remains a preview model." },
    facts: { zh: ["1M 上下文", "文字与图片输入", "Preview"], en: ["1M context", "Text and image input", "Preview"] },
    tone: "balanced",
  },
  "kimi-k3": {
    name: { zh: "Kimi K3", en: "Kimi K3" },
    option: { zh: "软件工程与深度推理 · 视觉 · 1M · 额度消耗高", en: "software engineering and deep reasoning · vision · 1M · high allowance use" },
    summary: { zh: "适合前沿软件工程、知识工作和深度推理；始终开启思考，建议仅在复杂任务使用。", en: "For frontier software engineering, knowledge work, and deep reasoning. Thinking is always on, so reserve it for complex tasks." },
    facts: { zh: ["1M 上下文", "最高 128K 输出", "不能关闭思考"], en: ["1M context", "Up to 128K output", "Thinking cannot be disabled"] },
    tone: "advanced",
  },
});

const bareModel = (model: string): string => model.trim().split("/").slice(-1)[0]?.toLowerCase() ?? "";

export function providerModelDescription(providerId: string, model: string, locale: Locale): string | undefined {
  if (providerId === "volcengine-coding-plan") {
    return VOLCENGINE_CODING_PLAN_MODEL_GUIDANCE[bareModel(model)]?.option[locale];
  }
  const capabilities = providerId === "token-plan"
    ? TOKEN_PLAN_AGENT_MODEL_CAPABILITIES
    : providerId === "volcengine-agent-plan"
      ? VOLCENGINE_AGENT_PLAN_MODEL_CAPABILITIES
      : undefined;
  return capabilities?.[bareModel(model)]?.[locale];
}

export function providerModelDisplayName(providerId: string, model: string, locale: Locale): string {
  if (providerId !== "volcengine-coding-plan") return model;
  return VOLCENGINE_CODING_PLAN_MODEL_GUIDANCE[bareModel(model)]?.name[locale] ?? model;
}

export function providerModelPresentation(
  providerId: string,
  model: string,
  locale: Locale,
): ProviderModelPresentation | undefined {
  if (providerId !== "volcengine-coding-plan") return undefined;
  const guide = VOLCENGINE_CODING_PLAN_MODEL_GUIDANCE[bareModel(model)];
  if (!guide) return undefined;
  return {
    name: guide.name[locale],
    summary: guide.summary[locale],
    facts: guide.facts[locale],
    tone: guide.tone,
  };
}

export const TOKEN_PLAN_AGENT_MODEL_IDS = Object.freeze(Object.keys(TOKEN_PLAN_AGENT_MODEL_CAPABILITIES));
export const VOLCENGINE_AGENT_PLAN_MODEL_IDS = Object.freeze(Object.keys(VOLCENGINE_AGENT_PLAN_MODEL_CAPABILITIES));
export const VOLCENGINE_CODING_PLAN_MODEL_IDS = Object.freeze(Object.keys(VOLCENGINE_CODING_PLAN_MODEL_GUIDANCE));
