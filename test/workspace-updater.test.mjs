import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceUpdater, UPDATE_INTERVAL, updateDefaults, shouldNotify, newerVersion, hasUpdateAttention } from "../src/workspace-updater-state.ts";
function fixture(extra = {}) {
  let now = 0, current = updateDefaults(), checks = 0, installs = 0, restarts = 0, prepares = 0, running = 0, downloads = 0, closes = 0;
  const handle = { version: "0.1.189", body: "Fixture notes", async close() { closes++; }, async download(progress) { downloads++; progress({ event: "Started", data: { contentLength: 100 } }); progress({ event: "Progress", data: { chunkLength: 100 } }); progress({ event: "Finished" }); }, async install() { installs++; } };
  const controller = new WorkspaceUpdater({ load: async () => current, save: async value => { current = structuredClone(value); }, check: async () => { checks++; return handle; },
    activity: async () => ({ running }), prepare: async () => { prepares++; if (running) throw new Error("fixture busy"); return { id: "lease" }; }, release: async () => {}, restart: async () => { restarts++; }, error: () => "安全的更新失败提示", now: () => now, ...extra });
  return { controller, handle, clock(value) { now = value; }, busy(value) { running = value; }, counts: () => ({ checks, installs, restarts, prepares, downloads, closes }), preferences: () => current };
}
test("automatic check waits 30 seconds, uses six-hour cadence and catches up after sleep without duplicate requests", async () => {
  const f = fixture(); try { await f.controller.start(); f.clock(29999); await f.controller.wake(); assert.equal(f.counts().checks, 0);
    f.clock(30000); await Promise.all([f.controller.wake(), f.controller.wake()]); assert.equal(f.counts().checks, 1);
    f.clock(30000 + UPDATE_INTERVAL - 1); await f.controller.wake(); assert.equal(f.counts().checks, 1);
    f.clock(30000 + UPDATE_INTERVAL * 2); await f.controller.wake(); assert.equal(f.counts().checks, 2);
    await f.controller.setAutoCheck(false); f.clock(UPDATE_INTERVAL * 9); await f.controller.wake(); assert.equal(f.counts().checks, 2);
    await f.controller.check(true); assert.equal(f.counts().checks, 3);
  } finally { f.controller.dispose(); }
});
test("snooze is 24 hours, skip persists until a higher version and manual check still shows skipped versions", async () => {
  const f = fixture(); try { await f.controller.check(); await f.controller.later(); assert.equal(f.preferences().snooze.until, 86400000);
    await f.controller.check(false); assert.equal(f.controller.getSnapshot().notice, false);
    f.clock(86400001); await f.controller.check(false); assert.equal(f.controller.getSnapshot().notice, true);
    await f.controller.skip(); await f.controller.check(false); assert.equal(f.controller.getSnapshot().notice, false); assert.equal(hasUpdateAttention(f.controller.getSnapshot()), false);
    await f.controller.check(true); assert.equal(f.controller.getSnapshot().notice, true);
    assert.equal(shouldNotify("0.1.190", f.preferences(), 86400001), true); assert.equal(shouldNotify("0.1.188", f.preferences(), 86400001), false);
    assert.equal(newerVersion("0.1.189-rc.10", "0.1.189-rc.2"), true); assert.equal(newerVersion("0.1.189", "0.1.189-rc.2"), true);
  } finally { f.controller.dispose(); }
});
test("download and signature completion are separate from installation; work in any Workspace blocks restart", async () => {
  const f = fixture(); try {
    await f.controller.check(); f.busy(2); await Promise.all([f.controller.download(), f.controller.download()]);
    assert.equal(f.counts().downloads, 1); assert.equal(f.controller.getSnapshot().phase, "ready"); assert.equal(f.counts().installs, 0); assert.equal(f.counts().restarts, 0);
    await f.controller.restart(); assert.equal(f.counts().prepares, 0); assert.equal(f.counts().installs, 0); assert.match(f.controller.getSnapshot().message, /同事正在工作/);
    f.busy(0); await f.controller.restart(); assert.equal(f.counts().installs, 1); assert.equal(f.counts().restarts, 1); assert.equal(f.counts().prepares, 1);
  } finally { f.controller.dispose(); }
});
test("Finished event cannot claim signature validation or installation after signature failure", async () => {
  const f = fixture(); f.handle.download = async progress => { progress({ event: "Finished" }); assert.equal(f.controller.getSnapshot().phase, "downloading"); throw new Error("fixture invalid signature"); };
  try { await f.controller.check(); await f.controller.download(); assert.equal(f.controller.getSnapshot().phase, "error"); await f.controller.restart(); assert.equal(f.counts().installs, 0); assert.equal(f.counts().restarts, 0); }
  finally { f.controller.dispose(); }
});
test("automatic network errors are silent, manual result remains actionable, and no automatic retry occurs", async () => {
  let calls = 0; const f = fixture({ check: async () => { calls++; throw new Error("fixture network unavailable"); } });
  try { await f.controller.start(); f.clock(30000); await f.controller.wake(); assert.equal(f.controller.getSnapshot().phase, "error"); assert.equal(f.controller.getSnapshot().notice, false);
    f.clock(31000); await f.controller.wake(); assert.equal(calls, 1); await f.controller.check(); assert.equal(calls, 2);
  } finally { f.controller.dispose(); }
});
test("StrictMode cleanup/restart ignores the first delayed load and does not schedule duplicate owners", async () => {
  const loads = []; const f = fixture({ load: () => new Promise(resolve => loads.push(resolve)) });
  try { const first = f.controller.start(); f.controller.dispose(); const second = f.controller.start();
    loads[0]({ ...updateDefaults(), autoCheck: false }); await first;
    loads[1](updateDefaults()); await second; f.clock(30000); await f.controller.wake(); assert.equal(f.counts().checks, 1);
  } finally { f.controller.dispose(); }
});
test("an atomic host prepare refusal also blocks install when work starts after the visible idle check", async () => {
  const f = fixture({ prepare: async () => { throw new Error("fixture task won the admission race"); } });
  try { await f.controller.check(); await f.controller.download(); await f.controller.restart(); assert.equal(f.counts().installs, 0); assert.equal(f.counts().restarts, 0); assert.equal(f.controller.getSnapshot().installing, false); }
  finally { f.controller.dispose(); }
});
