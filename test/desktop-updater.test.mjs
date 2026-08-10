import assert from "node:assert/strict";
import test from "node:test";
import {
  DesktopUpdaterArchitectureError,
  assertMacUpdaterManifestTarget,
  desktopUpdaterErrorText,
} from "../src/desktop-updater.ts";

const manifest = {
  platforms: {
    "darwin-x86_64": { url: "https://releases.example/Hara_x64.app.tar.gz", signature: "x" },
    "darwin-aarch64": { url: "https://releases.example/Hara_aarch64.app.tar.gz", signature: "a" },
  },
};

test("macOS updater accepts only the archive mapped to the running architecture", () => {
  assert.doesNotThrow(() => assertMacUpdaterManifestTarget(manifest, "darwin-x86_64"));
  assert.doesNotThrow(() => assertMacUpdaterManifestTarget(manifest, "darwin-aarch64"));

  const swapped = structuredClone(manifest);
  swapped.platforms["darwin-x86_64"].url = manifest.platforms["darwin-aarch64"].url;
  assert.throws(
    () => assertMacUpdaterManifestTarget(swapped, "darwin-x86_64"),
    DesktopUpdaterArchitectureError,
  );
});

test("missing or ambiguous macOS updater metadata fails closed with localized copy", () => {
  assert.throws(
    () => assertMacUpdaterManifestTarget({ platforms: {} }, "darwin-x86_64"),
    DesktopUpdaterArchitectureError,
  );
  const message = desktopUpdaterErrorText("zh", new DesktopUpdaterArchitectureError());
  assert.match(message, /本机架构不一致/);
  assert.doesNotMatch(message, /architecture mismatch/);
});
