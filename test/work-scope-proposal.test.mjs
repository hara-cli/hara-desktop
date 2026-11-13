import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createAgentDutyDraft } from "../src/agent-duty-draft.ts";
import { parseWorkScopeProposal, dutyWorkScopeProposal, boundaryWorkScopeProposal, workScopeProposalDigest, workScopeChanges, workScopeEqual } from "../src/work-scope-proposal.ts";
const root = new URL("../", import.meta.url);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/agent-policy-proposal-v1.json", import.meta.url), "utf8"));
const base = () => parseWorkScopeProposal(structuredClone(fixtures.vectors[0].proposal));
const snapshot = () => ({ ...base() }); // Factories consume validated data, never issue authority.
const mutableBoundary = value => { const { resources, tools, budget, approvalRequired, runtimeRequirements } = structuredClone(value.boundary); return { resources, tools, budget, approvalRequired, runtimeRequirements }; };
const invalid = error => ["INVALID_DOCUMENT", "CONTEXT_MISMATCH", "AUTHORIZATION_DENIED"].includes(error.code);

test("C5 proposal WebCrypto matches ten pinned actual Core source digest vectors", async () => {
  for (const row of fixtures.vectors) assert.equal(await workScopeProposalDigest(row.proposal), row.digest, row.name);
  assert.equal(fixtures.vectors[0].digest, fixtures.vectors[1].digest, "Object property order is irrelevant; array order remains meaningful");
  await assert.rejects(workScopeProposalDigest(undefined));
});
test("C5 duty proposal only changes confirmed duty data; boundary and four rights stay byte-identical", () => {
  const before = snapshot(), profile = { title: "資料整理", description: "整理记录\n不购买服务。", owns: ["Read personal material"], rejects: ["No publishing"] };
  const proposal = dutyWorkScopeProposal(before, createAgentDutyDraft(profile));
  assert.deepEqual(proposal.duty.publicProfile, profile); assert.equal(proposal.duty.dutyRevision, before.duty.dutyRevision + 1);
  assert.equal(JSON.stringify(proposal.boundary), JSON.stringify(before.boundary)); assert.equal(JSON.stringify(proposal.rights), JSON.stringify(before.rights));
  assert.equal("grant" in proposal, false); assert.equal("command" in proposal, false); assert.ok(Object.isFrozen(proposal.duty.publicProfile));
  assert.ok(workScopeChanges(before, proposal).every(row => row.direction === "text"));
});
test("C5 boundary proposal cannot carry duty, rights, context or a different budget reference", () => {
  const before = snapshot(), changes = mutableBoundary(before); changes.tools.readOnly = !changes.tools.readOnly;
  const proposal = boundaryWorkScopeProposal(before, changes);
  assert.equal(JSON.stringify(proposal.duty), JSON.stringify(before.duty)); assert.equal(JSON.stringify(proposal.rights), JSON.stringify(before.rights));
  assert.equal(proposal.boundary.boundaryRevision, before.boundary.boundaryRevision + 1);
  for (const patch of [{ rights: { manage: true } }, { context: before.duty.context }, { duty: before.duty }, { runnable: true }])
    assert.throws(() => boundaryWorkScopeProposal(before, { ...changes, ...patch }), invalid);
  assert.throws(() => boundaryWorkScopeProposal(before, { ...changes, budget: { ...changes.budget, budgetRef: "invented-budget" } }), invalid);
});
test("C5 boundary differences account for every expansion dimension", () => {
  const before = base();
  const narrow = structuredClone(before); narrow.boundary.resources = [{ resourceId: "folder", access: ["read"] }]; narrow.boundary.tools = { allow: [], deny: [{ toolId: "workspace_write", connectorId: null, catalogRevision: 1 }], readOnly: true };
  narrow.boundary.budget.maxModelCalls = 1; narrow.boundary.budget.maxToolEffects = 1;
  narrow.boundary.approvalRequired = ["paid", "write"]; narrow.boundary.runtimeRequirements = ["resource_isolation", "current_grant_check"];
  const wide = structuredClone(narrow); wide.boundary.resources[0].access.push("write"); wide.boundary.tools.allow.push({ toolId: "workspace_read", connectorId: "connector", catalogRevision: 2 }); wide.boundary.tools.deny = []; wide.boundary.tools.readOnly = false;
  wide.boundary.budget.maxModelCalls = 2; wide.boundary.budget.maxToolEffects = 3; wide.boundary.approvalRequired = []; wide.boundary.runtimeRequirements = [];
  const changes = workScopeChanges(narrow, wide);
  for (const field of ["resource", "allow", "deny", "readOnly", "modelCalls", "toolEffects", "approval", "requirement"]) assert.ok(changes.some(row => row.field === field && row.direction === "expand"), field);
  assert.ok(workScopeChanges(wide, narrow).every(row => row.direction === "narrow"));
});
test("C5 exact text/context/four-right changes are never hidden by a difference view", () => {
  const before = base(), other = structuredClone(before); other.rights.invoke = !other.rights.invoke;
  assert.throws(() => workScopeChanges(before, other), invalid);
  const foreign = structuredClone(before); for (const doc of [foreign.duty, foreign.boundary]) { doc.context.humanSubjectId = "other-human"; doc.context.localGrant.humanSubjectId = "other-human"; }
  assert.throws(() => workScopeChanges(before, foreign), invalid);
  const title = structuredClone(before); title.duty.publicProfile.title = "<img onerror=execute>";
  assert.deepEqual(workScopeChanges(before, title), [{ field: "title", direction: "text", before: before.duty.publicProfile.title, after: "<img onerror=execute>" }]);
  assert.equal(workScopeEqual(before, structuredClone(before)), true);
});
test("C5 proposal data rejects accessors, extra fields, duplicate resources and allow/deny overlap", () => {
  const before = snapshot(); let calls = 0; const raw = { ...before }; Object.defineProperty(raw, "rights", { enumerable: true, get() { calls++; return before.rights; } });
  assert.throws(() => parseWorkScopeProposal(raw), invalid); assert.equal(calls, 0);
  assert.throws(() => parseWorkScopeProposal({ ...before, approved: true }), invalid);
  const changes = mutableBoundary(before); changes.resources = [{ resourceId: "folder", access: ["read"] }, { resourceId: "folder", access: ["write"] }];
  assert.throws(() => boundaryWorkScopeProposal(before, changes), invalid);
  const overlap = mutableBoundary(before), ref = { toolId: "workspace_read", connectorId: null, catalogRevision: 1 }; overlap.tools.allow = [ref]; overlap.tools.deny = [ref];
  assert.throws(() => boundaryWorkScopeProposal(before, overlap), invalid);
});
test("C5 proposal canonical mirror/fixture checks reject drift without mutating the repository", () => {
  const script = new URL("../scripts/sync-work-scope-proposal.mjs", import.meta.url);
  execFileSync(process.execPath, [script.pathname, "--check"], { encoding: "utf8" });
  const temporary = mkdtempSync(join(tmpdir(), "c5-proposal-lock-"));
  const files = ["src/contracts/agent-policy-canonical-v1.ts", "docs/contracts/agent-policy-proposal-core.json", "docs/contracts/agent-policy-proposal.lock.json", "test/fixtures/agent-policy-proposal-v1.json", "test/fixtures/agent-boundaries-v1.json"];
  for (const name of files) { mkdirSync(join(temporary, name, ".."), { recursive: true }); copyFileSync(new URL(name, root), join(temporary, name)); }
  const run = () => spawnSync(process.execPath, [script.pathname, "--check", "--fixture-root", temporary], { encoding: "utf8" });
  assert.equal(run().status, 0);
  const mirror = join(temporary, files[0]), original = readFileSync(mirror); writeFileSync(mirror, Buffer.concat([original, Buffer.from("\n// drift\n")])); assert.notEqual(run().status, 0); writeFileSync(mirror, original);
  const fixture = join(temporary, files[3]), originalFixture = readFileSync(fixture), data = JSON.parse(originalFixture); data.vectors[0].digest = "0".repeat(64); writeFileSync(fixture, JSON.stringify(data)); assert.notEqual(run().status, 0); writeFileSync(fixture, originalFixture);
  assert.equal(run().status, 0);
});
