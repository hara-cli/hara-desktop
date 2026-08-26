import assert from "node:assert/strict";
import test from "node:test";
import { authenticationPausePresentation } from "../src/auth-recovery.ts";

test("expired administrator auth becomes a renderer-owned resumable pause", () => {
  const presentation = authenticationPausePresentation({
    dependencyKind: "missing_secret",
    capability: "nayi-admin",
    detail: "nayi-admin JWT/refresh token expired and refresh failed; run fan_queue_create after login",
    evidence: ["AUTH EXPIRED: the admin JWT no longer works"],
  });
  assert.deepEqual(presentation, {
    capability: "nayi-admin",
    automaticRefreshFailed: true,
  });
  assert.doesNotMatch(JSON.stringify(presentation), /JWT|refresh token|fan_queue/i);
});

test("ordinary missing secrets do not masquerade as expired login", () => {
  assert.equal(authenticationPausePresentation({
    dependencyKind: "missing_secret",
    capability: "deployment",
    detail: "A deployment credential has not been configured.",
    evidence: ["No API key exists for this target."],
  }), undefined);
});

test("auth wording outside a typed credential or authority dependency is ignored", () => {
  assert.equal(authenticationPausePresentation({
    dependencyKind: "external_state",
    detail: "The external session expired.",
  }), undefined);
});
