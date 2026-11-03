import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReport, loadCases, reportMarkdown, saveEvidence, sourceIdentity, validateRegistry } from "../scripts/visual-case-registry.mjs";
const sha = "a".repeat(40), coreSha = "b".repeat(40), cases = loadCases(), row = cases[0];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0b0AAAAASUVORK5CYII=", "base64");
function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "hara-visual-contract-")); t.after(() => rmSync(root, { recursive: true }));
  writeFileSync(join(root, "shot.png"), png);
  const checks = { caseId: row.id, sourceSha: sha, captureMethod: "fixture-browser", synthetic: true, status: "passed", assertions: ["A real collector assertion"], ...overrides };
  writeFileSync(join(root, "checks.json"), JSON.stringify(checks));
  const input = { sourceSha: sha, captureMethod: checks.captureMethod, checks: "passed", screenshots: ["shot.png"], checkArtifact: "checks.json", coreSha: checks.coreSha, packageSha256: checks.packageSha256 };
  return { root, input, checks };
}
test("registry covers all four areas and names unavailable features as pending", () => {
  assert.deepEqual([...new Set(cases.map(value => value.area))].sort(), ["errors", "groups", "login", "runtime"]);
  assert.equal(cases.length, 9);
  assert.deepEqual(cases.filter(value => !value.fixture).map(value => value.id), ["error-diagnostic-summary", "group-interjection-fold"]);
  for (const value of cases) assert.ok(value.scenario && value.expectations.length);
});
test("registry rejects duplicate IDs, unsafe fixture routes, unknown areas and undocumented gaps", () => {
  const copy = () => structuredClone({ schemaVersion: 1, cases });
  for (const mutate of [
    value => value.cases.push(value.cases[0]),
    value => value.cases[0].fixture.entry = "../outside-preview",
    value => value.cases[0].fixture.query.scenario = "https://private.invalid",
    value => value.cases[0].area = "unknown",
    value => { value.cases[0].fixture = null; },
  ]) { const value = copy(); mutate(value); assert.throws(() => validateRegistry(value)); }
});
test("a fixture pass keeps Core, native and human visual acceptance pending", t => {
  const f = fixture(t); const receipt = saveEvidence(row, f.input, f.root);
  assert.equal(receipt.stateSource, "fixture"); assert.equal(receipt.visualReview, "pending");
  const report = buildReport(cases, f.root, { sourceSha: sha, dirty: false }), evidence = report.cases[0].evidence;
  assert.equal(evidence["fixture-browser"].status, "passed"); assert.equal(evidence["fixture-browser"].lastVerifiedSha, sha);
  assert.equal(evidence["isolated-core-browser"].status, "pending"); assert.equal(evidence["native-core"].status, "pending");
  assert.ok(reportMarkdown(report).includes("fixture-browser: passed"));
  assert.ok(receipt.screenshots[0].sha256 && receipt.checkArtifact.sha256);
});
test("changed or missing evidence never remains passed", t => {
  const f = fixture(t); saveEvidence(row, f.input, f.root);
  writeFileSync(join(f.root, "shot.png"), Buffer.concat([png, Buffer.from("changed")]));
  assert.equal(buildReport(cases, f.root, { sourceSha: sha, dirty: false }).cases[0].evidence["fixture-browser"].status, "invalid");
  rmSync(join(f.root, "shot.png"));
  assert.equal(buildReport(cases, f.root, { sourceSha: sha, dirty: false }).cases[0].evidence["fixture-browser"].lastVerifiedSha, null);
});
test("different source and dirty source preserve attribution but cannot pass the current tree", t => {
  const f = fixture(t); saveEvidence(row, f.input, f.root);
  for (const identity of [{ sourceSha: coreSha, dirty: false }, { sourceSha: sha, dirty: true }]) {
    const evidence = buildReport(cases, f.root, identity).cases[0].evidence["fixture-browser"];
    assert.equal(evidence.status, "stale"); assert.equal(evidence.lastVerifiedSha, sha);
  }
});
test("synthetic checks cannot certify real Core or a native package", t => {
  for (const method of ["isolated-core-browser", "native-core"]) {
    const f = fixture(t, { captureMethod: method, coreSha, environment: "isolated", packageSha256: "c".repeat(64) });
    assert.throws(() => saveEvidence(row, f.input, f.root), /Synthetic/);
  }
});
test("real Core browser checks need the same exact Core SHA and isolated environment", t => {
  for (const patch of [{ coreSha: undefined, environment: "isolated" }, { coreSha, environment: "host" }]) {
    const f = fixture(t, { captureMethod: "isolated-core-browser", synthetic: false, ...patch });
    assert.throws(() => saveEvidence(row, f.input, f.root), /Real Core/);
  }
  const f = fixture(t, { captureMethod: "isolated-core-browser", synthetic: false, coreSha, environment: "isolated" });
  saveEvidence(row, f.input, f.root);
  const report = buildReport(cases, f.root, { sourceSha: sha, dirty: false }).cases[0].evidence;
  assert.equal(report["isolated-core-browser"].status, "passed"); assert.equal(report["fixture-browser"].status, "pending");
  assert.equal(report["native-core"].status, "pending");
});
test("native evidence additionally requires an exact package digest", t => {
  const f = fixture(t, { captureMethod: "native-core", synthetic: false, coreSha, environment: "isolated" });
  assert.throws(() => saveEvidence(row, f.input, f.root), /package digest/);
});
test("check identity, source, method and status are independently validated", t => {
  for (const patch of [{ caseId: "wrong-case" }, { sourceSha: coreSha }, { status: "pending" }, { assertions: [] }]) {
    const f = fixture(t, patch); assert.throws(() => saveEvidence(row, f.input, f.root));
  }
  const f = fixture(t);
  assert.throws(() => saveEvidence(row, { ...f.input, captureMethod: "native-core" }, f.root), /provenance/);
});
test("unavailable or locked capture has no last verified SHA or successful artifacts", t => {
  const f = fixture(t), pendingCase = cases.find(value => value.id === "group-interjection-fold");
  assert.throws(() => saveEvidence(pendingCase, f.input, f.root), /no fixture/);
  saveEvidence(row, { sourceSha: sha, captureMethod: "fixture-browser", checks: "pending", reason: "Screen locked; capture not attempted." }, f.root);
  const evidence = buildReport(cases, f.root, { sourceSha: sha, dirty: false }).cases[0].evidence["fixture-browser"];
  assert.equal(evidence.status, "pending"); assert.equal(evidence.lastVerifiedSha, null); assert.deepEqual(evidence.screenshots, []);
});
test("evidence refuses paths outside its root, symlink screenshots and fake PNGs", t => {
  const f = fixture(t);
  assert.throws(() => saveEvidence(row, { ...f.input, screenshots: [join(f.root, "shot.png")] }, f.root), /relative/);
  symlinkSync(join(f.root, "shot.png"), join(f.root, "link.png"));
  assert.throws(() => saveEvidence(row, { ...f.input, screenshots: ["link.png"] }, f.root), /regular file/);
  const outside = mkdtempSync(join(tmpdir(), "hara-visual-outside-")); t.after(() => rmSync(outside, { recursive: true }));
  writeFileSync(join(outside, "shot.png"), png);
  assert.throws(() => saveEvidence(row, { ...f.input, screenshots: ["../" + outside.split("/").at(-1) + "/shot.png"] }, f.root), /within/);
  writeFileSync(join(f.root, "shot.png"), "not a PNG");
  assert.throws(() => saveEvidence(row, f.input, f.root), /PNG/);
});
test("fresh captures cannot silently replace earlier receipts", t => {
  const f = fixture(t); saveEvidence(row, f.input, f.root);
  assert.throws(() => saveEvidence(row, f.input, f.root), /EEXIST/);
});
test("capture admission rejects uncommitted or untracked source", t => {
  const root = mkdtempSync(join(tmpdir(), "hara-visual-git-")); t.after(() => rmSync(root, { recursive: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init"); git("-c", "user.name=Visual Test", "-c", "user.email=visual@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  assert.equal(sourceIdentity(root, true).dirty, false);
  writeFileSync(join(root, "untracked-source.txt"), "source");
  assert.throws(() => sourceIdentity(root, true), /committed, clean/);
  assert.equal(sourceIdentity(root).dirty, true);
});
