import assert from "node:assert/strict";
import test from "node:test";

import {
  isAssistantWorkspace,
  sessionActivationAllowed,
  sessionBelongsToInteractivePlace,
  sessionPlace,
} from "../src/session-place.ts";

test("session placement keeps conversations, project work, and automations isolated", () => {
  assert.equal(isAssistantWorkspace("/Users/alice/.hara/workspace"), true);
  assert.equal(isAssistantWorkspace("C:\\Users\\Alice\\.hara\\workspace"), true);
  assert.equal(sessionPlace({ cwd: "/Users/alice/.hara/workspace", source: "desktop" }), "chat");
  assert.equal(sessionPlace({ cwd: "/Users/alice/reports", source: "desktop" }), "projects");
  assert.equal(sessionPlace({ cwd: "/Users/alice/reports", source: "gateway" }), "chat");
  assert.equal(sessionPlace({ cwd: "/Users/alice/.hara/workspace", source: "cron" }), "auto");
});

test("late session results cannot become active in a different place", () => {
  const assistant = { cwd: "/Users/alice/.hara/workspace", source: "desktop" };
  const project = { cwd: "/Users/alice/reports", source: "desktop" };

  assert.equal(sessionBelongsToInteractivePlace("chat", assistant), true);
  assert.equal(sessionBelongsToInteractivePlace("projects", assistant), false);
  assert.equal(sessionBelongsToInteractivePlace("projects", project), true);
  assert.equal(sessionBelongsToInteractivePlace("settings", project), false);
});

test("only the newest async open request may activate a session", () => {
  const assistant = { cwd: "/Users/alice/.hara/workspace", source: "desktop" };

  assert.equal(sessionActivationAllowed(3, 3, "chat", assistant), true);
  assert.equal(sessionActivationAllowed(2, 3, "chat", assistant), false);
  assert.equal(sessionActivationAllowed(3, 3, "projects", assistant), false);
});
