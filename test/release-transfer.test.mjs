// 1.2.3 release-chain fixes (v1.2.2 failed three times at the protected merge step: the signer
// downloaded the whole ~434 MB hidden draft twice through a 19-250 KB/s route in 600 s windows).
// Covers: metadata-only digest binding, speed-based route selection that stops before any transfer,
// resumable size-aware downloads, upload deadlines, and the workflow/verifier wiring.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkDraft,
  checkFinal,
  parseRecord,
  recordDirectory,
  smallAssets,
  SMALL_ASSET_MAX_BYTES,
} from "../scripts/release-asset-digests.mjs";
import {
  DEFAULT_FLOOR_BYTES_PER_SECOND,
  floorFromEnvironment,
  parseProbe,
  probeArguments,
  PROBE_BYTES,
  PROBE_MAX_SECONDS,
  selectProxy,
} from "../scripts/release-proxy-select.mjs";
import {
  downloadReleaseAssetsViaApi,
  releaseApiAssetTimeoutMs,
  releaseApiDownloadArguments,
} from "../scripts/github-release-api-download.mjs";
import { reconcileReleaseDownloadCache } from "../scripts/release-download-cache.mjs";
import { runWithDeadline, transferDeadlineSeconds } from "../scripts/run-with-deadline.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const replaced = ["mac.dmg", "mac.tar.gz", "mac.tar.gz.sig", "latest.json"];

function fixtureDraft() {
  const directory = mkdtempSync(join(tmpdir(), "hara-digest-draft-"));
  const files = {
    "linux.deb": "linux package bytes\n",
    "linux.deb.sig": "linux signature\n",
    "mac.dmg": "unsigned ci dmg\n",
    "mac.tar.gz": "unsigned ci updater\n",
    "mac.tar.gz.sig": "ci signature\n",
    "latest.json": "{\"version\":\"ci\"}\n",
  };
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(directory, name), contents);
  return { directory, files };
}

function metadataFrom(files, overrides = {}) {
  return {
    assets: Object.entries({ ...files, ...overrides }).map(([name, contents]) => ({
      name,
      size: Buffer.byteLength(contents),
      digest: `sha256:${sha256(contents)}`,
      state: "uploaded",
    })),
  };
}

test("the assembly record binds every draft asset by name, size and SHA-256", () => {
  const { directory, files } = fixtureDraft();
  try {
    const record = recordDirectory(directory);
    assert.deepEqual(record.map((entry) => entry.name), Object.keys(files).sort());
    assert.equal(record.find((entry) => entry.name === "linux.deb").sha256, sha256(files["linux.deb"]));
    writeFileSync(join(directory, ".linux.deb.part"), "partial");
    assert.equal(recordDirectory(directory).length, record.length, "partials are not draft assets");
    assert.throws(() => parseRecord("[]"), /non-empty array/);
    assert.throws(() => parseRecord(JSON.stringify([record[0], record[0]])), /duplicate/);
    assert.throws(() => parseRecord(JSON.stringify([{ ...record[0], sha256: "abc" }])), /sha256 is invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-draft refuses any non-Mac digest, size, extra or missing asset before upload", () => {
  const { directory, files } = fixtureDraft();
  try {
    const record = JSON.stringify(recordDirectory(directory));
    assert.deepEqual(checkDraft(metadataFrom(files), record, replaced), { unchanged: 2, replaced: 4 });
    // Replaced assets may differ (they are about to be overwritten); nothing else may.
    assert.doesNotThrow(() => checkDraft(metadataFrom(files, { "mac.dmg": "anything" }), record, replaced));
    assert.throws(() => checkDraft(metadataFrom(files, { "linux.deb": "tampered\n" }), record, replaced),
      /GitHub digest for linux\.deb differs from the verified draft record/);
    const sameSizeDifferentDigest = metadataFrom(files);
    sameSizeDifferentDigest.assets.find((asset) => asset.name === "linux.deb").digest = `sha256:${"0".repeat(64)}`;
    assert.throws(() => checkDraft(sameSizeDifferentDigest, record, replaced), /linux\.deb differs/);
    assert.throws(() => checkDraft(metadataFrom(files, { "extra.bin": "x" }), record, replaced), /extra=\[extra\.bin\]/);
    const missing = metadataFrom(files);
    missing.assets = missing.assets.filter((asset) => asset.name !== "linux.deb.sig");
    assert.throws(() => checkDraft(missing, record, replaced), /missing=\[linux\.deb\.sig\]/);
    const noDigest = metadataFrom(files);
    delete noDigest.assets[0].digest;
    assert.throws(() => checkDraft(noDigest, record, replaced), /did not report a SHA-256 digest/);
    const notUploaded = metadataFrom(files);
    notUploaded.assets[0].state = "starter";
    assert.throws(() => checkDraft(notUploaded, record, replaced), /not uploaded/);
    assert.throws(() => checkDraft(metadataFrom(files), record, ["unknown.bin"]), /not part of the verified draft/);
    assert.throws(() => checkDraft(metadataFrom(files), record, []), /no replaced asset/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check-final requires uploaded assets to equal the local signed bytes and the rest to be unchanged", () => {
  const { directory, files } = fixtureDraft();
  const local = mkdtempSync(join(tmpdir(), "hara-digest-signed-"));
  try {
    const record = JSON.stringify(recordDirectory(directory));
    const signed = { "mac.dmg": "signed dmg\n", "mac.tar.gz": "signed updater\n", "mac.tar.gz.sig": "signed sig\n", "latest.json": "{\"version\":\"signed\"}\n" };
    for (const [name, contents] of Object.entries(signed)) writeFileSync(join(local, name), contents);
    assert.deepEqual(checkFinal(metadataFrom(files, signed), record, local, replaced), { unchanged: 2, replaced: 4 });
    assert.throws(() => checkFinal(metadataFrom(files), record, local, replaced),
      /uploaded mac\.dmg does not match the local signed bytes/, "the old CI bytes must not pass as uploaded");
    assert.throws(() => checkFinal(metadataFrom(files, { ...signed, "mac.tar.gz": "corrupted\n" }), record, local, replaced),
      /uploaded mac\.tar\.gz does not match/);
    assert.throws(() => checkFinal(metadataFrom(files, { ...signed, "linux.deb": "swapped\n" }), record, local, replaced),
      /linux\.deb differs from the verified draft record/);
    rmSync(join(local, "latest.json"));
    assert.throws(() => checkFinal(metadataFrom(files, signed), record, local, replaced), /local signed asset is missing: latest\.json/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  }
});

test("the signer reads only small signature, manifest and provenance files", () => {
  const metadata = { assets: [
    { name: "Hara_1.2.3_amd64.deb", size: 62_000_000 },
    { name: "Hara_1.2.3_amd64.deb.sig", size: 408 },
    { name: "latest.json", size: 5_781 },
    { name: "release-source-provenance.json", size: 462 },
    { name: "Hara_1.2.3_source-packs.zip", size: 28_000_000 },
  ] };
  assert.deepEqual(smallAssets(metadata).assets.map((asset) => asset.name),
    ["Hara_1.2.3_amd64.deb.sig", "latest.json", "release-source-provenance.json"]);
  assert.throws(() => smallAssets({ assets: [{ name: "evil.sig", size: SMALL_ASSET_MAX_BYTES + 1 }] }), /unexpectedly large/);
  assert.throws(() => smallAssets({ assets: [{ name: "Hara.dmg", size: 1 }] }), /no signature\/manifest assets/);
});

test("updater-manifest --digest-bound accepts absent binaries only when the record binds them", () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-digest-bound-"));
  try {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const run = (args, env = {}) => spawnSync(process.execPath, ["scripts/updater-manifest.mjs", ...args], {
      cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
    // Only the provenance file exists locally: without a record the asset set is incomplete.
    writeFileSync(join(directory, "release-source-provenance.json"), "{}\n");
    const bare = run(["validate", directory, `v${version}`]);
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /release asset set mismatch; missing=\[[^\]]*Hara_aarch64\.app\.tar\.gz/);
    const record = JSON.stringify([
      `Hara_${version}_aarch64.dmg`, `Hara_${version}_x64.dmg`, "Hara_aarch64.app.tar.gz", "Hara_x64.app.tar.gz",
      `Hara_${version}_amd64.deb`, `Hara-${version}-1.x86_64.rpm`, `Hara_${version}_x64_en-US.msi`, `Hara_${version}_x64-setup.exe`,
      "Hara_aarch64.app.tar.gz.sig",
    ].map((name) => ({ name, size: 1, sha256: "a".repeat(64) })));
    const bound = run(["validate", directory, `v${version}`, "--digest-bound", "-env"], { HARA_DRAFT_ASSET_DIGESTS: record });
    assert.notEqual(bound.status, 0);
    // Binaries are now satisfied by the record, but signatures must still be local bytes.
    assert.match(bound.stderr, /release asset set mismatch; missing=\[[^\]]*\.sig/);
    assert.doesNotMatch(bound.stderr, /missing=\[[^\]]*Hara_aarch64\.app\.tar\.gz[,\]]/);
    const empty = run(["validate", directory, `v${version}`, "--digest-bound", "-env"], { HARA_DRAFT_ASSET_DIGESTS: "" });
    assert.match(empty.stderr, /--digest-bound record is invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("route selection takes the fastest complete 8 MiB probe at or above the floor", () => {
  const measured = {
    "socks5h://127.0.0.1:1080": { ok: false, bytes: 387_416, seconds: 30, bytesPerSecond: 12_913 },
    "socks5h://127.0.0.1:1081": { ok: true, bytes: PROBE_BYTES, seconds: 6, bytesPerSecond: Math.floor(PROBE_BYTES / 6) },
    "http://127.0.0.1:18888": { ok: true, bytes: PROBE_BYTES, seconds: 3.4, bytesPerSecond: Math.floor(PROBE_BYTES / 3.4) },
  };
  const probe = (proxy) => measured[proxy];
  const candidates = Object.keys(measured);
  assert.equal(selectProxy(candidates, { probe }).chosen, "http://127.0.0.1:18888");
  assert.equal(selectProxy(candidates, { probe, exclude: ["http://127.0.0.1:18888"] }).chosen, "socks5h://127.0.0.1:1081");
  assert.equal(selectProxy(candidates, { probe, floor: 4 * 1024 * 1024 }).chosen, null, "nothing reaches a 4 MiB/s floor");
  assert.equal(selectProxy(["socks5h://127.0.0.1:1080"], { probe }).chosen, null, "an incomplete probe never qualifies");
  assert.equal(selectProxy([...candidates, candidates[1]], { probe }).results.length, 3, "duplicates are probed once");
  assert.throws(() => selectProxy(["http://10.0.0.1:8080"], { probe }), /loopback/);
  assert.throws(() => selectProxy([], { probe }), /no GitHub release proxy candidates/);

  assert.deepEqual(parseProbe(`206 ${PROBE_BYTES} 4.000`, 0), { bytes: PROBE_BYTES, seconds: 4, bytesPerSecond: PROBE_BYTES / 4, ok: true });
  // A timed-out probe is measured over the whole window, never over the bytes' own time.
  assert.deepEqual(parseProbe("206 387416 29.05", 28), { bytes: 387_416, seconds: PROBE_MAX_SECONDS, bytesPerSecond: Math.floor(387_416 / 30), ok: false });
  assert.equal(parseProbe("000 0 0.001", 7).ok, false);
  assert.equal(parseProbe("garbage", 0).ok, false);
  const args = probeArguments("socks5h://127.0.0.1:1081");
  assert.deepEqual(args.slice(args.indexOf("--range"), args.indexOf("--range") + 2), ["--range", "0-8388607"]);
  assert.ok(args.includes("--disable") && args.includes("=https"));
  assert.match(args.at(-1), /^https:\/\/github\.com\/hara-cli\/hara-desktop\/releases\/download\//, "probes read a public asset, never the draft");

  assert.equal(floorFromEnvironment(undefined), DEFAULT_FLOOR_BYTES_PER_SECOND);
  assert.equal(floorFromEnvironment("524288"), 524_288);
  assert.throws(() => floorFromEnvironment("1024"), /at least/);
  assert.throws(() => floorFromEnvironment("fast"), /integer/);
});

test("the merge script stops before any release transfer when no route reaches the floor", { skip: process.platform === "win32" }, () => {
  const sandbox = mkdtempSync(join(tmpdir(), "hara-no-route-"));
  try {
    const bin = join(sandbox, "bin");
    mkdirSync(bin);
    const ghCalls = join(sandbox, "gh-calls");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$@" >> "${ghCalls}"\nexit 0\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const tag = `v${version}`;
    // Closed loopback ports: every probe fails at once, so no route qualifies.
    const result = spawnSync("/bin/bash", ["scripts/release-mac-assets.sh", tag], {
      cwd: root, encoding: "utf8", timeout: 120_000,
      env: {
        PATH: `${bin}:${process.env.PATH}`, HOME: sandbox,
        GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "hara-cli/hara-desktop", GITHUB_EVENT_NAME: "push",
        GITHUB_REF_PROTECTED: "true", GITHUB_RUN_ID: "42", HARA_PROTECTED_SIGNING_JOB: "42",
        HARA_PROMOTION_WORKFLOW_LOCK: "42", HARA_PROMOTION_TAG: tag,
        GITHUB_WORKFLOW_REF: `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/${tag}`,
        GH_TOKEN: "test-token", HARA_DRAFT_ASSET_DIGESTS: "[]",
        HARA_GITHUB_RELEASE_PROXY: "socks5h://127.0.0.1:29",
        HARA_GITHUB_RELEASE_FALLBACK_PROXY: "socks5h://127.0.0.1:27",
        HARA_GITHUB_RELEASE_PROXY_CANDIDATES: "http://127.0.0.1:13 socks5h://127.0.0.1:19",
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no GitHub route reached 1024 KiB\/s; stopping before any release transfer/);
    assert.match(result.stderr, /nothing was transferred/);
    for (const port of [29, 27, 13, 19]) assert.match(result.stderr, new RegExp(`127\\.0\\.0\\.1:${port} .*incomplete`));
    assert.equal(existsSync(ghCalls), false, "gh must never run when no route qualifies");

    const badCandidate = spawnSync("/bin/bash", ["scripts/release-mac-assets.sh", tag], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: sandbox,
        GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "hara-cli/hara-desktop", GITHUB_EVENT_NAME: "push",
        GITHUB_REF_PROTECTED: "true", GITHUB_RUN_ID: "42", HARA_PROTECTED_SIGNING_JOB: "42",
        HARA_PROMOTION_WORKFLOW_LOCK: "42", HARA_PROMOTION_TAG: tag,
        GITHUB_WORKFLOW_REF: `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/${tag}`,
        GH_TOKEN: "test-token", HARA_DRAFT_ASSET_DIGESTS: "[]",
        HARA_GITHUB_RELEASE_PROXY: "socks5h://127.0.0.1:29",
        HARA_GITHUB_RELEASE_PROXY_CANDIDATES: "http://192.168.1.2:8080" },
    });
    assert.equal(badCandidate.status, 1);
    assert.match(badCandidate.stderr, /HARA_GITHUB_RELEASE_PROXY_CANDIDATES entries must be loopback/);

    const noRecord = spawnSync("/bin/bash", ["scripts/release-mac-assets.sh", tag], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: sandbox,
        GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "hara-cli/hara-desktop", GITHUB_EVENT_NAME: "push",
        GITHUB_REF_PROTECTED: "true", GITHUB_RUN_ID: "42", HARA_PROTECTED_SIGNING_JOB: "42",
        HARA_PROMOTION_WORKFLOW_LOCK: "42", HARA_PROMOTION_TAG: tag,
        GITHUB_WORKFLOW_REF: `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/${tag}`,
        GH_TOKEN: "test-token", HARA_GITHUB_RELEASE_PROXY: "socks5h://127.0.0.1:29" },
    });
    assert.equal(noRecord.status, 1);
    assert.match(noRecord.stderr, /verified draft digest record \(HARA_DRAFT_ASSET_DIGESTS\) is missing/);
    assert.equal(existsSync(ghCalls), false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

function fakeCurl(behaviour) {
  const calls = [];
  return {
    calls,
    execute(command, args) {
      calls.push(args);
      const output = args[args.indexOf("--output") + 1];
      const listeners = new Map();
      queueMicrotask(() => listeners.get("close")?.(behaviour(output, calls.length), null));
      return {
        stdin: { on() {}, end() {} },
        once(event, listener) { listeners.set(event, listener); },
        kill() { return true; },
      };
    },
  };
}

test("an interrupted per-asset download resumes from its retained partial and is digest-checked", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hara-resume-"));
  try {
    const bytes = Buffer.from("0123456789".repeat(1000));
    const metadata = { assets: [{
      name: "big.bin", size: bytes.length, digest: `sha256:${sha256(bytes)}`, state: "uploaded",
      apiUrl: "https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/7",
    }] };
    const options = (execute) => ({ execute, token: "t", timeoutMs: 1_000 });
    // Attempt 1: half the bytes, then a stall (curl exit 28).
    const first = fakeCurl((output) => { writeFileSync(output, bytes.subarray(0, 4000)); return 28; });
    await assert.rejects(downloadReleaseAssetsViaApi({ metadata, repository: "hara-cli/hara-desktop", directory }, options(first.execute)), /stopped with exit code 28/);
    const partial = join(directory, ".big.bin.part");
    assert.equal(readFileSync(partial).length, 4000, "the partial is retained under a stable name");
    // The cache keeps an incomplete partial between attempts but drops it once the set is complete.
    reconcileReleaseDownloadCache(directory, metadata);
    assert.equal(existsSync(partial), true);
    // Attempt 2: curl continues at the partial's end (--continue-at -) and appends the rest.
    const second = fakeCurl((output) => { writeFileSync(output, bytes.subarray(readFileSync(output).length), { flag: "a" }); return 0; });
    const result = await downloadReleaseAssetsViaApi({ metadata, repository: "hara-cli/hara-desktop", directory }, options(second.execute));
    assert.deepEqual(result, { expected: 1, retained: 0, downloaded: 1 });
    assert.equal(second.calls[0][second.calls[0].indexOf("--output") + 1], partial);
    assert.deepEqual(second.calls[0].slice(second.calls[0].indexOf("--continue-at"), second.calls[0].indexOf("--continue-at") + 2), ["--continue-at", "-"]);
    assert.ok(readFileSync(join(directory, "big.bin")).equals(bytes));
    reconcileReleaseDownloadCache(directory, metadata, { complete: true });
    assert.equal(existsSync(partial), false);

    // Corrupt full-length partial: never accepted, never overwritten.
    const corruptDirectory = join(directory, "corrupt");
    mkdirSync(corruptDirectory);
    writeFileSync(join(corruptDirectory, ".big.bin.part"), Buffer.alloc(bytes.length + 1));
    await assert.rejects(downloadReleaseAssetsViaApi({ metadata, repository: "hara-cli/hara-desktop", directory: corruptDirectory }, options(second.execute)),
      /longer than the asset; retained for diagnosis/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("transfer deadlines scale with size and stalls are measured, not fixed at 600 s", async () => {
  assert.equal(releaseApiAssetTimeoutMs(0), 600_000);
  assert.equal(releaseApiAssetTimeoutMs(62_761_184), Math.ceil((62_761_184 / 102_400) * 1.5) * 1_000);
  assert.ok(releaseApiAssetTimeoutMs(62_761_184) > 600_000, "a 62 MB package gets more than the old 600 s");
  const args = releaseApiDownloadArguments("https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/1", "/tmp/x.part", 890);
  assert.deepEqual(args.slice(args.indexOf("--max-time"), args.indexOf("--max-time") + 2), ["--max-time", "890"]);
  assert.deepEqual(args.slice(args.indexOf("--speed-limit"), args.indexOf("--speed-limit") + 4), ["--speed-limit", "32768", "--speed-time", "60"]);
  assert.throws(() => releaseApiDownloadArguments("https://api.github.com/repos/hara-cli/hara-desktop/releases/assets/1", "/tmp/x", 0), /deadline is invalid/);

  assert.equal(transferDeadlineSeconds(400), 600);
  assert.equal(transferDeadlineSeconds(46_037_758), Math.ceil((46_037_758 / 102_400) * 1.5));
  assert.throws(() => transferDeadlineSeconds(-1), /non-negative/);
  let killed = false;
  const listeners = new Map();
  const stalled = {
    once(event, listener) { listeners.set(event, listener); },
    kill() { killed = true; queueMicrotask(() => listeners.get("close")?.(null, "SIGKILL")); return true; },
  };
  const status = await runWithDeadline(1, "gh", ["release", "upload"], { execute: () => stalled });
  assert.equal(status, 124);
  assert.equal(killed, true);
  assert.equal(await runWithDeadline(5, "gh", [], { execute: () => {
    const done = new Map();
    queueMicrotask(() => done.get("close")?.(0, null));
    return { once(event, listener) { done.set(event, listener); }, kill() {} };
  } }), 0);
});

test("workflow and verifiers wire the metadata-only merge and the full hosted public download", () => {
  const build = readFileSync(join(root, ".github/workflows/build.yml"), "utf8");
  const prepackage = readFileSync(join(root, ".github/workflows/prepackage.yml"), "utf8");
  const merge = readFileSync(join(root, "scripts/release-mac-assets.sh"), "utf8");
  const edge = readFileSync(join(root, "scripts/verify-public-release-edge.sh"), "utf8");
  const updaters = readFileSync(join(root, "scripts/verify-release-updaters.mjs"), "utf8");

  assert.match(build, /asset_digests: \$\{\{ steps\.verified_draft\.outputs\.asset_digests \}\}/);
  assert.match(build, /id: verified_draft[\s\S]*?release-asset-digests\.mjs record "\$VERIFY_DIR"[\s\S]*?jq -e 'length == 17'[\s\S]*?updater-manifest\.mjs validate "\$VERIFY_DIR"[\s\S]*?echo "asset_digests=\$ASSET_DIGESTS" >> "\$GITHUB_OUTPUT"/);
  assert.match(build, /HARA_DRAFT_ASSET_DIGESTS: \$\{\{ needs\.assemble_draft\.outputs\.asset_digests \}\}/);
  assert.match(build, /sign_and_promote:\n[\s\S]*?needs: \[prepare_release, create_draft, assemble_draft, promotion_preflight\]/);

  // Order inside the merge: route probe → digest check → small reads → local verification → upload → digest check → promotion.
  const at = (needle) => { const index = merge.indexOf(needle); assert.ok(index >= 0, needle); return index; };
  const probe = at('RELEASE_GITHUB_PROXY="$(node scripts/release-proxy-select.mjs');
  const draftCheck = at('release-asset-digests.mjs check-draft "$WORK/draft-assets.json" -env');
  const small = at('release_download_small "$ASSET_DIR"');
  const build_ = at('updater-manifest.mjs build "$ASSET_DIR" "$TAG" "$PUB_DATE" --digest-bound -env');
  const localUpdaters = at('verify-release-updaters.mjs "$ASSET_DIR" Hara_aarch64.app.tar.gz Hara_x64.app.tar.gz');
  const localDmg = at('verify_signed_dmg upload "$ASSET_DIR/Hara_${VER}_x64.dmg"');
  const upload = merge.indexOf("release_upload_signed_assets\n", localDmg);
  const finalCheck = at('release-asset-digests.mjs check-final "$WORK/signed-assets.json" -env "$ASSET_DIR"');
  const latestReadBack = at('cmp -s "$ASSET_DIR/latest.json" "$REMOTE_DIR/latest.json"');
  const publish = at('release_gh release edit "$TAG"');
  assert.ok(probe < draftCheck && draftCheck < small && small < build_ && build_ < localUpdaters &&
    localUpdaters < localDmg && localDmg < upload && upload < finalCheck && finalCheck < latestReadBack && latestReadBack < publish);
  assert.match(merge, /require_source_archive_digest "\$WORK\/draft-assets\.json"/);
  assert.match(merge, /require_source_archive_digest "\$WORK\/signed-assets\.json"/);

  assert.match(edge, /while IFS= read -r asset_name; do\n  \[ -e "\$FULL_DIR\/\$asset_name" \] \|\| download_attested_asset/);
  assert.match(edge, /= "17" \]/);
  assert.match(edge, /node scripts\/updater-manifest\.mjs validate "\$FULL_DIR" "\$TAG"/);
  assert.match(updaters, /unknown updater artifact/);

  assert.match(prepackage, /merge_metadata_path:[\s\S]*?runs-on: ubuntu-22.04[\s\S]*?release-metadata-merge-rehearsal\.mjs "\$WORK" "\$KEY" "\$RELEASE_TAG"[\s\S]*?node --test test\/release-transfer\.test\.mjs/);
});

test("verify-release-updaters refuses an unknown subset name before verifying anything", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-release-updaters.mjs", tmpdir(), "evil.bin"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown updater artifact evil\.bin/);
});
