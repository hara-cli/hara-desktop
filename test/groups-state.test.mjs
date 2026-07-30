import assert from "node:assert/strict";
import test from "node:test";

import {
  groupsReducer,
  groupsTaskKey,
  initialGroupsState,
} from "../src/groups-state.ts";

const agent = {
  id: "agent-a",
  name: "Agent A",
  owner: "owner-a",
  client: "hara-cli",
  role: "member",
  createdAt: 1,
  lastSeen: 2,
  revoked: false,
};

const task = (id, title) => ({
  id,
  kind: "dispatch",
  title,
  excerpt: "",
  risk: "low",
  state: "open",
  createdBy: "agent-a",
  claimedBy: null,
  ackedBy: null,
  createdAt: 1,
  updatedAt: 2,
});

const taskDetail = (id, title) => ({
  ...task(id, title),
  body: "",
});

const snapshot = (profileId, taskId, title) => ({
  profileId,
  fetchedAt: 3,
  me: agent,
  tasks: [task(taskId, title)],
  agents: [agent],
  events: [],
  circles: [],
  truncated: false,
});

const directoryProfiles = (...profileIds) =>
  profileIds.map((profileId) => ({ profileId, revision: `revision:${profileId}` }));

test("switching organizations preserves the pinned task and profile-partitioned snapshots", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: directoryProfiles("org-a", "org-b"),
    preferredProfileId: "org-a",
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 1,
  });
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 1,
    data: snapshot("org-a", "t_a", "A task"),
  });
  state = groupsReducer(state, {
    type: "openTask",
    profileId: "org-a",
    taskId: "t_a",
  });
  state = groupsReducer(state, {
    type: "selectProfile",
    profileId: "org-b",
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-b",
    generation: 2,
  });
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-b",
    generation: 2,
    data: snapshot("org-b", "t_b", "B task"),
  });

  assert.equal(state.selectedProfileId, "org-b");
  assert.deepEqual(state.openTask, { profileId: "org-a", taskId: "t_a" });
  assert.equal(state.snapshotsByProfile["org-a"].data.tasks[0].title, "A task");
  assert.equal(state.snapshotsByProfile["org-b"].data.tasks[0].title, "B task");
});

test("late snapshot and task responses cannot overwrite a newer generation or another organization", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 10,
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 11,
  });
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 10,
    data: snapshot("org-a", "t_old", "stale"),
  });
  assert.equal(state.snapshotsByProfile["org-a"].phase, "loading");

  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 11,
    data: snapshot("org-a", "t_new", "current"),
  });
  assert.equal(state.snapshotsByProfile["org-a"].data.tasks[0].title, "current");

  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-b",
    generation: 12,
  });
  const before = state;
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 12,
    data: snapshot("org-b", "t_wrong", "wrong profile"),
  });
  assert.equal(state, before);

  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_new",
    generation: 20,
  });
  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_new",
    generation: 21,
  });
  state = groupsReducer(state, {
    type: "taskSucceeded",
    profileId: "org-a",
    taskId: "t_new",
    generation: 20,
    data: {
      profileId: "org-a",
      task: taskDetail("t_new", "stale detail"),
      events: [],
    },
  });
  assert.equal(state.tasksByKey[groupsTaskKey("org-a", "t_new")].phase, "loading");
});

test("directory refresh preserves a valid manual selection and removes deleted profile caches", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: directoryProfiles("org-a", "org-b"),
    preferredProfileId: "org-a",
  });
  state = groupsReducer(state, { type: "selectProfile", profileId: "org-b" });
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: directoryProfiles("org-a", "org-b"),
    preferredProfileId: "org-a",
  });
  assert.equal(state.selectedProfileId, "org-b");

  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 1,
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-b",
    generation: 2,
  });
  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_a",
    generation: 3,
  });
  state = groupsReducer(state, {
    type: "openTask",
    profileId: "org-a",
    taskId: "t_a",
  });
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: directoryProfiles("org-b"),
    preferredProfileId: "org-b",
  });
  assert.equal(state.snapshotsByProfile["org-a"], undefined);
  assert.equal(state.snapshotsByProfile["org-b"].generation, 2);
  assert.equal(state.tasksByKey[groupsTaskKey("org-a", "t_a")], undefined);
  assert.equal(state.openTask, undefined);
  assert.equal(state.selectedProfileId, "org-b");
});

test("a reused organization id preserves cache only while its enrollment and Desk revision stay equal", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: [{ profileId: "org-a", revision: "enrollment-a:binding-a" }],
    preferredProfileId: "org-a",
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 1,
  });
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 1,
    data: snapshot("org-a", "t_a", "private organization A task"),
  });
  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_a",
    generation: 2,
  });
  state = groupsReducer(state, {
    type: "taskSucceeded",
    profileId: "org-a",
    taskId: "t_a",
    generation: 2,
    data: {
      profileId: "org-a",
      task: taskDetail("t_a", "private organization A task"),
      events: [],
    },
  });
  state = groupsReducer(state, {
    type: "openTask",
    profileId: "org-a",
    taskId: "t_a",
  });

  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: [{ profileId: "org-a", revision: "enrollment-a:binding-a" }],
    preferredProfileId: "org-a",
  });
  assert.equal(state.snapshotsByProfile["org-a"].data.tasks[0].id, "t_a");
  assert.equal(state.tasksByKey[groupsTaskKey("org-a", "t_a")].data.task.id, "t_a");
  assert.deepEqual(state.openTask, { profileId: "org-a", taskId: "t_a" });

  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: [{ profileId: "org-a", revision: "enrollment-b:binding-b" }],
    preferredProfileId: "org-a",
  });
  assert.equal(state.selectedProfileId, "org-a", "the organization may remain selected");
  assert.equal(state.revisionsByProfile["org-a"], "enrollment-b:binding-b");
  assert.equal(state.snapshotsByProfile["org-a"], undefined);
  assert.equal(state.tasksByKey[groupsTaskKey("org-a", "t_a")], undefined);
  assert.equal(state.openTask, undefined);
});

test("failed refreshes discard stale organization and task data", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 1,
  });
  state = groupsReducer(state, {
    type: "snapshotSucceeded",
    profileId: "org-a",
    generation: 1,
    data: snapshot("org-a", "t_a", "sensitive stale task"),
  });
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "org-a",
    generation: 2,
  });
  state = groupsReducer(state, {
    type: "snapshotFailed",
    profileId: "org-a",
    generation: 2,
    error: "authorization expired",
  });
  assert.equal(state.snapshotsByProfile["org-a"].data, undefined);

  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_a",
    generation: 3,
  });
  state = groupsReducer(state, {
    type: "taskSucceeded",
    profileId: "org-a",
    taskId: "t_a",
    generation: 3,
    data: {
      profileId: "org-a",
      task: taskDetail("t_a", "sensitive detail"),
      events: [],
    },
  });
  state = groupsReducer(state, {
    type: "taskStarted",
    profileId: "org-a",
    taskId: "t_a",
    generation: 4,
  });
  state = groupsReducer(state, {
    type: "taskFailed",
    profileId: "org-a",
    taskId: "t_a",
    generation: 4,
    error: "authorization expired",
  });
  assert.equal(state.tasksByKey[groupsTaskKey("org-a", "t_a")].data, undefined);
});

test("prototype-shaped organization ids never resolve inherited cache entries", () => {
  let state = initialGroupsState();
  state = groupsReducer(state, {
    type: "directorySynced",
    profiles: directoryProfiles("constructor", "toString"),
    preferredProfileId: "constructor",
  });
  assert.equal(Object.hasOwn(state.snapshotsByProfile, "constructor"), false);
  state = groupsReducer(state, {
    type: "snapshotStarted",
    profileId: "constructor",
    generation: 1,
  });
  assert.equal(Object.hasOwn(state.snapshotsByProfile, "constructor"), true);
  assert.equal(state.snapshotsByProfile.constructor.phase, "loading");
});
