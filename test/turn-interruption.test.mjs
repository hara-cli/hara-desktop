import assert from "node:assert/strict";
import test from "node:test";

import { rpcTurnFailureMessage, turnFailureMessage } from "../src/turn-failure.ts";
import { terminalTaskLifecycleFallback } from "../src/task-lifecycle.ts";

test("an interrupted turn after external receipts preserves its paused checkpoint and gives verification guidance", () => {
  const paused = {
    version: 1, sessionId: "session-upload", taskId: "task-upload", turnId: "turn-upload",
    objective: "Upload files once, then verify", state: "paused", taskStatus: "paused",
    phase: "finished", at: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z",
    lastOutcome: "interrupted",
    checkpoint: { done: 4, total: 5, artifacts: ["upload receipt", "message receipt"], nextStep: "Verify the existing results" },
  };
  const before = structuredClone(paused);
  const terminal = Object.freeze({ error: "(interrupted)", status: "error", turnId: paused.turnId });

  const notice = turnFailureMessage(terminal.error, terminal.status, "zh");
  assert.match(notice, /执行已中断/);
  assert.match(notice, /核对实际结果/);
  assert.match(notice, /避免重复上传或发送/);
  assert.doesNotMatch(notice, /重试|任务已完成|上传成功|发送成功/);
  assert.equal(terminalTaskLifecycleFallback(paused, terminal.turnId, "blocked", "later"), undefined);
  assert.deepEqual(paused, before, "presentation preserves the authoritative checkpoint and external receipts");
  assert.equal(terminal.status, "error", "safe copy does not convert the protocol error to success");
});

test("known interruption markers get localized copy without promising business completion", () => {
  for (const marker of ["(interrupted)", "interrupted", "  (Interrupted)\n"]) {
    for (const locale of ["zh", "en"]) {
      const notice = turnFailureMessage(marker, "error", locale);
      assert.match(notice, locale === "zh" ? /执行已中断/ : /turn was interrupted/);
      assert.match(notice, locale === "zh" ? /避免重复上传或发送/ : /avoid duplicate uploads or messages/);
      assert.doesNotMatch(notice, /重试|\bretry\b|任务已完成|task (?:is|was) complete/);
    }
  }
});

test("a missing terminal event gets the same interruption guidance from the RPC error and a rendered notice is not duplicated", () => {
  const error = Object.freeze({ code: -32603, message: "(interrupted)" });
  for (const locale of ["zh", "en"]) {
    assert.equal(rpcTurnFailureMessage(error, locale), turnFailureMessage(error.message, "error", locale));
    assert.match(rpcTurnFailureMessage(error, locale), locale === "zh" ? /执行已中断/ : /turn was interrupted/);
    assert.equal(rpcTurnFailureMessage(error, locale, true), undefined);
  }
  assert.equal(error.code, -32603);
  assert.equal(error.message, "(interrupted)");
});

test("ordinary failures after possible side effects require checking results before continuing", () => {
  const error = "response interrupted by network failure at https://provider.invalid/private-fixture";
  for (const locale of ["zh", "en"]) {
    const notice = turnFailureMessage(error, "error", locale);
    assert.match(notice, locale === "zh" ? /本轮没有完成/ : /turn did not finish/);
    assert.match(notice, locale === "zh" ? /实际结果/ : /actual results/);
    assert.match(notice, locale === "zh" ? /避免重复上传或发送/ : /avoid duplicate uploads or messages/);
    assert.doesNotMatch(notice, /执行已中断|turn was interrupted|重试|\bretry\b|private-fixture|provider\.invalid/);
  }
});

test("an interruption word cannot hide authentication failure or replace empty-response guidance", () => {
  assert.match(turnFailureMessage("(interrupted) 403 credential rejected", "error", "zh"), /模型连接认证失败/);
  assert.match(turnFailureMessage("empty response", "empty", "en"), /no usable content/);
  assert.equal(turnFailureMessage(undefined, "paused", "zh"), undefined);
  assert.equal(turnFailureMessage(undefined, "completed", "en"), undefined);
});
