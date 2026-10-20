import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { candidateAssetNames, candidateGates, candidateIdentity, CANDIDATE_TARGETS, validateCandidate } from "../scripts/candidate-gate.mjs";
import { CANDIDATE_STAGES, runCandidatePromotion, runCandidateStages } from "../scripts/candidate-stages.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const nowSeconds = 2000000000;
function fixture() {
  const source = {
    desktop: { commit: "1".repeat(40), tree: "2".repeat(40), version: "1.1.0" },
    core: { commit: "3".repeat(40), tree: "4".repeat(40), version: "1.1.0" },
    toolchain: { node: "22.23.1", bun: "1.3.9", rust: "1.97.0" },
    locks: { npm: sha("npm"), cargo: sha("cargo"), sidecar: sha("sidecar") }, updaterPublicKeySha256: sha("public key only"),
  };
  const policy = { repository: "hara-cli/hara-desktop", workflowId: 101, workflowPath: ".github/workflows/candidate.yml",
    workflowSha256: sha("reviewed workflow"), environment: "hara-desktop-candidate", controlledRef: "refs/heads/candidate/1.1.0",
    approverId: 12345, protectionSha256: sha("independently verified protection"), maximumAgeSeconds: 86400,
    upgradeFrom: ["0.1.187", "1.0.3"] };
  const identity = candidateIdentity(source, policy), runId = 700, attempt = 2;
  const receipt = { schema: 1, identity, runId, attempt, platforms: [] };
  const observed = { repository: policy.repository, workflow: { id: policy.workflowId, path: policy.workflowPath, sha256: policy.workflowSha256 },
    run: { id: runId, attempt, headRepository: policy.repository, headSha: source.desktop.commit, ref: policy.controlledRef,
      event: "workflow_dispatch", status: "completed", conclusion: "success", startedAt: nowSeconds - 600, completedAt: nowSeconds - 60 },
    approval: { environment: policy.environment, ref: policy.controlledRef, headSha: source.desktop.commit,
      reviewerId: policy.approverId, runId, attempt, protectionSha256: policy.protectionSha256 }, jobs: [], artifacts: [], inspections: [] };
  for (const [index, target] of CANDIDATE_TARGETS.entries()) {
    const jobId = 800 + index, artifactId = 900 + index;
    const files = Object.fromEntries(candidateAssetNames(target, source.desktop.version).map(name => [name, { size: 1024, sha256: sha(name) }]));
    const archiveSha256 = sha(`archive:${target}`), archiveSize = 12345 + index;
    receipt.platforms.push({ target, jobId, artifactId, archiveSha256, archiveSize, files: structuredClone(files) });
    observed.jobs.push({ id: jobId, runId, attempt, name: `candidate-${target}`, status: "completed", conclusion: "success",
      labels: [target.includes("apple") ? "macOS" : target.includes("linux") ? "Linux" : "Windows", target.startsWith("aarch64") ? "ARM64" : "X64"],
      steps: candidateGates(target).map(name => ({ name, status: "completed", conclusion: "success" })) });
    observed.artifacts.push({ id: artifactId, runId, attempt, headSha: source.desktop.commit, name: `candidate-${target}`, expired: false, size: archiveSize, sha256: archiveSha256 });
    const inspection = { artifactId, runId, attempt, identity, archiveSha256, archiveSize, files,
      piOnlyPreinstalledRequirementMet: true, upgrades: policy.upgradeFrom.map(from => ({ from, to: source.desktop.version, target, result: "passed" })) };
    if (target.includes("apple")) {
      const appFinalSha256 = sha(`signed app:${target}`), dmgSha256 = files[candidateAssetNames(target, source.desktop.version)[0]].sha256;
      const notary = (digest, suffix) => ({ submissionId: `01234567-0123-0123-0123-${String(index * 2 + suffix).padStart(12, "0")}`, status: "Accepted", inputSha256: sha(`pre-staple:${digest}`), finalSha256: digest, stapled: true });
      Object.assign(inspection, { appFinalSha256, appNotary: notary(appFinalSha256, 1), dmgNotary: notary(dmgSha256, 2), gatekeeper: "accepted", nativeDmg: true });
    }
    observed.inspections.push(inspection);
  }
  return { source, policy, receipt, observed, nowSeconds };
}

test("offline candidate joins exact source, policy, independent run/steps/download inspections for all four targets", () => {
  const f = fixture(), proof = validateCandidate(f);
  assert.equal(proof.identity, f.receipt.identity); assert.equal(proof.artifacts.length, 4);
  assert.equal(proof.artifacts[1].target, "x86_64-apple-darwin");
  assert(Object.isFrozen(proof) && Object.isFrozen(proof.artifacts[0].files));
  f.receipt.platforms[0].files[Object.keys(f.receipt.platforms[0].files)[0]].size++;
  assert.equal(Object.values(proof.artifacts[0].files)[0].size, 1024, "proof owns detached immutable file evidence");
});

const rejectionCases = {
  "changed Desktop SHA": f => { f.source.desktop.commit = "a".repeat(40); },
  "changed Desktop tree": f => { f.source.desktop.tree = "a".repeat(40); },
  "changed Desktop version": f => { f.source.desktop.version = "1.1.1"; },
  "changed Core SHA": f => { f.source.core.commit = "b".repeat(40); },
  "changed Core tree": f => { f.source.core.tree = "b".repeat(40); },
  "changed Core version": f => { f.source.core.version = "1.1.1"; },
  "changed toolchain": f => { f.source.toolchain.bun = "1.3.10"; },
  "changed npm lock": f => { f.source.locks.npm = sha("changed"); },
  "changed cargo lock": f => { f.source.locks.cargo = sha("changed"); },
  "changed sidecar lock": f => { f.source.locks.sidecar = sha("changed"); },
  "changed updater public key": f => { f.source.updaterPublicKeySha256 = sha("different key"); },
  "changed gate policy": f => { f.policy.protectionSha256 = sha("different policy"); },
  "changed workflow bytes": f => { f.observed.workflow.sha256 = sha("unreviewed workflow"); },
  "foreign repository": f => { f.observed.repository = "fork/hara-desktop"; },
  "fork source": f => { f.observed.run.headRepository = "fork/hara-desktop"; },
  "PR event": f => { f.observed.run.event = "pull_request"; },
  "PR-target event": f => { f.observed.run.event = "pull_request_target"; },
  "main ref": f => { f.observed.run.ref = "refs/heads/main"; },
  "tag ref": f => { f.observed.run.ref = "refs/tags/v1.1.0"; },
  "wrong workflow ID": f => { f.observed.workflow.id++; },
  "wrong workflow path": f => { f.observed.workflow.path = ".github/workflows/ci.yml"; },
  "stale run attempt": f => { f.observed.run.attempt++; },
  "cancelled run": f => { f.observed.run.conclusion = "cancelled"; },
  "running run": f => { f.observed.run.status = "in_progress"; },
  "future completion": f => { f.observed.run.completedAt = nowSeconds + 1; },
  "invalid time order": f => { f.observed.run.startedAt = nowSeconds; },
  "expired receipt": f => { f.nowSeconds += f.policy.maximumAgeSeconds + 1; },
  "wrong environment": f => { f.observed.approval.environment = "hara-desktop-production"; },
  "missing independent approval": f => { delete f.observed.approval; },
  "unapproved reviewer": f => { f.observed.approval.reviewerId++; },
  "approval of other source": f => { f.observed.approval.headSha = "a".repeat(40); },
  "approval of other attempt": f => { f.observed.approval.attempt--; },
  "missing Intel platform": f => { f.receipt.platforms.splice(1, 1); },
  "duplicate target": f => { f.receipt.platforms[1] = structuredClone(f.receipt.platforms[0]); },
  "duplicate job": f => { f.observed.jobs.push(structuredClone(f.observed.jobs[0])); },
  "carried forward earlier-attempt job": f => { f.observed.jobs[1].attempt--; },
  "foreign-run job": f => { f.observed.jobs[1].runId++; },
  "ordinary CI instead of candidate": f => { f.observed.jobs[1].name = "native-check"; },
  "ARM emulates Intel": f => { f.observed.jobs[1].labels = ["macOS", "ARM64"]; },
  "failed native test job": f => { f.observed.jobs[1].conclusion = "failure"; },
  "skipped gate": f => { f.observed.jobs[1].steps[3].conclusion = "skipped"; },
  "missing gate": f => { f.observed.jobs[1].steps.pop(); },
  "duplicate step": f => { f.observed.jobs[1].steps.push(structuredClone(f.observed.jobs[1].steps[0])); },
  "receipt self-reports passed": f => { f.receipt.passed = true; f.observed.jobs[1].conclusion = "failure"; },
  "expired artifact": f => { f.observed.artifacts[1].expired = true; },
  "foreign artifact run": f => { f.observed.artifacts[1].runId++; },
  "stale artifact attempt": f => { f.observed.artifacts[1].attempt--; },
  "wrong artifact source": f => { f.observed.artifacts[1].headSha = "f".repeat(40); },
  "artifact digest changed": f => { f.observed.artifacts[1].sha256 = sha("changed zip"); },
  "artifact size changed": f => { f.observed.artifacts[1].size++; },
  "downloaded bytes changed": f => { f.observed.inspections[1].archiveSha256 = sha("changed download"); },
  "inner provenance from older run": f => { f.observed.inspections[1].runId--; },
  "inner provenance from older attempt": f => { f.observed.inspections[1].attempt--; },
  "payload digest changed": f => { f.observed.inspections[1].files["Hara_1.1.0_x64.dmg"].sha256 = sha("changed dmg"); },
  "missing real Intel DMG": f => { delete f.receipt.platforms[1].files["Hara_1.1.0_x64.dmg"]; },
  "foreign payload filename": f => { f.receipt.platforms[1].files["../escape.dmg"] = { size: 3, sha256: sha("x") }; },
  "missing independent inspection": f => { f.observed.inspections.splice(1, 1); },
  "Pi-only hydration false": f => { f.observed.inspections[1].piOnlyPreinstalledRequirementMet = false; },
  "Pi-only string true": f => { f.observed.inspections[1].piOnlyPreinstalledRequirementMet = "true"; },
  "static Intel DMG inspection only": f => { f.observed.inspections[1].nativeDmg = false; },
  "app notarization pending": f => { f.observed.inspections[1].appNotary.status = "In Progress"; },
  "DMG notarization rejected": f => { f.observed.inspections[1].dmgNotary.status = "Invalid"; },
  "wrong final notarized DMG bytes": f => { f.observed.inspections[1].dmgNotary.finalSha256 = sha("other dmg"); },
  "notarization input digest missing": f => { delete f.observed.inspections[1].dmgNotary.inputSha256; },
  "one notary submission reused for app and DMG": f => { f.observed.inspections[1].dmgNotary.submissionId = f.observed.inspections[1].appNotary.submissionId; },
  "staple missing": f => { f.observed.inspections[1].appNotary.stapled = false; },
  "Gatekeeper rejected": f => { f.observed.inspections[1].gatekeeper = "rejected"; },
  "upgrade omitted": f => { f.observed.inspections[1].upgrades.pop(); },
  "upgrade wrong source version": f => { f.observed.inspections[1].upgrades[0].from = "0.1.188"; },
  "upgrade wrong platform": f => { f.observed.inspections[1].upgrades[0].target = CANDIDATE_TARGETS[0]; },
  "upgrade failed": f => { f.observed.inspections[1].upgrades[0].result = "failed"; },
};
for (const [name, mutate] of Object.entries(rejectionCases)) test(`reject candidate: ${name}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => validateCandidate(f));
});

test("identity is independent of JSON object key order, not of policy values", () => {
  const f = fixture(), reorder = value => Object.fromEntries(Object.entries(value).reverse());
  assert.equal(candidateIdentity(reorder(f.source), reorder(f.policy)), f.receipt.identity);
  for (const mutation of [
    p => { p.controlledRef = "refs/heads/main"; }, p => { p.environment = "hara-desktop-production"; },
    p => { p.maximumAgeSeconds = 8 * 86400; }, p => { p.upgradeFrom = []; }, p => { p.approverId = "12345"; },
  ]) { const p = structuredClone(f.policy); mutation(p); assert.throws(() => candidateIdentity(f.source, p)); }
});

const buildAdapters = events => Object.fromEntries(CANDIDATE_STAGES.map(name => [name, async () => {
  events.push(name); return { ok: true, ...(name === "piOnlyPreflight" ? { onlyPiPreinstalledRequirementMet: true } : {}) };
}]));
test("candidate executes full phase contract with key/Pi-only preflight before expensive work; never publishes", async () => {
  const events = [], result = await runCandidateStages(buildAdapters(events));
  assert.deepEqual(events, CANDIDATE_STAGES); assert.equal(result.published, false);
  assert(events.indexOf("updaterFilePreflight") < events.indexOf("formalBuild"));
  assert(events.indexOf("piOnlyPreflight") < events.indexOf("formalBuild"));
});
for (const stop of CANDIDATE_STAGES) test(`candidate stops at failed ${stop}, without later gates/retry`, async () => {
  const events = [], adapters = buildAdapters(events);
  adapters[stop] = async () => { events.push(stop); return { ok: false }; };
  await assert.rejects(runCandidateStages(adapters), /candidate stopped/);
  assert.deepEqual(events, CANDIDATE_STAGES.slice(0, CANDIDATE_STAGES.indexOf(stop) + 1));
});
test("candidate refuses publication callback and refuses Pi-only self-reported generic success", async () => {
  const events = [], adapters = buildAdapters(events);
  await assert.rejects(runCandidateStages({ ...adapters, publishStable: async () => { events.push("publish"); } }));
  assert.deepEqual(events, []);
  adapters.piOnlyPreflight = async () => ({ ok: true });
  await assert.rejects(runCandidateStages(adapters), /piOnlyPreflight/);
  assert(!events.includes("tests"));
});

function promotionAdapters(f, events) {
  return Object.fromEntries(["inspect", "publishImmutable", "verifyPublic", "publishStable", "verifyStable"].map(name => [name, async proof => {
    events.push(name);
    if (name === "inspect") return { receipt: f.receipt, observed: f.observed };
    assert.equal(proof.identity, f.receipt.identity); assert.equal(proof.artifacts.length, 4);
    return { ok: true };
  }]));
}
test("promotion only uses exact validated artifacts, without build/sign or fallback callbacks", async () => {
  const f = fixture(), events = [];
  await runCandidatePromotion(f, promotionAdapters(f, events));
  assert.deepEqual(events, ["inspect", "publishImmutable", "verifyPublic", "publishStable", "verifyStable"]);
  for (const forbidden of ["build", "formalBuild", "signAndNotarize", "retryOlderCandidate"]) {
    events.length = 0;
    await assert.rejects(runCandidatePromotion(f, { ...promotionAdapters(f, events), [forbidden]: async () => ({ ok: true }) }));
    assert.deepEqual(events, []);
  }
});
test("invalid independent candidate evidence prevents every publication action", async () => {
  const f = fixture(), events = []; f.observed.run.conclusion = "cancelled";
  await assert.rejects(runCandidatePromotion(f, promotionAdapters(f, events)));
  assert.deepEqual(events, ["inspect"]);
});
test("failed public immutable verification prevents stable switch; no automatic retry", async () => {
  const f = fixture(), events = [], adapters = promotionAdapters(f, events);
  adapters.verifyPublic = async () => { events.push("verifyPublic"); return { ok: false }; };
  await assert.rejects(runCandidatePromotion(f, adapters), /verifyPublic/);
  assert.deepEqual(events, ["inspect", "publishImmutable", "verifyPublic"]);
});
test("pinned expected identity cannot be changed while asynchronous inspection runs", async () => {
  const f = fixture(), events = [], adapters = promotionAdapters(f, events), expected = structuredClone(f);
  adapters.inspect = async () => { events.push("inspect"); expected.source.desktop.commit = "f".repeat(40); return { receipt: f.receipt, observed: f.observed }; };
  const result = await runCandidatePromotion(expected, adapters);
  assert.equal(result.proof.desktopCommit, "1".repeat(40));
});
test("stage callbacks are snapshotted before asynchronous work, not swapped while awaiting inspection", async () => {
  const f = fixture(), events = [], adapters = promotionAdapters(f, events);
  adapters.inspect = async () => {
    events.push("inspect");
    adapters.publishStable = async () => { throw new Error("unapproved replacement callback"); };
    return { receipt: f.receipt, observed: f.observed };
  };
  await runCandidatePromotion(f, adapters);
  assert.deepEqual(events, ["inspect", "publishImmutable", "verifyPublic", "publishStable", "verifyStable"]);
});
