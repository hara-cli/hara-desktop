// Minimal Tauri/minisign key-consistency gate. Tauri .sig files are base64-wrapped minisign text;
// the public key in tauri.conf.json is wrapped the same way. Comparing their embedded 8-byte key
// IDs catches a rotated/misconfigured CI or local private key before an unusable update is shipped.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

function minisignPacket(wrapped, label, expectedMagic) {
  let text;
  try {
    text = Buffer.from(wrapped.trim(), "base64").toString("utf8");
  } catch {
    throw new Error(`${label} is not valid base64-wrapped minisign data`);
  }
  const packetLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("untrusted comment:") && !line.startsWith("trusted comment:"));
  if (!packetLine) throw new Error(`${label} contains no minisign packet`);
  const packet = Buffer.from(packetLine, "base64");
  if (packet.length < 10 || packet.subarray(0, 2).toString("ascii") !== expectedMagic) {
    throw new Error(`${label} has an invalid minisign ${expectedMagic} packet`);
  }
  return packet;
}

const configuredPublicKey = tauri.plugins?.updater?.pubkey;
if (typeof configuredPublicKey !== "string" || !configuredPublicKey.trim()) {
  throw new Error("tauri.conf.json updater public key is missing");
}
const publicKeyId = minisignPacket(configuredPublicKey, "configured updater public key", "Ed")
  .subarray(2, 10)
  .toString("hex");

export function assertUpdaterSignatureKey(signature, label = "updater signature") {
  const signatureKeyId = minisignPacket(signature, label, "ED").subarray(2, 10).toString("hex");
  if (signatureKeyId !== publicKeyId) {
    throw new Error(
      `${label} key id ${signatureKeyId} does not match configured updater public key ${publicKeyId}`,
    );
  }
  return publicKeyId;
}

let verifierPath;

function updaterVerifier() {
  if (verifierPath) return verifierPath;
  const manifestPath = join(root, "src-tauri", "Cargo.toml");
  execFileSync(
    "cargo",
    ["build", "--quiet", "--locked", "--manifest-path", manifestPath, "--example", "verify_updater_signature"],
    {
      cwd: root,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 10 * 60_000,
      windowsHide: true,
    },
  );
  const targetRoot = process.env.CARGO_TARGET_DIR
    ? isAbsolute(process.env.CARGO_TARGET_DIR)
      ? process.env.CARGO_TARGET_DIR
      : resolve(root, process.env.CARGO_TARGET_DIR)
    : join(root, "src-tauri", "target");
  verifierPath = join(
    targetRoot,
    "debug",
    "examples",
    `verify_updater_signature${process.platform === "win32" ? ".exe" : ""}`,
  );
  return verifierPath;
}

export function verifyUpdaterArtifactSignature(artifact, signaturePath, label = "updater artifact") {
  const signature = readFileSync(signaturePath, "utf8").trim();
  const keyId = assertUpdaterSignatureKey(signature, `${label} signature`);
  try {
    execFileSync(updaterVerifier(), [artifact, signaturePath, configuredPublicKey], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 120_000,
    });
  } catch (error) {
    const detail = [error?.stderr?.toString(), error?.stdout?.toString(), error?.message]
      .filter(Boolean)
      .join(" ")
      .replaceAll(/\s+/g, " ")
      .slice(0, 1000);
    throw new Error(`${label} cryptographic signature verification failed: ${detail || "unknown error"}`);
  }
  return keyId;
}
