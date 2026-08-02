#!/usr/bin/env node
// Execute the desktop binary users actually receive and verify the Tauri updater configuration it
// reconstructs at runtime. Raw byte searches are not architecture-safe: linkers may split or
// transform string data while the generated runtime value remains intact.
import { spawnSync } from "node:child_process";
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
const updaterEndpointSmokeArg = "--hara-release-updater-endpoint-smoke";
const SMOKE_TIMEOUT_MS = 30_000;

function executeEndpointSmoke(binary, label) {
  const result = spawnSync(binary, [updaterEndpointSmokeArg], {
    encoding: "utf8",
    timeout: SMOKE_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr, result.stdout]
      .filter(Boolean)
      .join(" ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 800);
    throw new Error(`${label} updater endpoint self-test failed: ${detail || `exit status ${result.status ?? "unknown"}`}`);
  }
  return result.stdout.trim();
}

export function smokeUpdaterEndpoints({
  binary,
  label = "desktop executable",
  endpoints = configuredUpdaterEndpoints,
  execute = executeEndpointSmoke,
  log = console.log,
}) {
  const executable = resolve(binary);
  if (!existsSync(executable) || !statSync(executable).isFile() || statSync(executable).size === 0) {
    throw new Error(`${label} is missing or empty: ${executable}`);
  }
  if (!Array.isArray(endpoints) || endpoints.length < 2 || endpoints.some((value) => !value)) {
    throw new Error("updater endpoint smoke requires at least two configured endpoints");
  }

  let actual;
  try {
    actual = JSON.parse(execute(executable, label));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label} updater endpoint self-test did not return valid JSON`);
    }
    throw error;
  }
  if (!Array.isArray(actual) || actual.some((endpoint) => typeof endpoint !== "string")) {
    throw new Error(`${label} updater endpoint self-test must return a string array`);
  }
  if (!endpoints.includes(deprecatedUpdaterEndpoint) && actual.includes(deprecatedUpdaterEndpoint)) {
    throw new Error(`${label} reports deprecated updater endpoint: ${deprecatedUpdaterEndpoint}`);
  }
  if (actual.length !== endpoints.length) {
    throw new Error(`${label} reports ${actual.length} updater endpoints; expected ${endpoints.length}`);
  }
  for (let index = 0; index < endpoints.length; index++) {
    if (actual[index] !== endpoints[index]) {
      throw new Error(`${label} updater endpoint mismatch at index ${index}`);
    }
  }

  log(`  ✓ ${label} reports ${endpoints.length} configured updater endpoints in order`);
  return actual;
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
