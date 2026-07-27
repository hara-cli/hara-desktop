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
