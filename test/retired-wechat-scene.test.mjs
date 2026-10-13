import assert from "node:assert/strict";
import test from "node:test";
import { stopRetiredWechatScene } from "../src/retired-wechat-scene.ts";

test("a new engine without the retired scene receives no legacy operation", async () => {
  await stopRetiredWechatScene({ supports: method => { assert.equal(method, "settings.wechat-group.stop"); return false; },
    stopWechatGroupScene: () => assert.fail("no legacy scene exists") });
});

test("an older engine is asked to stop only its local group scene once, not owner DMs or Agents", async () => {
  let stops = 0;
  await stopRetiredWechatScene({ supports: () => true, stopWechatGroupScene: async () => {
    stops += 1; return { active: false, managedArmed: false };
  } });
  assert.equal(stops, 1);
});

for (const value of [null, {}, { active: true }, { active: false, managedArmed: true }]) {
  test(`an uncertain retirement is not reported stopped (${JSON.stringify(value)})`, async () => {
    await assert.rejects(stopRetiredWechatScene({ supports: () => true, stopWechatGroupScene: async () => value }), /not confirmed stopped/);
  });
}

test("a lost stop ACK is not retried or exposed as an arbitrary upstream error", async () => {
  let stops = 0;
  await assert.rejects(stopRetiredWechatScene({ supports: () => true, stopWechatGroupScene: async () => {
    stops += 1; throw new Error("synthetic private error");
  } }), error => /not confirmed stopped/.test(error.message) && !/synthetic private/.test(error.message));
  assert.equal(stops, 1);
});
