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
  withBinary(`prefix\0${configuredUpdaterEndpoints.join("\0middle\0")}\0suffix`, (binary) => {
    const offsets = smokeUpdaterEndpoints({ binary, log: () => {} });
    assert.equal(offsets.length, configuredUpdaterEndpoints.length);
    assert.ok(offsets[0] < offsets[1]);
  });
});

test("rejects a desktop executable missing the first-party endpoint", () => {
  withBinary(`prefix\0${configuredUpdaterEndpoints[1]}\0suffix`, (binary) => {
    assert.throws(
      () => smokeUpdaterEndpoints({ binary, log: () => {} }),
      /does not embed configured updater endpoint/,
    );
  });
});

test("rejects configured endpoints embedded in fallback-first order", () => {
  withBinary([...configuredUpdaterEndpoints].reverse().join("\0"), (binary) => {
    assert.throws(
      () => smokeUpdaterEndpoints({ binary, log: () => {} }),
      /out of configured order/,
    );
  });
});

test("rejects the deprecated updater path even when configured endpoints are present", () => {
  withBinary(
    `${configuredUpdaterEndpoints.join("\0")}\0${deprecatedUpdaterEndpoint}`,
    (binary) => {
      assert.throws(
        () => smokeUpdaterEndpoints({ binary, log: () => {} }),
        /embeds deprecated updater endpoint/,
      );
    },
  );
});
