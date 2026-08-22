import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditStableChannel,
  auditVersionedMirror,
  expectedMirrorAssetNames,
  releaseAssetExpectations,
  updaterPayloadNames,
} from "../scripts/release-channel-audit.mjs";
import { buildMirrorManifest, updaterPlatformAssets } from "../scripts/updater-mirror-manifest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseFixture() {
  const bytes = new Map(
    [...expectedMirrorAssetNames(version), "latest.json"].map((name) => [
      name,
      Buffer.from(`verified fixture bytes for ${name}\n`),
    ]),
  );
  return {
    bytes,
    release: {
      tag_name: tag,
      draft: false,
      prerelease: false,
      assets: [...bytes].map(([name, contents]) => ({
        name,
        size: contents.byteLength,
        digest: `sha256:${sha256(contents)}`,
      })),
    },
  };
}

test("versioned channel audit streams every asset and probes every updater payload", async () => {
  const { bytes, release } = releaseFixture();
  const calls = [];
  const summary = await auditVersionedMirror({
    release,
    tag,
    concurrency: 2,
    attempts: 1,
    retryDelayMs: 0,
    fetchImpl: async (url, options) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      const contents = bytes.get(name);
      assert.ok(contents, `unexpected asset request ${name}`);
      const isRange = options.headers?.range === "bytes=0-0";
      calls.push({ name, isRange });
      if (isRange) {
        return new Response(contents.subarray(0, 1), {
          status: 206,
          headers: { "content-range": `bytes 0-0/${contents.byteLength}` },
        });
      }
      return new Response(contents, {
        status: 200,
        headers: { "content-length": String(contents.byteLength) },
      });
    },
  });

  assert.equal(summary.assets, expectedMirrorAssetNames(version).length);
  assert.equal(summary.updaterRanges, updaterPayloadNames(version).size);
  assert.equal(calls.filter((call) => call.isRange).length, updaterPayloadNames(version).size);
});

test("versioned channel audit fails closed on a CDN digest mismatch", async () => {
  const { bytes, release } = releaseFixture();
  const first = expectedMirrorAssetNames(version)[0];
  await assert.rejects(
    () =>
      auditVersionedMirror({
        release,
        tag,
        concurrency: 1,
        attempts: 1,
        retryDelayMs: 0,
        fetchImpl: async (url) => {
          const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
          const contents = name === first ? Buffer.from("tampered") : bytes.get(name);
          return new Response(contents, {
            status: 200,
            headers: { "content-length": String(contents.byteLength) },
          });
        },
      }),
    /Content-Length must be|SHA-256 mismatch/,
  );
});

test("release metadata must expose the exact digest-bearing asset set", () => {
  const { release } = releaseFixture();
  assert.equal(releaseAssetExpectations(release, version).length, 15);
  const missing = structuredClone(release);
  missing.assets.pop();
  assert.throws(() => releaseAssetExpectations(missing, version), /asset set mismatch/);
  const malformed = structuredClone(release);
  malformed.assets[0].digest = null;
  assert.throws(() => releaseAssetExpectations(malformed, version), /SHA-256 digest/);
});

function updaterManifestFixture() {
  const signature = "trusted updater signature ".repeat(4);
  return {
    version,
    notes: `Hara Desktop ${version}`,
    pub_date: "2026-08-20T02:57:21.000Z",
    platforms: Object.fromEntries(
      Object.entries(updaterPlatformAssets).map(([platform, asset]) => [
        platform,
        {
          signature,
          url: `https://github.com/hara-cli/hara-desktop/releases/download/${tag}/${encodeURIComponent(asset)}`,
        },
      ]),
    ),
  };
}

test("stable channel audit requires matching updater signatures and website manifest", async () => {
  const canonical = updaterManifestFixture();
  const mirror = buildMirrorManifest(canonical, tag);
  const downloadManifest = {
    version,
    tag,
    chinaMirror: {
      status: "ready",
      baseUrl: `https://assets.nanhara.com/hara/desktop/${tag}`,
    },
  };
  const documents = new Map([
    [`https://github.com/hara-cli/hara-desktop/releases/download/${tag}/latest.json`, canonical],
    ["https://assets.nanhara.com/hara/desktop/stable/latest.json", mirror],
    ["https://assets.nanhara.com/hara/desktop/stable/manifest.json", downloadManifest],
  ]);
  const fetchImpl = async (url) =>
    new Response(JSON.stringify(documents.get(url)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  assert.deepEqual(await auditStableChannel({ tag, fetchImpl, attempts: 1 }), {
    tag,
    version,
    platforms: Object.keys(updaterPlatformAssets).length,
    signaturesMatch: true,
  });

  documents.set("https://assets.nanhara.com/hara/desktop/stable/manifest.json", {
    ...downloadManifest,
    version: "0.1.82",
    tag: "v0.1.82",
  });
  await assert.rejects(
    () => auditStableChannel({ tag, fetchImpl, attempts: 1 }),
    /stable download manifest must advertise/,
  );
});
