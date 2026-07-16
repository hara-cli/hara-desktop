#!/usr/bin/env node
// Validate Apple notarization tickets without turning a single transient CloudKit lookup failure
// into a withheld Desktop release. Only explicit network/service failures are retried; a missing or
// invalid ticket fails immediately, and the final transient attempt always fails closed.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STAPLER_ATTEMPTS = 3;
const STAPLER_TIMEOUT_MS = 120_000;
const TRANSIENT_STAPLER_FAILURE =
  /NSURLErrorDomain|kCFErrorDomainCFNetwork|CloudKit|request timed out|timed out|network connection was lost|could not connect to (?:the )?server|Internet connection appears to be offline|TLS handshake/i;

function errorDetail(error) {
  return [error?.stderr?.toString(), error?.stdout?.toString(), error?.message]
    .filter(Boolean)
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

export function isTransientStaplerFailure(value) {
  return TRANSIENT_STAPLER_FAILURE.test(String(value));
}

export function validateStapledArtifact(input, label = "Apple notarization staple") {
  const path = resolve(input);
  if (!existsSync(path) || (!statSync(path).isFile() && !statSync(path).isDirectory())) {
    throw new Error(`${label} target is missing: ${path}`);
  }

  for (let attempt = 1; attempt <= STAPLER_ATTEMPTS; attempt++) {
    try {
      execFileSync("/usr/bin/xcrun", ["stapler", "validate", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: STAPLER_TIMEOUT_MS,
      });
      return;
    } catch (error) {
      const detail = errorDetail(error);
      if (!isTransientStaplerFailure(detail) || attempt === STAPLER_ATTEMPTS) {
        throw new Error(`${label} failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${detail}`);
      }
      console.warn(
        `  ⚠ ${label}: Apple ticket service had a transient failure (${attempt}/${STAPLER_ATTEMPTS}); retrying`,
      );
      execFileSync("/bin/sleep", [String(attempt * 3)], { stdio: "ignore", timeout: 15_000 });
    }
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , path, label] = process.argv;
  if (!path || process.argv.length > 4) {
    console.error("usage: node scripts/stapler-validate.mjs <path> [label]");
    process.exit(2);
  }
  try {
    validateStapledArtifact(path, label);
    console.log(`✓ ${label || "Apple notarization staple"} validated`);
  } catch (error) {
    console.error(`stapler-validate: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
