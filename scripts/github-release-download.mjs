#!/usr/bin/env node
// Run `gh release download` behind a hard process deadline. GitHub's release CDN can leave a TCP
// connection established without delivering more bytes; the gh CLI otherwise waits indefinitely.
// The caller retains only digest-verified completed assets before retrying.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}$/;

export function releaseDownloadArguments(tag, repository, directory, extraArguments = []) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
    throw new Error("release download requires a stable vX.Y.Z tag");
  }
  if (!SAFE_REPOSITORY.test(repository ?? "")) {
    throw new Error("release download requires an owner/repository name");
  }
  if (typeof directory !== "string" || !directory.trim() || directory.includes("\0")) {
    throw new Error("release download requires a destination directory");
  }

  const allowedExtraArguments =
    extraArguments.length === 0 ||
    (extraArguments.length === 1 && extraArguments[0] === "--skip-existing") ||
    (extraArguments.length === 2 &&
      extraArguments[0] === "--pattern" &&
      SAFE_ASSET_NAME.test(extraArguments[1] ?? ""));
  if (!allowedExtraArguments) {
    throw new Error("release download received unsupported options");
  }

  return [
    "release",
    "download",
    tag,
    "-R",
    repository,
    "--dir",
    resolve(directory),
    ...extraArguments,
  ];
}

export function runBoundedReleaseDownload(
  { tag, repository, directory, extraArguments = [] },
  { execute = spawn, timeoutMs = RELEASE_DOWNLOAD_TIMEOUT_MS } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("release download timeout must be a positive integer");
  }
  const arguments_ = releaseDownloadArguments(tag, repository, directory, extraArguments);

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timedOut = false;
    const child = execute("gh", arguments_, {
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: "true",
        NO_PROXY: "",
        no_proxy: "",
      },
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const settle = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.once("error", (error) => settle(() => rejectPromise(error)));
    child.once("close", (code, signal) =>
      settle(() => resolvePromise({ code, signal, timedOut })),
    );
  });
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [tag, repository, directory, ...extraArguments] = process.argv.slice(2);
  try {
    const result = await runBoundedReleaseDownload({
      tag,
      repository,
      directory,
      extraArguments,
    });
    if (result.timedOut) {
      console.error(
        `i/o timeout: gh release download exceeded ${RELEASE_DOWNLOAD_TIMEOUT_MS / 1_000} seconds`,
      );
      process.exitCode = 124;
    } else if (result.code !== 0) {
      if (result.signal) console.error(`gh release download stopped by ${result.signal}`);
      process.exitCode = Number.isInteger(result.code) ? result.code : 1;
    }
  } catch (error) {
    console.error(
      `GitHub release download: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  }
}
