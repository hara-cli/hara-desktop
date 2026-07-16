import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgePetActivity,
  BUILTIN_HARA_PET,
  selectPetSnapshot,
  setPetActivity,
} from "../src/pets.ts";

test("built-in pet provenance is independent from local and future market providers", () => {
  assert.equal(BUILTIN_HARA_PET.source, "builtin");
  assert.equal(BUILTIN_HARA_PET.selector, "builtin:hara");
});

test("pet activity priority matches needs-input, blocked, ready, running", () => {
  let activities = {};
  activities = setPetActivity(activities, "running", "running", "compile", 40);
  activities = setPetActivity(activities, "ready", "ready", "tests", 30);
  activities = setPetActivity(activities, "blocked", "blocked", "release", 20);
  activities = setPetActivity(activities, "waiting", "waiting", "approval", 10);

  const snapshot = selectPetSnapshot(activities);
  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.activity.sessionId, "waiting");
  assert.equal(snapshot.activityCount, 4);
});

test("newest activity wins within the same pet status", () => {
  let activities = {};
  activities = setPetActivity(activities, "old", "blocked", "old failure", 10);
  activities = setPetActivity(activities, "new", "blocked", "new failure", 20);
  assert.equal(selectPetSnapshot(activities).activity.sessionId, "new");
});

test("opening a task acknowledges ready without hiding actionable states", () => {
  let ready = setPetActivity({}, "task", "ready", "done", 1);
  ready = acknowledgePetActivity(ready, "task");
  assert.equal(selectPetSnapshot(ready).status, "idle");

  const waiting = setPetActivity({}, "task", "waiting", "approve", 1);
  assert.equal(acknowledgePetActivity(waiting, "task"), waiting);
  assert.equal(selectPetSnapshot(waiting).status, "waiting");
});

test("tracked pet activity is bounded", () => {
  let activities = {};
  for (let index = 0; index < 80; index += 1) {
    activities = setPetActivity(activities, `s-${index}`, "running", `task ${index}`, index);
  }
  assert.equal(Object.keys(activities).length, 64);
  assert.equal(selectPetSnapshot(activities).activity.sessionId, "s-79");
  assert.equal(activities["s-0"], undefined);
});
