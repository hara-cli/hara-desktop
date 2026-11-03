import test from "node:test";
import assert from "node:assert/strict";
import { runtimeEffortVisible, manualRuntimeInstallUrl, HOST_LOGIN_ONLY_RUNTIMES } from "../src/runtime-expansion.ts";
import { agentRuntimeLabel } from "../src/agent-runtime-selection.ts";
import { parseRuntimeFailure, runtimeLoginCommand } from "../src/runtime-failure.ts";
import { knownRuntimeVersionId } from "../src/runtime-version-drift.ts";
import { makeT } from "../src/i18n.ts";

for (const id of ["copilot", "cursor", "grok"]) test(id + " has a safe guide, proper label, host-only binding and diagnostic identity", () => {
  assert.ok(manualRuntimeInstallUrl(id).startsWith("https://"));
  assert.ok(HOST_LOGIN_ONLY_RUNTIMES.includes(id)); assert.ok(agentRuntimeLabel(id, "en"));
  assert.equal(runtimeEffortVisible(id, []), false); assert.equal(runtimeLoginCommand(id), "");
  assert.equal(knownRuntimeVersionId(id), true);
  const data = { runtime: id, version: "1.2.3", loginSource: "host", homeMatchesAccount: true,
    kind: "runtime_network", elapsedMs: 1, retryAtMs: 0, consecutiveFailures: 1 };
  assert.equal(parseRuntimeFailure("hara_runtime_failure_v1=" + JSON.stringify(data), id)?.runtime, id);
  assert.equal(parseRuntimeFailure("hara_runtime_failure_v1=" + JSON.stringify(data), "codex"), null);
});
test("guide destinations cannot be supplied by the Core, a path or a model string", () => {
  for (const input of ["https://evil.invalid", "__proto__", "../grok", "unknown"]) assert.equal(manualRuntimeInstallUrl(input), null);
});
test("effort is displayed for new runtimes only when the CLI advertised levels", () => {
  assert.equal(runtimeEffortVisible("copilot", ["low", "high"]), true);
  assert.equal(runtimeEffortVisible("cursor"), false); assert.equal(runtimeEffortVisible("grok"), false);
  assert.equal(runtimeEffortVisible("opencode", ["high"]), false);
});
test("installation, host login and live model provenance exist in all three locales", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const key of ["ws.runtimeExpansion.manualInstall", "ws.runtimeExpansion.instructions", "ws.runtimeExpansion.hostLogin", "ws.runtimeExpansion.modelsLive", "ws.runtimeExpansion.isolationPending"]) {
      assert.notEqual(t(key), key); assert.ok(t(key).length > 0);
    }
  }
});
