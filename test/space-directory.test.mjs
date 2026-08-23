import test from "node:test";
import assert from "node:assert/strict";
import { organizationConnectionSpaceId, sessionSpaceId } from "../src/space-directory.ts";

const session = (overrides = {}) => ({
  id: "session-a",
  title: "Conversation",
  cwd: "/workspace",
  model: "model-a",
  updatedAt: "2026-08-23T00:00:00.000Z",
  ...overrides,
});

const directory = {
  activeId: "personal",
  activeProfileId: "personal",
  activeSource: "default",
  switchLocked: false,
  spaces: [
    { id: "personal", name: "Personal", kind: "personal", profileId: "personal", profileIds: ["personal", "token-plan"], active: true, authoritative: true, agentProfilePermission: "edit" },
    { id: "org:tenant-a", name: "Company A", kind: "organization", profileId: "company-a", profileIds: ["company-a", "company-a-backup"], active: false, authoritative: true, agentProfilePermission: "view" },
  ],
};

test("session Space routing preserves durable ownership and maps known legacy company profiles", () => {
  assert.equal(sessionSpaceId(session({ spaceId: "org:tenant-a", profileId: "renamed-route" }), directory), "org:tenant-a");
  assert.equal(sessionSpaceId(session({ profileId: "company-a" }), directory), "org:tenant-a");
  assert.equal(sessionSpaceId(session({ profileId: "company-a-backup" }), directory), "org:tenant-a");
  assert.equal(sessionSpaceId(session({ profileId: "personal" }), directory), "personal");
  assert.equal(sessionSpaceId(session({ profileId: "token-plan" }), directory), "personal");
  assert.equal(sessionSpaceId(session(), directory), "unbound");
});

test("a removed legacy company route never falls into Personal history", () => {
  assert.equal(sessionSpaceId(session({ profileId: "removed-company" }), directory), "org-profile:removed-company");
  assert.equal(sessionSpaceId(session({ profileId: "removed-company" }), null), "org-profile:removed-company");
});

test("organization connection routes collapse onto their authoritative tenant Space", () => {
  assert.equal(organizationConnectionSpaceId({ id: "company-a", tenantId: "tenant-a" }), "org:tenant-a");
  assert.equal(organizationConnectionSpaceId({ id: "legacy-company" }), "org-profile:legacy-company");
  assert.equal(
    organizationConnectionSpaceId({ id: "legacy-company", spaceId: "org-enrollment:0123456789abcdef0123456789abcdef" }),
    "org-enrollment:0123456789abcdef0123456789abcdef",
  );
});
