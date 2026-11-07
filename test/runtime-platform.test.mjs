import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeT } from "../src/i18n.ts";
import { DEFAULT_RUNTIME_PLATFORM, parseRuntimePlatform, platformReasonKey } from "../src/runtime-platform.ts";

// Platform write protection: never imply a sandbox where the Host platform has none.
test("the Core runtime platform field is parsed strictly and never advertises the full tier by accident", () => {
  assert.equal(parseRuntimePlatform(undefined), DEFAULT_RUNTIME_PLATFORM, "an older Core keeps the macOS semantics it shipped with");
  assert.deepEqual(parseRuntimePlatform({ writeProtection: "seatbelt", permissionTiers: ["full-protected", "controlled"] }), DEFAULT_RUNTIME_PLATFORM);
  const none = { writeProtection: "none", permissionTiers: ["controlled"] };
  assert.deepEqual(parseRuntimePlatform(none), none);
  for (const malformed of [null, [], "seatbelt", { writeProtection: "seatbelt", permissionTiers: ["full-protected"] },
    { writeProtection: "seatbelt" }, { writeProtection: "none", permissionTiers: ["full-protected", "controlled"] }, { writeProtection: "other", permissionTiers: ["full-protected", "controlled"] }])
    assert.deepEqual(parseRuntimePlatform(malformed), none, JSON.stringify(malformed));
});

test("platform refusals map to closed i18n keys and unknown reasons stay unmapped", () => {
  assert.equal(platformReasonKey({ platformReason: "permission_tier_unavailable_on_platform" }), "ws.permissions.unavailableHere");
  assert.equal(platformReasonKey({ platformReason: "native_engine_unsupported_on_platform" }), "ws.engine.unsupportedPlatform");
  for (const value of [{ platformReason: "other" }, { platformReason: 1 }, {}, null, "permission_tier_unavailable_on_platform"]) assert.equal(platformReasonKey(value), undefined);
});

test("the no-protection notice and the explicit switch exist in English and Simplified Chinese without leaking the other script", () => {
  const en = makeT("en"), hans = makeT("zh-Hans");
  for (const key of ["ws.permissions.noOsProtection", "ws.permissions.unavailableHere", "ws.permissions.switchControlled", "ws.engine.unsupportedPlatform"]) {
    assert.notEqual(en(key), key, key); assert.notEqual(hans(key), key, key);
    assert.doesNotMatch(en(key), /\p{Script=Han}/u, key);
    assert.match(hans(key), /\p{Script=Han}/u, key);
  }
  assert.match(en("ws.permissions.noOsProtection"), /no system-level write protection/);
  assert.match(hans("ws.permissions.noOsProtection"), /没有系统级写保护/);
});

test("every tier selector offers the full tier only when the platform has it", () => {
  for (const file of ["src/ColleagueRuntimeForm.tsx", "src/WorkspaceRuntimeAccess.tsx", "src/WorkspaceLocalDev.tsx"]) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    const fullOptions = source.match(/<option value="full-protected"/g) ?? [];
    assert.ok(fullOptions.length >= 1, file);
    assert.match(source, /permissionTiers\.includes\("full-protected"\)/, file);
    assert.match(source, /ws\.permissions\.noOsProtection/, file);
  }
});
