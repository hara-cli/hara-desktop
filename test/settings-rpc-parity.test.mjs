import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { BASELINE, SCENARIOS, recordSettingsRpc, settingsModelCalls } from "./support/settings-rpc-scenarios.mjs";

/**
 * S4b (settings IA audit): the Settings cleanup S0–S4 and the engine Check must send the same Core calls, with the same
 * parameters, as before the cleanup. The fixture was recorded on integrate fa844bf (before S0) with the same scenarios.
 */
const fixture = JSON.parse(readFileSync(new URL("./fixtures/settings-rpc-baseline.json", import.meta.url), "utf8"));
const read = file => { const url = new URL(`../src/${file}`, import.meta.url); return existsSync(url) ? readFileSync(url, "utf8") : null; };

/** Calls the cleanup added on purpose, by model method, each with its reason. Anything else new fails. */
const ADDED = {
  supportsDefaultRuntime: "S1b/G1: the per-workspace default engine is shown only when Core advertises workspace.default-runtime.v1",
  defaultRuntime: "S1b/G1: read the per-workspace default engine (Core contract 2026-11-13)",
  saveDefaultRuntime: "S1b/G1: save it with the optimistic lock (value.revision)",
  supportsConnectionModels: "#98: Pi can be checked only when Core lists connection models",
  listRuntimeModels: "#98 (DESIGN 2.1.2 §11.4): the user-pressed «Check» on an enabled engine",
  listConnectionModels: "#98: the user-pressed «Check» on Pi, through the workspace connection",
};
const method = call => call.match(/^[\w.]+?\.(\w+)\(/)[1];

test("the fixture is the recorded baseline for the current scenario list", () => {
  assert.equal(fixture.baseline, BASELINE);
  assert.deepEqual(fixture.rpc.map(row => row.name), SCENARIOS.map(([name]) => name));
  assert.ok(fixture.rpc.every(row => row.calls.length > 0), "every operation reaches Core in the scenario, so the comparison means something");
});

test("every Settings operation sends the same Core methods with the same parameters as before the cleanup", async () => {
  const current = await recordSettingsRpc(WorkspaceDevModel);
  for (const [index, row] of fixture.rpc.entries()) assert.deepEqual(current[index].calls, row.calls, row.name);
  assert.deepEqual(current.map(row => row.outcome), fixture.rpc.map(row => row.outcome), "replies are handled the same way");
});

test("the Settings screens still make every model call they made before; new calls are only the listed, intended ones", () => {
  const now = settingsModelCalls(ts, read), before = fixture.modelCalls;
  assert.deepEqual(before.filter(call => !now.includes(call)), [], "no baseline call was dropped or changed its arguments");
  const added = now.filter(call => !before.includes(call));
  assert.deepEqual(added.filter(call => !ADDED[method(call)]), [], "unexplained new model calls");
  for (const call of added) assert.ok(ADDED[method(call)].length > 20, call);
});
