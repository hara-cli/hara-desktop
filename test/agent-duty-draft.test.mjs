import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { AgentBoundaryContractError } from "../src/agent-boundary-contract.ts";
import { createAgentDutyDraft, parseAgentDutyDraft, parseAgentDutyPublicProfile, agentDutyDraftProposal } from "../src/agent-duty-draft.ts";
import { readInputs, renderMirror, assertMirror } from "../scripts/sync-agent-duty-draft.mjs";
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/agent-duty-draft-v1.json", import.meta.url), "utf8"));
const code = expected => error => error instanceof AgentBoundaryContractError && error.code === expected;
for (const { name, profile } of fixtures.validProfiles) test(`C5 duty public data round-trips without authority: ${name}`, () => {
  const input = structuredClone(profile), draft = createAgentDutyDraft(input);
  assert.deepEqual(draft, { schemaVersion: 1, kind: "duty-draft", status: "unconfirmed", publicProfile: profile });
  assert.deepEqual(parseAgentDutyDraft(JSON.parse(JSON.stringify(draft))), draft);
  assert.deepEqual(parseAgentDutyPublicProfile(profile), profile);
  assert.deepEqual(Object.keys(draft).sort(), ["kind", "publicProfile", "schemaVersion", "status"]);
  assert.equal(JSON.stringify(draft).includes("syntax-only"), false);
  assert.ok(Object.isFrozen(draft) && Object.isFrozen(draft.publicProfile) && Object.isFrozen(draft.publicProfile.owns) && Object.isFrozen(draft.publicProfile.rejects));
  input.title = "edited input"; input.owns.push("changed later"); assert.deepEqual(draft.publicProfile, profile);
  const proposal = agentDutyDraftProposal(draft, fixtures.context, fixtures.agentId, fixtures.dutyRevision + 1);
  assert.equal(proposal.kind, "duty-profile"); assert.equal(proposal.dutyRevision, fixtures.dutyRevision + 1);
  assert.deepEqual(proposal.context, fixtures.context); assert.deepEqual(proposal.publicProfile, profile);
  assert.equal("permit" in proposal, false); assert.equal("grant" in proposal, false); assert.equal("runnable" in proposal, false);
});
for (const { name, key, value } of fixtures.invalidDraftEdits) test(`C5 duty refuses confirmed/extra draft data: ${name}`, () => {
  const draft = createAgentDutyDraft(fixtures.validProfiles[0].profile);
  assert.throws(() => parseAgentDutyDraft({ ...draft, [key]: value }), code("INVALID_DOCUMENT"));
});
for (const { name, key, value } of fixtures.invalidProfileEdits) test(`C5 duty rejects non-C0 public fields: ${name}`, () => {
  assert.throws(() => createAgentDutyDraft({ ...fixtures.validProfiles[0].profile, [key]: value }), code("INVALID_DOCUMENT"));
});
test("C5 duty parsing rejects getters, hidden/symbol keys, sparse arrays and foreign prototypes without reading them", () => {
  let reads = 0;
  const draft = createAgentDutyDraft(fixtures.validProfiles[0].profile), getter = { ...draft };
  Object.defineProperty(getter, "publicProfile", { enumerable: true, get() { reads++; return draft.publicProfile; } });
  const profileGetter = { ...draft.publicProfile };
  Object.defineProperty(profileGetter, "owns", { enumerable: true, get() { reads++; return ["private"]; } });
  assert.throws(() => createAgentDutyDraft(profileGetter), code("INVALID_DOCUMENT"));
  const hidden = { ...draft }; Object.defineProperty(hidden, "secret", { value: "not-read" });
  const symbol = { ...draft, [Symbol("permit")]: true };
  for (const raw of [getter, hidden, symbol, Object.assign(Object.create({ foreign: true }), draft), null, [], new Date()])
    assert.throws(() => parseAgentDutyDraft(raw), code("INVALID_DOCUMENT"));
  assert.throws(() => createAgentDutyDraft({ ...draft.publicProfile, owns: new Array(1) }), code("INVALID_DOCUMENT"));
  assert.equal(reads, 0);
  assert.deepEqual(parseAgentDutyDraft(Object.assign(Object.create(null), draft)), draft);
});
test("C5 duty mirror check allows only pinned imports and exact pure deepFreeze, rejecting other changes", () => {
  const inputs = readInputs(), mirror = readFileSync(new URL("../src/contracts/agent-duty-draft-v1.ts", import.meta.url), "utf8");
  assert.equal(assertMirror(mirror, inputs), true); assert.equal(renderMirror(inputs), mirror);
  for (const edited of [mirror.replace('value.status !== "unconfirmed"', 'false'), mirror.replace('keys.length !== 4', 'false'), mirror + "\n// extra body change\n"])
    assert.throws(() => assertMirror(edited, inputs));
  assert.throws(() => renderMirror({ ...inputs, source: inputs.source + "\n" }));
  assert.throws(() => renderMirror({ ...inputs, freeze: inputs.freeze.replace("Object.freeze(value);", "return value;") }));
  assert.throws(() => renderMirror({ ...inputs, lock: { ...inputs.lock, allowedTransforms: { ...inputs.lock.allowedTransforms, editBody: true } } }));
});
test("C5 duty shared facade bundles for the browser using only the existing C0 parser and mirror", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/agent-duty-draft.ts", import.meta.url))], bundle: true,
    platform: "browser", format: "esm", target: "es2022", write: false, metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile.inputs);
  assert.equal(inputs.length, 3); assert.ok(inputs.some(name => name.endsWith("agent-boundaries-v1.ts")));
  assert.equal(inputs.some(name => name.includes("local-state") || name.includes("node_modules")), false);
  assert.equal(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports.length, 0);
});
test("C5 duty public types stay C0-only, immutable and unconfirmed", () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "--project", "test/fixtures/agent-duty-draft.tsconfig.json"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe" });
});
