import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, constants, copyFileSync, createReadStream, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWindowsVaultBinding, windowsVaultRequired } from "./windows-vault-bundle.mjs";

const target = "x86_64-pc-windows-msvc";
const headPattern = /^[a-f0-9]{40}$/u;
const shaPattern = /^[a-f0-9]{64}$/u;
const idPattern = /^[1-9][0-9]*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const manifestName = "manifest.json";
const bindingName = "windows-vault-binding.json";
const unbound = "unbound/hara-credential-worker.exe";
const collectorBinaries = [`hara-${target}.exe`, `herdr-${target}.exe`];
const release = join("src-tauri", "target", target, "release");
const binaries = join("src-tauri", "binaries");
const refusalReasons = ["helper_invalid", "windows_desktop_required", "helper_missing"];

class TransferError extends Error {}
function requireCondition(condition, code) {
  if (!condition) throw new TransferError(code);
}

export function transferIdentity(env, desktop, core, version) {
  requireCondition(headPattern.test(desktop) && headPattern.test(core) && versionPattern.test(version)
    && env.WINDOWS_DESKTOP_SHA === desktop && env.GITHUB_SHA === desktop && env.WINDOWS_CORE_SHA === core
    && env.GITHUB_REPOSITORY === "hara-cli/hara-desktop" && idPattern.test(env.GITHUB_RUN_ID)
    && idPattern.test(env.GITHUB_RUN_ATTEMPT), "windows_transfer_identity_mismatch");
  const production = env.WINDOWS_RELEASE_ONLY === "true";
  const validEvent = production ? env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === `refs/tags/v${version}`
    : env.WINDOWS_RELEASE_ONLY === "false" && env.GITHUB_EVENT_NAME === "workflow_dispatch";
  requireCondition(validEvent, "windows_transfer_event_mismatch");
  return { desktop, core, version, production, target, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT };
}

export function payloadFiles({ version, production }) {
  requireCondition(versionPattern.test(version), "windows_transfer_invalid_version");
  const msi = `bundle/msi/Hara_${version}_x64_en-US.msi`;
  const nsis = `bundle/nsis/Hara_${version}_x64-setup.exe`;
  const tail = production ? collectorBinaries.map(name => `collector/${name}`) : [unbound];
  return [msi, nsis, msi + ".sig", nsis + ".sig", bindingName, ...tail];
}

function metadata(file) {
  const stat = lstatSync(file);
  requireCondition(stat.isFile() && stat.nlink === 1 && stat.size > 0, "windows_transfer_invalid_file");
  return stat;
}

async function fileRecord(file) {
  const { size } = metadata(file);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { bytes: size, sha256: hash.digest("hex") };
}

function json(file) {
  requireCondition(metadata(file).size <= 64 * 1024, "windows_transfer_invalid_json_size");
  return JSON.parse(readFileSync(file, "utf8"));
}

function materialize(source, destination) {
  metadata(source);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
}

function readBinding(root, core) {
  const value = json(join(root, bindingName));
  requireCondition(Object.keys(value).length === 6 && value.schemaVersion === 1 && value.protocolVersion === 2
    && value.coreCommit === core && value.target === target && typeof value.expectedWorkerSHA256 === "string"
    && typeof value.sidecarSHA256 === "string" && shaPattern.test(value.expectedWorkerSHA256) && shaPattern.test(value.sidecarSHA256),
  "windows_transfer_invalid_worker_binding");
  return value;
}

export async function verifyPayload(root, identity, manifestSHA256) {
  const paths = payloadFiles(identity);
  const expected = [...paths, manifestName].sort();
  requireCondition(lstatSync(root).isDirectory(), "windows_transfer_invalid_root");
  function list(parent, prefix = "") {
    return readdirSync(parent, { withFileTypes: true }).flatMap(entry => {
      const name = prefix + entry.name;
      if (entry.isDirectory() && expected.some(path => path.startsWith(name + "/"))) {
        return list(join(parent, entry.name), name + "/");
      }
      requireCondition(entry.isFile(), "windows_transfer_unsupported_entry");
      return [name];
    });
  }
  const actual = list(root).sort();
  requireCondition(actual.length === expected.length && actual.every((name, index) => name === expected[index]), "windows_transfer_unexpected_files");
  const manifestPath = join(root, manifestName);
  requireCondition(shaPattern.test(manifestSHA256) && (await fileRecord(manifestPath)).sha256 === manifestSHA256,
    "windows_transfer_manifest_digest_mismatch");
  const manifest = json(manifestPath);
  requireCondition(manifest.schema === 1 && Object.entries(identity).every(([key, value]) => manifest.identity?.[key] === value)
    && Array.isArray(manifest.files) && manifest.files.length === paths.length, "windows_transfer_manifest_identity_mismatch");
  for (const [index, path] of paths.entries()) {
    const file = manifest.files[index];
    const info = await fileRecord(join(root, path));
    requireCondition(file?.path === path && file.sha256 === info.sha256 && file.bytes === info.bytes, "windows_transfer_payload_digest_mismatch");
  }
  const binding = readBinding(root, identity.core);
  if (identity.production) {
    const sidecar = manifest.files.find(file => file.path === `collector/${collectorBinaries[0]}`);
    requireCondition(sidecar?.sha256 === binding.sidecarSHA256, "windows_transfer_collector_sidecar_mismatch");
  } else {
    requireCondition(manifest.files.find(file => file.path === unbound)?.sha256 !== binding.expectedWorkerSHA256, "windows_transfer_worker_fixture_matches");
  }
  return { ...manifest, binding };
}

export async function verifyArchive(directory, archiveSHA256) {
  requireCondition(shaPattern.test(archiveSHA256), "windows_transfer_missing_archive_digest");
  const items = readdirSync(directory, { withFileTypes: true });
  requireCondition(items.length === 1 && items[0].isFile() && items[0].name.endsWith(".zip"), "windows_transfer_unexpected_archive");
  const path = join(directory, items[0].name);
  requireCondition((await fileRecord(path)).sha256 === archiveSHA256, "windows_transfer_archive_digest_mismatch");
  return path;
}

export async function stageCollectorInputs(root, checkout, identity, manifestSHA256) {
  requireCondition(identity.production, "windows_transfer_collector_requires_production");
  // The builder's hydrator checks the upstream ZIP pin before extracting Herdr.
  // Here the manifest binds the extracted EXE from that same build attempt.
  const payload = await verifyPayload(root, identity, manifestSHA256);
  for (const file of payload.files.slice(0, 4)) materialize(join(root, file.path), join(checkout, release, file.path));
  for (const name of collectorBinaries) materialize(join(root, "collector", name), join(checkout, binaries, name));
  return payload;
}

function powershell(script, timeout, extraEnv = {}) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64")],
  { env: { ...process.env, ...extraEnv }, encoding: "utf8", timeout, maxBuffer: 64 * 1024, windowsHide: true });
}

function extract(archive, directory, identity) {
  const allowed = [...payloadFiles(identity), manifestName].map(name => `'${name}'`).join(", ");
  const code = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$allowed = @(${allowed})
$zip = [IO.Compression.ZipFile]::OpenRead($env:WINDOWS_TRANSFER_ZIP)
try {
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (!$names.Add($name)) { throw 'duplicate_archive_entry' }
    if ($entry.Length -eq 0 -and $name.EndsWith('/')) {
      if (!($allowed | Where-Object { $_.StartsWith($name, [StringComparison]::Ordinal) })) { throw 'unexpected_folder' }
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
      $dest = Join-Path $env:WINDOWS_TRANSFER_DIR $name
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $false)
    }
  }
} finally { $zip.Dispose() }
`;
  const result = powershell(code, 120_000, { WINDOWS_TRANSFER_ZIP: archive, WINDOWS_TRANSFER_DIR: directory });
  requireCondition(!result.error && result.status === 0, "windows_transfer_extract_failed");
}

function writeJson(file, value) {
  const data = JSON.stringify(value) + "\n";
  writeFileSync(file, data, { flag: "wx" });
  process.stdout.write(data);
}

async function pack(root, temp, identity) {
  const binding = readWindowsVaultBinding();
  const stagedSidecar = await fileRecord(join(binaries, collectorBinaries[0]));
  const stagedWorker = await fileRecord(join(binaries, `hara-credential-worker-${target}.exe`));
  requireCondition(binding.coreCommit === identity.core && binding.sidecarSHA256 === stagedSidecar.sha256
    && binding.expectedWorkerSHA256 === stagedWorker.sha256, "windows_transfer_builder_binding_mismatch");
  mkdirSync(root);
  const files = [];
  for (const path of payloadFiles(identity)) {
    const source = path.startsWith("bundle/") ? join(release, path) : path === bindingName ? join(binaries, bindingName)
      : path === unbound ? join(temp, "hara-vault-unbound-worker", "hara-credential-worker.exe") : join(binaries, path.slice("collector/".length));
    materialize(source, join(root, path));
    files.push({ path, ...await fileRecord(join(root, path)) });
  }
  const path = join(root, manifestName);
  writeJson(path, { schema: 1, identity, files });
  const { sha256 } = await fileRecord(path);
  await verifyPayload(root, identity, sha256);
  appendFileSync(process.env.GITHUB_OUTPUT, `manifest_sha256=${sha256}\n`);
}

export function assertPrecheck(row, leg, identity) {
  requireCondition(row?.schemaVersion === 1 && row.desktopCommit === identity.desktop && row.coreCommit === identity.core
    && row.precheck?.kind === leg && row.precheck.registrationClear === true && !row.failure, "windows_transfer_precheck_receipt_invalid");
}

export function assertInstalled(row, leg, identity, payload) {
  requireCondition(row?.schemaVersion === 1 && row.desktopCommit === identity.desktop && row.coreCommit === identity.core
    && !row.failure && row.results?.length === 1 && row.installationChecks?.length === 1, "windows_transfer_install_receipt_invalid");
  const [result] = row.results, [layout] = row.installationChecks;
  const pkg = payload.files[leg === "msi" ? 0 : 1];
  requireCondition(result.kind === leg && result.installerSHA256 === pkg.sha256 && result.workerSHA256 === payload.binding.expectedWorkerSHA256
    && result.expectedWorkerSHA256 === result.workerSHA256 && result.sidecarSHA256 === payload.binding.sidecarSHA256
    && result.keySaved === true && result.restartReadback === true && result.rotationReadback === true
    && Number.isSafeInteger(result.addedRevision) && Number.isSafeInteger(result.rotatedRevision)
    && result.rotatedRevision > result.addedRevision && result.loopbackCatalogRequests === 2 && result.loopbackUnexpected === 0,
  "windows_transfer_install_result_mismatch");
  requireCondition(layout.kind === leg && layout.desktopPresent === true && layout.corePresent === true && layout.workerPresent === true,
    "windows_transfer_installed_binaries_missing");
  const reasons = !identity.production && leg === "nsis" ? refusalReasons : [];
  requireCondition(row.refusals?.length === reasons.length && reasons.every((reason, index) => {
    const reply = row.refusals[index];
    return reply?.reason === reason && reply.code === (reason === "windows_desktop_required" ? "unsupported" : "unavailable")
      && reply.configured === false && reply.writes === 0;
  }), "windows_transfer_refusal_receipt_invalid");
  if (leg === "msi") {
    requireCondition(layout.registrationClearBefore === true && layout.directory === "requested" && layout.installExitCode === 0
      && layout.uninstallExitCode === 0 && layout.registrationClearAfter === true && layout.legacyMsiClearAfter === true
      && layout.reason === null && layout.cleanupReason === null, "windows_transfer_msi_uninstall_invalid");
  } else {
    requireCondition(layout.uninstalled === true, "windows_transfer_nsis_uninstall_invalid");
  }
}

async function main() {
  requireCondition(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true"
    && process.env.RUNNER_ENVIRONMENT === "github-hosted", "windows_transfer_requires_hosted_windows");
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000 }).trim();
  const core = readFileSync(join(binaries, "SIDECAR_COMMIT"), "utf8").trim();
  const { version } = json("package.json");
  requireCondition(windowsVaultRequired(), "windows_transfer_requires_credential_storage");
  const identity = transferIdentity(process.env, head, core, version);
  const temp = process.env.RUNNER_TEMP;
  const root = join(temp, "windows-install-transfer");
  const [command, leg] = process.argv.slice(2);
  if (command === "pack") {
    await pack(root, temp, identity);
    return;
  }
  const id = process.env.WINDOWS_TRANSFER_ID;
  const archiveSHA256 = process.env.WINDOWS_TRANSFER_SHA256;
  const manifestSHA256 = process.env.WINDOWS_MANIFEST_SHA256;
  requireCondition(idPattern.test(id) && shaPattern.test(archiveSHA256) && shaPattern.test(manifestSHA256), "windows_transfer_missing_producer_outputs");
  if (command === "receive" || command === "stage-collect") {
    const archive = await verifyArchive(join(temp, "windows-install-zip"), archiveSHA256);
    mkdirSync(root);
    extract(archive, root, identity);
    const payload = command === "stage-collect"
      ? await stageCollectorInputs(root, process.cwd(), identity, manifestSHA256)
      : await verifyPayload(root, identity, manifestSHA256);
    if (command === "receive") {
      materialize(join(root, bindingName), join(binaries, bindingName));
      if (!identity.production) {
        materialize(join(root, unbound), join(temp, "hara-vault-unbound-worker", "hara-credential-worker.exe"));
      }
    }
    writeJson(join(temp, "windows-transfer-readback.json"), { identity, id, archiveSHA256, manifestSHA256, files: payload.files });
  } else {
    requireCondition(leg === "msi" || leg === "nsis", "windows_transfer_invalid_leg");
    if (command === "precheck") {
      assertPrecheck(json(join(temp, "windows-install-precheck", "windows-install-smoke.json")), leg, identity);
    } else if (command === "installed") {
      const checked = json(join(temp, "windows-transfer-readback.json"));
      requireCondition(checked.id === id && checked.archiveSHA256 === archiveSHA256 && checked.manifestSHA256 === manifestSHA256,
        "windows_transfer_readback_drift");
      const payload = await verifyPayload(root, identity, manifestSHA256);
      assertInstalled(json(join(temp, "windows-installed-smoke", "windows-install-smoke.json")), leg, identity, payload);
    } else {
      throw new TransferError("windows_transfer_unknown_command");
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main().catch(error => {
    console.error(error instanceof TransferError ? error.message : "windows_transfer_error");
    process.exitCode = 1;
  });
}
