import test from "node:test";
import assert from "node:assert/strict";
import {
  providerModelDescription,
  TOKEN_PLAN_AGENT_MODEL_IDS,
  VOLCENGINE_AGENT_PLAN_MODEL_IDS,
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
