#!/usr/bin/env node
// Resolve a stable remote tag without letting a stalled or reset Git transport consume an entire
// signing run. Reads are bounded and retried; malformed, missing, or conflicting refs still fail
// closed. The caller receives only the verified commit on stdout.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REMOTE_TAG_ATTEMPTS = 3;
const REMOTE_TAG_TIMEOUT_MS = 45_000;

function wait(milliseconds) {
  execFileSync("/bin/sleep", [String(milliseconds / 1000)], {
    stdio: "ignore",
    timeout: milliseconds + 2_000,
  });
}

export function parseRemoteTagRefs(value, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`expected a stable vX.Y.Z tag, received ${JSON.stringify(tag)}`);
  }

  const directRef = `refs/tags/${tag}`;
  const peeledRef = `${directRef}^{}`;
  let directCommit = "";
  let peeledCommit = "";

  for (const line of String(value).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
    if (!match) throw new Error("remote returned a malformed tag ref");
    const [, commit, ref] = match;
    if (ref === directRef) {
      if (directCommit && directCommit !== commit) throw new Error("remote returned conflicting direct refs");
      directCommit = commit;
    } else if (ref === peeledRef) {
      if (peeledCommit && peeledCommit !== commit) throw new Error("remote returned conflicting peeled refs");
      peeledCommit = commit;
    } else {
      throw new Error("remote returned an unexpected tag ref");
    }
  }

  const commit = peeledCommit || directCommit;
  if (!commit) throw new Error(`remote tag ${tag} is missing`);
  return commit;
}

export function resolveRemoteTagCommit(
  repository,
  remote,
  tag,
  {
    attempts = REMOTE_TAG_ATTEMPTS,
    timeoutMs = REMOTE_TAG_TIMEOUT_MS,
    execute = execFileSync,
    sleep = wait,
  } = {},
) {
  if (!repository || typeof repository !== "string") throw new Error("repository directory is required");
  if (!/^[A-Za-z0-9._/-]+$/.test(remote) || remote.startsWith("-")) {
    throw new Error("remote name is invalid");
  }
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > REMOTE_TAG_ATTEMPTS) {
    throw new Error(`attempts must be between 1 and ${REMOTE_TAG_ATTEMPTS}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > REMOTE_TAG_TIMEOUT_MS) {
    throw new Error(`timeout must be between 1 and ${REMOTE_TAG_TIMEOUT_MS}ms`);
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const output = execute(
        "git",
        [
          "-c",
          "http.version=HTTP/1.1",
          "-c",
          "http.lowSpeedLimit=1024",
          "-c",
          "http.lowSpeedTime=20",
          "-C",
          repository,
          "ls-remote",
          "--tags",
          remote,
          `refs/tags/${tag}`,
          `refs/tags/${tag}^{}`,
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        },
      );
      return parseRemoteTagRefs(output, tag);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.error(
        `warning: remote tag read failed (${attempt}/${attempts}); retrying after a bounded delay`,
      );
      sleep(attempt * 1_000);
    }
  }

  throw new Error(
    `could not resolve remote tag ${tag} after ${attempts} attempts`,
    lastError ? { cause: lastError } : undefined,
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , repository, remote, tag] = process.argv;
  if (!repository || !remote || !tag || process.argv.length !== 5) {
    console.error("usage: node scripts/resolve-remote-tag.mjs <repository> <remote> <vX.Y.Z>");
    process.exit(2);
  }
  try {
    console.log(resolveRemoteTagCommit(repository, remote, tag));
  } catch (error) {
    console.error(`resolve-remote-tag: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
