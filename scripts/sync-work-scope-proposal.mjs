#!/usr/bin/env node
// Portable C3 JSON primitives only. This copies no persistence/transport authority and issues no grant.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import ts from "typescript";
const fixtureIndex = process.argv.indexOf("--fixture-root");
if (fixtureIndex >= 0 && !process.argv.includes("--check")) throw Error("A fixture root is read-only check mode only");
const root = fixtureIndex >= 0 ? resolve(process.argv[fixtureIndex + 1]) : fileURLToPath(new URL("../", import.meta.url));
const ref = "b01e492adf30b3b6d0d5c31385122ce3dca601a3", domain = "hara-agent-policy-proposal-v1\0";
const paths = { mirror: "src/contracts/agent-policy-canonical-v1.ts", snapshot: "docs/contracts/agent-policy-proposal-core.json",
  lock: "docs/contracts/agent-policy-proposal.lock.json", fixtures: "test/fixtures/agent-policy-proposal-v1.json" };
const check = process.argv.includes("--check"), index = process.argv.indexOf("--core-repository"), core = index >= 0 ? resolve(process.argv[index + 1]) : null;
if (!check && !core) throw Error("Generation requires --core-repository; the canonical Core source is mandatory");
const hash = value => createHash("sha256").update(value).digest("hex");
const read = name => readFileSync(resolve(root, name), "utf8");
const text = value => JSON.stringify(value, null, 2) + "\n";
function sourceSnapshot() {
  const source = path => execFileSync("git", ["show", `${ref}:${path}`], { cwd: core, encoding: "utf8" }).replaceAll("\r\n", "\n");
  const local = source("src/workspace/local-state.ts"), state = source("src/workspace/agent-command-state.ts");
  const tree = ts.createSourceFile("local-state.ts", local, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = name => { const rows = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.equal(rows.length, 1); return rows[0].getText(tree); };
  const stateTree = ts.createSourceFile("agent-command-state.ts", state, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = stateTree.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const rows = declarations.filter(node => ts.isIdentifier(node.name) && node.name.text === "agentPolicyProposalDigest"); assert.equal(rows.length, 1);
  const digest = rows[0].initializer.getText(stateTree);
  assert.equal(digest, '(value: unknown): string => createHash("sha256").update("hara-agent-policy-proposal-v1\\0").update(canonical(value)).digest("hex")', "C3 digest definition changed; review contract before adapting");
  return { ref, sourceFiles: { "src/workspace/local-state.ts": hash(local), "src/workspace/agent-command-state.ts": hash(state) },
    plain: declaration("plain"), canonical: declaration("canonical"), digest };
}
const snapshot = core ? sourceSnapshot() : JSON.parse(read(paths.snapshot));
assert.equal(snapshot.ref, ref);
assert.equal(snapshot.digest, '(value: unknown): string => createHash("sha256").update("hara-agent-policy-proposal-v1\\0").update(canonical(value)).digest("hex")');
// Execute the exact two Core declarations and exact Core digest initializer, without Node filesystem imports.
const portableReference = `import { createHash } from "node:crypto";\n${snapshot.plain}\n${snapshot.canonical}\nexport const agentPolicyProposalDigest = ${snapshot.digest};`;
const compiled = ts.transpileModule(portableReference, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const reference = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const documents = JSON.parse(read("test/fixtures/agent-boundaries-v1.json")).valid;
const copy = name => structuredClone(documents.find(row => row.name === name).document);
const duty = copy("duty"), boundary = copy("boundary"); boundary.context = structuredClone(duty.context); boundary.agentId = duty.agentId;
const base = { duty, boundary, rights: { manage: true, invoke: false, privateRead: false, nodeUse: false } };
const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reverse(value[key])])) : value;
const variants = [
  ["current-policy", value => value], ["object-key-order", reverse],
  ["unicode-newlines", value => { value.duty.publicProfile = { title: "資料複核 🌱", description: "résumé\nLine two\t<plain text>", owns: ["整理資料", "Archive summaries"], rejects: ["No publication"] }; return value; }],
  ["empty-lists-zero-budget", value => { value.boundary.resources = []; value.boundary.tools = { allow: [], deny: [], readOnly: true }; value.boundary.approvalRequired = []; value.boundary.budget.maxModelCalls = 0; value.boundary.budget.maxToolEffects = 0; return value; }],
  ["rights-differ", value => { value.rights.invoke = true; value.rights.nodeUse = true; return value; }],
  ["budget-differs", value => { value.boundary.budget.maxModelCalls += 7; return value; }],
  ["approval-order", value => { value.boundary.approvalRequired = ["policy_expand", "paid", "write"]; return value; }],
  ["connector-reference", value => { value.boundary.tools.allow = [{ toolId: "workspace_read", connectorId: "registered-connector", catalogRevision: 2 }]; return value; }],
  ["duty-order", value => { value.duty.publicProfile.owns = ["second", "first"]; return value; }],
  ["different-principal", value => { for (const doc of [value.duty, value.boundary]) { doc.context.humanSubjectId = "other-human"; doc.context.localGrant.humanSubjectId = "other-human"; } return value; }],
];
const fixtures = { sourceRef: ref, domain, vectors: variants.map(([name, change]) => { const proposal = change(structuredClone(base)); return { name, proposal, digest: reference.agentPolicyProposalDigest(proposal) }; }) };
assert.equal(fixtures.vectors[0].digest, fixtures.vectors[1].digest);
const mirror = `// Generated by sync-work-scope-proposal.mjs from Core ${ref}. No authority is exported.\n${snapshot.plain}\n\n${snapshot.canonical}\n\nexport const AGENT_POLICY_PROPOSAL_DOMAIN = ${JSON.stringify(domain)};\n`;
const outputs = { [paths.snapshot]: text(snapshot), [paths.fixtures]: text(fixtures), [paths.mirror]: mirror };
outputs[paths.lock] = text({ schemaVersion: 1, sourceRef: ref, sourceFiles: snapshot.sourceFiles, allowedTransformation: "two pure function declarations byte-identical; domain literal emitted separately; WebCrypto adapter is not Core authority",
  files: Object.fromEntries(Object.entries(outputs).map(([path, content]) => [path, hash(content)])) });
for (const [path, content] of Object.entries(outputs)) {
  if (check) assert.equal(hash(read(path)), hash(content), `C3 proposal mirror/fixture drift: ${path}`);
  else writeFileSync(resolve(root, path), content);
}
console.log(`C3 proposal canonical mirror and ${fixtures.vectors.length} actual-source digest vectors ${check ? "verified" : "generated"}${core ? " against pinned Core" : " against locked source snapshot"}`);
