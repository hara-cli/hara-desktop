import test from "node:test";
import assert from "node:assert/strict";
import {
  providerModelDescription,
  TOKEN_PLAN_AGENT_MODEL_IDS,
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
