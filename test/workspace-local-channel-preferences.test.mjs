import test from "node:test";
import assert from "node:assert/strict";
import { createLocalChannelPreferencesStore, emptyChannelPreferences } from "../src/workspace-local-channel-preferences.ts";

function fixture() {
  const data = new Map();
  return { data, store: createLocalChannelPreferencesStore({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }) };
}
test("local recovery keeps 1001 selected colleagues and receipt identities while excluding bodies and credentials", () => {
  const { data, store } = fixture(), value = emptyChannelPreferences();
  const members = Array.from({ length: 1001 }, (_, index) => `member-${index}`);
  value.selectedChannelId = "room"; value.recipients.room = members; value.recipients.all = null; value.recipients.notes = [];
  value.pending.room = { requestId: "original-nonce", recipientIds: members, body: "DO_NOT_STORE_BODY", apiKey: "DO_NOT_STORE_KEY" };
  value.creation = { id: "new-room", name: "Personal discussion", memberIds: members, expectedRevision: 7, secret: "DO_NOT_STORE_SECRET" };
  store.save("workspace-A", "generation-A", { ...value, draft: "DO_NOT_STORE_DRAFT", messages: ["DO_NOT_STORE_CHAT"] });
  assert.equal(/DO_NOT_STORE/.test([...data.values()][0]), false);
  const restored = store.load("workspace-A", "generation-A");
  assert.equal(restored.selectedChannelId, "room"); assert.deepEqual(restored.recipients.room, members);
  assert.equal(restored.recipients.all, null); assert.deepEqual(restored.recipients.notes, []);
  assert.deepEqual(restored.pending.room, { requestId: "original-nonce", recipientIds: members });
  assert.equal(restored.creation.memberIds.length, 1001);
});
test("a Workspace or generation mismatch never restores another scope's channel or request", () => {
  const { data, store } = fixture(), value = emptyChannelPreferences(); value.selectedChannelId = "room";
  store.save("A", "g-A", value);
  assert.deepEqual(store.load("B", "g-A"), emptyChannelPreferences());
  assert.deepEqual(store.load("A", "g-B"), emptyChannelPreferences());
  const key = [...data.keys()][0], payload = JSON.parse(data.get(key)); payload.workspaceId = "B"; data.set(key, JSON.stringify(payload));
  assert.deepEqual(store.load("A", "g-A"), emptyChannelPreferences());
});
test("malformed preferences discard the entire record, including an otherwise valid partial selection", () => {
  const { data, store } = fixture(), value = emptyChannelPreferences(); value.selectedChannelId = "room"; store.save("A", "g-A", value);
  const key = [...data.keys()][0], original = JSON.parse(data.get(key));
  for (const payload of ["not JSON", { ...original, recipients: { good: ["member"], bad: ["duplicate", "duplicate"] } },
    { ...original, pending: { room: { requestId: "../invalid", recipientIds: [] } } },
    { ...original, creation: { id: "room", name: "unsafe\nname", memberIds: [], expectedRevision: 0 } },
    { ...original, recipients: JSON.parse('{"__proto__": ["member"]}') }]) {
    data.set(key, typeof payload === "string" ? payload : JSON.stringify(payload));
    assert.deepEqual(store.load("A", "g-A"), emptyChannelPreferences());
  }
});
test("blocked or full local storage is optional and never throws into the local channel flow", () => {
  assert.equal(createLocalChannelPreferencesStore(null), null);
  const store = createLocalChannelPreferencesStore({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } });
  assert.deepEqual(store.load("A", "g-A"), emptyChannelPreferences());
  assert.doesNotThrow(() => store.save("A", "g-A", emptyChannelPreferences()));
});
