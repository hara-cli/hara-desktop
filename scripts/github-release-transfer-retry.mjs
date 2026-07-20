#!/usr/bin/env node
// Classify the narrow GitHub transport failures that are safe to retry while a release remains a
// hidden draft. Authentication, authorization, missing-release, and asset-integrity failures are
// deliberately terminal.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const TERMINAL_GITHUB_FAILURE =
  /\b(?:401|403|404)\b|unauthorized|forbidden|authentication|permission denied|resource not accessible|release not found|no such release/i;
const TRANSIENT_GITHUB_TRANSFER_FAILURE =
  /connection reset(?: by peer)?|unexpected EOF|\bread tcp\b|\bwrite tcp\b|TLS handshake timeout|i\/o timeout|context deadline exceeded|net\/http: request canceled|server closed idle connection|connection (?:refused|timed out)|network is unreachable|temporary failure in name resolution|could not resolve host|HTTP (?:500|502|503|504)\b|(?:500|502|503|504) (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i;

export function isTransientGitHubReleaseTransferFailure(value) {
  const text = String(value ?? "");
  if (TERMINAL_GITHUB_FAILURE.test(text)) return false;
  return TRANSIENT_GITHUB_TRANSFER_FAILURE.test(text);
}

function readBoundedLog(input) {
  const path = resolve(input);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error("GitHub release transfer log is missing or is not a regular file");
  }
  if (statSync(path).size > MAX_LOG_BYTES) {
    throw new Error(`GitHub release transfer log exceeds ${MAX_LOG_BYTES} bytes`);
  }
  return readFileSync(path, "utf8");
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , logPath] = process.argv;
  if (!logPath || process.argv.length !== 3) {
    console.error("usage: node scripts/github-release-transfer-retry.mjs <gh-transfer-log>");
    process.exit(2);
  }
  try {
    process.exit(isTransientGitHubReleaseTransferFailure(readBoundedLog(logPath)) ? 0 : 1);
  } catch (error) {
    console.error(
      `GitHub release transfer classifier: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
}
