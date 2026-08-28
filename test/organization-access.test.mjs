import assert from "node:assert/strict";
import test from "node:test";
import {
  companyAccessRecoveryMessage,
  companySpaceNeedsReenrollment,
  unavailableCompanySpaceMessage,
} from "../src/organization-access.ts";

test("expired and invalid company Spaces require re-enrollment", () => {
  assert.equal(companySpaceNeedsReenrollment("expired"), true);
  assert.equal(companySpaceNeedsReenrollment("invalid"), true);
  assert.equal(companySpaceNeedsReenrollment("expiring"), false);
  assert.equal(companySpaceNeedsReenrollment("valid"), false);
});

test("organization HTTP authorization failures become a focused recovery instruction", () => {
  const raw = Object.assign(new Error("organization role sync failed with HTTP 401"), { code: -32603 });
  const zh = companyAccessRecoveryMessage(raw, "zh");
  const en = companyAccessRecoveryMessage(raw, "en");
  assert.match(zh ?? "", /设置 → AI 与模型/);
  assert.match(zh ?? "", /重新接入/);
  assert.doesNotMatch(zh ?? "", /HTTP 401/);
  assert.match(en ?? "", /Re-enroll/);
});

test("unrelated failures remain available to their original error handling", () => {
  assert.equal(companyAccessRecoveryMessage(new Error("connection closed"), "zh"), null);
  assert.match(unavailableCompanySpaceMessage("zh"), /公司授权已失效/);
});
