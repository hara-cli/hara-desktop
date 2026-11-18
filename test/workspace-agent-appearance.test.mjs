import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { WorkspaceRpcWaitError } from "../src/workspace-dev-errors.ts";
import { agentAccent } from "../src/agent-visual.ts";

const method = "workspace.agents.updatePersona";
const colleague = {
  agentId: "colleague", kind: "colleague", state: "active", configRevision: 4, agentEpoch: 2,
  identity: { displayName: "Fixture", accent: "#d1667b", avatarStyle: "hex" },
  runtime: { id: "pi", label: "Pi", available: true }, initialAccent: "#c68a72",
};
const main = { ...colleague, agentId: "main", kind: "main" };

function fixture({ capable = true, selected = colleague, onWrite } = {}) {
  const calls = [];
  const model = new WorkspaceDevModel({
    supportsCapability: name => name === "workspace.agents.appearance.v1" && capable,
    async request(name, params) {
      calls.push({ name, params });
      if (name === "workspace.list") return { revision: 1, syntheticOnly: true, workspaces: ["A", "B"].map(workspaceId => ({ workspaceId, active: true })) };
      if (name === method) return onWrite?.();
      const workspaceId = params.workspaceId;
      return {
        workspaceId, resourceGeneration: `generation-${workspaceId}`, label: workspaceId, syntheticOnly: true,
        selectedAgentId: selected.agentId, agents: [main, colleague], approvals: [],
        connections: { revision: 0, connections: [] },
        conversation: { revision: 0, history: [], state: "idle", sessionId: `${workspaceId}-${selected.agentId}` },
      };
    },
  });
  return { model, calls, writes: () => calls.filter(call => call.name === method) };
}

test("restoring uses only the top-level colour and the normal delta on the existing persona RPC", async () => {
  const f = fixture();
  await f.model.selectWorkspace("A");
  assert.equal(f.model.supportsAgentAppearance(), true);
  const current = f.model.getSnapshot().workspace.agents.find(row => row.agentId === colleague.agentId);
  await f.model.updateAgentPersona(current, { accent: agentAccent(current.initialAccent) }, f.model.mediaScope);

  assert.deepEqual(f.writes(), [{
    name: method, params: {
      agentId: "colleague", configRevision: 4, agentEpoch: 2,
      workspaceId: "A", expectedGeneration: "generation-A",
      input: { profile: { displayName: "Fixture", accent: "#c68a72" } },
    },
  }]);
  assert.equal(current.initialAccent, "#c68a72");
  await f.model.updateAgentPersona(current, { avatarStyle: "portrait" }, f.model.mediaScope);
  assert.deepEqual(f.writes().at(-1).params.input.profile, { displayName: "Fixture", avatarStyle: "portrait" });

  const editor = readFileSync(new URL("../src/AgentProfileEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /appearanceSupported \? agentAccent\(agent\.initialAccent\) : undefined/);
  assert.match(editor, /onClick=\{\(\) => setAccent\(initialAccent\)\}/);
  assert.doesNotMatch(editor, /patch\.initialAccent|agent\.identity\.initialAccent/);
});

test("unsupported, stale or forged appearance changes send zero writes", async () => {
  const old = fixture({ capable: false });
  await old.model.selectWorkspace("A");
  assert.equal(old.model.supportsAgentAppearance(), false);
  await assert.rejects(old.model.updateAgentPersona(colleague, { accent: "#c68a72" }, old.model.mediaScope));
  assert.equal(old.writes().length, 0);
  await old.model.updateAgentPersona(colleague, { title: "Updated title" });
  assert.deepEqual(old.writes().at(-1).params.input.profile, { displayName: "Fixture", title: "Updated title" });

  const capable = fixture();
  await capable.model.selectWorkspace("A");
  const scope = capable.model.mediaScope;
  for (const patch of [{ accent: "#a67bc2" }, { accent: "#c68a72; color: red" }, { initialAccent: "#c68a72" }, { avatarStyle: "star" }]) {
    await assert.rejects(capable.model.updateAgentPersona(colleague, patch, scope));
  }
  await assert.rejects(capable.model.updateAgentPersona(main, { accent: "#c68a72" }, scope));
  await assert.rejects(capable.model.updateAgentPersona(colleague, { accent: "#c68a72" }));
  await assert.rejects(capable.model.updateAgentPersona({ ...colleague, configRevision: 3 }, { avatarStyle: "circle" }, scope));
  await assert.rejects(capable.model.updateAgentPersona({ ...colleague, agentEpoch: 1 }, { avatarStyle: "circle" }, scope));
  await capable.model.selectWorkspace("B");
  await assert.rejects(capable.model.updateAgentPersona(colleague, { accent: "#c68a72" }, scope));
  assert.equal(capable.writes().length, 0);
});

test("a lost reply rereads the snapshot without resubmitting a persona change", async () => {
  const f = fixture({ onWrite: () => { throw new WorkspaceRpcWaitError(method); } });
  await f.model.selectWorkspace("A");
  await assert.rejects(f.model.updateAgentPersona(colleague, { accent: "#c68a72" }, f.model.mediaScope), {
    messageKey: "ws.profileSheet.appearance.saveUnconfirmed",
  });
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.calls.at(-1), { name: "workspace.snapshot", params: { workspaceId: "A", agentId: "colleague" } });
});
