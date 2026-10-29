import test from "node:test";
import assert from "node:assert/strict";
import { readColleagueUsage } from "../src/agent-runtime-usage.ts";

const now = Date.parse("2026-10-29T12:00:00Z");
const colleague = (runtimeId) => ({ ref: "global:writer", spaceId: "personal",
  runtime: { version: 1, spaceId: "personal", agentRef: "global:writer", runtimeId, revision: 1 } });
const account = (runtimeId, connectionId) => ({ spaceId: "personal", agentRef: "global:writer", runtimeId, connectionId });
const window = (runtimeId, connectionId, availability, scope) => ({ runtimeId, connectionId, availability, scope,
  authority: "native-account-window", fetchedAt: "2026-10-29T11:59:00Z", validUntil: "2026-10-29T12:05:00Z" });

test("Desktop reads the bound runtime account, not a shared provider balance", () => {
  const windows = [window("pi", "same-vendor-a", "exhausted", "hara-pi"),
    window("pi", "same-vendor-b", "available", "hara-pi"),
    window("codex", "same-vendor-a", "available", "external-runtime")];
  assert.equal(readColleagueUsage(colleague("pi"), account("pi", "same-vendor-a"), windows, now).availability, "exhausted");
  assert.equal(readColleagueUsage(colleague("pi"), account("pi", "same-vendor-b"), windows, now).availability, "available");
  assert.equal(readColleagueUsage(colleague("codex"), account("codex", "same-vendor-a"), windows, now).availability, "available");
  const reverse = [window("pi", "same-vendor-a", "available", "hara-pi"),
    window("codex", "same-vendor-a", "exhausted", "external-runtime")];
  assert.equal(readColleagueUsage(colleague("pi"), account("pi", "same-vendor-a"), reverse, now).availability, "available");
  assert.equal(readColleagueUsage(colleague("codex"), account("codex", "same-vendor-a"), reverse, now).availability, "exhausted");
});

test("missing, stale, cross-role and ambiguous windows remain unknown", () => {
  const valid = window("claude", "account-c", "available", "external-runtime");
  for (const [link, windows] of [
    [undefined, [valid]],
    [{ ...account("claude", "account-c"), agentRef: "global:other" }, [valid]],
    [account("claude", "account-c"), [{ ...valid, validUntil: "2026-10-29T11:59:59Z" }]],
    [account("claude", "account-c"), [{ ...valid, scope: "hara-pi" }]],
    [account("claude", "account-c"), [valid, valid]],
  ]) {
    const view = readColleagueUsage(colleague("claude"), link, windows, now);
    assert.equal(view.availability, "unknown"); assert.equal(view.fresh, false);
  }
});

test("the read model does not invent scheduler-wide credits", () => {
  const view = readColleagueUsage(colleague("opencode"), account("opencode", "account-d"),
    [window("opencode", "account-d", "available", "external-runtime")], now);
  assert.deepEqual(Object.keys(view).sort(), ["authority", "availability", "connectionId", "fetchedAt", "fresh", "resetAt", "runtimeId", "scope"]);
});
