import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeT } from "../src/i18n.ts";
import { DEFAULT_RUNTIME_PLATFORM, parseRuntimePlatform } from "../src/runtime-platform.ts";
import { WorkspacePublicRpcError, workspaceErrorState } from "../src/core-i18n.ts";

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

test("platform refusals render through their closed Core public codes in English and Simplified Chinese", () => {
  for (const code of ["permission_tier_unavailable_on_platform", "native_engine_unsupported_on_platform"]) {
    const data = { code, params: {}, technicalDetail: "fixture detail" };
    const en = new WorkspacePublicRpcError(-32602, data, "legacy", "en"), hans = new WorkspacePublicRpcError(-32602, data, "legacy", "zh-Hans");
    assert.equal(en.publicCode, code); assert.equal(en.messageKey, "core.error." + code);
    assert.deepEqual(workspaceErrorState(en), { error: "core.error." + code, errorTechnicalDetail: "fixture detail" });
    assert.doesNotMatch(en.message, /[\u3400-\u9fff]/u, "English copy has no Chinese");
    assert.match(hans.message, /[\u3400-\u9fff]/u);
    assert.doesNotMatch(hans.message.replace(/macOS|Pi/gu, ""), /[A-Za-z]{4,}/u, "Simplified Chinese copy has no English leftovers");
  }
  for (const data of [{ code: "other", params: {} }, { platformReason: "permission_tier_unavailable_on_platform" }, {}, null])
    assert.equal(new WorkspacePublicRpcError(-32602, data, "legacy", "en").publicCode, "request_failed", JSON.stringify(data));
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
