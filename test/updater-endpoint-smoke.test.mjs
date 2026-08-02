import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configuredUpdaterEndpoints,
  smokeUpdaterEndpoints,
} from "../scripts/updater-endpoint-smoke.mjs";

const deprecatedUpdaterEndpoint =
  "https://assets.nanhara.com/hara-desktop/releases/latest.json";

function withBinary(contents, verify) {
  const directory = mkdtempSync(join(tmpdir(), "hara-updater-endpoint-smoke-"));
  const binary = join(directory, "hara-desktop");
  try {
    writeFileSync(binary, contents);
    return verify(binary);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts every configured updater endpoint in configured order", () => {
  withBinary("fixture", (binary) => {
    const actual = smokeUpdaterEndpoints({
      binary,
      execute: () => JSON.stringify(configuredUpdaterEndpoints),
      log: () => {},
    });
    assert.deepEqual(actual, configuredUpdaterEndpoints);
  });
});

test("rejects a desktop executable missing the first-party endpoint", () => {
  withBinary("fixture", (binary) => {
    assert.throws(
      () =>
        smokeUpdaterEndpoints({
          binary,
          execute: () => JSON.stringify([configuredUpdaterEndpoints[1]]),
          log: () => {},
        }),
      /reports 1 updater endpoints; expected 2/,
    );
  });
});

test("rejects configured endpoints reported in fallback-first order", () => {
  withBinary("fixture", (binary) => {
    assert.throws(
      () =>
        smokeUpdaterEndpoints({
          binary,
          execute: () => JSON.stringify([...configuredUpdaterEndpoints].reverse()),
          log: () => {},
        }),
      /updater endpoint mismatch at index 0/,
    );
  });
});

test("rejects the deprecated updater path even when configured endpoints are present", () => {
  withBinary("fixture", (binary) => {
    assert.throws(
      () =>
        smokeUpdaterEndpoints({
          binary,
          execute: () => JSON.stringify([...configuredUpdaterEndpoints, deprecatedUpdaterEndpoint]),
          log: () => {},
        }),
      /reports deprecated updater endpoint/,
    );
  });
});
