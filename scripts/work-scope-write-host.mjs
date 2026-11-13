// Private synthetic C5 joint fixture. Never imported by product code or a production bootstrap.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
const tools = ["workspace_read", "workspace_write", "workspace_verify", "task_intake", "task_checkpoint", "todo_write", "ask_user"];
export async function createWorkScopeWriteHost(core, root) {
  const load = name => import(pathToFileURL(join(core, "dist", name)).href);
  const { startLocalWorkspaceServe } = await load("serve/local-workspace.js"), { createWorkspaceSyntheticProvider } = await load("workspace/synthetic-provider.js");
  const { LocalWorkspaceCatalog } = await load("workspace/local-catalog.js"), { WorkspaceResources } = await load("workspace/resources.js"), { WorkspaceResourceStorage, workspaceStateHome } = await load("workspace/resource-context.js");
  const { agentCommandMessageDigest } = await load("workspace/agent-command-control.js");
  const docs = JSON.parse(fs.readFileSync(join(core, "test/fixtures/agent-boundaries-v1.json"))), credential = randomBytes(32).toString("hex");
  const clients = [], counters = { providers: 0, syntheticTurns: 0, paidModels: 0, submits: 0, drafts: 0, receipts: [], ownerReads: 0, guestDenials: 0, writeAttemptsAfterNarrowing: 0 };
  const records = new Map(); let handle, owner, initialized, common, target, siblingId, snapshot, agent, storage, prepared;
  let connected = true, connectionEpoch = 1, proof, dropNext = false, allowProbe = false, paused = false, releaseMain, releaseSibling;
  const mainWait = new Promise(resolve => { releaseMain = resolve; }), siblingWait = new Promise(resolve => { releaseSibling = resolve; });
  let connectionId = randomUUID();
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`), pending = new Map(); let serial = 0; ws.addEventListener("error", () => {});
    ws.addEventListener("message", ({ data }) => { const value = JSON.parse(data), row = pending.get(value.id); if (!row) return; pending.delete(value.id); clearTimeout(row.timer);
      value.error ? row.reject(Object.assign(Error("Private Host rejected request"), { data: value.error.data })) : row.resolve(value.result); });
    await new Promise((done, fail) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", fail, { once: true }); });
    const client = { request(method, params = {}) { return new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error("Private Host RPC deadline")); }, 15000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }); },
      async close() { if (ws.readyState === WebSocket.CLOSED) return; const done = new Promise(resolve => ws.addEventListener("close", resolve, { once: true })); ws.close(); await done;
        for (const row of pending.values()) { clearTimeout(row.timer); row.reject(Error("Private Host closed")); } pending.clear(); } };
    clients.push(client); return client;
  }
  const until = async read => { const end = Date.now() + 30000; while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error("C5 actual Host observation deadline"); };
  try {
    handle = await startLocalWorkspaceServe({ host: "127.0.0.1", port: 0, cwd: root }, { root, version: "C5-private-write-matrix", agentBoundaries: { commandControl: true, lifecycleControl: true, ownerCredential: credential },
      providerFactory(connection, binding, context) {
        counters.providers++; assert(allowProbe, "No provider may run during C5 reads or policy updates");
        const synthetic = createWorkspaceSyntheticProvider(connection, binding, context);
        return { ...synthetic, async turn(args) {
          counters.syntheticTurns++;
          if (context.agent.agentId === siblingId) { await siblingWait; return { text: "sibling independently released", toolUses: [], stop: "end", usage: { input: 1, output: 1 } }; }
          const file = join(root, "project", common.workspaceId, "hello.md");
          if (!paused && fs.existsSync(file)) {
            paused = true; await mainWait;
            const write = args.tools.find(tool => tool.name.replace(/^mcp__hara__/, "") === "workspace_write"); assert(write, "The requested effect must use the real controlled file tool");
            counters.writeAttemptsAfterNarrowing++;
            return { text: "", toolUses: [{ id: `call_${randomUUID()}`, name: write.name, input: { path: "after-narrowing.txt", content: "must never be written" } }], stop: "tool_use", usage: { input: 1, output: 1 } };
          }
          return synthetic.turn(args);
        } };
      } });
    owner = await connect(); initialized = await owner.request("initialize", { token: handle.token, boundaryCredential: credential });
    const created = await owner.request("workspace.create", { label: "C5 private scope", expectedRevision: initialized.workspace.revision });
    common = { workspaceId: created.workspaceId, expectedGeneration: created.resourceGeneration }; const mainId = created.selectedAgentId;
    const catalog = new LocalWorkspaceCatalog(join(root, "home")), row = catalog.resolve(common.workspaceId), resources = new WorkspaceResources(join(root, "home"), row.scope); resources.initialize();
    storage = new WorkspaceResourceStorage(join(root, "home"), row.scope); storage.initialize();
    siblingId = resources.agents.create({ username: "c5-sibling", profile: { displayName: "Sibling" }, instructions: "Synthetic sibling only", runtimeId: "pi", permissionTier: "controlled" }, resources.agents.list().revision).agentId;
    await owner.request("workspace.connection.synthetic", { ...common, expectedRevision: 0 });
    const initial = await owner.request("workspace.snapshot", { workspaceId: common.workspaceId, agentId: mainId }), main = initial.agents.find(row => row.agentId === mainId);
    await owner.request("workspace.agents.setPermissionTier", { ...common, agentId: mainId, permissionTier: "controlled", configRevision: main.configRevision, agentEpoch: main.agentEpoch });
    for (const agentId of [mainId, siblingId]) {
      const params = { ...common, agentId }, view = await owner.request("workspace.boundaries.prepareProject", params);
      const duty = structuredClone(docs.valid.find(row => row.name === "duty").document), boundary = structuredClone(docs.valid.find(row => row.name === "boundary").document);
      for (const document of [duty, boundary]) { document.context = view.context; document.agentId = agentId; }
      duty.publicProfile = { title: agentId === mainId ? "Synthetic editable scope" : "Synthetic sibling", description: "Personal synthetic project only", owns: ["Summarize the project"], rejects: ["No publishing"] };
      boundary.resources = [{ resourceId: view.resources[0].resourceId, access: ["read"] }]; boundary.tools = { allow: tools.map(toolId => ({ toolId, connectorId: null, catalogRevision: 1 })), deny: [], readOnly: true };
      boundary.approvalRequired = []; boundary.budget = { budgetRef: "c5-synthetic", maxModelCalls: 8, maxToolEffects: 16 };
      await owner.request("workspace.boundaries.configure", { ...params, expectedRevision: view.revision, duty, boundary, rights: { manage: true, invoke: true, privateRead: true, nodeUse: true } });
      if (agentId === mainId) prepared = view;
    }
    const params = { ...common, agentId: mainId }; await owner.request("workspace.boundaries.control.initialize", params);
    const view = await owner.request("workspace.boundaries.get", { workspaceId: common.workspaceId, agentId: mainId }); proof = view.provenance;
    target = { workspaceId: common.workspaceId, generation: common.expectedGeneration, agentId: mainId, agentEpoch: view.agent.agentEpoch, configRevision: view.agent.configRevision };
    snapshot = await owner.request("workspace.snapshot", { workspaceId: common.workspaceId, agentId: mainId }); agent = snapshot.agents.find(row => row.agentId === mainId);
    const guest = await connect();
    await assert.rejects(guest.request("initialize", { token: handle.token, source: "local_human", provenance: proof }), error => error.data?.boundary?.code === "AUTHORITY_UNVERIFIED"); counters.guestDenials++;
    const get = async () => { counters.ownerReads++; return owner.request("workspace.boundaries.get", { workspaceId: common.workspaceId, agentId: mainId }); };
    const scoped = method => owner.request(method, params), state = () => storage.run(() => JSON.parse(fs.readFileSync(join(workspaceStateHome(), ".hara", "workspace-agent-authority-v1.json"))));
    const checkTarget = value => assert.deepEqual(value, target, "Only the fixture's current authenticated target is allowed");
    const project = join(root, "project", common.workspaceId), file = join(project, "hello.md"), forbidden = join(project, "after-narrowing.txt");
    const facts = async () => ({ counters: structuredClone(counters), main: await scoped("workspace.boundaries.control.inspect"), sibling: await owner.request("workspace.boundaries.control.inspect", { ...common, agentId: siblingId }),
      beforeFileSha256: fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null, forbiddenExists: fs.existsSync(forbidden), state: state() });
    return {
      target, counters, assertPublicArtifacts(bytes) { assert(!Buffer.from(bytes).includes(Buffer.from(credential))); assert(!Buffer.from(bytes).includes(Buffer.from(handle.token))); }, async bootstrap(mode = "owner") { if (mode === "no-cap") return { target, snapshot, agent, view: null, capabilities: [], connectionId: "unbound", connectionEpoch };
        const view = await get(); return { target, snapshot, agent, view, capabilities: initialized.capabilities, connectionId, connectionEpoch }; },
      async read(value) { checkTarget(value); assert(connected); return get(); },
      async catalog(value) { checkTarget(value); const view = await get(); assert(view.current); const ref = view.policy.resources.find(row => row.resourceId === prepared.resources[0].resourceId); assert(ref);
        return { context: view.context, target, resources: [{ resourceId: ref.resourceId, revision: ref.revision, label: "Synthetic project", path: project, access: ["read", "write"] }],
          tools: tools.map(toolId => ({ ref: { toolId, connectorId: null, catalogRevision: 1 }, label: toolId.replaceAll("_", " ") })),
          limits: { budgetRef: view.policy.boundary.budget.budgetRef, maxModelCalls: 16, maxToolEffects: 32, requiredApprovals: [], requiredChecks: ["resource_isolation", "effect_journal", "current_grant_check"] } }; },
      async inspect(value) { checkTarget(value); return scoped("workspace.boundaries.control.inspect"); },
      async draft(value, input) { checkTarget(value); assert.deepEqual(Object.keys(input).sort(), ["commandId", "rootRequestId", "operation", "lifetimeMs"].sort()); assert(["duty.update", "boundary.update"].includes(input.operation?.action));
        counters.drafts++; return owner.request("workspace.boundaries.draft", { ...params, commandId: input.commandId, rootRequestId: input.rootRequestId, operation: input.operation, lifetimeMs: input.lifetimeMs }); },
      async submit(value, command, proposal) { checkTarget(value); assert(["duty.update", "boundary.update"].includes(command.operation?.action)); counters.submits++; const result = await owner.request("workspace.boundaries.control.submit", { ...params, command, proposal });
        records.set(command.commandId, { commandId: command.commandId, rootRequestId: command.rootRequestId, intentDigest: command.intentDigest, proposalDigest: command.operation.proposedDutyDigest ?? command.operation.proposedBoundaryDigest, status: result.status });
        if (dropNext) { dropNext = false; throw Error("Fixture intentionally dropped the response AFTER real C3 submission"); } return result; },
      async receipt(value, commandId) { checkTarget(value); counters.receipts.push(commandId); return owner.request("workspace.boundaries.control.receipt", { ...params, commandId }); },
      dropNext() { dropNext = true; }, records: () => [...records.values()], facts,
      async reconnect() {
        const before = await get(), oldId = connectionId; await owner.close(); owner = await connect();
        initialized = await owner.request("initialize", { token: handle.token, boundaryCredential: credential }); connectionEpoch++; connectionId = randomUUID();
        const after = await get(); const changed = before.provenance.proofRef !== after.provenance.proofRef; assert(changed); assert.deepEqual(after.context, before.context);
        proof = after.provenance; return { proofChanged: changed, connectionIdChanged: oldId !== connectionId, contextSame: true, connectionEpoch };
      },
      async dismissMainProbe() { const command = await owner.request("workspace.boundaries.draft", { ...params, commandId: randomUUID(), rootRequestId: randomUUID(), lifetimeMs: 30000, operation: { action: "agent.dismiss", retention: "keep_records_and_recovery" } });
        const result = await owner.request("workspace.boundaries.control.submit", { ...params, command }); assert.equal(result.status, "rejected"); return result; },
      async startEffects() {
        assert.equal(counters.providers, 0, "Reads and C3 policy updates cannot start models"); allowProbe = true;
        const dispatch = async (agentId, message) => { const conversationId = agentId.slice(3), command = await owner.request("workspace.boundaries.draft", { ...common, agentId, commandId: randomUUID(), rootRequestId: randomUUID(), lifetimeMs: 30000,
          operation: { action: "task.dispatch", taskId: randomUUID(), conversationId, messageDigest: agentCommandMessageDigest(conversationId, message) } });
          const result = await owner.request("workspace.boundaries.control.submit", { ...common, agentId, command, message }); assert.equal(result.status, "accepted"); return command; };
        const sibling = await dispatch(siblingId, "Wait for an explicit sibling release"), main = await dispatch(mainId, "Write hello.md and verify the file");
        await until(() => paused); assert.equal(fs.readFileSync(file, "utf8"), "hello workspace\n");
        const before = await facts(); return { main, sibling, before };
      },
      async finishEffects(mainCommand) { releaseMain(); await until(async () => (await owner.request("workspace.boundaries.control.receipt", { ...params, commandId: mainCommand.commandId })).execution.drain === "observed");
        const after = await facts(); assert.equal(after.forbiddenExists, false); return after; },
      async close() { connected = false; releaseMain(); releaseSibling(); for (const client of clients) await client.close(); await handle.close(); },
    };
  } catch (error) { releaseMain(); releaseSibling(); for (const client of clients) await client.close().catch(() => {}); if (handle) await handle.close(); throw error; }
}
