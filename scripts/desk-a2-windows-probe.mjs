import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, constants, copyFileSync, createReadStream, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const desktopCommit = "19662f8206d23e2cac9098c0f8a03add8c71b567";
const desktopTree = "6dbb209e15f3a2cc80744351ec8f25268aa5a2c3";
export const coreCommit = "25276907b92393a117e5518a51b47bdb5a34ec5e";
const target = "x86_64-pc-windows-msvc";
const ref = "refs/heads/probe/desk-130-windows-split-20261128";
const workflow = ".github/workflows/desk-a2-windows-split-probe.yml";
const producer = "build_windows";
const artifacts = ["bundle/msi/hara.msi", "bundle/nsis/hara-setup.exe", "unbound/hara-credential-worker.exe", "windows-vault-binding.json"];
const manifestName = "manifest.json";
const stages = ["before_build", "after_build", "after_extract", "after_native", "before_install", "after_install"];
const releaseBase = join("src-tauri", "target", target, "release");
const bindingPath = join("src-tauri", "binaries", "windows-vault-binding.json");
const hex = /^[a-f0-9]{64}$/u;
const id = /^[1-9][0-9]*$/u;
const expectedToolchain = { node: "22.23.1", bun: "1.3.9", rust: "1.97.0", workerRust: "1.92.0" };

class ProbeError extends Error {}

function requireCondition(condition, code) {
  if (!condition) throw new ProbeError(code);
}

export function identity(env) {
  const expectedWorkflow = `hara-cli/hara-desktop/${workflow}@${ref}`;
  requireCondition(env.GITHUB_REPOSITORY === "hara-cli/hara-desktop" && env.GITHUB_EVENT_NAME === "push"
    && env.GITHUB_REF === ref && env.GITHUB_RUN_ATTEMPT === "1" && env.GITHUB_WORKFLOW_REF === expectedWorkflow
    && /^[a-f0-9]{40}$/u.test(env.GITHUB_SHA) && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA
    && typeof env.GITHUB_RUN_ID === "string" && id.test(env.GITHUB_RUN_ID), "probe_identity_mismatch");
  return { probeCommit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: 1, producer, desktopCommit, desktopTree, coreCommit, target };
}

function metadata(path) {
  const stat = lstatSync(path);
  requireCondition(stat.isFile() && stat.nlink === 1 && stat.size > 0, "invalid_artifact_file");
  return stat;
}

async function hashFile(path) {
  const { size } = metadata(path);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { bytes: size, sha256: hash.digest("hex") };
}

function jsonFile(path) {
  requireCondition(metadata(path).size <= 64 * 1024, "invalid_json_size");
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalBinding(value) {
  requireCondition(value?.schemaVersion === 1 && value.protocolVersion === 2 && value.target === target
    && value.coreCommit === coreCommit && typeof value.expectedWorkerSHA256 === "string"
    && typeof value.sidecarSHA256 === "string" && hex.test(value.expectedWorkerSHA256) && hex.test(value.sidecarSHA256),
  "invalid_worker_binding");
  const { schemaVersion, protocolVersion, target: boundTarget, coreCommit: boundCore, expectedWorkerSHA256, sidecarSHA256 } = value;
  const binding = { schemaVersion, protocolVersion, target: boundTarget, coreCommit: boundCore, expectedWorkerSHA256, sidecarSHA256 };
  requireCondition(Object.keys(value).length === Object.keys(binding).length, "unexpected_worker_binding_field");
  return binding;
}

function exactFiles(root) {
  function visit(directory, prefix = "") {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const relative = prefix + entry.name;
      if (entry.isDirectory() && artifacts.some(path => path.startsWith(relative + "/"))) {
        return visit(join(directory, entry.name), relative + "/");
      }
      requireCondition(entry.isFile(), "invalid_artifact_entry");
      return [relative];
    });
  }
  requireCondition(lstatSync(root).isDirectory(), "invalid_artifact_root");
  const found = visit(root).sort();
  const expected = [...artifacts, manifestName].sort();
  requireCondition(found.length === expected.length && found.every((path, index) => path === expected[index]), "unexpected_artifact_set");
}

export async function verifyPayload(root, env) {
  const expected = identity(env);
  exactFiles(root);
  const manifestPath = join(root, manifestName);
  requireCondition(hex.test(env.A2_MANIFEST_SHA256) && (await hashFile(manifestPath)).sha256 === env.A2_MANIFEST_SHA256,
    "artifact_manifest_digest_mismatch");
  const manifest = jsonFile(manifestPath);
  requireCondition(manifest.schemaVersion === 1 && Object.entries(expected).every(([key, value]) => manifest[key] === value),
    "artifact_manifest_identity_mismatch");
  requireCondition(Object.entries(expectedToolchain).every(([key, version]) => manifest.toolchain?.[key] === version),
    "artifact_toolchain_mismatch");
  requireCondition(Array.isArray(manifest.files) && manifest.files.length === artifacts.length, "artifact_manifest_file_set_mismatch");
  for (const [index, relative] of artifacts.entries()) {
    const { bytes, sha256 } = await hashFile(join(root, relative));
    const row = manifest.files[index];
    requireCondition(row?.path === relative && row.bytes === bytes && row.sha256 === sha256, "artifact_file_digest_mismatch");
  }
  const binding = canonicalBinding(jsonFile(join(root, artifacts[3])));
  requireCondition(Object.entries(binding).every(([key, value]) => manifest.binding?.[key] === value)
    && binding.expectedWorkerSHA256 !== manifest.files[2].sha256, "artifact_worker_binding_mismatch");
  return manifest;
}

export async function verifyArchive(download, expected) {
  requireCondition(hex.test(expected), "invalid_archive_digest");
  const entries = readdirSync(download, { withFileTypes: true });
  requireCondition(entries.length === 1 && entries[0].isFile() && entries[0].name.endsWith(".zip"), "unexpected_download_set");
  const archive = join(download, entries[0].name);
  requireCondition((await hashFile(archive)).sha256 === expected, "artifact_archive_digest_mismatch");
  return archive;
}

function extractArchive(archive, root) {
  const files = [...artifacts, manifestName].map(value => `'${value}'`).join(", ");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$allowed = @(${files})
$folders = @('bundle/', 'bundle/msi/', 'bundle/nsis/', 'unbound/')
$zip = [IO.Compression.ZipFile]::OpenRead($env:A2_LOCAL_ARCHIVE)
try {
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (!$names.Add($name)) { throw 'duplicate_archive_entry' }
    if ($folders -ccontains $name) {
      if ($entry.Length -ne 0) { throw 'invalid_archive_folder' }
      continue
    }
    if (!($allowed -ccontains $name) -or $entry.Length -le 0) { throw 'unexpected_archive_entry' }
  }
  foreach ($name in $allowed) {
    if (!$names.Contains($name)) { throw 'missing_archive_entry' }
  }
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($allowed -ccontains $name) {
      $dest = Join-Path $env:A2_LOCAL_PAYLOAD $name
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $false)
    }
  }
} finally { $zip.Dispose() }
`;
  const result = powershell(script, 120_000, { A2_LOCAL_ARCHIVE: archive, A2_LOCAL_PAYLOAD: root });
  requireCondition(!result.error && result.status === 0, "artifact_extract_rejected");
}

const snapshotScript = String.raw`
$ErrorActionPreference = 'Stop'
$values = @{
  freePhysicalBytes = $null; commitBytes = $null; commitLimitBytes = $null
  systemDriveFreeBytes = $null; workspaceDriveFreeBytes = $null; jobProcessWorkingSetBytes = $null
}
try {
  $os = Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 3
  if ($null -ne $os.FreePhysicalMemory) { $values.freePhysicalBytes = [long]$os.FreePhysicalMemory * 1024 }
} catch {}
try {
  $memory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -OperationTimeoutSec 3
  if ($null -ne $memory.CommittedBytes) { $values.commitBytes = [long]$memory.CommittedBytes }
  if ($null -ne $memory.CommitLimit) { $values.commitLimitBytes = [long]$memory.CommitLimit }
} catch {}
try { $values.systemDriveFreeBytes = [IO.DriveInfo]::new($env:SystemDrive).AvailableFreeSpace } catch {}
try { $values.workspaceDriveFreeBytes = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:GITHUB_WORKSPACE)).AvailableFreeSpace } catch {}
try {
  $rows = Get-CimInstance Win32_Process -Property Name,ProcessId,ParentProcessId,WorkingSetSize -OperationTimeoutSec 3
  $indexed = @{}
  foreach ($row in $rows) { $indexed[[int]$row.ProcessId] = $row }
  $current = $indexed[$PID]
  for ($i = 0; $current -and $i -lt 16; $i++) {
    if ($current.Name -eq 'Runner.Worker.exe') { break }
    $current = $indexed[[int]$current.ParentProcessId]
  }
  if ($current -and $current.Name -eq 'Runner.Worker.exe') {
    $owned = [Collections.Generic.HashSet[int]]::new()
    [void]$owned.Add([int]$current.ProcessId)
    do {
      $before = $owned.Count
      foreach ($row in $rows) {
        if ($owned.Contains([int]$row.ParentProcessId)) { [void]$owned.Add([int]$row.ProcessId) }
      }
    } while ($owned.Count -gt $before)
    $sum = [long]0
    foreach ($ownedPid in $owned) {
      if ($null -eq $indexed[$ownedPid].WorkingSetSize) { throw 'missing_working_set' }
      $sum += [long]$indexed[$ownedPid].WorkingSetSize
    }
    $values.jobProcessWorkingSetBytes = $sum
  }
} catch {}
$values | ConvertTo-Json -Compress
`;

function powershell(script, timeout, extraEnv = {}) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")],
  { env: { ...process.env, ...extraEnv }, encoding: "utf8", timeout, maxBuffer: 64 * 1024, windowsHide: true });
}

const metricNames = ["freePhysicalBytes", "commitBytes", "commitLimitBytes", "systemDriveFreeBytes", "workspaceDriveFreeBytes",
  "jobProcessWorkingSetBytes"];
const machineValue = value => typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/u.test(value) ? value : null;

export function sanitizedMetrics(result) {
  let fields = {};
  if (!result.error && result.status === 0) {
    try { fields = JSON.parse(result.stdout); } catch { /* Preserve unknown fields as null. */ }
  }
  return Object.fromEntries(metricNames.map(key => {
    const value = fields?.[key];
    return [key, Number.isSafeInteger(value) && value >= 0 ? value : null];
  }));
}

function snapshot(stage) {
  requireCondition(stages.includes(stage), "invalid_evidence_stage");
  return {
    stage, observedUTC: new Date().toISOString(), metrics: sanitizedMetrics(powershell(snapshotScript, 15_000)),
    runner: machineValue(process.env.RUNNER_NAME), imageOS: machineValue(process.env.ImageOS),
    imageVersion: machineValue(process.env.ImageVersion),
  };
}

function writeJson(path, object) {
  const text = JSON.stringify(object);
  writeFileSync(path, text + "\n", { flag: "wx" });
  console.log(text);
}

function oneInstaller(desk, kind, suffix) {
  const dir = join(desk, releaseBase, "bundle", kind);
  const names = readdirSync(dir).filter(name => name.endsWith(suffix));
  requireCondition(names.length === 1, "installer_not_unique");
  return join(dir, names[0]);
}

export async function pack(root, desk, env, nodeVersion = process.versions.node) {
  requireCondition(env.GITHUB_JOB === producer, "unexpected_producer");
  const identityFields = identity(env);
  const rustVersion = (value) => /^rustc (\d+\.\d+\.\d+) /u.exec(value)?.[1];
  const toolchain = { node: nodeVersion, bun: env.A2_BUN_VERSION,
    rust: rustVersion(env.A2_RUST_VERSION), workerRust: rustVersion(env.A2_WORKER_RUST_VERSION) };
  requireCondition(Object.entries(expectedToolchain).every(([key, version]) => toolchain[key] === version), "unexpected_build_toolchain");
  const sources = [oneInstaller(desk, "msi", ".msi"), oneInstaller(desk, "nsis", "-setup.exe"),
    join(env.RUNNER_TEMP, "hara-vault-unbound-worker", "hara-credential-worker.exe"), join(desk, bindingPath)];
  const binding = canonicalBinding(jsonFile(sources[3]));
  const staged = join(desk, "src-tauri", "binaries");
  requireCondition((await hashFile(join(staged, `hara-${target}.exe`))).sha256 === binding.sidecarSHA256
    && (await hashFile(join(staged, `hara-credential-worker-${target}.exe`))).sha256 === binding.expectedWorkerSHA256
    && (await hashFile(sources[2])).sha256 !== binding.expectedWorkerSHA256, "build_worker_binding_mismatch");
  mkdirSync(root);
  const files = [];
  for (const [index, relative] of artifacts.entries()) {
    const input = sources[index];
    metadata(input);
    const output = join(root, relative);
    const parent = dirname(relative);
    if (parent !== ".") mkdirSync(join(root, parent), { recursive: true });
    copyFileSync(input, output, constants.COPYFILE_EXCL);
    files.push({ path: relative, ...await hashFile(output) });
  }
  writeJson(join(root, manifestName), { schemaVersion: 1, ...identityFields, toolchain, binding, files });
  const digest = (await hashFile(join(root, manifestName))).sha256;
  appendFileSync(env.GITHUB_OUTPUT, `manifest_sha256=${digest}\n`);
}

export function requirePrecheck(receipt, leg) {
  requireCondition(receipt?.schemaVersion === 1 && receipt.desktopCommit === desktopCommit && receipt.coreCommit === coreCommit
    && receipt.precheck?.kind === leg && receipt.precheck.registrationClear === true && !receipt.failure,
  "installer_precheck_receipt_invalid");
}

export function requireInstalled(receipt, leg, manifest) {
  requireCondition(receipt?.schemaVersion === 1 && receipt.desktopCommit === desktopCommit && receipt.coreCommit === coreCommit
    && receipt.results?.length === 1 && receipt.installationChecks?.length === 1 && !receipt.failure, "install_receipt_invalid");
  const [row] = receipt.results;
  const [layout] = receipt.installationChecks;
  const pkg = manifest.files[leg === "msi" ? 0 : 1];
  requireCondition(row.kind === leg && row.installerSHA256 === pkg.sha256
    && row.workerSHA256 === manifest.binding.expectedWorkerSHA256 && row.expectedWorkerSHA256 === row.workerSHA256
    && row.sidecarSHA256 === manifest.binding.sidecarSHA256 && row.keySaved === true && row.restartReadback === true
    && row.rotationReadback === true && Number.isSafeInteger(row.addedRevision) && Number.isSafeInteger(row.rotatedRevision)
    && row.rotatedRevision > row.addedRevision && row.loopbackCatalogRequests === 2 && row.loopbackUnexpected === 0,
  "install_result_mismatch");
  requireCondition(layout.kind === leg && layout.desktopPresent === true && layout.corePresent === true && layout.workerPresent === true,
    "installed_binaries_incomplete");
  const reasons = leg === "nsis" ? ["helper_invalid", "windows_desktop_required", "helper_missing"] : [];
  requireCondition(receipt.refusals?.length === reasons.length && reasons.every((reason, index) => {
    const refusal = receipt.refusals[index];
    return refusal?.reason === reason && refusal.code === (reason === "windows_desktop_required" ? "unsupported" : "unavailable")
      && refusal.configured === false && refusal.writes === 0;
  }), "installer_refusal_receipt_invalid");
  if (leg === "msi") {
    requireCondition(layout.registrationClearBefore === true && layout.directory === "requested"
      && layout.installExitCode === 0 && layout.uninstallExitCode === 0 && layout.registrationClearAfter === true
      && layout.legacyMsiClearAfter === true && layout.reason === null && layout.cleanupReason === null, "msi_uninstall_receipt_invalid");
  } else {
    requireCondition(layout.uninstalled === true, "nsis_uninstall_receipt_invalid");
  }
}

async function main() {
  requireCondition(process.platform === "win32" && process.env.RUNNER_ENVIRONMENT === "github-hosted", "requires_hosted_windows");
  const fields = identity(process.env);
  const temp = process.env.RUNNER_TEMP;
  const data = join(temp, "desk-a2-payload");
  const evidence = join(temp, "desk-a2-evidence");
  const [command, stage] = process.argv.slice(2);
  mkdirSync(evidence, { recursive: true });
  if (command === "sample") {
    const record = snapshot(stage);
    writeJson(join(evidence, `${stage}.json`), { ...fields, ...record });
    return;
  }
  if (command === "pack") {
    await pack(data, process.cwd(), process.env);
    return;
  }
  const leg = { install_msi: "msi", install_nsis: "nsis" }[process.env.GITHUB_JOB];
  const artifactId = process.env.A2_ARTIFACT_ID;
  const artifactSHA256 = process.env.A2_ARCHIVE_SHA256;
  requireCondition(leg && typeof artifactId === "string" && id.test(artifactId) && hex.test(artifactSHA256), "invalid_install_artifact_identity");
  if (command === "receive") {
    const archive = await verifyArchive(join(temp, "desk-a2-download"), artifactSHA256);
    mkdirSync(data);
    extractArchive(archive, data);
    const manifest = await verifyPayload(data, process.env);
    copyFileSync(join(data, "windows-vault-binding.json"), bindingPath, constants.COPYFILE_EXCL);
    if (leg === "nsis") {
      const fixture = join(temp, "hara-vault-unbound-worker");
      mkdirSync(fixture);
      copyFileSync(join(data, artifacts[2]), join(fixture, "hara-credential-worker.exe"), constants.COPYFILE_EXCL);
    }
    writeJson(join(evidence, "received.json"), {
      ...fields, leg, artifactId, artifactSHA256, manifestSHA256: process.env.A2_MANIFEST_SHA256, files: manifest.files,
    });
  } else if (command === "precheck-receipt") {
    const receipt = jsonFile(join(temp, "desk-a2-precheck", "windows-install-smoke.json"));
    requirePrecheck(receipt, leg);
    writeJson(join(evidence, "precheck.json"), { ...fields, leg, registrationClear: true });
  } else if (command === "install-receipt") {
    const receipt = jsonFile(join(temp, "desk-a2-install", "windows-install-smoke.json"));
    requireInstalled(receipt, leg, await verifyPayload(data, process.env));
  } else {
    throw new ProbeError("unknown_probe_command");
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main().catch(error => {
    // Emit only fixed diagnostic codes. Node/PowerShell errors can carry private paths.
    const code = error instanceof ProbeError ? error.message : "probe_error";
    console.error(code);
    process.exitCode = 1;
  });
}
