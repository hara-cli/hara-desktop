#!/usr/bin/env node
// Verify the updater endpoints embedded in the desktop executable users actually receive. Source
// configuration alone is not release evidence: persistent Cargo build-script output can survive a
// clean checkout and produce an architecture-specific binary with stale generated configuration.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tauri = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

export const configuredUpdaterEndpoints = Object.freeze([
  ...(tauri.plugins?.updater?.endpoints ?? []),
]);

const deprecatedUpdaterEndpoint =
  "https://assets.nanhara.com/hara-desktop/releases/latest.json";

export function smokeUpdaterEndpoints({
  binary,
  label = "desktop executable",
  endpoints = configuredUpdaterEndpoints,
  log = console.log,
}) {
  const executable = resolve(binary);
  if (!existsSync(executable) || !statSync(executable).isFile() || statSync(executable).size === 0) {
    throw new Error(`${label} is missing or empty: ${executable}`);
  }
  if (!Array.isArray(endpoints) || endpoints.length < 2 || endpoints.some((value) => !value)) {
    throw new Error("updater endpoint smoke requires at least two configured endpoints");
  }

  const bytes = readFileSync(executable);
  const offsets = [];
  for (const endpoint of endpoints) {
    const offset = bytes.indexOf(Buffer.from(endpoint, "utf8"));
    if (offset < 0) {
      throw new Error(`${label} does not embed configured updater endpoint: ${endpoint}`);
    }
    offsets.push(offset);
  }
  for (let index = 1; index < offsets.length; index++) {
    if (offsets[index] <= offsets[index - 1]) {
      throw new Error(`${label} embeds updater endpoints out of configured order`);
    }
  }
  if (
    !endpoints.includes(deprecatedUpdaterEndpoint) &&
    bytes.includes(Buffer.from(deprecatedUpdaterEndpoint, "utf8"))
  ) {
    throw new Error(`${label} embeds deprecated updater endpoint: ${deprecatedUpdaterEndpoint}`);
  }

  log(`  ✓ ${label} embeds ${endpoints.length} configured updater endpoints in order`);
  return offsets;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , binary, label] = process.argv;
  if (!binary) {
    console.error("usage: node scripts/updater-endpoint-smoke.mjs <desktop-executable> [label]");
    process.exit(2);
  }
  try {
    smokeUpdaterEndpoints({ binary, label });
  } catch (error) {
    console.error(`updater-endpoint-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
