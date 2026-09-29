import test from "node:test";
import assert from "node:assert/strict";
import {
  providerModelDescription,
  providerModelDisplayName,
  providerModelPresentation,
  TOKEN_PLAN_AGENT_MODEL_IDS,
  VOLCENGINE_AGENT_PLAN_MODEL_IDS,
  VOLCENGINE_CODING_PLAN_MODEL_IDS,
} from "../src/provider-model-capabilities.ts";

test("Token Plan chat catalog exposes current Agent models with honest modality labels", () => {
  assert.deepEqual(TOKEN_PLAN_AGENT_MODEL_IDS, [
    "qwen3.8-max",
    "qwen3.8-flash",
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.6-flash",
    "deepseek-v4-pro-0813",
    "deepseek-v4-pro",
    "deepseek-v4-flash-0731",
    "glm-5.2",
  ]);
  assert.match(providerModelDescription("token-plan", "qwen3.8-flash", "zh"), /视觉.*推理.*1M/);
  assert.match(providerModelDescription("token-plan", "qwen3.7-max", "zh"), /文本.*推理/);
  assert.doesNotMatch(providerModelDescription("token-plan", "qwen3.7-max", "zh"), /视觉/);
  assert.equal(providerModelDescription("openai", "qwen3.8-flash", "zh"), undefined);
  assert.equal(providerModelDescription("token-plan", "qwen-image-3.0-pro", "zh"), undefined);
});

test("Volcengine Agent Plan catalog exposes current context, modality, and plan constraints", () => {
  assert.equal(VOLCENGINE_AGENT_PLAN_MODEL_IDS[0], "auto");
  assert.equal(VOLCENGINE_AGENT_PLAN_MODEL_IDS.includes("doubao-seedream-5.0-lite"), false);
  assert.match(providerModelDescription("volcengine-agent-plan", "glm-5.3-flash", "zh"), /视觉.*推理.*1M/);
  assert.match(providerModelDescription("volcengine-agent-plan", "doubao-seed-2.1-turbo", "zh"), /视觉.*Agent/);
  assert.match(providerModelDescription("volcengine-agent-plan", "kimi-k2.7-code", "zh"), /视觉\/视频/);
  assert.match(providerModelDescription("volcengine-agent-plan", "glm-5.3", "zh"), /始终思考/);
  assert.match(providerModelDescription("volcengine-agent-plan", "kimi-k3", "en"), /vision.*Medium plan or higher/);
  assert.match(providerModelDescription("volcengine-agent-plan", "auto", "zh"), /智能调度/);
  assert.equal(providerModelDescription("openai", "glm-5.3-flash", "zh"), undefined);
});

test("Volcengine Coding Plan catalog separates current chat models from sunset and vector models", () => {
  assert.equal(VOLCENGINE_CODING_PLAN_MODEL_IDS[0], "ark-code-latest");
  for (const current of ["doubao-seed-2.1-pro", "deepseek-v4.1-flash", "kimi-k2.8-preview", "kimi-k3"]) {
    assert.equal(VOLCENGINE_CODING_PLAN_MODEL_IDS.includes(current), true, current);
  }
  for (const hidden of ["auto", "doubao-seed-2.0-lite", "doubao-seed-2.1-turbo", "doubao-embedding-vision"]) {
    assert.equal(VOLCENGINE_CODING_PLAN_MODEL_IDS.includes(hidden), false, hidden);
  }
  assert.equal(providerModelDisplayName("volcengine-coding-plan", "ark-code-latest", "zh"), "Auto（推荐）");
  assert.match(providerModelDescription("volcengine-coding-plan", "ark-code-latest", "zh"), /自动平衡.*控制台/);
  assert.match(providerModelDescription("volcengine-coding-plan", "deepseek-v4.1-flash", "zh"), /多模态.*1M/);
  assert.match(providerModelDescription("volcengine-coding-plan", "glm-5.3", "en"), /hard coding tasks.*1M/);
  assert.deepEqual(providerModelPresentation("volcengine-coding-plan", "ark-code-latest", "en"), {
    name: "Auto (recommended)",
    summary: "Choose this when you do not want to compare every model. Hara uses the stable alias while Ark Console manages the concrete model and Auto routing.",
    facts: ["Wire ID: ark-code-latest", "Console changes take about 3–5 minutes", "Best everyday default"],
    tone: "recommended",
  });
  assert.match(providerModelPresentation("volcengine-coding-plan", "glm-5.3", "zh")?.summary, /额度消耗较快/);
  assert.equal(providerModelPresentation("volcengine-agent-plan", "glm-5.3", "zh"), undefined);
  assert.equal(providerModelDescription("volcengine-agent-plan", "doubao-seed-2.1-pro", "zh"), undefined);
});
