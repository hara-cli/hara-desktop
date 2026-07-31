import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CORE_NAVIGATION_CONTRIBUTIONS,
  initialAppPlace,
  moveNavigation,
  parseNavigationPreferences,
  visibleNavigation,
  withNavigationVisibility,
} from "../src/navigation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("module dock preferences tolerate corruption and stale plugin IDs", () => {
  assert.deepEqual(parseNavigationPreferences("{broken"), {
    version: 1,
    order: [],
    hidden: [],
    shown: [],
  });
  const preferences = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: ["plugin.old.surface", "core.tasks", "core.tasks"],
    hidden: ["plugin.old.surface"],
  }));

  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.tasks", "core.chat", "core.projects", "core.groups", "core.office"],
  );
});

test("core modules can be hidden, restored, and reordered without hiding Settings", () => {
  let preferences = parseNavigationPreferences(null);
  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.projects",
    false,
  );
  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.chat", "core.tasks", "core.groups", "core.office"],
  );
  assert.equal(initialAppPlace("projects", preferences), "chat");
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    true,
  );

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.projects",
    true,
  );
  preferences = moveNavigation(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.projects",
    -1,
  );
  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.projects", "core.chat", "core.tasks", "core.groups", "core.office"],
  );

  for (const item of CORE_NAVIGATION_CONTRIBUTIONS) {
    preferences = withNavigationVisibility(
      CORE_NAVIGATION_CONTRIBUTIONS,
      preferences,
      item.id,
      false,
    );
  }
  assert.equal(initialAppPlace("chat", preferences), "settings");
});

test("Groups and Office are default-visible but remain local navigation preferences", () => {
  let preferences = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: [
      "core.chat",
      "core.projects",
      "core.tasks",
      "core.groups",
      "core.office",
    ],
    hidden: [],
  }));
  assert.deepEqual(preferences.shown, []);
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    true,
  );
  assert.equal(initialAppPlace("groups", preferences), "groups");

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    false,
  );
  assert.deepEqual(preferences.shown, []);
  assert.deepEqual(preferences.hidden, ["core.groups"]);
  assert.equal(initialAppPlace("groups", preferences), "chat");

  preferences = moveNavigation(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    -1,
  );
  assert.deepEqual(preferences.shown, []);
  assert.deepEqual(preferences.hidden, ["core.groups"]);

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    true,
  );
  assert.deepEqual(preferences.shown, []);
  assert.deepEqual(preferences.hidden, []);
  assert.equal(initialAppPlace("groups", preferences), "groups");
  assert.equal(initialAppPlace("office", preferences), "office");
});

test("Groups is a native, explicit-read work surface with no renderer-owned transport", () => {
  const groups = readFileSync(`${root}/src/Groups.tsx`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  for (const forbidden of [
    "HaraClient",
    "fetch(",
    "WebSocket",
    "setInterval",
    "invoke(",
    "localStorage",
    ".hara/collab",
  ]) {
    assert.equal(
      groups.includes(forbidden),
      false,
      `Groups must not contain ${forbidden}`,
    );
  }
  assert.match(
    app,
    /const GroupsStage = lazy\(\(\) => import\("\.\/Groups"\)\)/,
  );
  assert.match(app, /await client\.deskSnapshot\(profileId, state\)/);
  assert.match(app, /await client\.getDeskTask\(profileId, taskId\)/);
  const selectStart = app.indexOf("const selectGroupsOrganization");
  const readStart = app.indexOf("const readGroupsBoard");
  assert.ok(selectStart >= 0 && readStart > selectStart);
  const selectSource = app.slice(selectStart, readStart);
  assert.match(selectSource, /dispatchGroups\(\{ type: "selectProfile", profileId \}\)/);
  assert.match(selectSource, /groupsSwitchingProfileRef\.current/, "organization switches are serialized");
  assert.match(selectSource, /await client\.useOrganizationConnection\(profileId, targetCwd\)/);
  assert.match(selectSource, /await client\.listProviderSettings\(targetCwd\)/);
  assert.match(groups, /disabled=\{Boolean\(switchingProfileId\)\}/);
  assert.match(app, /if \(phase !== "ready" \|\| zone !== "groups"\) return;/);
  assert.match(
    app,
    /const preferredPlace = initialAppPlace\([\s\S]*setZoneRaw\(preferredPlace\)/,
  );
});

test("chat exposes a real fresh-conversation action while preserving folded history", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");

  assert.match(
    app,
    /const startNewAssistantConversation[\s\S]*await newSession\(`\$\{home\}\/\.hara\/workspace`\)/,
  );
  assert.match(
    app,
    /onClick=\{\(\) => void startNewAssistantConversation\(\)\}/,
  );
  assert.match(app, /az\.history\.length > 0/);
  assert.match(app, /collapsed\["__history"\] === false/);
});
