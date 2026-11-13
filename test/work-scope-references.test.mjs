import test from "node:test";
import assert from "node:assert/strict";
import { createWorkScopeReferenceStore, parseWorkScopeReference, workScopeReferenceNamespace } from "../src/work-scope-references.ts";
function memory() {
  const values = new Map();
  return { values, get length() { return values.size; }, key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
}
const prefix = "hara.work-scope.pending.v1:fixture:";
const ref = commandId => ({ schemaVersion: 1, workspaceId: "workspace", generation: "generation", scopeKey: "a".repeat(64), agentId: "agent",
  contextDigest: "b".repeat(64), commandId, rootRequestId: "root-" + commandId, intentDigest: "c".repeat(64), proposalDigest: "d".repeat(64), action: "duty.update" });
const held = error => error.code === "CONTROL_HELD";
test("C5 pending store only keeps minimal scoped non-secret command references", () => {
  const storage = memory(), store = createWorkScopeReferenceStore(storage), a = ref("command-a"); store.put(prefix, a);
  assert.deepEqual(store.list(prefix), [a]); assert.ok(Object.isFrozen(store.list(prefix)[0]));
  for (const field of ["proposal", "command", "credential", "approved", "context"]) assert.throws(() => store.put(prefix, { ...a, [field]: {} }), held);
  assert.deepEqual(store.list(prefix), [a]);
});
test("C5 two windows retain separate unknown references and only resolve the exact terminal ID", () => {
  const storage = memory(), a = createWorkScopeReferenceStore(storage), b = createWorkScopeReferenceStore(storage);
  a.put(prefix, ref("command-a")); b.put(prefix, ref("command-b"));
  assert.equal(a.list(prefix).length, 2); b.remove(prefix, ref("command-b")); assert.deepEqual(a.list(prefix), [ref("command-a")]);
  assert.throws(() => a.put(prefix, { ...ref("command-a"), intentDigest: "f".repeat(64) }), held);
  assert.throws(() => a.remove(prefix, { ...ref("command-a"), proposalDigest: "f".repeat(64) }), held);
  assert.deepEqual(a.list(prefix), [ref("command-a")]);
});
test("C5 malformed/unknown reference data is preserved and holds new work", () => {
  const storage = memory(), store = createWorkScopeReferenceStore(storage), key = prefix + "command-a";
  storage.setItem(key, '{"schemaVersion":2,"privateUniqueData":"preserve"}'); assert.throws(() => store.list(prefix), held);
  assert.equal(storage.getItem(key), '{"schemaVersion":2,"privateUniqueData":"preserve"}');
  let reads = 0; const raw = ref("command-b"); Object.defineProperty(raw, "intentDigest", { enumerable: true, get() { reads++; return "c".repeat(64); } });
  assert.throws(() => parseWorkScopeReference(raw), held); assert.equal(reads, 0);
});
test("C5 storage quota failure propagates and no unrelated records are changed", () => {
  const storage = memory(); storage.setItem("other-product-key", "private"); const store = createWorkScopeReferenceStore({ ...storage, get length() { return storage.length; }, setItem() { throw Error("quota"); } });
  assert.throws(() => store.put(prefix, ref("command-a")), /quota/); assert.equal(storage.getItem("other-product-key"), "private");
});
test("C5 generation, human, node and agent namespaces never collide on delimiter-like IDs", () => {
  const identity = { context: { resourceBinding: { scopeKey: "a".repeat(64), generation: "generation" }, scope: { workspaceId: "workspace" }, humanSubjectId: "human", nodeId: "node", deviceId: null }, target: { agentId: "a:b" } };
  const a = workScopeReferenceNamespace(identity), b = workScopeReferenceNamespace({ ...identity, target: { agentId: "a" } });
  assert.equal(a.startsWith(b), false); assert.notEqual(a, workScopeReferenceNamespace({ ...identity, context: { ...identity.context, humanSubjectId: "other" } }));
  assert.notEqual(a, workScopeReferenceNamespace({ ...identity, context: { ...identity.context, resourceBinding: { ...identity.context.resourceBinding, generation: "new" } } }));
});

test("C5 reference identity is property-order independent; concurrent enumeration cannot hide an unknown", () => {
  const storage = memory(), store = createWorkScopeReferenceStore(storage), original = ref("command-a");
  store.put(prefix, original); store.put(prefix, Object.fromEntries(Object.entries(original).reverse()));
  store.put(prefix, ref("command-b")); let changed = false;
  const racing = createWorkScopeReferenceStore({ get length() { return storage.length; }, key(index) { const key = storage.key(index); if (!changed) { changed = true; storage.removeItem(prefix + "command-a"); } return key; },
    getItem: key => storage.getItem(key), setItem: (key,value) => storage.setItem(key,value), removeItem: key => storage.removeItem(key) });
  assert.throws(() => racing.list(prefix), held); assert.deepEqual(store.list(prefix), [ref("command-b")]);
});


test("C5 v2 references require paired original ISO deadlines; legacy v1 stays readable without guessing expiry", () => {
  const base = { schemaVersion: 1, workspaceId: "workspace", generation: "generation", scopeKey: "1".repeat(64), agentId: "agent", contextDigest: "2".repeat(64),
    commandId: "command", rootRequestId: "root", intentDigest: "3".repeat(64), proposalDigest: "4".repeat(64), action: "duty.update" };
  const issuedAt = "2026-11-13T00:00:00.000Z", notAfter = "2026-11-13T00:00:30.000Z";
  assert.equal(parseWorkScopeReference(base).schemaVersion, 1);
  assert.equal(parseWorkScopeReference({ ...base, schemaVersion: 2, issuedAt, notAfter }).notAfter, notAfter);
  for (const patch of [{ schemaVersion: 2 }, { schemaVersion: 2, issuedAt }, { schemaVersion: 2, issuedAt, notAfter: issuedAt },
    { schemaVersion: 2, issuedAt, notAfter: "2026-11-13T00:01:00.000Z" }, { schemaVersion: 1, issuedAt, notAfter }]) {
    assert.throws(() => parseWorkScopeReference({ ...base, ...patch }), held);
  }
});
