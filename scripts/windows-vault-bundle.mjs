// The Windows release and rehearsal build use the same bound Core/worker pair.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const worker = "hara-credential-worker.exe";
const target = "x86_64-pc-windows-msvc";
const sha256 = /^[a-f0-9]{64}$/u;

const json = path => JSON.parse(readFileSync(path, "utf8"));
const pins = root => join(root, "src-tauri", "binaries");
const corePin = root => readFileSync(join(pins(root), "SIDECAR_COMMIT"), "utf8").trim();
const receiptFile = root => join(pins(root), "windows-vault-binding.json");

export function windowsVaultRequired(root = desktop) {
  const version = json(join(root, "package.json")).version;
  const numbers = /^(\d+)\.(\d+)\.\d+$/u.exec(version);
  if (!numbers) throw new Error("Invalid Desktop release version");
  const major = Number(numbers[1]), minor = Number(numbers[2]);
  return major > 1 || (major === 1 && minor >= 3);
}

export function binarySHA(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size === 0) throw new Error("Expected an independent release executable file");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireWorker(path, digest) {
  if (binarySHA(path) !== digest) throw new Error("Windows credential worker SHA-256 mismatch");
}

export function verifiedWindowsVaultManifest(directory) {
  const manifest = json(join(directory, "manifest.json"));
  if (!manifest || manifest.protocolVersion !== 2 || manifest.target !== target || !sha256.test(manifest.sha256))
    throw new Error("Windows credential worker manifest must be v2 for Windows x64 MSVC");
  requireWorker(join(directory, worker), manifest.sha256);
  return manifest.sha256;
}

export function readWindowsVaultBinding(root = desktop) {
  const receipt = json(receiptFile(root));
  if (!receipt || receipt.schemaVersion !== 1 || receipt.protocolVersion !== 2 || receipt.target !== target
      || !/^[a-f0-9]{40}$/u.test(receipt.coreCommit) || receipt.coreCommit !== corePin(root)
      || !sha256.test(receipt.expectedWorkerSHA256) || !sha256.test(receipt.sidecarSHA256))
    throw new Error("Windows credential binding must identify the pinned Core and v2 worker");
  return receipt;
}

export function verifyWindowsVaultSidecar(sidecar, receipt) {
  if (binarySHA(sidecar) !== receipt.sidecarSHA256) throw new Error("Windows sidecar differs from the worker-bound Core build");
  requireWorker(join(dirname(sidecar), worker), receipt.expectedWorkerSHA256);
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(`Windows credential packaging command failed: ${command}`);
}

function verifyPinnedCore(core, sha) {
  if (!/^[a-f0-9]{40}$/u.test(sha) || sha !== corePin(desktop)) throw new Error("Windows vault CLI SHA must match the Desk Core pin");
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" });
  if (head.status !== 0 || head.stdout.trim() !== sha) throw new Error("Windows vault build requires the pinned Core checkout");
}

function main([command, input]) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 native build required");
  const required = windowsVaultRequired();
  if (command === "build") {
    if (input !== target) throw new Error("Unexpected Windows package target");
    const args = ["build", "--target", target];
    if (required) {
      const receipt = readWindowsVaultBinding();
      requireWorker(join(pins(desktop), `hara-credential-worker-${target}.exe`), receipt.expectedWorkerSHA256);
      if (binarySHA(join(pins(desktop), `hara-${target}.exe`)) !== receipt.sidecarSHA256)
        throw new Error("Staged Windows Core sidecar SHA-256 mismatch");
      args.push("--config", join(desktop, "src-tauri", "tauri.windows-vault.conf.json"));
    }
    run(process.execPath, [join(desktop, "node_modules", "@tauri-apps", "cli", "tauri.js"), ...args], { cwd: desktop });
    return;
  }
  if (command !== "prepare" && command !== "stage") throw new Error("Expected prepare, stage, or build");
  if (!required) return;
  const core = process.cwd();
  verifyPinnedCore(core, input);
  const directory = join(core, "dist", "native", "win32-x64");
  const builder = join(core, "scripts", "build-windows-vault-worker.mjs");
  if (!existsSync(builder)) throw new Error("Pinned Core cannot build the v2 Windows credential worker");
  if (command === "prepare") {
    run("rustup", ["toolchain", "install", "1.92.0-x86_64-pc-windows-msvc", "--profile", "minimal"], { cwd: core });
    run(process.execPath, [builder], { cwd: core });
    const digest = verifiedWindowsVaultManifest(directory);
    mkdirSync(pins(desktop), { recursive: true });
    // This is the digest build-binary.ts validates and embeds in the next workflow command.
    writeFileSync(receiptFile(desktop), JSON.stringify({ schemaVersion: 1, protocolVersion: 2, target,
      coreCommit: input, expectedWorkerSHA256: digest }), { flag: "wx" });
    return;
  }
  const prepared = json(receiptFile(desktop));
  const expectedWorkerSHA256 = verifiedWindowsVaultManifest(directory);
  if (prepared?.coreCommit !== input || prepared.expectedWorkerSHA256 !== expectedWorkerSHA256)
    throw new Error("Windows vault manifest changed between prepare and stage");
  const bundled = join(core, "dist", "bin", worker);
  requireWorker(bundled, expectedWorkerSHA256);
  const staged = join(pins(desktop), `hara-credential-worker-${target}.exe`);
  copyFileSync(bundled, staged);
  requireWorker(staged, expectedWorkerSHA256);
  const sidecarSHA256 = binarySHA(join(core, "dist", "bin", "hara-sidecar.exe"));
  if (sidecarSHA256 !== binarySHA(join(pins(desktop), `hara-${target}.exe`)))
    throw new Error("Core sidecar bytes changed during staging");
  writeFileSync(receiptFile(desktop), JSON.stringify({ schemaVersion: 1, protocolVersion: 2, target, coreCommit: input,
    expectedWorkerSHA256, sidecarSHA256 }) + "\n");
  console.log(JSON.stringify(readWindowsVaultBinding()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
