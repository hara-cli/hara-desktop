#!/usr/bin/env node

// Audit the public first-party updater channel against GitHub's immutable release metadata. The
// versioned CDN objects are streamed and hashed instead of trusted from headers, while the stable
// manifests are checked only after every immutable payload is known-good.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { requireStableTag, requireStableVersion } from "./release-policy.mjs";
import {
  validateCanonicalManifest,
  validateMirrorManifest,
} from "./updater-mirror-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version: desktopVersion } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const repository = "hara-cli/hara-desktop";
const githubApiOrigin = "https://api.github.com";
const githubReleaseOrigin = `https://github.com/${repository}/releases/download`;
const firstPartyOrigin = "https://assets.nanhara.com/hara/desktop";
const stableUpdaterUrl = `${firstPartyOrigin}/stable/latest.json`;
const stableDownloadManifestUrl = `${firstPartyOrigin}/stable/manifest.json`;

class ReleaseAuditError extends Error {
  constructor(message, { transient = false } = {}) {
    super(message);
    this.name = "ReleaseAuditError";
    this.transient = transient;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseAuditError(`${label} must be an object`);
  }
}

function assertExactNames(actual, expected, label) {
  const actualNames = [...actual].sort();
  const expectedNames = [...expected].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    const missing = expectedNames.filter((name) => !actualNames.includes(name));
    const extra = actualNames.filter((name) => !expectedNames.includes(name));
    throw new ReleaseAuditError(
      `${label} mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`,
    );
  }
}

export function expectedMirrorAssetNames(version = desktopVersion) {
  requireStableVersion(version);
  return Object.freeze([
    `Hara-${version}-1.x86_64.rpm`,
    `Hara-${version}-1.x86_64.rpm.sig`,
    `Hara_${version}_aarch64.dmg`,
    `Hara_${version}_amd64.deb`,
    `Hara_${version}_amd64.deb.sig`,
    `Hara_${version}_x64-setup.exe`,
    `Hara_${version}_x64-setup.exe.sig`,
    `Hara_${version}_x64.dmg`,
    `Hara_${version}_x64_en-US.msi`,
    `Hara_${version}_x64_en-US.msi.sig`,
    "Hara_aarch64.app.tar.gz",
    "Hara_aarch64.app.tar.gz.sig",
    "Hara_x64.app.tar.gz",
    "Hara_x64.app.tar.gz.sig",
    "release-source-provenance.json",
  ]);
}

export function releaseSourceArchiveName(version = desktopVersion) {
  return `Hara_${requireStableVersion(version)}_source-packs.zip`;
}

export function updaterPayloadNames(version = desktopVersion) {
  requireStableVersion(version);
  return new Set([
    `Hara-${version}-1.x86_64.rpm`,
    `Hara_${version}_amd64.deb`,
    `Hara_${version}_x64-setup.exe`,
    `Hara_${version}_x64_en-US.msi`,
    "Hara_aarch64.app.tar.gz",
    "Hara_x64.app.tar.gz",
  ]);
}

export function releaseAssetExpectations(release, version = desktopVersion) {
  const tag = `v${requireStableVersion(version)}`;
  assertPlainObject(release, "GitHub release");
  if (release.tag_name !== tag) {
    throw new ReleaseAuditError(`GitHub release tag must be ${tag}, got ${release.tag_name ?? "<missing>"}`);
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw new ReleaseAuditError("GitHub release must be public, non-draft, and non-prerelease");
  }
  if (!Array.isArray(release.assets)) {
    throw new ReleaseAuditError("GitHub release assets must be an array");
  }

  const expectedNames = expectedMirrorAssetNames(version);
  assertExactNames(
    release.assets.map((asset) => asset?.name),
    [...expectedNames, releaseSourceArchiveName(version), "latest.json"],
    "GitHub release asset set",
  );

  const assets = new Map();
  for (const asset of release.assets) {
    const name = String(asset?.name ?? "");
    if (!name || basename(name) !== name || name === "." || name === "..") {
      throw new ReleaseAuditError(`unsafe GitHub release asset name: ${JSON.stringify(name)}`);
    }
    if (!Number.isSafeInteger(asset?.size) || asset.size <= 0) {
      throw new ReleaseAuditError(`invalid GitHub release asset size: ${name}`);
    }
    const digest = String(asset?.digest ?? "");
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
      throw new ReleaseAuditError(`missing or invalid GitHub SHA-256 digest: ${name}`);
    }
    assets.set(name, {
      name,
      size: asset.size,
      sha256: digest.slice("sha256:".length),
    });
  }
  return expectedNames.map((name) => assets.get(name));
}

function responseHeader(response, name) {
  return response.headers?.get?.(name) ?? null;
}

async function responseBytes(response, label) {
  if (!response.body) throw new ReleaseAuditError(`${label} response body is missing`);
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      hash.update(bytes);
    }
  } catch (error) {
    throw new ReleaseAuditError(
      `${label} response stream failed: ${error instanceof Error ? error.message : String(error)}`,
      { transient: true },
    );
  }
  return { size, sha256: hash.digest("hex") };
}

export async function verifyAssetResponse(response, expectation) {
  if (response.status !== 200) {
    throw new ReleaseAuditError(`${expectation.name} returned HTTP ${response.status}`, {
      transient: response.status === 408 || response.status === 429 || response.status >= 500,
    });
  }
  const contentLength = responseHeader(response, "content-length");
  if (contentLength !== String(expectation.size)) {
    throw new ReleaseAuditError(
      `${expectation.name} Content-Length must be ${expectation.size}, got ${contentLength ?? "<missing>"}`,
    );
  }
  const actual = await responseBytes(response, expectation.name);
  if (actual.size !== expectation.size) {
    throw new ReleaseAuditError(
      `${expectation.name} downloaded ${actual.size} byte(s), expected ${expectation.size}`,
    );
  }
  if (actual.sha256 !== expectation.sha256) {
    throw new ReleaseAuditError(
      `${expectation.name} SHA-256 mismatch; expected ${expectation.sha256}, got ${actual.sha256}`,
    );
  }
  return actual;
}

export async function verifyRangeResponse(response, expectation) {
  if (response.status !== 206) {
    throw new ReleaseAuditError(`${expectation.name} range probe returned HTTP ${response.status}`);
  }
  const contentRange = responseHeader(response, "content-range");
  if (contentRange !== `bytes 0-0/${expectation.size}`) {
    throw new ReleaseAuditError(
      `${expectation.name} Content-Range must be bytes 0-0/${expectation.size}, got ${contentRange ?? "<missing>"}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== 1) {
    throw new ReleaseAuditError(`${expectation.name} range probe returned ${bytes.byteLength} byte(s)`);
  }
}

function isTransient(error) {
  return (
    error?.transient === true ||
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error instanceof TypeError
  );
}

async function retry(label, operation, { attempts, retryDelayMs }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts) throw error;
      await wait(retryDelayMs * attempt);
    }
  }
  throw new ReleaseAuditError(`${label} failed: ${String(lastError)}`);
}

function requestSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

async function fetchJson(url, { fetchImpl, timeoutMs, attempts, retryDelayMs, label }) {
  return retry(
    label,
    async () => {
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": "hara-desktop-release-channel-audit",
        },
        redirect: "follow",
        signal: requestSignal(timeoutMs),
      });
      if (response.status !== 200) {
        throw new ReleaseAuditError(`${label} returned HTTP ${response.status}`, {
          transient: response.status === 408 || response.status === 429 || response.status >= 500,
        });
      }
      try {
        return await response.json();
      } catch (error) {
        throw new ReleaseAuditError(
          `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    { attempts, retryDelayMs },
  );
}

async function mapWithConcurrency(values, concurrency, operation) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new ReleaseAuditError("audit concurrency must be an integer from 1 through 8");
  }
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await operation(values[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function auditVersionedMirror({
  release,
  tag = `v${desktopVersion}`,
  fetchImpl = fetch,
  baseUrl = firstPartyOrigin,
  concurrency = 3,
  timeoutMs = 120_000,
  attempts = 3,
  retryDelayMs = 500,
  onVerified = () => {},
} = {}) {
  const version = tag.replace(/^v/u, "");
  requireStableTag(tag, version);
  if (version !== desktopVersion) {
    throw new ReleaseAuditError(`audit tag must match Desktop ${desktopVersion}, got ${tag}`);
  }
  const expectations = releaseAssetExpectations(release, version);
  const updaterPayloads = updaterPayloadNames(version);

  const results = await mapWithConcurrency(expectations, concurrency, async (expectation) => {
    const assetUrl = `${baseUrl}/${tag}/${encodeURIComponent(expectation.name)}`;
    const actual = await retry(
      expectation.name,
      async () => {
        const response = await fetchImpl(assetUrl, {
          cache: "no-store",
          headers: { "cache-control": "no-cache", pragma: "no-cache" },
          redirect: "follow",
          signal: requestSignal(timeoutMs),
        });
        return verifyAssetResponse(response, expectation);
      },
      { attempts, retryDelayMs },
    );

    let rangeVerified = false;
    if (updaterPayloads.has(expectation.name)) {
      await retry(
        `${expectation.name} range probe`,
        async () => {
          const response = await fetchImpl(assetUrl, {
            cache: "no-store",
            headers: {
              "cache-control": "no-cache",
              pragma: "no-cache",
              range: "bytes=0-0",
            },
            redirect: "follow",
            signal: requestSignal(timeoutMs),
          });
          await verifyRangeResponse(response, expectation);
        },
        { attempts, retryDelayMs },
      );
      rangeVerified = true;
    }
    const result = { ...expectation, url: assetUrl, rangeVerified, ...actual };
    onVerified(result);
    return result;
  });

  return {
    tag,
    assets: results.length,
    updaterRanges: results.filter((result) => result.rangeVerified).length,
    bytes: results.reduce((total, result) => total + result.size, 0),
    results,
  };
}

export async function auditStableChannel({
  tag = `v${desktopVersion}`,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  attempts = 3,
  retryDelayMs = 500,
} = {}) {
  const version = tag.replace(/^v/u, "");
  requireStableTag(tag, version);
  if (version !== desktopVersion) {
    throw new ReleaseAuditError(`audit tag must match Desktop ${desktopVersion}, got ${tag}`);
  }
  const options = { fetchImpl, timeoutMs, attempts, retryDelayMs };
  const [canonical, mirror, downloadManifest] = await Promise.all([
    fetchJson(`${githubReleaseOrigin}/${tag}/latest.json`, {
      ...options,
      label: "canonical updater manifest",
    }),
    fetchJson(stableUpdaterUrl, { ...options, label: "first-party updater manifest" }),
    fetchJson(stableDownloadManifestUrl, { ...options, label: "stable download manifest" }),
  ]);

  validateCanonicalManifest(canonical, tag);
  validateMirrorManifest(mirror, tag);
  for (const platform of Object.keys(canonical.platforms)) {
    if (canonical.platforms[platform].signature !== mirror.platforms[platform].signature) {
      throw new ReleaseAuditError(`stable updater signature mismatch for ${platform}`);
    }
  }
  assertPlainObject(downloadManifest, "stable download manifest");
  if (downloadManifest.version !== version || downloadManifest.tag !== tag) {
    throw new ReleaseAuditError(
      `stable download manifest must advertise ${tag}, got ${downloadManifest.tag ?? "<missing>"}`,
    );
  }
  const wantedBaseUrl = `${firstPartyOrigin}/${tag}`;
  if (
    downloadManifest.chinaMirror?.status !== "ready" ||
    downloadManifest.chinaMirror?.baseUrl !== wantedBaseUrl
  ) {
    throw new ReleaseAuditError(`stable download manifest must expose ready mirror ${wantedBaseUrl}`);
  }
  return {
    tag,
    version,
    platforms: Object.keys(canonical.platforms).length,
    signaturesMatch: true,
  };
}

async function loadPublicRelease(tag, options) {
  return fetchJson(`${githubApiOrigin}/repos/${repository}/releases/tags/${tag}`, {
    ...options,
    label: `GitHub release ${tag}`,
  });
}

function usage() {
  console.error("usage: node scripts/release-channel-audit.mjs <versioned|stable|all> [vX.Y.Z]");
}

async function main() {
  const [, , command, tagArgument, ...extra] = process.argv;
  if (!command || !["versioned", "stable", "all"].includes(command) || extra.length > 0) {
    usage();
    process.exitCode = 2;
    return;
  }
  const tag = tagArgument || `v${desktopVersion}`;
  requireStableTag(tag, desktopVersion);
  const options = { timeoutMs: 120_000, attempts: 3, retryDelayMs: 750 };
  const summary = {};
  if (command === "versioned" || command === "all") {
    const release = await loadPublicRelease(tag, { fetchImpl: fetch, ...options });
    summary.versioned = await auditVersionedMirror({
      release,
      tag,
      ...options,
      onVerified(result) {
        console.log(
          `  verified ${result.name} (${result.size} bytes)${result.rangeVerified ? " + range" : ""}`,
        );
      },
    });
    delete summary.versioned.results;
  }
  if (command === "stable" || command === "all") {
    summary.stable = await auditStableChannel({ tag, fetchImpl: fetch, ...options });
  }
  console.log(`release-channel-audit: ${JSON.stringify(summary)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(`release-channel-audit: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
