import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SettingsLeaveGuard } from "../src/settings-leave-guard.ts";

function fixture() {
  let context = { workspaceId: "A", generation: "a1", page: "connections" };
  const actions = [], guard = new SettingsLeaveGuard(() => context, action => actions.push(action));
  return { guard, actions, context(value) { context = { ...context, ...value }; } };
}
test("dirty page, scope, close and skill navigation all wait for a visible decision", () => {
  for (const action of [{ kind: "page", page: "appearance" }, { kind: "scope", workspaceId: "B" }, { kind: "close" }, { kind: "skill", workspaceId: "A" }]) {
    const f = fixture(); f.guard.setDirty(true); f.guard.request(action);
    assert.deepEqual(f.actions, []); assert.deepEqual(f.guard.getSnapshot()?.action, action);
    assert.equal(f.guard.confirm(), "committed"); assert.deepEqual(f.actions, [action]);
  }
});
test("cancel and Escape semantics retain dirty edits, and the next navigation asks again", () => {
  const f = fixture(); f.guard.setDirty(true); f.guard.request({ kind: "close" }); f.guard.cancel();
  assert.equal(f.guard.getSnapshot(), null); assert.deepEqual(f.actions, []);
  f.guard.request({ kind: "page", page: "updates" }); assert.ok(f.guard.getSnapshot()); assert.deepEqual(f.actions, []);
});
test("a repeated click neither replaces the pending target nor commits it twice", () => {
  const f = fixture(); f.guard.setDirty(true); f.guard.request({ kind: "scope", workspaceId: "B" });
  f.guard.request({ kind: "close" }); assert.deepEqual(f.guard.getSnapshot().action, { kind: "scope", workspaceId: "B" });
  assert.equal(f.guard.confirm(), "committed"); assert.equal(f.guard.confirm(), "none");
  assert.deepEqual(f.actions, [{ kind: "scope", workspaceId: "B" }]);
});
test("changed workspace, generation or page invalidates the original confirmation", () => {
  for (const changed of [{ workspaceId: "B" }, { generation: "a2" }, { page: "skills" }]) {
    const f = fixture(); f.guard.setDirty(true); f.guard.request({ kind: "close" }); f.context(changed);
    assert.equal(f.guard.confirm(), "stale"); assert.equal(f.guard.getSnapshot(), null); assert.deepEqual(f.actions, []);
  }
});
test("saved or unchanged forms navigate immediately; store snapshots and subscriptions are stable", () => {
  const f = fixture(); let notices = 0; const unsubscribe = f.guard.subscribe(() => notices++);
  f.guard.request({ kind: "close" }); assert.deepEqual(f.actions, [{ kind: "close" }]); assert.equal(notices, 0);
  f.guard.setDirty(true); f.guard.request({ kind: "page", page: "skills" });
  assert.equal(f.guard.getSnapshot(), f.guard.getSnapshot()); assert.equal(notices, 1);
  f.guard.cancel(); assert.equal(notices, 2); unsubscribe(); f.guard.setDirty(false);
  f.guard.request({ kind: "close" }); assert.equal(notices, 2); assert.equal(f.actions.length, 2);
});
test("browser extension stacks a non-stretching address toolbar above a flexing preview", () => {
  const css = readFileSync(new URL("../src/workspace-browser.css", import.meta.url), "utf8");
  assert.equal(/\.hs-browser\s*\{[^}]*flex-direction:\s*column/.test(css), true, "preview uses a vertical flex container");
  assert.equal(/\.hs-browser-address\s*\{[^}]*flex:\s*0\s+0\s+auto/.test(css), true, "address toolbar cannot stretch or shrink into the iframe");
  assert.equal(/\.hs-browser-address\s+\.hs-btn\s*\{[^}]*flex-shrink:\s*0/.test(css), true, "address actions keep their click targets");
  assert.equal(/\.hs-browser\s+iframe\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/.test(css), true, "iframe uses the remaining panel height");
});
