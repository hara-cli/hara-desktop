import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient } from "../src/client.ts";
test("typed mentions require their own feature and method, never a silent plain-send downgrade", async () => {
  for (const feature of [false, true]) for (const method of [false, true]) {
    const client = new HaraClient(), calls = [];
    client.supportsFeature = name => name === "workspace.collaboration.v1" || (feature && name === "workspace.collaboration.mentions.v1");
    client.supports = name => method && name === "workspace.collaboration.send-with-mentions";
    client.call = async (name, input) => { calls.push([name, input]); return { ok: true, value: {} }; };
    const input = { workspaceId: "workspace", channelId: "channel", accountScope: "scope", body: "text", idempotencyKey: "frozen", mentions: [{ kind: "human", principalId: "person" }] };
    assert.equal((await client.sendCollaborationMentionedMessage(input)).ok, feature && method);
    assert.equal(calls.length, feature && method ? 1 : 0);
    if (calls.length) assert.deepEqual(calls[0], ["workspace.collaboration.send-with-mentions", input]);
  }
});
test("history transport needs both explicit feature and method; old clients do not send an unsupported request", async () => {
  for (const feature of [false, true]) for (const method of [false, true]) {
    const client = new HaraClient(), calls = [];
    client.supportsFeature = name => name === "workspace.collaboration.v1" || (feature && name === "workspace.collaboration.history.v1");
    client.supports = name => method && name === "workspace.collaboration.history";
    client.call = async (name, input) => { calls.push([name, input]); return { ok: true, value: { messages: [] } }; };
    const input = { workspaceId: "workspace", channelId: "channel", accountScope: "scope", before: "cursor" };
    const result = await client.readCollaborationHistory(input);
    assert.equal(result.ok, feature && method);
    assert.equal(calls.length, feature && method ? 1 : 0);
    if (calls.length) assert.deepEqual(calls[0], ["workspace.collaboration.history", input]);
  }
});
test("member transport also requires its exact feature and method without falling back to local Agents", async () => {
  for (const feature of [false, true]) for (const method of [false, true]) {
    const client = new HaraClient(), calls = [];
    client.supportsFeature = name => name === "workspace.collaboration.v1" || (feature && name === "workspace.collaboration.members.v1");
    client.supports = name => method && name === "workspace.collaboration.members";
    client.call = async (name, input) => { calls.push([name, input]); return { ok: true, value: { members: [] } }; };
    const input = { workspaceId: "workspace", accountScope: "scope", cursor: "opaque" };
    assert.equal((await client.listCollaborationMembers(input)).ok, feature && method);
    assert.equal(calls.length, feature && method ? 1 : 0);
    if (calls.length) assert.deepEqual(calls[0], ["workspace.collaboration.members", input]);
  }
});
