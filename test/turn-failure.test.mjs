import assert from "node:assert/strict";
import test from "node:test";

import { turnFailureMessage } from "../src/turn-failure.ts";

test("provider authentication failures become actionable copy without echoing upstream details", () => {
  const upstream = "[token-plan error] 403 credential rejected at https://provider.invalid?key=secret";
  const message = turnFailureMessage(upstream, "error", "zh");
  assert.match(message, /模型连接认证失败/);
  assert.match(message, /模型与连接/);
  assert.doesNotMatch(message, /provider\.invalid|secret|token-plan/);
});

test("empty and generic failures remain distinct and safe", () => {
  assert.match(turnFailureMessage("empty response", "empty", "en"), /no usable content/i);
  assert.match(turnFailureMessage("socket exploded with private detail", "error", "en"), /did not finish/i);
  assert.equal(turnFailureMessage(undefined, "completed", "en"), undefined);
});
