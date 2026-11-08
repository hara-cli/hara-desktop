#!/usr/bin/env node
// Hara-owned evidence model. No backend, credentials, platform capture, or external upload.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const methods = ["fixture-browser", "isolated-core-browser", "native-core"];
const shaPattern = /^[a-f0-9]{40}$/;
const safeId = /^[a-z][a-z0-9-]{1,63}$/;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

export function validateRegistry(registry) {
  requireThat(registry?.schemaVersion === 1 && Array.isArray(registry.cases) && registry.cases.length > 0, "Invalid visual registry");
  const ids = new Set();
  for (const row of registry.cases) {
    requireThat(safeId.test(row.id) && !ids.has(row.id), "Invalid or duplicate case ID"); ids.add(row.id);
    requireThat(["runtime", "login", "errors", "groups"].includes(row.area), "Unknown case area");
    requireThat(typeof row.scenario === "string" && row.scenario.trim() && Array.isArray(row.expectations) && row.expectations.length > 0 && row.expectations.every(value => typeof value === "string" && value.trim()), "Scenario and expectations required");
    if (row.fixture) {
      requireThat(safeId.test(row.fixture.entry) && row.fixture.entry.endsWith("-preview"), "Invalid fixture entry");
      requireThat(row.fixture.query && Object.entries(row.fixture.query).every(([key, value]) => /^[a-zA-Z]+$/.test(key) && typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value)), "Invalid fixture query");
    } else requireThat(typeof row.pendingReason === "string" && row.pendingReason.trim(), "Unavailable fixture requires a pending reason");
  }
  return registry.cases;
}
export function loadCases(root = repoRoot) {
  const cases = validateRegistry(JSON.parse(readFileSync(join(root, "test/visual-cases.json"), "utf8")));
  for (const row of cases) if (row.fixture) {
    for (const suffix of ["html", "tsx"]) requireThat(existsSync(join(root, "test/fixtures", row.fixture.entry + "." + suffix)), "Registered fixture is missing");
  }
  return cases;
}
export function sourceIdentity(root = repoRoot, requireClean = false) {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
  requireThat(shaPattern.test(sourceSha), "Full source SHA required");
  requireThat(!requireClean || !dirty, "Capture requires a committed, clean source tree");
  return { sourceSha, dirty };
}
function artifact(root, file) {
  requireThat(typeof file === "string" && !isAbsolute(file), "Evidence paths must be relative");
  const candidate = resolve(root, file), rel = relative(realpathSync(root), realpathSync(candidate));
  requireThat(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel) && lstatSync(candidate).isFile(), "Evidence must be a regular file within the evidence root");
  const bytes = readFileSync(candidate);
  return { path: file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function checkEvidence(row, receipt, root) {
  requireThat(receipt?.schemaVersion === 1 && receipt.caseId === row.id && methods.includes(receipt.captureMethod), "Evidence identity mismatch");
  requireThat(shaPattern.test(receipt.sourceSha) && Number.isFinite(Date.parse(receipt.capturedAt)), "Evidence source SHA and capture time required");
  const fixture = receipt.captureMethod === "fixture-browser";
  requireThat(receipt.stateSource === (fixture ? "fixture" : "core") && receipt.surface === (receipt.captureMethod === "native-core" ? "native" : "browser"), "Capture method and state source mismatch");
  requireThat(!fixture || row.fixture || receipt.checks === "pending", "This baseline has no fixture for the case");
  requireThat(receipt.visualReview === "pending", "Automated capture cannot certify a visual review");
  requireThat(["passed", "failed", "pending"].includes(receipt.checks), "Invalid checks status");
  requireThat(Array.isArray(receipt.screenshots), "Screenshot list required");
  if (receipt.checks === "pending") {
    requireThat(typeof receipt.reason === "string" && receipt.reason.trim() && !receipt.screenshots.length && receipt.checkArtifact === null, "Pending capture needs a reason and no claimed artifacts");
    return receipt;
  }
  requireThat(receipt.screenshots.length > 0 && receipt.checkArtifact, "Completed checks require screenshot and check evidence");
  for (const item of [...receipt.screenshots, receipt.checkArtifact]) {
    const found = artifact(root, item.path);
    requireThat(found.bytes === item.bytes && found.sha256 === item.sha256, "Evidence artifact changed or missing");
  }
  for (const item of receipt.screenshots) {
    const data = readFileSync(resolve(root, item.path));
    requireThat(data.length > 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Screenshot must be a PNG");
  }
  const checks = JSON.parse(readFileSync(resolve(root, receipt.checkArtifact.path), "utf8"));
  requireThat(checks.caseId === row.id && checks.sourceSha === receipt.sourceSha && checks.captureMethod === receipt.captureMethod && checks.status === receipt.checks, "Check evidence provenance mismatch");
  requireThat(Array.isArray(checks.assertions) && checks.assertions.length > 0, "Executed assertions required");
  requireThat(checks.synthetic === fixture, "Synthetic checks cannot certify real Core");
  if (!fixture) {
    requireThat(shaPattern.test(receipt.coreSha) && checks.coreSha === receipt.coreSha && checks.environment === "isolated", "Real Core evidence needs an isolated environment and exact Core SHA");
    if (receipt.surface === "native") requireThat(/^[a-f0-9]{64}$/.test(receipt.packageSha256) && receipt.packageSha256 === checks.packageSha256, "Native evidence needs the captured package digest");
  }
  return receipt;
}
export function saveEvidence(row, input, root) {
  requireThat(methods.includes(input.captureMethod), "Unknown capture method");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const fixture = input.captureMethod === "fixture-browser";
  const receipt = {
    schemaVersion: 1, caseId: row.id, sourceSha: input.sourceSha, capturedAt: new Date().toISOString(),
    captureMethod: input.captureMethod, stateSource: fixture ? "fixture" : "core",
    surface: input.captureMethod === "native-core" ? "native" : "browser", coreSha: input.coreSha ?? null,
    ...(input.packageSha256 ? { packageSha256: input.packageSha256 } : {}),
    checks: input.checks, visualReview: "pending", reason: input.reason ?? null,
    screenshots: (input.screenshots ?? []).map(file => artifact(root, file)),
    checkArtifact: input.checkArtifact ? artifact(root, input.checkArtifact) : null,
  };
  checkEvidence(row, receipt, root);
  const directory = join(root, row.id, input.captureMethod); mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return receipt;
}
export function buildReport(cases, root, identity) {
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), ...identity, cases: cases.map(row => ({
    id: row.id, area: row.area, scenario: row.scenario, expectations: row.expectations,
    evidence: Object.fromEntries(methods.map(method => {
      const file = join(root, row.id, method, "receipt.json");
      if (!existsSync(file)) return [method, { status: "pending", stateSource: method === "fixture-browser" ? "fixture" : "core", lastVerifiedSha: null, evidencePath: null,
        reason: method === "fixture-browser" && !row.fixture ? row.pendingReason : "No evidence recorded for this source and surface." }];
      try {
        const receipt = checkEvidence(row, JSON.parse(readFileSync(file, "utf8")), root);
        requireThat(receipt.captureMethod === method, "Evidence lane mismatch");
        return [method, { status: receipt.checks === "pending" ? "pending" : identity.dirty || receipt.sourceSha !== identity.sourceSha ? "stale" : receipt.checks,
          stateSource: receipt.stateSource, lastVerifiedSha: receipt.checks === "passed" ? receipt.sourceSha : null,
          evidencePath: file, ...receipt }];
      } catch {
        return [method, { status: "invalid", lastVerifiedSha: null, evidencePath: file, reason: "Evidence identity, provenance or artifact integrity failed validation." }];
      }
    })),
  })) };
}
export function reportMarkdown(report) {
  const cell = value => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
  const lines = ["# Hara visual case evidence", "", "Source: " + report.sourceSha + (report.dirty ? " (dirty; receipts cannot certify this tree)" : ""), "",
    "Automated browser checks and screenshot capture do not certify human visual review, real Core or a native package.", "",
    "| Case | Fixture checks | Real Core browser | Native Core |", "| --- | --- | --- | --- |"];
  for (const row of report.cases) lines.push("| " + [row.id, ...methods.map(method => row.evidence[method].status)].map(cell).join(" | ") + " |");
  for (const row of report.cases) {
    lines.push("", "## " + row.id, "", row.scenario);
    for (const method of methods) {
      const item = row.evidence[method];
      lines.push("", "- " + method + ": " + item.status + "; state=" + (item.stateSource ?? "unknown") + "; last verified SHA=" + (item.lastVerifiedSha ?? "pending") + "; visual review=" + (item.visualReview ?? "pending"),
        "  Evidence: " + (item.evidencePath ?? "pending") + (item.reason ? "; " + item.reason : ""));
      for (const screenshot of item.screenshots ?? []) lines.push("  Screenshot: " + screenshot.path + " (SHA256 " + screenshot.sha256 + ")");
    }
  }
  return lines.join("\n") + "\n";
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "list", output] = process.argv.slice(2);
  const cases = loadCases();
  if (command === "list") console.log(JSON.stringify(cases, null, 2));
  else if (command === "report" && output) {
    const root = resolve(output), report = buildReport(cases, root, sourceIdentity());
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const [name, content] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["report.md", reportMarkdown(report)]])
      writeFileSync(join(root, name), content, { mode: 0o600 });
    console.log(JSON.stringify({ report: join(root, "report.md"), cases: cases.length }));
    if (report.cases.some(row => Object.values(row.evidence).some(value => ["invalid", "failed"].includes(value.status)))) process.exitCode = 1;
  } else throw new Error("Usage: node scripts/visual-case-registry.mjs [list | report EVIDENCE_DIRECTORY]");
}
