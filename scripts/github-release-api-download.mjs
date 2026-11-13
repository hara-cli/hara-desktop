#!/usr/bin/env node

// Download only missing GitHub release assets through the REST asset endpoint after the bulk
// `gh release download` path hits a transient CDN failure. Every completed file is accepted only
// after its size and GitHub-declared SHA-256 match, then copied into place exclusively.
// Existing targets and partial downloads are retained for diagnosis; nothing is deleted.
// 1.2.3: the partial file name is stable per asset, so a retry resumes with an HTTP Range request
// instead of starting over; a transfer is abandoned only after it stalls below 32 KiB/s for 60 s,
// and the hard deadline scales with the asset size.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_API_ASSET_TIMEOUT_MS = 10 * 60_000;
export const RELEASE_API_CURL_MAX_TIME_SECONDS = 570;
export const RELEASE_API_STALL_BYTES_PER_SECOND = 32 * 1024;
export const RELEASE_API_STALL_SECONDS = 60;

// Never less than the historical 10 minutes; otherwise the size at 100 KiB/s with 50% slack.
export function releaseApiAssetTimeoutMs(size, minimumMs = RELEASE_API_ASSET_TIMEOUT_MS) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("release API asset size is invalid");
  return Math.max(minimumMs, Math.ceil((size / (100 * 1024)) * 1.5) * 1_000);
}

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/u;
const SHA256_DIGEST = /^sha256:([a-f0-9]{64})$/u;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireRealDirectory(directory) {
  const root = resolve(directory);
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("release API download destination must be a real directory");
  }
  return root;
}

function fileMatches(path, asset) {
  if (!existsSync(path)) return false;
  const info = lstatSync(path);
  return (
    info.isFile() &&
    !info.isSymbolicLink() &&
    info.nlink === 1 &&
    statSync(path).size === asset.size &&
    sha256File(path) === asset.sha256
  );
}

export function releaseApiAssets(metadata, repository) {
  if (!SAFE_REPOSITORY.test(repository ?? "")) {
    throw new Error("release API download requires an owner/repository name");
  }
  const assets = Array.isArray(metadata) ? metadata : metadata?.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error("release API metadata must contain a non-empty assets array");
  }

  const apiPrefix = `https://api.github.com/repos/${repository}/releases/assets/`;
  const names = new Set();
  const apiUrls = new Set();
  return assets.map((asset) => {
    const name = String(asset?.name ?? "");
    const digest = String(asset?.digest ?? "");
    const apiUrl = String(asset?.apiUrl ?? "");
    const digestMatch = SHA256_DIGEST.exec(digest);
    if (!SAFE_ASSET_NAME.test(name) || basename(name) !== name || name === "." || name === "..") {
      throw new Error(`release API asset name is unsafe: ${JSON.stringify(name)}`);
    }
    if (names.has(name)) throw new Error(`duplicate release API asset metadata: ${name}`);
    if (!Number.isSafeInteger(asset?.size) || asset.size < 0) {
      throw new Error(`release API asset size is invalid: ${name}`);
    }
    if (!digestMatch) throw new Error(`release API asset SHA-256 is missing or invalid: ${name}`);
    if (asset?.state !== "uploaded") {
      throw new Error(`release API asset is not uploaded: ${name}`);
    }
    if (!apiUrl.startsWith(apiPrefix) || !/^\d+$/u.test(apiUrl.slice(apiPrefix.length))) {
      throw new Error(`release API asset URL is outside the expected repository: ${name}`);
    }
    if (apiUrls.has(apiUrl)) throw new Error(`duplicate release API asset endpoint: ${name}`);
    names.add(name);
    apiUrls.add(apiUrl);
    return { name, size: asset.size, sha256: digestMatch[1], apiUrl };
  });
}

export function releaseApiDownloadArguments(apiUrl, outputPath, maxTimeSeconds = RELEASE_API_CURL_MAX_TIME_SECONDS) {
  if (!/^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/assets\/\d+$/u.test(apiUrl ?? "")) {
    throw new Error("release API asset endpoint is invalid");
  }
  if (typeof outputPath !== "string" || !outputPath || outputPath.includes("\0")) {
    throw new Error("release API asset output path is invalid");
  }
  if (!Number.isSafeInteger(maxTimeSeconds) || maxTimeSeconds <= 0) {
    throw new Error("release API asset curl deadline is invalid");
  }
  return [
    "--disable",
    "--http1.1",
    "--proto",
    "=https",
    "--proto-redir",
    "=https",
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "5",
    "--retry-all-errors",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "20",
    "--max-time",
    String(maxTimeSeconds),
    "--speed-limit",
    String(RELEASE_API_STALL_BYTES_PER_SECOND),
    "--speed-time",
    String(RELEASE_API_STALL_SECONDS),
    "--continue-at",
    "-",
    "--output",
    outputPath,
    "--config",
    "-",
    apiUrl,
  ];
}

function curlAuthenticationConfig(token) {
  if (typeof token !== "string" || !token || /[\r\n"\\]/u.test(token)) {
    throw new Error("GH_TOKEN is missing or unsafe for release API download");
  }
  return `header = "Authorization: Bearer ${token}"\nheader = "Accept: application/octet-stream"\n`;
}

function runAssetDownload(asset, root, { execute, timeoutMs: minimumMs, token }) {
  const timeoutMs = releaseApiAssetTimeoutMs(asset.size, minimumMs);
  const target = join(root, asset.name);
  if (fileMatches(target, asset)) return Promise.resolve({ skipped: true });
  // lstat also finds dangling symlinks, which existsSync would treat as missing.
  let missing = false;
  try { lstatSync(target); }
  catch (error) { if (error.code !== "ENOENT") throw error; missing = true; }
  if (!missing) throw new Error(`release API asset target already exists; retained without overwrite: ${asset.name}`);

  // Stable per asset: a later attempt resumes these bytes (curl --continue-at -). A partial that is
  // already longer than GitHub's size can never become valid and is refused rather than truncated.
  const partial = join(root, `.${asset.name}.part`);
  let resumeFrom = 0;
  try {
    const info = lstatSync(partial);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new Error(`release API partial download is not a private regular file: ${asset.name}`);
    }
    if (info.size > asset.size) {
      throw new Error(`release API partial download is longer than the asset; retained for diagnosis: ${asset.name}`);
    }
    resumeFrom = info.size;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    closeSync(openSync(partial, "wx", 0o600));
  }
  if (resumeFrom > 0) console.log(`release-api-download: resuming ${asset.name} at byte ${resumeFrom}`);
  const curlEnvironment = { ...process.env };
  delete curlEnvironment.GH_TOKEN;
  delete curlEnvironment.GITHUB_TOKEN;
  curlEnvironment.NO_PROXY = "";
  curlEnvironment.no_proxy = "";
  const curlMaxTime = Math.max(1, Math.floor(timeoutMs / 1_000) - 30);
  const child = execute("/usr/bin/curl", releaseApiDownloadArguments(asset.apiUrl, partial, curlMaxTime), {
    env: curlEnvironment,
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.stdin?.on?.("error", () => {});
  child.stdin?.end(curlAuthenticationConfig(token));

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.once("error", (error) =>
      finish(() => {
        rejectPromise(error);
      }),
    );
    child.once("close", (code, signal) =>
      finish(() => {
        if (timedOut) {
          rejectPromise(new Error(`i/o timeout: release API asset ${asset.name} exceeded ${timeoutMs / 1_000} seconds`));
          return;
        }
        if (code !== 0) {
          rejectPromise(
            new Error(
              `release API asset ${asset.name} stopped ${signal ? `by ${signal}` : `with exit code ${code ?? "unknown"}`}`,
            ),
          );
          return;
        }
        try {
          if (!fileMatches(partial, asset)) {
            throw new Error(`release API asset digest mismatch: ${asset.name}`);
          }
          // COPYFILE_EXCL refuses a target created while the request was in flight.
          // Keep the verified partial too, including when publication fails.
          copyFileSync(partial, target, constants.COPYFILE_EXCL);
          if (!fileMatches(target, asset)) throw new Error(`release API asset published digest mismatch: ${asset.name}`);
          resolvePromise({ skipped: false });
        } catch (error) {
          rejectPromise(error);
        }
      }),
    );
  });
}

export async function downloadReleaseAssetsViaApi(
  { metadata, repository, directory },
  { execute = spawn, timeoutMs = RELEASE_API_ASSET_TIMEOUT_MS, token = process.env.GH_TOKEN } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("release API asset timeout must be a positive integer");
  }
  const root = requireRealDirectory(directory);
  const assets = releaseApiAssets(metadata, repository);
  curlAuthenticationConfig(token);
  let retained = 0;
  let downloaded = 0;
  for (const asset of assets) {
    const result = await runAssetDownload(asset, root, { execute, timeoutMs, token });
    if (result.skipped) retained += 1;
    else {
      downloaded += 1;
      console.log(`release-api-download: verified ${asset.name}`);
    }
  }
  return { expected: assets.length, retained, downloaded };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , repository, metadataPath, directory] = process.argv;
  if (!repository || !metadataPath || !directory || process.argv.length !== 5) {
    console.error(
      "usage: node scripts/github-release-api-download.mjs <owner/repository> <assets.json> <directory>",
    );
    process.exitCode = 2;
  } else {
    try {
      if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required for release API downloads");
      const metadata = JSON.parse(readFileSync(resolve(metadataPath), "utf8"));
      const result = await downloadReleaseAssetsViaApi({ metadata, repository, directory });
      console.log(
        `release-api-download: retained ${result.retained}, downloaded ${result.downloaded}, expected ${result.expected}`,
      );
    } catch (error) {
      console.error(`release-api-download: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
