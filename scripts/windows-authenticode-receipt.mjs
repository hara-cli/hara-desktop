#!/usr/bin/env node

// Validate the provider-neutral receipt emitted after Windows trust-policy checks. This does not
// sign anything and never accepts a self-declared publisher: protected release configuration must
// supply the expected tag, commits, subject, and certificate thumbprint independently.
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireStableTag, requireStableVersion } from "./release-policy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version: desktopVersion } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const MAX_RECEIPT_BYTES = 1024 * 1024;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CERTIFICATE_THUMBPRINT = /^[A-F0-9]{40}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;

export function expectedWindowsAuthenticodeFiles(version = desktopVersion) {
  requireStableVersion(version);
  return Object.freeze({
    "installer-nsis": `Hara_${version}_x64-setup.exe`,
    "installer-msi": `Hara_${version}_x64_en-US.msi`,
    "nsis-desktop-executable": "hara-desktop.exe",
    "nsis-sidecar-executable": "hara.exe",
    "msi-desktop-executable": "hara-desktop.exe",
    "msi-sidecar-executable": "hara.exe",
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} keys mismatch; expected ${wanted.join(", ")}, got ${actual.join(", ")}`,
  );
}

function validTimestamp(value) {
  return (
    typeof value === "string" &&
    UTC_TIMESTAMP.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeThumbprint(value, label) {
  assert(typeof value === "string", `${label} must be a string`);
  const normalized = value.replaceAll(" ", "").toUpperCase();
  assert(CERTIFICATE_THUMBPRINT.test(normalized), `${label} must be a 40-character certificate thumbprint`);
  return normalized;
}

export function validateWindowsAuthenticodeReceipt(
  receipt,
  {
    tag = `v${desktopVersion}`,
    desktopCommit,
    cliCommit,
    publisher,
    signerThumbprint,
  } = {},
) {
  assert(plainObject(receipt), "Windows Authenticode receipt must be an object");
  const version = tag.replace(/^v/u, "");
  requireStableTag(tag, version);
  assert(version === desktopVersion, `receipt tag must match Desktop ${desktopVersion}, got ${tag}`);
  assert(COMMIT.test(desktopCommit ?? ""), "expected Desktop commit must be 40 lowercase hex characters");
  assert(COMMIT.test(cliCommit ?? ""), "expected CLI commit must be 40 lowercase hex characters");
  assert(typeof publisher === "string" && publisher.length > 0, "expected publisher subject is required");
  const expectedThumbprint = normalizeThumbprint(signerThumbprint, "expected signer thumbprint");

  assertExactKeys(
    receipt,
    [
      "schema",
      "releaseTag",
      "target",
      "desktopCommit",
      "cliCommit",
      "verifiedAt",
      "publisher",
      "signerThumbprint",
      "signtoolPolicy",
      "artifacts",
    ],
    "Windows Authenticode receipt",
  );
  assert(receipt.schema === 1, "Windows Authenticode receipt schema must be 1");
  assert(receipt.releaseTag === tag, `receipt releaseTag must be ${tag}`);
  assert(receipt.target === "x86_64-pc-windows-msvc", "receipt target must be x86_64-pc-windows-msvc");
  assert(receipt.desktopCommit === desktopCommit, "receipt Desktop commit does not match protected source");
  assert(receipt.cliCommit === cliCommit, "receipt CLI commit does not match protected source");
  assert(validTimestamp(receipt.verifiedAt), "receipt verifiedAt must be an ISO timestamp");
  assert(receipt.publisher === publisher, "receipt publisher does not match protected configuration");
  assert(
    normalizeThumbprint(receipt.signerThumbprint, "receipt signer thumbprint") === expectedThumbprint,
    "receipt signer thumbprint does not match protected configuration",
  );
  assert(receipt.signtoolPolicy === "/pa /all /v", "receipt must use signtool policy /pa /all /v");
  assert(Array.isArray(receipt.artifacts), "receipt artifacts must be an array");

  const expectedFiles = expectedWindowsAuthenticodeFiles(version);
  assert(receipt.artifacts.length === Object.keys(expectedFiles).length, "receipt must contain all six signed roles");
  const seenRoles = new Set();
  const verifiedAt = Date.parse(receipt.verifiedAt);

  for (const artifact of receipt.artifacts) {
    assert(plainObject(artifact), "receipt artifact must be an object");
    assertExactKeys(
      artifact,
      [
        "role",
        "name",
        "size",
        "sha256",
        "authenticodeStatus",
        "signatureType",
        "signatureDigestAlgorithm",
        "signtoolPolicyVerified",
        "signer",
        "timestamp",
      ],
      "receipt artifact",
    );
    assert(typeof artifact.role === "string" && expectedFiles[artifact.role], `unexpected signed role: ${artifact.role}`);
    assert(!seenRoles.has(artifact.role), `duplicate signed role: ${artifact.role}`);
    seenRoles.add(artifact.role);
    assert(artifact.name === expectedFiles[artifact.role], `${artifact.role} filename mismatch`);
    assert(basename(artifact.name) === artifact.name, `${artifact.role} filename must be a basename`);
    assert(Number.isSafeInteger(artifact.size) && artifact.size > 0, `${artifact.role} size is invalid`);
    assert(SHA256.test(artifact.sha256), `${artifact.role} SHA-256 is invalid`);
    assert(artifact.authenticodeStatus === "Valid", `${artifact.role} Authenticode status is not Valid`);
    assert(artifact.signatureType === "Authenticode", `${artifact.role} signature type is not Authenticode`);
    assert(artifact.signatureDigestAlgorithm === "sha256", `${artifact.role} signature digest is not SHA-256`);
    assert(artifact.signtoolPolicyVerified === true, `${artifact.role} did not pass signtool trust policy`);

    assert(plainObject(artifact.signer), `${artifact.role} signer must be an object`);
    assertExactKeys(artifact.signer, ["subject", "thumbprint", "notBefore", "notAfter"], `${artifact.role} signer`);
    assert(artifact.signer.subject === publisher, `${artifact.role} signer subject mismatch`);
    assert(
      normalizeThumbprint(artifact.signer.thumbprint, `${artifact.role} signer thumbprint`) === expectedThumbprint,
      `${artifact.role} signer thumbprint mismatch`,
    );
    assert(validTimestamp(artifact.signer.notBefore), `${artifact.role} signer notBefore is invalid`);
    assert(validTimestamp(artifact.signer.notAfter), `${artifact.role} signer notAfter is invalid`);
    const signerNotBefore = Date.parse(artifact.signer.notBefore);
    const signerNotAfter = Date.parse(artifact.signer.notAfter);
    assert(signerNotBefore <= signerNotAfter, `${artifact.role} signer validity interval is inverted`);
    assert(signerNotBefore <= verifiedAt, `${artifact.role} signer was not yet valid`);
    assert(signerNotAfter >= verifiedAt, `${artifact.role} signer was expired`);

    assert(plainObject(artifact.timestamp), `${artifact.role} timestamp must be an object`);
    assertExactKeys(
      artifact.timestamp,
      ["trustedCertificatePresent", "subject", "thumbprint", "notBefore", "notAfter"],
      `${artifact.role} timestamp`,
    );
    assert(artifact.timestamp.trustedCertificatePresent === true, `${artifact.role} trusted timestamp is missing`);
    assert(typeof artifact.timestamp.subject === "string" && artifact.timestamp.subject.length > 0, `${artifact.role} timestamp subject is missing`);
    normalizeThumbprint(artifact.timestamp.thumbprint, `${artifact.role} timestamp thumbprint`);
    assert(validTimestamp(artifact.timestamp.notBefore), `${artifact.role} timestamp notBefore is invalid`);
    assert(validTimestamp(artifact.timestamp.notAfter), `${artifact.role} timestamp notAfter is invalid`);
    assert(
      Date.parse(artifact.timestamp.notBefore) <= Date.parse(artifact.timestamp.notAfter),
      `${artifact.role} timestamp certificate validity interval is inverted`,
    );
  }
  assertExactKeys(Object.fromEntries([...seenRoles].map((role) => [role, true])), Object.keys(expectedFiles), "signed roles");
  return {
    tag,
    target: receipt.target,
    artifacts: receipt.artifacts.length,
    publisher,
    signerThumbprint: expectedThumbprint,
  };
}

function parseArguments(arguments_) {
  const [receiptPath, ...options] = arguments_;
  if (!receiptPath || options.length % 2 !== 0) return undefined;
  const parsed = { receiptPath };
  const allowed = new Map([
    ["--tag", "tag"],
    ["--desktop-commit", "desktopCommit"],
    ["--cli-commit", "cliCommit"],
    ["--publisher", "publisher"],
    ["--thumbprint", "signerThumbprint"],
  ]);
  for (let index = 0; index < options.length; index += 2) {
    const key = allowed.get(options[index]);
    if (!key || parsed[key] !== undefined || !options[index + 1]) return undefined;
    parsed[key] = options[index + 1];
  }
  if (["tag", "desktopCommit", "cliCommit", "publisher", "signerThumbprint"].some((key) => !parsed[key])) {
    return undefined;
  }
  return parsed;
}

function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    console.error(
      "usage: node scripts/windows-authenticode-receipt.mjs <receipt.json> --tag vX.Y.Z --desktop-commit <sha> --cli-commit <sha> --publisher <subject> --thumbprint <sha1>",
    );
    process.exitCode = 2;
    return;
  }
  const receiptPath = resolve(parsed.receiptPath);
  const info = lstatSync(receiptPath);
  assert(
    info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= MAX_RECEIPT_BYTES,
    `receipt must be a regular file up to ${MAX_RECEIPT_BYTES} bytes`,
  );
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const result = validateWindowsAuthenticodeReceipt(receipt, parsed);
  console.log(`windows-authenticode-receipt: verified ${result.artifacts} signed roles for ${result.tag}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(`windows-authenticode-receipt: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
