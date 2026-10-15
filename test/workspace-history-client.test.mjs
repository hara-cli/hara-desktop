import assert from "node:assert/strict";
import test from "node:test";
import { HaraClient } from "../src/client.ts";
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
