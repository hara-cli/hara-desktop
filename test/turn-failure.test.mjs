import assert from "node:assert/strict";
import test from "node:test";

import {
  isModelAuthenticationFailure,
  turnFailureMessage,
  updateModelAuthenticationFailureState,
} from "../src/turn-failure.ts";

test("provider authentication failures become actionable copy without echoing upstream details", () => {
  const upstream = "[token-plan error] 403 credential rejected at https://provider.invalid?key=secret";
  const message = turnFailureMessage(upstream, "error", "zh");
  assert.match(message, /模型连接认证失败/);
  assert.match(message, /模型与连接/);
  assert.doesNotMatch(message, /provider\.invalid|secret|token-plan/);
  assert.equal(isModelAuthenticationFailure(upstream), true);
});

test("ordinary provider failures do not trigger connection migration recovery", () => {
  assert.equal(isModelAuthenticationFailure("upstream timed out while streaming"), false);
});

test("empty and generic failures remain distinct and safe", () => {
  assert.match(turnFailureMessage("empty response", "empty", "en"), /no usable content/i);
  assert.match(turnFailureMessage("socket exploded with private detail", "error", "en"), /did not finish/i);
  assert.equal(turnFailureMessage(undefined, "completed", "en"), undefined);
});

test("live auth recovery survives the terminal task transition and clears only after success", () => {
  const failed = updateModelAuthenticationFailureState(
    {},
    "old-session",
    "401 invalid API key at https://provider.invalid/private",
    "failed",
  );
  assert.deepEqual(failed, { "old-session": true });

  const unrelatedFailure = updateModelAuthenticationFailureState(
    failed,
    "old-session",
    "upstream timed out",
    "failed",
  );
  assert.equal(unrelatedFailure, failed, "a later non-auth failure cannot falsely clear the recovery route");

  const recovered = updateModelAuthenticationFailureState(
    failed,
    "old-session",
    undefined,
    "completed",
  );
  assert.deepEqual(recovered, {});
});
