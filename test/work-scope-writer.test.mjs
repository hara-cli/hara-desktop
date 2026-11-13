import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspaceWorkScopeSource, bindWorkspaceWorkScopeSource } from "../src/workspace-work-scope.ts";
import { createWorkspaceWorkScopeWriter, bindWorkspaceWorkScopeWriter, workScopeWriter } from "../src/work-scope-writer.ts";
import { createWorkScopeReferenceStore, workScopeReferenceNamespace } from "../src/work-scope-references.ts";
import { AgentBoundaryContractError, parseAgentBoundaryDocument } from "../src/agent-boundary-contract.ts";
import { createAgentDutyDraft } from "../src/agent-duty-draft.ts";
import { workScopeCommandDigest, workScopeProposalDigest } from "../src/work-scope-proposal.ts";
import { parseWorkScopeEditCatalog } from "../src/work-scope-catalog.ts";
const vectors = JSON.parse(readFileSync(new URL("./fixtures/agent-policy-proposal-v1.json", import.meta.url), "utf8"));
const errorCode = code => error => error.code === code;
const anyContractError = error => typeof error.code === "string";
function fixture() {
  const proposal = structuredClone(vectors.vectors[0].proposal); proposal.rights = { manage: true, invoke: true, privateRead: false, nodeUse: false };
  proposal.boundary.resources = [{ resourceId: "folder", access: ["read", "write"] }];
  proposal.boundary.tools = { allow: ["workspace_read", "workspace_write"].map(toolId => ({ toolId, connectorId: null, catalogRevision: 1 })), deny: [], readOnly: false };
  proposal.boundary.budget = { budgetRef: "budget", maxModelCalls: 3, maxToolEffects: 4 }; proposal.boundary.approvalRequired = ["write", "policy_expand"];
  const context = proposal.duty.context, target = { workspaceId: context.scope.workspaceId, generation: context.resourceBinding.generation,
    agentId: proposal.duty.agentId, agentEpoch: 1, configRevision: 1 }, provenance = { channel: "local_human", proofRef: "proof-owner-1" };
  const state = { context, provenance, revision: 1, agent: { agentId: target.agentId, agentEpoch: 1, configRevision: 1 }, configured: true, current: true,
    policy: { ...proposal, agentId: target.agentId, revision: 1, agentEpoch: 1, configRevision: 1, resources: [{ resourceId: "folder", revision: 1 }] },
    executors: [], identityReservations: { account: null, device: null, membership: null, remoteExecution: false }, runtimeEnforced: false };
  let connected = true, connectionEpoch = 1, capabilities = ["workspace.agent-boundaries.authority.v1", "workspace.agent-command-control.v1"], fence;
  const listeners = new Set(), calls = { inspect: 0, draft: 0, submit: 0, receipt: [] }, stored = new Map(), receipts = new Map();
  const storage = { get length() { return stored.size; }, key(i) { return [...stored.keys()][i] ?? null; }, getItem(k) { return stored.get(k) ?? null; },
    setItem(k, v) { stored.set(k, v); }, removeItem(k) { stored.delete(k); } };
  const references = createWorkScopeReferenceStore(storage), source = createWorkspaceWorkScopeSource({
    capture() { return connected ? { connectionId: "owner-socket", connectionEpoch, capabilities, context, provenance,
      assertCurrent() { if (!connected) throw new Error("offline"); } } : null; }, read: async () => structuredClone(state),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
  const inspector = { sourceAvailableHere: true, pendingDrainObservations: 0, agent: { agentId: target.agentId, epoch: 3, hold: null, dismissed: false }, runs: [] };
  const catalog = { context, target, resources: [{ resourceId: "folder", revision: 1, label: "Project folder", path: "/synthetic/project", access: ["read", "write"] }],
    tools: proposal.boundary.tools.allow.map(ref => ({ ref, label: ref.toolId })),
    limits: { budgetRef: "budget", maxModelCalls: 6, maxToolEffects: 8, requiredApprovals: ["policy_expand"], requiredChecks: ["current_grant_check"] } };
  let draftPatch = value => value, submitEffect, draftWait;
  const receiptFor = (command, status = "applied") => parseAgentBoundaryDocument({ schemaVersion: 1, mode: "personal", kind: "command-receipt", context,
    commandId: command.commandId, rootRequestId: command.rootRequestId, agentId: command.agentId, intentDigest: command.intentDigest, status,
    control: { epoch: inspector.agent.epoch, holdId: null }, execution: { drain: "not_requested", drainProofRef: null, effect: "none", effectId: null },
    error: status === "rejected" ? { code: "STALE_REVISION", retry: "refresh_state" } : null });
  const apply = (command, value) => {
    state.policy.duty = structuredClone(value.duty); state.policy.boundary = structuredClone(value.boundary); state.policy.rights = structuredClone(value.rights);
    state.policy.revision++; state.revision++; inspector.agent.epoch++; const receipt = receiptFor(command); receipts.set(command.commandId, receipt); return receipt;
  };
  const port = {
    assertCurrent(identity) { assert.deepEqual(identity.context, context); if (!connected) throw new Error("offline"); return fence; },
    async inspect() { calls.inspect++; return structuredClone(inspector); },
    async draft(_target, input) {
      calls.draft++; if (draftWait) await draftWait;
      const issued = Date.now();
      const command = { schemaVersion: 1, mode: "personal", kind: "command", context, commandId: input.commandId, rootRequestId: input.rootRequestId,
        agentId: target.agentId, actorChain: { requestedBy: context.humanSubjectId, actingAgent: target.agentId, approvedBy: null, executingNode: context.nodeId }, provenance,
        expected: { dutyRevision: state.policy.duty.dutyRevision, boundaryRevision: state.policy.boundary.boundaryRevision, controlEpoch: inspector.agent.epoch },
        issuedAt: new Date(issued).toISOString(), notAfter: new Date(issued + input.lifetimeMs).toISOString(), operation: input.operation, intentDigest: "0".repeat(64) };
      command.intentDigest = await workScopeCommandDigest(command); return draftPatch(command);
    },
    async submit(_target, command, value) { calls.submit++; return submitEffect ? submitEffect(command, value) : apply(command, value); },
    async receipt(_target, commandId) { calls.receipt.push(commandId); if (!receipts.has(commandId)) throw new Error("unidentified"); return receipts.get(commandId); },
    async catalog() { return structuredClone(catalog); },
  };
  const writer = createWorkspaceWorkScopeWriter(source, port, references), capture = () => writer.capture(target);
  return { writer, source, port, target, capture, state, calls, storage, stored, receipts, references, inspector, catalog, apply, receiptFor,
    draft: () => createAgentDutyDraft({ ...state.policy.duty.publicProfile, title: "Reviewed new responsibility", owns: ["Summarize project files"] }),
    patchDraft(fn) { draftPatch = fn; }, setSubmit(fn) { submitEffect = fn; }, waitDraft(value) { draftWait = value; },
    close() { connected = false; for (const fn of listeners) fn(); }, reconnect() { connected = true; connectionEpoch++; for (const fn of listeners) fn(); },
    setCapabilities(value) { capabilities = value; }, setFence(value) { fence = value; } };
}
const previewDuty = async f => f.writer.preview(await f.writer.load(f.capture()), { action: "duty.update", draft: f.draft() });
const changes = f => { const { resources, tools, budget, approvalRequired, runtimeRequirements } = structuredClone(f.state.policy.boundary); return { resources, tools, budget, approvalRequired, runtimeRequirements }; };

test("C5 writer cannot be enabled by JSON, a generic model or a capability advertisement", async () => {
  const f = fixture(), model = { supportsCapability: () => true, request() { assert.fail("not a credentialed port"); } };
  assert.equal(workScopeWriter(model), null);
  assert.throws(() => createWorkspaceWorkScopeWriter({}, f.port, f.references), anyContractError);
  assert.throws(() => bindWorkspaceWorkScopeWriter(model, JSON.parse(JSON.stringify(f.writer))), anyContractError);
  assert.throws(() => bindWorkspaceWorkScopeWriter(model, f.writer), anyContractError);
  const unbind = bindWorkspaceWorkScopeSource(model, f.source), unwrite = bindWorkspaceWorkScopeWriter(model, f.writer);
  assert.equal(workScopeWriter(model), f.writer); unbind(); assert.equal(workScopeWriter(model), null); unwrite();
  f.setCapabilities(["workspace.agent-boundaries.authority.v1"]); assert.equal(f.capture(), null);
  assert.deepEqual(f.calls, { inspect: 0, draft: 0, submit: 0, receipt: [] });
  for (const value of [true, { approved: true }, Promise.resolve(undefined)]) { f.setCapabilities(["workspace.agent-boundaries.authority.v1", "workspace.agent-command-control.v1"]); f.setFence(value); assert.equal(f.capture(), null); }
});
test("C5 exact immutable duty preview has no effect until confirmed; duplicate confirmation submits once", async () => {
  const f = fixture(), before = structuredClone(f.state.policy), preview = await previewDuty(f);
  assert.equal(f.calls.submit, 0); assert.equal(f.stored.size, 0); assert.equal(preview.action, "duty.update");
  assert.deepEqual(preview.proposal.boundary, before.boundary); assert.deepEqual(preview.proposal.rights, before.rights);
  assert.equal(preview.proposal.duty.dutyRevision, before.duty.dutyRevision + 1); assert.ok(preview.changes.every(change => change.direction === "text"));
  assert.throws(() => { preview.proposal.duty.publicProfile.title = "changed after review"; }, TypeError);
  await assert.rejects(f.writer.submit(JSON.parse(JSON.stringify(preview))), anyContractError);
  const first = f.writer.submit(preview), second = f.writer.submit(preview); assert.equal(first, second);
  const result = await first; assert.equal(result.state, "applied"); assert.equal(result.receipt.status, "applied"); assert.equal(f.calls.submit, 1); assert.equal(f.stored.size, 0);
  assert.deepEqual(f.state.policy.rights, before.rights); assert.equal(f.state.policy.rights.privateRead, false, "Management does not require granting privateRead");
});
test("C5 command preview rejects forged Host source, identity, epoch, operation and intent digest", async () => {
  for (const patch of [
    command => ({ ...command, provenance: { ...command.provenance, proofRef: "forged" } }),
    command => ({ ...command, expected: { ...command.expected, controlEpoch: command.expected.controlEpoch + 1 } }),
    command => ({ ...command, operation: { action: "boundary.update", proposedBoundaryDigest: "a".repeat(64) } }),
    command => ({ ...command, commandId: "different-id" }), command => ({ ...command, intentDigest: "a".repeat(64) }),
    command => ({ ...command, actorChain: { ...command.actorChain, requestedBy: "other-human" } }),
  ]) { const f = fixture(); f.patchDraft(patch); await assert.rejects(previewDuty(f), anyContractError); assert.equal(f.calls.submit, 0); assert.equal(f.stored.size, 0); }
});
test("C5 boundary editing is limited to current Host registry, resources, supported tools and ceilings", async () => {
  const f = fixture(), before = structuredClone(f.state.policy), session = await f.writer.load(f.capture()), value = changes(f);
  value.tools.readOnly = true; value.resources[0].access = ["read"];
  const preview = await f.writer.preview(session, { action: "boundary.update", boundary: value });
  assert.deepEqual(preview.proposal.duty, before.duty); assert.deepEqual(preview.proposal.rights, before.rights);
  assert.ok(preview.changes.every(change => change.direction === "narrow")); assert.equal((await f.writer.submit(preview)).state, "applied");
  for (const edit of [value => { value.budget.maxToolEffects = 9; }, value => { value.resources[0].access = ["execute"]; },
    value => { value.approvalRequired = []; }, value => { value.runtimeRequirements = []; },
    value => { value.tools.allow.push({ toolId: "exec", connectorId: null, catalogRevision: 1 }); },
    value => { value.resources.push({ resourceId: "unattested", access: ["read"] }); }]) {
    const bad = fixture(), change = changes(bad); edit(change); await assert.rejects(bad.writer.preview(await bad.writer.load(bad.capture()), { action: "boundary.update", boundary: change }), anyContractError); assert.equal(bad.calls.submit, 0);
  }
  const missing = fixture(); delete missing.port.catalog; const noCatalog = createWorkspaceWorkScopeWriter(missing.source, missing.port, missing.references), capture = noCatalog.capture(missing.target), view = await noCatalog.load(capture);
  await assert.rejects(noCatalog.preview(view, { action: "boundary.update", boundary: changes(missing) }), errorCode("RUNTIME_UNSUPPORTED"));
  assert.ok(await noCatalog.preview(view, { action: "duty.update", draft: missing.draft() }));
});
test("C5 catalog rejects stale metadata, unsupported connectors/tools, forged labels and duplicate choices", async () => {
  const f = fixture(), policy = await f.source.policy(f.source.capture(f.target));
  for (const mutate of [row => row.resources[0].revision++, row => row.target.configRevision++, row => row.resources[0].label = "unsafe\nlabel",
    row => row.resources.push(row.resources[0]), row => row.tools[0].ref.connectorId = "connector", row => row.tools[0].ref.toolId = "agent",
    row => row.resources[0].access.push("execute"), row => row.limits.budgetRef = "other-budget"]) {
    const catalog = structuredClone(f.catalog); mutate(catalog); assert.throws(() => parseWorkScopeEditCatalog(catalog, policy), anyContractError);
  }
});
test("C5 revoked/stale policy, control epoch, expiry or capture cannot silently replace reviewed intent", async () => {
  for (const change of [f => { f.state.policy.rights.manage = false; }, f => { f.state.policy.revision++; }, f => { f.inspector.agent.epoch++; }, f => f.close()]) {
    const f = fixture(), preview = await previewDuty(f); change(f); await assert.rejects(f.writer.submit(preview), anyContractError); assert.equal(f.calls.submit, 0);
  }
  const f = fixture(), preview = await previewDuty(f), now = Date.now; Date.now = () => Date.parse(preview.expiresAt) + 1;
  try { await assert.rejects(f.writer.submit(preview), errorCode("STALE_REVISION")); } finally { Date.now = now; } assert.equal(f.calls.submit, 0);
});
test("C5 accepted is pending; transport loss persists only references and reload queries the original command", async () => {
  const f = fixture(); let savedCommand, savedProposal;
  f.setSubmit((command, proposal) => { savedCommand = command; savedProposal = proposal; assert.equal(f.stored.size, 1, "Reference is durable before the possible submission"); throw new Error("response lost"); });
  const preview = await previewDuty(f), first = await f.writer.submit(preview); assert.equal(first.state, "unknown"); assert.equal(first.receipt, null);
  const saved = [...f.stored.values()][0]; assert.ok(saved.includes(preview.commandId));
  for (const privateValue of [savedProposal.duty.publicProfile.title, "publicProfile", "boundaryRevision", "proofRef", "ownerCredential", "context\""]) assert.equal(saved.includes(privateValue), false, privateValue);
  await assert.rejects(previewDuty(f), errorCode("CONTROL_HELD")); assert.equal(f.calls.draft, 1);
  f.receipts.set(savedCommand.commandId, f.receiptFor(savedCommand, "accepted"));
  f.reconnect(); const restoredWriter = createWorkspaceWorkScopeWriter(f.source, f.port, f.references), capture = restoredWriter.capture(f.target);
  const restored = await restoredWriter.load(capture); assert.equal(restored.pending[0].state, "pending"); assert.equal(restored.pending[0].receipt.status, "accepted"); assert.equal(f.stored.size, 1);
  f.receipts.set(savedCommand.commandId, f.receiptFor(savedCommand, "unknown")); assert.equal((await restoredWriter.refresh(capture, first.reference)).state, "unknown"); assert.equal(f.stored.size, 1);
  f.apply(savedCommand, savedProposal); assert.equal((await restoredWriter.refresh(capture, first.reference)).state, "applied");
  assert.equal(f.calls.submit, 1); assert.ok(f.calls.receipt.every(id => id === preview.commandId)); assert.equal(f.stored.size, 0);
});
test("C5 unexpected or mismatched receipts preserve unknown references; rejected and superseded are honest terminal observations", async () => {
  const f = fixture(); let command, proposal; f.setSubmit((c, p) => { command = c; proposal = p; return { ...f.receiptFor(c, "applied"), commandId: "other-id" }; });
  const unknown = await f.writer.submit(await previewDuty(f)); assert.equal(unknown.state, "unknown"); assert.equal(f.stored.size, 1);
  f.receipts.set(command.commandId, f.receiptFor(command, "rejected")); assert.equal((await f.writer.refresh(f.capture(), unknown.reference)).state, "rejected"); assert.equal(f.stored.size, 0);
  const g = fixture(); g.setSubmit((c, p) => { g.apply(c, p); g.state.policy.duty = { ...g.state.policy.duty, dutyRevision: p.duty.dutyRevision + 1, publicProfile: { ...p.duty.publicProfile, title: "Changed by another approved command" } }; return g.receiptFor(c); });
  const historical = await g.writer.submit(await previewDuty(g)); assert.equal(historical.state, "superseded"); assert.equal(historical.receipt.status, "applied"); assert.equal(g.stored.size, 0);
});
test("C5 storage quota and corrupt/unidentifiable references fail closed without a second command", async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error("quota"); };
  const preview = await previewDuty(f); await assert.rejects(f.writer.submit(preview), /quota/); assert.equal(f.calls.submit, 0);
  const g = fixture(), identity = g.source.identity(g.source.capture(g.target)), prefix = workScopeReferenceNamespace(identity); g.stored.set(prefix + "broken", "{");
  await assert.rejects(g.writer.load(g.capture()), errorCode("CONTROL_HELD")); assert.equal(g.calls.draft, 0); assert.equal(g.calls.submit, 0); assert.equal(g.stored.size, 1);
});
test("C5 cancellation and late results cannot affect another capture or resurrect an old preview", async () => {
  const f = fixture(), preview = await previewDuty(f); f.writer.cancel(preview); await assert.rejects(f.writer.submit(preview), anyContractError); assert.equal(f.calls.submit, 0);
  const g = fixture(); let release; g.waitDraft(new Promise(resolve => { release = resolve; }));
  const view = await g.writer.load(g.capture()), pending = g.writer.preview(view, { action: "duty.update", draft: g.draft() });
  while (!g.calls.draft) await new Promise(resolve => setTimeout(resolve, 1)); g.reconnect(); release(); await assert.rejects(pending, anyContractError); assert.equal(g.calls.submit, 0);
});
test("C5 refresh cannot read a reference from another scope, human, Agent or context", async () => {
  const f = fixture(); f.setSubmit(() => { throw new Error("lost"); }); const result = await f.writer.submit(await previewDuty(f));
  for (const patch of [{ agentId: "other-agent" }, { generation: "different-generation" }, { workspaceId: "other-workspace" }, { scopeKey: "a".repeat(64) }, { contextDigest: "b".repeat(64) }])
    await assert.rejects(f.writer.refresh(f.capture(), { ...result.reference, ...patch }), errorCode("CONTEXT_MISMATCH"));
  assert.equal(f.calls.receipt.length, 0); assert.equal(f.stored.size, 1);
});

test("C5 a changed Host catalog or management revocation cannot use an already reviewed boundary", async () => {
  const f = fixture(), session = await f.writer.load(f.capture()), value = changes(f); value.tools.readOnly = true;
  const preview = await f.writer.preview(session, { action: "boundary.update", boundary: value });
  f.catalog.limits.maxToolEffects--;
  await assert.rejects(f.writer.submit(preview), errorCode("STALE_REVISION")); assert.equal(f.calls.submit, 0);
  const g = fixture(); g.state.policy.rights.manage = false;
  const reader = await g.writer.load(g.capture()); assert.equal(reader, null); assert.equal(g.calls.inspect, 0); assert.equal(g.calls.draft, 0);
});

test("C5 a known pre-submission refusal does not strand a future freshly reviewed preview", async () => {
  const f = fixture(), first = await previewDuty(f); f.inspector.agent.epoch++;
  await assert.rejects(f.writer.submit(first), errorCode("STALE_REVISION")); assert.equal(f.calls.submit, 0); assert.equal(f.stored.size, 0);
  const next = await previewDuty(f); assert.notEqual(next.commandId, first.commandId);
  assert.equal((await f.writer.submit(next)).state, "applied"); assert.equal(f.calls.submit, 1);
});

test("C5 unrelated root ledger progress does not invalidate an unchanged target policy and control epoch", async () => {
  const f = fixture(), preview = await previewDuty(f); f.state.revision += 7;
  assert.equal((await f.writer.submit(preview)).state, "applied"); assert.equal(f.calls.submit, 1);
});

test("C5 a syntactically valid rehashed provenance or operation still cannot replace the observed Host draft", async () => {
  for (const mutate of [command => { command.provenance.proofRef = "other-connection"; }, command => { command.expected.controlEpoch++; }, command => { command.operation.proposedDutyDigest = "a".repeat(64); }]) {
    const f = fixture(); f.patchDraft(async command => { command = structuredClone(command); mutate(command); command.intentDigest = await workScopeCommandDigest(command); return command; });
    await assert.rejects(previewDuty(f), anyContractError); assert.equal(f.calls.submit, 0);
  }
});
test("C5 an accepted/completed effect in a policy receipt cannot retire an uncertain original reference", async () => {
  for (const status of ["rejected", "applied"]) for (const effect of ["accepted", "completed"]) {
    const f = fixture(); f.setSubmit(command => ({ ...f.receiptFor(command, status), execution: { drain: "not_requested", drainProofRef: null, effect, effectId: "original-effect" } }));
    const result = await f.writer.submit(await previewDuty(f)); assert.equal(result.state, "unknown"); assert.equal(result.receipt.execution.effect, effect); assert.equal(f.stored.size, 1);
    await assert.rejects(previewDuty(f), errorCode("CONTROL_HELD")); assert.equal(f.calls.submit, 1);
  }
});

test("C5 the outgoing draft wrapper and expected operation are immutable before the Host port is called", async () => {
  const f = fixture(), original = f.port.draft;
  f.port.draft = async (target, input) => { assert.ok(Object.isFrozen(input)); assert.ok(Object.isFrozen(input.operation));
    assert.throws(() => { input.operation.proposedDutyDigest = "f".repeat(64); }, TypeError); return original(target, input); };
  assert.ok(await previewDuty(f)); assert.equal(f.calls.submit, 0);
});

test("C5 distinct writer instances sharing one read source cannot reuse a form's opaque lifetime key", async () => {
  const f = fixture(), other = createWorkspaceWorkScopeWriter(f.source, f.port, f.references), oldCapture = f.capture(), nextCapture = other.capture(f.target);
  assert.notEqual(oldCapture.key, nextCapture.key, "writer replacement must synchronously discard the old writer session/form");
  await assert.rejects(other.load(oldCapture), anyContractError);
});


function missingReceiptFixture() {
  const f = fixture(); let observed = Date.now(), response;
  f.setCapabilities(["workspace.agent-boundaries.authority.v1", "workspace.agent-command-control.v1", "workspace.agent-command-receipt-lookup.v1"]);
  f.port.lookupReceipt = async (_target, commandId) => response ?? ({ schemaVersion: 1, kind: "command-receipt-lookup", state: "not_seen", context: f.state.context,
    agentId: f.target.agentId, commandId, observedAt: new Date(observed).toISOString(), receipt: null });
  return { ...f, observeAt(value) { observed = value; }, lookupReply(value) { response = value; } };
}
test("C5 M1 persisted but unsent intent retires only after exact Core not-seen expiry, reload never resubmits", async () => {
  const f = missingReceiptFixture(); f.setSubmit(() => { throw Error("never sent"); });
  const preview = await previewDuty(f), unknown = await f.writer.submit(preview);
  assert.equal(unknown.state, "unknown"); assert.equal(f.stored.size, 1);
  const early = await f.writer.refresh(f.capture(), unknown.reference); assert.equal(early.state, "unknown"); assert.equal(f.stored.size, 1);
  f.observeAt(Date.parse(preview.expiresAt) + 1001);
  const expired = await f.writer.refresh(f.capture(), unknown.reference);
  assert.equal(expired.state, "not_applied"); assert.equal(expired.receipt, null); assert.equal(f.stored.size, 0);
  const restored = createWorkspaceWorkScopeWriter(f.source, f.port, f.references), capture = restored.capture(f.target), loaded = await restored.load(capture);
  assert.equal(loaded.pending.length, 0); assert.equal(f.calls.submit, 1); assert.equal(f.calls.draft, 1);
  const next = await restored.preview(loaded, { action: "duty.update", draft: f.draft() });
  assert.notEqual(next.commandId, preview.commandId); assert.equal(f.calls.submit, 1); restored.cancel(next);
});
test("C5 M1 a fence failure after durable put stays recoverable and no command reaches submit", async () => {
  const f = missingReceiptFixture(), set = f.storage.setItem.bind(f.storage);
  const preview = await previewDuty(f); f.storage.setItem = (key, value) => { set(key, value); f.close(); };
  await assert.rejects(f.writer.submit(preview)); assert.equal(f.calls.submit, 0); assert.equal(f.stored.size, 1);
  f.storage.setItem = set; f.reconnect(); f.observeAt(Date.parse(preview.expiresAt) + 1001);
  const restored = createWorkspaceWorkScopeWriter(f.source, f.port, f.references), loaded = await restored.load(restored.capture(f.target));
  assert.equal(loaded.pending[0].state, "not_applied"); assert.equal(f.stored.size, 0); assert.equal(f.calls.submit, 0);
});
test("C5 M1 local fast clock, unavailable old Core, and legacy references cannot prove non-application", async t => {
  const f = missingReceiptFixture(); f.setSubmit(() => { throw Error("unsent"); });
  const preview = await previewDuty(f), unknown = await f.writer.submit(preview);
  const clock = t.mock.method(Date, "now", () => Date.parse(preview.expiresAt) + 999999);
  try { assert.equal((await f.writer.refresh(f.capture(), unknown.reference)).state, "unknown"); assert.equal(f.stored.size, 1); }
  finally { clock.mock.restore(); }
  f.observeAt(Date.parse(preview.expiresAt) + 1001);
  f.setCapabilities(["workspace.agent-boundaries.authority.v1", "workspace.agent-command-control.v1"]);
  assert.equal((await f.writer.refresh(f.capture(), unknown.reference)).state, "unknown"); assert.equal(f.stored.size, 1);
  f.setCapabilities(["workspace.agent-boundaries.authority.v1", "workspace.agent-command-control.v1", "workspace.agent-command-receipt-lookup.v1"]);
  const [key, bytes] = [...f.stored.entries()][0], legacy = JSON.parse(bytes); legacy.schemaVersion = 1; delete legacy.issuedAt; delete legacy.notAfter; f.stored.set(key, JSON.stringify(legacy));
  const loaded = await f.writer.load(f.capture()); assert.equal(loaded.pending[0].state, "unknown"); assert.equal(f.stored.size, 1); assert.equal(f.calls.submit, 1);
});
test("C5 M1 known UNKNOWN/accepted receipts are retained after expiry and malformed absence cannot clear references", async () => {
  for (const status of ["accepted", "unknown"]) {
    const f = missingReceiptFixture(); let command;
    f.setSubmit(value => { command = value; return f.receiptFor(value, status); });
    const preview = await previewDuty(f), pending = await f.writer.submit(preview);
    f.observeAt(Date.parse(preview.expiresAt) + 1001);
    f.lookupReply({ schemaVersion: 1, kind: "command-receipt-lookup", state: "seen", context: f.state.context, agentId: f.target.agentId,
      commandId: command.commandId, observedAt: new Date(Date.parse(preview.expiresAt) + 1001).toISOString(), receipt: f.receiptFor(command, status) });
    assert.equal((await f.writer.refresh(f.capture(), pending.reference)).state, status === "accepted" ? "pending" : "unknown"); assert.equal(f.stored.size, 1);
    await assert.rejects(previewDuty(f), errorCode("CONTROL_HELD")); assert.equal(f.calls.submit, 1);
    for (const patch of [{ commandId: "other-command" }, { agentId: "other-agent" }, { context: {} }, { observedAt: "bad-date" }, { approved: true }]) {
      f.lookupReply({ schemaVersion: 1, kind: "command-receipt-lookup", state: "not_seen", context: f.state.context, agentId: f.target.agentId,
        commandId: command.commandId, observedAt: new Date(Date.parse(preview.expiresAt) + 1001).toISOString(), receipt: null, ...patch });
      assert.equal((await f.writer.refresh(f.capture(), pending.reference)).state, "unknown"); assert.equal(f.stored.size, 1);
    }
  }
});

test("C5 M1 real process exit after durable put restores only original reference and never sends before expiry", async t => {
  const folder = mkdtempSync(join(tmpdir(), "hara-c5-process-cut-")), durable = join(folder, "reference.json"), submitted = join(folder, "unexpected-submit");
  t.after(() => { for (const file of [durable, submitted]) if (existsSync(file)) unlinkSync(file); rmdirSync(folder); });
  const childSource = [
    "import assert from 'node:assert/strict';",
    "import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';",
    `import {createWorkspaceWorkScopeSource} from ${JSON.stringify(new URL("../src/workspace-work-scope.ts", import.meta.url).href)};`,
    `import {createWorkspaceWorkScopeWriter} from ${JSON.stringify(new URL("../src/work-scope-writer.ts", import.meta.url).href)};`,
    `import {createWorkScopeReferenceStore} from ${JSON.stringify(new URL("../src/work-scope-references.ts", import.meta.url).href)};`,
    `import {parseAgentBoundaryDocument} from ${JSON.stringify(new URL("../src/agent-boundary-contract.ts", import.meta.url).href)};`,
    `import {createAgentDutyDraft} from ${JSON.stringify(new URL("../src/agent-duty-draft.ts", import.meta.url).href)};`,
    `import {workScopeCommandDigest} from ${JSON.stringify(new URL("../src/work-scope-proposal.ts", import.meta.url).href)};`,
    `const vectors = ${JSON.stringify(vectors)};`, fixture.toString(),
    `const durable = ${JSON.stringify(durable)}, submitted = ${JSON.stringify(submitted)};`,
    "const f = fixture();",
    "f.setSubmit(() => { writeFileSync(submitted, 'unexpected'); process.exit(43); });",
    "f.storage.setItem = (key, value) => { const fd = openSync(durable, 'wx', 0o600); writeFileSync(fd, JSON.stringify({key,value})); fsyncSync(fd); closeSync(fd); process.exit(42); };",
    "const preview = await f.writer.preview(await f.writer.load(f.capture()), {action:'duty.update',draft:f.draft()});",
    "await f.writer.submit(preview); process.exit(44);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", childSource], { env: process.env, encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null);
  assert.equal(child.status, 42, child.stderr.slice(-1500));
  assert.equal(existsSync(submitted), false, "the abrupt exit preceded the actual submit port");
  const persisted = JSON.parse(readFileSync(durable, "utf8")), reference = JSON.parse(persisted.value), f = missingReceiptFixture();
  f.storage.setItem(persisted.key, persisted.value);
  const restored = createWorkspaceWorkScopeWriter(f.source, f.port, createWorkScopeReferenceStore(f.storage)), capture = restored.capture(f.target);
  f.observeAt(Date.parse(reference.notAfter) - 1);
  const early = await restored.load(capture);
  assert.equal(early.pending[0].state, "unknown"); assert.equal(f.stored.size, 1);
  await assert.rejects(restored.preview(early, {action:"duty.update",draft:f.draft()}), errorCode("CONTROL_HELD"));
  assert.equal(f.calls.submit, 0); assert.equal(f.calls.draft, 0);
  f.observeAt(Date.parse(reference.notAfter) + 1001);
  const recovered = await restored.load(capture);
  assert.equal(recovered.pending[0].state, "not_applied"); assert.equal(recovered.pending[0].receipt, null); assert.equal(f.stored.size, 0);
  const next = await restored.preview(recovered, {action:"duty.update",draft:f.draft()});
  assert.notEqual(next.commandId, reference.commandId); assert.equal(f.calls.submit, 0); restored.cancel(next);
});

test("C5 M1 genuine AUTHORIZATION_DENIED after expiry retains the reference until an explicit successful reread", async () => {
  const f = missingReceiptFixture(); f.setSubmit(() => { throw Error("disconnected before sending"); });
  const preview = await previewDuty(f), unknown = await f.writer.submit(preview), lookup = f.port.lookupReceipt;
  f.observeAt(Date.parse(preview.expiresAt) + 1001);
  f.port.lookupReceipt = async () => { throw new AgentBoundaryContractError("AUTHORIZATION_DENIED", "control.receipt"); };
  const restored = createWorkspaceWorkScopeWriter(f.source, f.port, createWorkScopeReferenceStore(f.storage)), capture = restored.capture(f.target);
  const denied = await restored.load(capture);
  assert.equal(denied.pending[0].state, "unknown"); assert.equal(denied.pending[0].reference.commandId, unknown.reference.commandId); assert.equal(f.stored.size, 1);
  await assert.rejects(restored.preview(denied, {action:"duty.update",draft:f.draft()}), errorCode("CONTROL_HELD"));
  assert.equal(f.calls.submit, 1); assert.equal(f.calls.draft, 1);
  f.port.lookupReceipt = lookup;
  const reread = await restored.refresh(capture, unknown.reference);
  assert.equal(reread.state, "not_applied"); assert.equal(f.stored.size, 0); assert.equal(f.calls.submit, 1); assert.equal(f.calls.draft, 1);
});
