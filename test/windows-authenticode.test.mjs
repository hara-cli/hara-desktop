import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  expectedWindowsAuthenticodeFiles,
  validateWindowsAuthenticodeReceipt,
} from "../scripts/windows-authenticode-receipt.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const desktopCommit = "1".repeat(40);
const cliCommit = "2".repeat(40);
const publisher = "CN=Nanhara Software, O=Nanhara, C=CN";
const signerThumbprint = "A".repeat(40);
const timestampThumbprint = "B".repeat(40);

function receiptFixture() {
  return {
    schema: 1,
    releaseTag: `v${version}`,
    target: "x86_64-pc-windows-msvc",
    desktopCommit,
    cliCommit,
    verifiedAt: "2026-08-21T00:00:00.000Z",
    publisher,
    signerThumbprint,
    signtoolPolicy: "/pa /all /v",
    artifacts: Object.entries(expectedWindowsAuthenticodeFiles(version)).map(([role, name], index) => ({
      role,
      name,
      size: 1000 + index,
      sha256: String(index + 1).repeat(64),
      authenticodeStatus: "Valid",
      signatureType: "Authenticode",
      signatureDigestAlgorithm: "sha256",
      signtoolPolicyVerified: true,
      signer: {
        subject: publisher,
        thumbprint: signerThumbprint,
        notBefore: "2026-01-01T00:00:00.000Z",
        notAfter: "2027-01-01T00:00:00.000Z",
      },
      timestamp: {
        trustedCertificatePresent: true,
        subject: "CN=Trusted Timestamp Authority",
        thumbprint: timestampThumbprint,
        notBefore: "2025-01-01T00:00:00.000Z",
        notAfter: "2030-01-01T00:00:00.000Z",
      },
    })),
  };
}

function validate(receipt) {
  return validateWindowsAuthenticodeReceipt(receipt, {
    tag: `v${version}`,
    desktopCommit,
    cliCommit,
    publisher,
    signerThumbprint,
  });
}

test("provider-neutral Authenticode receipt binds both installers and both extracted payloads", () => {
  assert.deepEqual(validate(receiptFixture()), {
    tag: `v${version}`,
    target: "x86_64-pc-windows-msvc",
    artifacts: 6,
    publisher,
    signerThumbprint,
  });
});

test("Authenticode receipt rejects mixed publishers, missing timestamps, and incomplete roles", () => {
  const mixed = receiptFixture();
  mixed.artifacts[2].signer.subject = "CN=Unexpected Publisher";
  assert.throws(() => validate(mixed), /signer subject mismatch/);

  const unstamped = receiptFixture();
  unstamped.artifacts[0].timestamp.trustedCertificatePresent = false;
  assert.throws(() => validate(unstamped), /trusted timestamp is missing/);

  const incomplete = receiptFixture();
  incomplete.artifacts.pop();
  assert.throws(() => validate(incomplete), /all six signed roles/);
});

test("Authenticode receipt rejects stale source identities and pre-signing digest claims", () => {
  const wrongSource = receiptFixture();
  wrongSource.desktopCommit = "3".repeat(40);
  assert.throws(() => validate(wrongSource), /Desktop commit does not match/);

  const malformedHash = receiptFixture();
  malformedHash.artifacts[0].sha256 = "unsigned-build-digest";
  assert.throws(() => validate(malformedHash), /SHA-256 is invalid/);

  const nonUtcTime = receiptFixture();
  nonUtcTime.verifiedAt = "2026-08-21 00:00:00";
  assert.throws(() => validate(nonUtcTime), /verifiedAt must be an ISO timestamp/);

  const invertedTimestampCertificate = receiptFixture();
  invertedTimestampCertificate.artifacts[0].timestamp.notBefore = "2031-01-01T00:00:00.000Z";
  assert.throws(
    () => validate(invertedTimestampCertificate),
    /timestamp certificate validity interval is inverted/,
  );
});

test("Windows verifier is verification-only and enforces both trust-policy tools", () => {
  const script = readFileSync(join(root, "scripts", "verify-windows-authenticode.ps1"), "utf8");
  assert.match(script, /Get-AuthenticodeSignature -LiteralPath/);
  assert.match(script, /verify \/pa \/all \/v/);
  assert.match(script, /TimeStamperCertificate/);
  assert.match(script, /Get-FileHash -LiteralPath \$artifactPath -Algorithm SHA256/);
  assert.match(script, /artifact changed while it was being verified/);
  assert.match(script, /PSProvider\.Name -ne 'FileSystem'/);
  assert.match(script, /FileAttributes\]::ReparsePoint/);
  assert.match(script, /installer-nsis/);
  assert.match(script, /msi-sidecar-executable/);
  assert.doesNotMatch(script, /Set-AuthenticodeSignature|\bsign \/f\b/);
});
