import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WorkspaceViewError } from "../src/workspace-dev-errors.ts";
import { updateDefaults } from "../src/workspace-updater-state.ts";
import { createEngineFreeUpdater, engineUnreachable, LOCAL_UPDATE_PREFERENCES_KEY, readLocalUpdatePreferences, withEngineOffline } from "../src/workspace-update-offline.ts";

// HARA-FB-001698: Windows 1.0.3–1.2.1 could not install a fix because every install path needed the engine.
function memoryStorage(initial = {}) { const map = new Map(Object.entries(initial)); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, String(value)); }, map }; }
function fixture({ stopped = true, storage = memoryStorage() } = {}) {
  let installs = 0, restarts = 0, stops = 0;
  const handle = { version: "1.2.2", body: "", async close() {}, async download(progress) { progress({ event: "Started", data: { contentLength: 10 } }); progress({ event: "Finished" }); }, async install() { installs++; } };
  const controller = createEngineFreeUpdater({ check: async () => handle, engineStopped: async () => { stops++; if (stopped instanceof Error) throw stopped; return stopped; },
    restart: async () => { restarts++; }, storage, error: () => "ws.updates.networkFailed", now: () => 0 });
  return { controller, storage, counts: () => ({ installs, restarts, stops }) };
}

test("the startup-failure updater checks, verifies and installs with no engine RPC when no engine runs", async () => {
  const f = fixture(); try {
    await f.controller.start(); assert.equal(f.controller.getSnapshot().preferences.autoCheck, true, "missing local preferences keep automatic checks on");
    await f.controller.check(false); assert.equal(f.controller.getSnapshot().phase, "available"); assert.equal(f.controller.getSnapshot().notice, true);
    await f.controller.download(); assert.equal(f.controller.getSnapshot().phase, "ready");
    await f.controller.restart(); assert.equal(f.counts().installs, 1); assert.equal(f.counts().restarts, 1); assert.ok(f.counts().stops >= 1, "native stop check consulted");
    assert.equal(JSON.parse(f.storage.map.get(LOCAL_UPDATE_PREFERENCES_KEY)).lastChecked, 0);
  } finally { f.controller.dispose(); }
});

test("a possibly running engine, or an unanswerable native check, keeps the install refused", async () => {
  for (const stopped of [false, new Error("native bridge unavailable")]) {
    const f = fixture({ stopped }); try {
      await f.controller.check(); await f.controller.download(); await f.controller.restart();
      assert.equal(f.counts().installs, 0); assert.equal(f.counts().restarts, 0); assert.equal(f.controller.getSnapshot().installing, false);
    } finally { f.controller.dispose(); }
  }
});

test("local preferences are validated and a user's choice to turn checks off is kept", () => {
  assert.deepEqual(readLocalUpdatePreferences(null), updateDefaults());
  assert.deepEqual(readLocalUpdatePreferences(memoryStorage({ [LOCAL_UPDATE_PREFERENCES_KEY]: "{not json" })), updateDefaults());
  assert.deepEqual(readLocalUpdatePreferences(memoryStorage({ [LOCAL_UPDATE_PREFERENCES_KEY]: JSON.stringify({ autoCheck: false, lastChecked: 5, skippedVersion: "../x", snooze: { version: "1.2.2", until: 9 } }) })),
    { autoCheck: false, lastChecked: 5, skippedVersion: null, snooze: { version: "1.2.2", until: 9 } });
});

test("only an unreachable engine that Desktop shows stopped bypasses the engine's idle lease", async () => {
  const lost = new WorkspaceViewError("ws.rpc.notConnected"), busy = new Error("fixture task won the admission race");
  assert.equal(engineUnreachable(lost), true); assert.equal(engineUnreachable(new WorkspaceViewError("ws.rpc.transportLost")), true); assert.equal(engineUnreachable(busy), false);
  assert.deepEqual(await withEngineOffline(async () => { throw lost; }, { id: "" }, async () => true), { id: "" });
  await assert.rejects(withEngineOffline(async () => { throw lost; }, { id: "" }, async () => false), lost);
  await assert.rejects(withEngineOffline(async () => { throw lost; }, { id: "" }, async () => { throw new Error("bridge"); }), lost);
  await assert.rejects(withEngineOffline(async () => { throw busy; }, { id: "" }, async () => true), busy, "a live engine's refusal is never bypassed");
  assert.deepEqual(await withEngineOffline(async () => ({ id: "lease" }), { id: "" }, async () => { throw new Error("not consulted"); }), { id: "lease" });
});

test("the startup-failure screen and the connected updater are wired to the engine-free paths", () => {
  const local = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");
  assert.match(local, /<WorkspaceBoot view=\{view\}[^\n]*update=\{<WorkspaceBootUpdate \/>\} \/>/);
  const updates = readFileSync(new URL("../src/WorkspaceSoftwareUpdate.tsx", import.meta.url), "utf8");
  assert.match(updates, /activity: \(\) => withEngineOffline\(\(\) => model\.activity\(\), \{ running: 0 \}, engineStopped\)/);
  assert.match(updates, /prepare: \(\) => withEngineOffline\(\(\) => model\.prepareUpdate\(\), \{ id: "" \}, engineStopped\)/);
  assert.match(updates, /invoke<boolean>\("workspace_engine_stopped"\)/);
  assert.match(readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"), /desktop_restart_for_update,\n\s+workspace_engine_stopped,/);
});
