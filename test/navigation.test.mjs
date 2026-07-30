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
    ["core.tasks", "core.chat", "core.projects"],
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
    ["core.chat", "core.tasks"],
  );
  assert.equal(initialAppPlace("projects", preferences), "chat");
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    false,
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
    ["core.projects", "core.chat", "core.tasks"],
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

test("default-hidden Groups requires an explicit show choice independent of ordering", () => {
  let preferences = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: [
      "core.chat",
      "core.projects",
      "core.tasks",
      "core.groups",
    ],
    hidden: [],
  }));
  assert.deepEqual(preferences.shown, []);
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    false,
  );
  assert.equal(initialAppPlace("groups", preferences), "chat");

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    true,
  );
  assert.deepEqual(preferences.shown, ["core.groups"]);
  assert.equal(initialAppPlace("groups", preferences), "groups");

  preferences = moveNavigation(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    -1,
  );
  assert.deepEqual(preferences.shown, ["core.groups"]);

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.groups",
    false,
  );
  assert.deepEqual(preferences.shown, []);
  assert.equal(initialAppPlace("groups", preferences), "chat");
});

test("Groups preview remains a local-only shell with no collaboration side effects", () => {
  const groups = readFileSync(`${root}/src/GroupsPreview.tsx`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  for (const forbidden of [
    "HaraClient",
    "fetch(",
    "WebSocket",
    "setInterval",
    "invoke(",
    ".hara/collab",
  ]) {
    assert.equal(
      groups.includes(forbidden),
      false,
      `Groups preview must not contain ${forbidden}`,
    );
  }
  assert.match(
    app,
    /const GroupsStage = lazy\(\(\) => import\("\.\/GroupsPreview"\)\)/,
  );
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
