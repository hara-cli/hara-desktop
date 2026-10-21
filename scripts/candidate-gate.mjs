// Offline contract only. No filesystem, HTTP, credential, signing or publishing side effects.
// `observed` MUST come from a trusted API/download/inspection adapter, never the receipt itself.
// That adapter and protected workflow admission are deliberately not enabled by this module.
import { createHash } from "node:crypto";

export const CANDIDATE_TARGETS = Object.freeze([
  "aarch64-apple-darwin", "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc",
]);
const MAC = new Set(CANDIDATE_TARGETS.slice(0, 2));
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, VERSION = /^\d+\.\d+\.\d+$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const COMMON_GATES = Object.freeze([
  "Exact source and toolchain", "Pi-only hydration preflight", "Full tests",
  "Formal installer build", "Native package smoke", "Updater signature verification", "Upgrade smoke",
]);
const MAC_GATES = Object.freeze([
  "Developer ID verification", "App notarization", "DMG notarization", "Staple verification", "Gatekeeper verification",
]);
const fail = () => { throw new Error("candidate gate rejected: missing, stale or mismatched independent evidence"); };
const requireThat = value => { if (!value) fail(); };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const positive = value => Number.isSafeInteger(value) && value > 0;
const matches = (expression, value) => typeof value === "string" && expression.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const same = (left, right) => canonical(left) === canonical(right);
const unique = (array, key) => Array.isArray(array) && new Set(array.map(key)).size === array.length;

function checkSource(source) {
  requireThat(exact(source, ["desktop", "core", "toolchain", "locks", "updaterPublicKeySha256"]));
  for (const part of [source.desktop, source.core]) {
    requireThat(exact(part, ["commit", "tree", "version"]) && matches(COMMIT, part.commit)
      && matches(COMMIT, part.tree) && matches(VERSION, part.version));
  }
  requireThat(exact(source.toolchain, ["node", "bun", "rust"])
    && Object.values(source.toolchain).every(value => matches(VERSION, value)));
  requireThat(exact(source.locks, ["npm", "cargo", "sidecar"]) && Object.values(source.locks).every(value => matches(SHA, value)));
  requireThat(matches(SHA, source.updaterPublicKeySha256));
}

function checkPolicy(policy) {
  requireThat(exact(policy, ["repository", "workflowId", "workflowPath", "workflowSha256", "environment",
    "controlledRef", "approverId", "protectionSha256", "maximumAgeSeconds", "upgradeFrom"]));
  requireThat(policy.repository === "hara-cli/hara-desktop" && positive(policy.workflowId)
    && policy.workflowPath === ".github/workflows/candidate.yml"
    && matches(SHA, policy.workflowSha256) && matches(SHA, policy.protectionSha256)
    && policy.environment === "hara-desktop-candidate" && positive(policy.approverId)
    && matches(/^refs\/heads\/candidate\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/, policy.controlledRef)
    && !policy.controlledRef.includes("..") && !policy.controlledRef.endsWith("/")
    && positive(policy.maximumAgeSeconds) && policy.maximumAgeSeconds <= 7 * 86400);
  requireThat(unique(policy.upgradeFrom, value => value) && policy.upgradeFrom.length > 0
    && policy.upgradeFrom.length <= 8 && policy.upgradeFrom.every(value => matches(VERSION, value)));
}

export function candidateIdentity(source, policy) {
  checkSource(source); checkPolicy(policy);
  return createHash("sha256").update(canonical({ source, policy })).digest("hex");
}

export function candidateGates(target) {
  requireThat(CANDIDATE_TARGETS.includes(target));
  return [...COMMON_GATES, ...(MAC.has(target) ? MAC_GATES : [])];
}

export function candidateAssetNames(target, version) {
  requireThat(CANDIDATE_TARGETS.includes(target) && matches(VERSION, version));
  if (MAC.has(target)) {
    const arch = target.startsWith("aarch64") ? "aarch64" : "x64";
    return [`Hara_${version}_${arch}.dmg`, `Hara_${arch}.app.tar.gz`, `Hara_${arch}.app.tar.gz.sig`];
  }
  return target.endsWith("linux-gnu")
    ? [`Hara_${version}_amd64.deb`, `Hara_${version}_amd64.deb.sig`, `Hara-${version}-1.x86_64.rpm`, `Hara-${version}-1.x86_64.rpm.sig`]
    : [`Hara_${version}_x64_en-US.msi`, `Hara_${version}_x64_en-US.msi.sig`, `Hara_${version}_x64-setup.exe`, `Hara_${version}_x64-setup.exe.sig`];
}

function checkFiles(files, names) {
  requireThat(exact(files, names));
  for (const entry of Object.values(files)) requireThat(exact(entry, ["size", "sha256"]) && positive(entry.size) && matches(SHA, entry.sha256));
}

function checkNotary(value, sha256) {
  // Apple accepts the pre-staple submission, not necessarily the final distributed bytes.
  // The trusted native adapter must verify that lineage before supplying both hashes.
  requireThat(exact(value, ["submissionId", "status", "inputSha256", "finalSha256", "stapled"])
    && matches(UUID, value.submissionId) && value.status === "Accepted" && matches(SHA, value.inputSha256)
    && value.finalSha256 === sha256 && value.stapled === true);
}

/**
 * Join an untrusted receipt against independently retrieved run/jobs/artifact metadata and
 * freshly downloaded, inspected bytes. No self-reported `passed` grants authorization.
 * Input identity is supplied by the protected caller from pinned Git/source/policy, NOT receipt.
 * Normalized observed fields are an adapter contract, NOT raw GitHub API response field names.
 */
export function validateCandidate({ source, policy, receipt, observed, nowSeconds }) {
  const identity = candidateIdentity(source, policy);
  requireThat(positive(nowSeconds));
  requireThat(exact(receipt, ["schema", "identity", "runId", "attempt", "platforms"]) && receipt.schema === 1
    && receipt.identity === identity && positive(receipt.runId) && positive(receipt.attempt));
  requireThat(exact(observed, ["repository", "workflow", "run", "approval", "jobs", "artifacts", "inspections"])
    && observed.repository === policy.repository);
  const { run, workflow, approval } = observed;
  requireThat(exact(workflow, ["id", "path", "sha256"]) && workflow.id === policy.workflowId
    && workflow.path === policy.workflowPath && workflow.sha256 === policy.workflowSha256);
  requireThat(exact(run, ["id", "attempt", "headRepository", "headSha", "ref", "event", "status", "conclusion", "startedAt", "completedAt"])
    && run.id === receipt.runId && run.attempt === receipt.attempt && run.headRepository === policy.repository
    && run.headSha === source.desktop.commit && run.ref === policy.controlledRef && run.event === "workflow_dispatch"
    && run.status === "completed" && run.conclusion === "success" && positive(run.startedAt) && positive(run.completedAt)
    && run.startedAt <= run.completedAt && run.completedAt <= nowSeconds
    && nowSeconds - run.completedAt <= policy.maximumAgeSeconds);
  requireThat(exact(approval, ["environment", "ref", "headSha", "reviewerId", "runId", "attempt", "protectionSha256"])
    && approval.environment === policy.environment && approval.ref === run.ref && approval.headSha === run.headSha
    && approval.reviewerId === policy.approverId && approval.runId === run.id && approval.attempt === run.attempt
    && approval.protectionSha256 === policy.protectionSha256);
  requireThat(unique(receipt.platforms, row => row.target) && receipt.platforms.length === CANDIDATE_TARGETS.length);
  for (const rows of [observed.jobs, observed.artifacts, observed.inspections]) requireThat(Array.isArray(rows) && rows.length <= 100);
  requireThat(unique(observed.jobs, row => row.id) && unique(observed.artifacts, row => row.id)
    && unique(observed.inspections, row => row.artifactId)
    && unique(receipt.platforms, row => row.jobId) && unique(receipt.platforms, row => row.artifactId));

  for (const row of receipt.platforms) {
    requireThat(exact(row, ["target", "jobId", "artifactId", "archiveSha256", "archiveSize", "files"])
      && CANDIDATE_TARGETS.includes(row.target) && positive(row.jobId) && positive(row.artifactId)
      && matches(SHA, row.archiveSha256) && positive(row.archiveSize));
    const job = observed.jobs.find(value => value.id === row.jobId);
    const artifact = observed.artifacts.find(value => value.id === row.artifactId);
    const inspection = observed.inspections.find(value => value.artifactId === row.artifactId);
    requireThat(exact(job, ["id", "runId", "attempt", "name", "status", "conclusion", "labels", "steps"])
      && job.runId === run.id && job.attempt === run.attempt && job.name === `candidate-${row.target}`
      && job.status === "completed" && job.conclusion === "success"
      && Array.isArray(job.labels) && job.labels.length <= 32);
    const os = MAC.has(row.target) ? "macOS" : row.target.endsWith("linux-gnu") ? "Linux" : "Windows";
    const arch = row.target.startsWith("aarch64") ? "ARM64" : "X64";
    requireThat(job.labels.includes(os) && job.labels.includes(arch));
    requireThat(unique(job.steps, value => value.name) && job.steps.length <= 100);
    for (const name of candidateGates(row.target)) {
      const step = job.steps.find(value => value.name === name);
      requireThat(exact(step, ["name", "status", "conclusion"]) && step.status === "completed" && step.conclusion === "success");
    }
    requireThat(exact(artifact, ["id", "runId", "attempt", "headSha", "name", "expired", "size", "sha256"])
      && artifact.runId === run.id && artifact.attempt === run.attempt && artifact.headSha === run.headSha
      && artifact.name === `candidate-${row.target}` && artifact.expired === false
      && artifact.size === row.archiveSize && artifact.sha256 === row.archiveSha256);
    const inspectionFields = ["artifactId", "runId", "attempt", "identity", "archiveSha256", "archiveSize", "files", "piOnlyPreinstalledRequirementMet", "upgrades"];
    requireThat(exact(inspection, [...inspectionFields, ...(MAC.has(row.target) ? ["appFinalSha256", "appNotary", "dmgNotary", "gatekeeper", "nativeDmg"] : [])])
      && inspection.runId === run.id && inspection.attempt === run.attempt
      && inspection.identity === identity && inspection.archiveSha256 === artifact.sha256 && inspection.archiveSize === artifact.size
      && inspection.piOnlyPreinstalledRequirementMet === true);
    const names = candidateAssetNames(row.target, source.desktop.version);
    checkFiles(row.files, names); checkFiles(inspection.files, names);
    requireThat(same(row.files, inspection.files));
    requireThat(unique(inspection.upgrades, value => value.from) && inspection.upgrades.length === policy.upgradeFrom.length);
    for (const from of policy.upgradeFrom) {
      const upgrade = inspection.upgrades.find(value => value.from === from);
      requireThat(exact(upgrade, ["from", "to", "target", "result"]) && upgrade.to === source.desktop.version
        && upgrade.target === row.target && upgrade.result === "passed");
    }
    if (MAC.has(row.target)) {
      requireThat(matches(SHA, inspection.appFinalSha256) && inspection.gatekeeper === "accepted" && inspection.nativeDmg === true);
      checkNotary(inspection.appNotary, inspection.appFinalSha256);
      checkNotary(inspection.dmgNotary, row.files[names[0]].sha256);
      requireThat(inspection.appNotary.submissionId !== inspection.dmgNotary.submissionId);
    }
  }
  // Detach and freeze the proof passed to future publication adapters; callers cannot alter it.
  return Object.freeze({ identity, runId: run.id, attempt: run.attempt, desktopCommit: source.desktop.commit,
    artifacts: Object.freeze(receipt.platforms.map(row => Object.freeze({ target: row.target, id: row.artifactId,
      sha256: row.archiveSha256, size: row.archiveSize,
      files: Object.freeze(Object.fromEntries(Object.entries(row.files).map(([name, file]) => [name, Object.freeze({ ...file })]))),
    }))) });
}
