import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorkspaceWorkScopeSource, bindWorkspaceWorkScopeSource, workScopeSource, workScopeVersion, subscribeWorkScope, visibleWorkScope } from "../src/workspace-work-scope.ts";
const docs = JSON.parse(readFileSync(new URL("./fixtures/agent-boundaries-v1.json", import.meta.url), "utf8")).valid;
const originalDuty = docs.find(row => row.document.kind === "duty-profile").document;
const originalBoundary = docs.find(row => row.document.kind === "execution-boundary").document;
const unavailable = error => error.code === "AUTHORITY_UNVERIFIED" || error.code === "CONTEXT_MISMATCH" || error.code === "INVALID_DOCUMENT";
function fixture() {
  const duty = structuredClone(originalDuty), boundary = { ...structuredClone(originalBoundary), context: structuredClone(duty.context), agentId: duty.agentId };
  const target = { workspaceId: duty.context.scope.workspaceId, generation: duty.context.resourceBinding.generation, agentId: duty.agentId, agentEpoch: 1, configRevision: 1 };
  const provenance = { channel: "local_human", proofRef: "owner-connection-proof" };
  const state = { context: duty.context, provenance, revision: 1, agent: { agentId: duty.agentId, agentEpoch: 1, configRevision: 1 }, configured: true, current: true,
    policy: { agentId: duty.agentId, revision: 1, agentEpoch: 1, configRevision: 1, rights: { manage: false, invoke: false, privateRead: false, nodeUse: false }, duty, boundary,
      resources: boundary.resources.map(row => ({ resourceId: row.resourceId, revision: 1 })) }, executors: [],
    identityReservations: { account: null, device: null, membership: null, remoteExecution: false }, runtimeEnforced: false };
  const listeners = new Set(); let closed = false, epoch = 1, calls = 0, reply = state, pending = null, description;
  const bridge = {
    capture() { return closed ? null : { connectionId: "private-owner-socket", connectionEpoch: epoch, capabilities: ["workspace.agent-boundaries.authority.v1"], context: state.context, provenance,
      assertCurrent() { if (closed) throw new Error("closed"); } }; },
    async read() { calls++; if (pending) await pending; return reply; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    describeResources(_target, refs) { return description ?? refs.map(row => ({ ...row, label: "Accounts", path: "/private/fixture/Accounts" })); },
  };
  const source = createWorkspaceWorkScopeSource(bridge);
  return { source, bridge, target, state, get calls() { return calls; }, listeners, setReply(value) { reply = value; }, setDescriptions(value) { description = value; },
    defer(promise) { pending = promise; }, close() { closed = true; for (const fn of listeners) fn(); }, changeConnection() { epoch++; for (const fn of listeners) fn(); } };
}
test("C5 capability strings and JSON claims do not bind any read source", () => {
  const model = { supportsCapability: () => true, request() { assert.fail("no boundary RPC"); } };
  assert.equal(workScopeSource(model), null);
  for (const raw of [{ approved: true }, { capture: {}, read: true, subscribe: null }]) {
    assert.throws(() => createWorkspaceWorkScopeSource(raw), unavailable);
    assert.throws(() => bindWorkspaceWorkScopeSource(model, raw), unavailable);
  }
  assert.equal(workScopeSource(model), null);
});
test("C5 fresh read uses C0 public fields, exact resources and Host labels without issuing any right", async () => {
  const f = fixture(), capture = f.source.capture(f.target), view = await f.source.read(capture);
  assert.equal(view.state, "saved"); assert.deepEqual(view.profile, f.state.policy.duty.publicProfile);
  assert.deepEqual(view.tools, f.state.policy.boundary.tools);
  assert.deepEqual(view.approvals, f.state.policy.boundary.approvalRequired);
  assert.equal(f.calls, 1); assert.ok(Object.isFrozen(view.profile));
  assert.equal(JSON.stringify(view).includes(f.state.context.humanSubjectId), false);
  assert.equal(JSON.stringify(capture).includes("owner-connection-proof"), false);
  assert.equal("rights" in view, false); assert.equal("permit" in view, false); assert.equal("context" in view, false);
  if (view.resources.length) assert.equal(view.resources[0].label, "Accounts");
});
for (const bad of [true, { approved: true }, Promise.resolve(undefined)]) test(`C5 liveness fence refuses ${typeof bad === "object" && bad instanceof Promise ? "Promise" : JSON.stringify(bad)}`, () => {
  const f = fixture(); f.bridge.capture = () => ({ connectionId: "owner", connectionEpoch: 1, capabilities: ["workspace.agent-boundaries.authority.v1"], context: f.state.context, provenance: f.state.provenance, assertCurrent: () => bad });
  assert.equal(f.source.capture(f.target), null); assert.equal(f.calls, 0);
});
test("C5 missing capability, other scope, old Agent version and foreign principal do not disclose", async () => {
  const f = fixture(); const normal = f.bridge.capture;
  f.bridge.capture = () => ({ ...normal(), capabilities: [] }); assert.equal(f.source.capture(f.target), null); assert.equal(f.calls, 0);
  f.bridge.capture = normal;
  assert.equal(f.source.capture({ ...f.target, workspaceId: "ws_other" }), null);
  const capture = f.source.capture(f.target);
  f.setReply({ ...f.state, agent: { ...f.state.agent, configRevision: 2 } }); await assert.rejects(f.source.read(capture), unavailable);
  f.setReply({ ...f.state, context: { ...f.state.context, nodeId: "other", localGrant: { ...f.state.context.localGrant, nodeId: "other" } } }); await assert.rejects(f.source.read(capture), unavailable);
});
test("C5 JSON round-trip cannot forge the opaque read capture", async () => {
  const f = fixture(), capture = f.source.capture(f.target);
  await assert.rejects(f.source.read(JSON.parse(JSON.stringify(capture))), unavailable); assert.equal(f.calls, 0);
});
test("C5 old data and the old proof fail after a physical connection changes", async () => {
  const f = fixture(), capture = f.source.capture(f.target); f.changeConnection();
  assert.equal(f.source.current(capture), false); await assert.rejects(f.source.read(capture), unavailable); assert.equal(f.calls, 0);
  f.setReply({ ...f.state, provenance: { ...f.state.provenance, proofRef: "old-other-proof" } });
  await assert.rejects(f.source.read(f.source.capture(f.target)), unavailable);
});
test("C5 late reply cannot survive connection revocation or be cached into a new scope", async () => {
  const f = fixture(); let release; f.defer(new Promise(resolve => { release = resolve; }));
  const pending = f.source.read(f.source.capture(f.target)); f.close(); release();
  await assert.rejects(pending, unavailable); assert.equal(f.source.capture(f.target), null);
});
test("C5 retained noncurrent policy shows only unconfirmed, never its private title", async () => {
  const f = fixture(); f.state.current = false; f.state.policy.duty.publicProfile.title = "old-private-title";
  const view = await f.source.read(f.source.capture(f.target)); assert.deepEqual(view, { state: "unconfirmed" }); assert.equal(JSON.stringify(view).includes("private"), false);
});
test("C5 malformed fields/getters/future authority never become an empty allow", async () => {
  const f = fixture(), capture = f.source.capture(f.target); let reads = 0;
  const raw = { ...f.state }; Object.defineProperty(raw, "policy", { enumerable: true, get() { reads++; return f.state.policy; } });
  f.setReply(raw); await assert.rejects(f.source.read(capture), unavailable); assert.equal(reads, 0);
  f.setReply({ ...f.state, runtimeEnforced: true }); await assert.rejects(f.source.read(capture), unavailable);
  f.setReply({ ...f.state, policy: { ...f.state.policy, duty: { ...f.state.policy.duty, publicProfile: { ...f.state.policy.duty.publicProfile, rights: "all" } } } }); await assert.rejects(f.source.read(capture), unavailable);
});
test("C5 folder display only accepts the exact current Host registry reference", async () => {
  const f = fixture(); f.setDescriptions([{ resourceId: "other-private-folder", revision: 1, label: "not for this card", path: "/other/private" }]);
  await assert.rejects(f.source.read(f.source.capture(f.target)), unavailable);
  const g = fixture(); g.bridge.describeResources = undefined; const view = await g.source.read(g.source.capture(g.target));
  for (const row of view.resources) { assert.equal(row.label, null); assert.equal(row.path, null); }
});
test("C5 registered sources have independent listener cleanup and clear on unbind", () => {
  const model = {}, f = fixture(); let calls = 0;
  const stopBad = subscribeWorkScope(model, () => { throw new Error("one view"); }), stop = subscribeWorkScope(model, () => calls++);
  const unbind = bindWorkspaceWorkScopeSource(model, f.source); assert.equal(workScopeSource(model), f.source); const before = workScopeVersion(model);
  f.changeConnection(); assert.ok(workScopeVersion(model) > before); assert.equal(calls, 2);
  unbind(); assert.equal(workScopeSource(model), null); assert.equal(f.listeners.size, 0); stop(); stopBad();
});

test("C5 cancelled reads never dispatch or publish a late resource projection", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.source.read(f.source.capture(f.target), controller.signal), unavailable); assert.equal(f.calls, 0);
  const g = fixture(), running = new AbortController(); let release;
  g.defer(new Promise(resolve => { release = resolve; }));
  const pending = g.source.read(g.source.capture(g.target), running.signal);
  running.abort(); release(); await assert.rejects(pending, unavailable);
});

test("C5 a different human, device or node cannot replay a current policy projection", async () => {
  for (const patch of [{ humanSubjectId: "foreign-human" }, { deviceId: "foreign-device" }, { nodeId: "foreign-node" }]) {
    const f = fixture(), capture = f.source.capture(f.target);
    const context = { ...f.state.context, ...patch };
    if (patch.nodeId) context.localGrant = { ...context.localGrant, nodeId: patch.nodeId };
    f.setReply({ ...f.state, context }); await assert.rejects(f.source.read(capture), unavailable);
  }
});

test("C5 M1 changed capture key excludes prior ready/error before any effect runs", async () => {
  const f = fixture(), view = await f.source.read(f.source.capture(f.target));
  const ready = Object.freeze({ key: "1:1", state: "ready", view });
  const error = Object.freeze({ key: "1:1", state: "error" });
  for (const nextKey of ["1:2", "2:1", "2:2"]) {
    for (const previous of [ready, error]) {
      const shown = visibleWorkScope(previous, nextKey);
      assert.deepEqual(shown, { key: nextKey, state: "loading" }, "M1 mismatched snapshot must not render previous ready/error");
      assert.equal("view" in shown, false);
      assert.equal(JSON.stringify(shown).includes(view.profile.title), false);
    }
  }
  assert.equal(visibleWorkScope(ready, "1:1"), ready, "Only the current capture may reuse its ready projection");
  assert.equal(visibleWorkScope(error, "1:1"), error);
  assert.deepEqual(visibleWorkScope(null, "1:1"), { key: "1:1", state: "loading" });
  assert.equal(f.calls, 1, "Visibility selection performs no additional read or effect");
});
