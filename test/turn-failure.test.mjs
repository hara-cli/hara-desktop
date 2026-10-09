import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isModelAuthenticationFailure,
  rpcTurnFailureMessage,
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

test("a matching terminal failure notice suppresses the later RPC error notice without changing the error", () => {
  const error = Object.freeze({ code: -32603, message: "403 private diagnostic https://provider.invalid?key=private-fixture" });
  for (const locale of ["en", "zh"]) {
    assert.equal(rpcTurnFailureMessage(error, locale, true), undefined);
  }
  assert.equal(error.code, -32603, "presentation never converts the RPC failure to a success");
  assert.match(error.message, /private diagnostic/);
  assert.ok(rpcTurnFailureMessage(error, "en", false), "a terminal receipt without a failure notice cannot silence the error");
});

test("missing terminal events still get safe localized RPC failure copy for all thrown shapes", () => {
  for (const locale of ["en", "zh"]) {
    for (const error of [
      new Error("401 API key rejected at https://provider.invalid/account/private-fixture"),
      { code: -32603, message: "upstream failed at https://provider.invalid/private-fixture" },
      "socket failed with private-fixture",
      { code: -32603 }, undefined,
    ]) {
      const notice = rpcTurnFailureMessage(error, locale);
      assert.ok(notice?.trim());
      assert.doesNotMatch(notice, /provider\.invalid|private-fixture|socket failed|upstream failed/);
    }
  }
  assert.match(rpcTurnFailureMessage(new Error("403 rejected"), "en"), /could not authenticate/);
});

test("App RPC catch keeps unacknowledged input and cannot append raw diagnostics or duplicate terminal notices", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const catchStart = app.indexOf("const persisted = dispatch?.pendingId === pendingId && dispatch.completed === true;");
  const failure = app.slice(catchStart, app.indexOf('return persisted ? "started" : "failed";', catchStart));
  assert.ok(catchStart >= 0);
  assert.match(failure, /if \(persisted\) resolvePendingUser\(sessionId, pendingId, true\)/,
    "unacknowledged user input stays local and is not removed or made rewindable");
  assert.doesNotMatch(failure, /resolvePendingUser\([^\n]*false\)|resolvePendingUser\(sessionId, pendingId, persisted\)/);
  assert.match(failure, /const failureNotified = persisted && dispatch\?\.failureNotified === true/);
  assert.match(failure, /rpcTurnFailureMessage\(e, locale, failureNotified\)/);
  assert.match(failure, /if \(failureMessage\) \{[\s\S]*push\(sessionId, \(items\) =>/);
  assert.match(failure, /text: recovery \?\? failureMessage/);
  assert.doesNotMatch(failure, /e\?\.message|String\(e\)|`error:/);
  assert.match(app, /dispatch\.failureNotified = Boolean\(failureMessage\)/);
});
