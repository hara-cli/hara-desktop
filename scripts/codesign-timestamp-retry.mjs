#!/usr/bin/env node
// Classify the narrow Apple codesign timestamp failures that are safe to retry. A retry still performs
// the complete Tauri bundle/sign pass and must produce a trusted timestamp; this helper never permits an
// unsigned or timestamp-free fallback.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_LOG_BYTES = 8 * 1024 * 1024;
const EXPLICIT_TIMESTAMP_TRANSIENT =
  /A timestamp was expected but was not found|timestamp(?:ing)? (?:service|server).{0,120}(?:not available|unavailable|temporarily unavailable|timed out|timeout|could not connect|connection (?:failed|reset|lost))/is;
const NETWORK_TRANSIENT =
  /NSURLErrorDomain|kCFErrorDomainCFNetwork|network connection was lost|Internet connection appears to be offline|TLS handshake|request timed out|could not connect to (?:the )?server/i;

export function isTransientCodesignTimestampFailure(value) {
  const text = String(value ?? "");
  if (EXPLICIT_TIMESTAMP_TRANSIENT.test(text)) return true;
  if (!/timestamp/i.test(text)) return false;
  return NETWORK_TRANSIENT.test(text);
}

function readBoundedLog(input) {
  const path = resolve(input);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error("codesign build log is missing or is not a regular file");
  }
  if (statSync(path).size > MAX_LOG_BYTES) {
    throw new Error(`codesign build log exceeds ${MAX_LOG_BYTES} bytes`);
  }
  return readFileSync(path, "utf8");
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , logPath] = process.argv;
  if (!logPath || process.argv.length !== 3) {
    console.error("usage: node scripts/codesign-timestamp-retry.mjs <tauri-build-log>");
    process.exit(2);
  }
  try {
    process.exit(isTransientCodesignTimestampFailure(readBoundedLog(logPath)) ? 0 : 1);
  } catch (error) {
    console.error(`codesign timestamp classifier: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
