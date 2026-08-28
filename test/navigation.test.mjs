import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CORE_NAVIGATION_CONTRIBUTIONS,
  initialAppPlace,
  moveNavigation,
  parseNavigationPreferences,
  pluginNavigationContributionId,
  pluginNavigationContributions,
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
    ["core.tasks", "core.chat", "core.groups", "core.office"],
  );
});

test("legacy Chat and Projects visibility merges without making a formerly visible module disappear", () => {
  const projectsVisible = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: ["core.chat", "core.projects", "core.tasks"],
    hidden: ["core.chat"],
    shown: [],
  }));
  assert.deepEqual(projectsVisible.order, ["core.chat", "core.tasks"]);
  assert.deepEqual(projectsVisible.hidden, []);
  assert.equal(initialAppPlace("projects", projectsVisible), "projects");

  const bothHidden = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: ["core.chat", "core.projects", "core.tasks"],
    hidden: ["core.chat", "core.projects"],
    shown: [],
  }));
  assert.deepEqual(bothHidden.hidden, ["core.chat"]);
  assert.equal(initialAppPlace("projects", bothHidden), "auto");
});

test("enabled plugin panels contribute collision-safe, default-hidden dock entries", () => {
  const pluginPanels = pluginNavigationContributions([
    {
      plugin: "design.tools",
      panelId: "preview",
      title: "Design preview",
      description: "Project-owned live preview",
      icon: "office",
    },
    {
      plugin: "design",
      panelId: "tools.preview",
      title: "Other preview",
      icon: "projects",
    },
    {
      plugin: "design.tools",
      panelId: "preview",
      title: "Duplicate is ignored",
    },
    {
      plugin: "",
      panelId: "invalid",
      title: "Invalid owner",
    },
    {
      plugin: "unsafe",
      panelId: "control",
      title: "Unsafe\nlabel",
    },
  ]);

  assert.equal(pluginPanels.length, 2);
  assert.notEqual(pluginPanels[0].id, pluginPanels[1].id, "owner and panel segments cannot collide");
  assert.equal(
    pluginNavigationContributionId("design.tools", "preview"),
    pluginPanels[0].id,
  );
  assert.equal(pluginPanels[0].source, "plugin");
  assert.equal(pluginPanels[0].defaultVisible, false);
  assert.equal(pluginPanels[0].canHide, true);
  assert.equal(pluginPanels[0].icon, "office");

  const contributions = [...CORE_NAVIGATION_CONTRIBUTIONS, ...pluginPanels];
  let preferences = parseNavigationPreferences(null);
  assert.equal(
    visibleNavigation(contributions, preferences).some((item) => item.id === pluginPanels[0].id),
    false,
    "installing a plugin never clutters the dock without a user choice",
  );
  preferences = withNavigationVisibility(contributions, preferences, pluginPanels[0].id, true);
  assert.equal(
    visibleNavigation(contributions, preferences).some((item) => item.id === pluginPanels[0].id),
    true,
  );
});

test("the Workbench can be hidden, restored, and reordered without exposing a second Projects rail item", () => {
  let preferences = parseNavigationPreferences(null);
  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.chat",
    false,
  );
  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.tasks", "core.groups", "core.office"],
  );
  assert.equal(initialAppPlace("projects", preferences), "auto");
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    true,
  );

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.chat",
    true,
  );
  preferences = moveNavigation(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.chat",
    1,
  );
  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.tasks", "core.chat", "core.groups", "core.office"],
  );
  assert.equal(initialAppPlace("projects", preferences), "projects");

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
  assert.equal(preferences.order.includes("core.projects"), false);
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.projects"),
    false,
    "stale Projects preferences migrate into the visible Workbench instead of reviving a rail item",
  );
  assert.equal(initialAppPlace("projects", preferences), "projects");
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
  assert.match(app, /const loadGroups = \(\) => import\("\.\/Groups"\)/);
  assert.match(app, /const GroupsStage = lazy\(loadGroups\)/);
  assert.match(app, /warmModule\(loadGroups\(\)\)/);
  assert.match(app, /await client\.deskSnapshot\(profileId, state\)/);
  assert.match(app, /await client\.getDeskTask\(profileId, taskId\)/);
  const selectStart = app.indexOf("const selectGroupsOrganization");
  const readStart = app.indexOf("const readGroupsBoard");
  assert.ok(selectStart >= 0 && readStart > selectStart);
  const selectSource = app.slice(selectStart, readStart);
  assert.match(selectSource, /dispatchGroups\(\{ type: "selectProfile", profileId \}\)/);
  assert.match(selectSource, /groupsSwitchingProfileRef\.current/, "organization switches are serialized");
  assert.match(selectSource, /organizationConnectionSpaceId\(selected\)/);
  assert.match(selectSource, /await switchSpaceRef\.current\(targetSpaceId\)/,
    "Groups delegates every cross-company activation to the global Space transaction");
  assert.doesNotMatch(selectSource, /useOrganizationConnection/,
    "Groups cannot bypass the global Space transaction by activating a raw route");
  assert.match(groups, /disabled=\{Boolean\(switchingProfileId\)\}/);
  assert.match(app, /if \(phase !== "ready" \|\| zone !== "groups"\) return;/);
  assert.match(
    app,
    /const preferredPlace = initialAppPlace\([\s\S]*setZoneRaw\(preferredPlace\)/,
  );
});

test("Workbench exposes fresh conversations plus isolated Agent, project, and external-session inbox facets", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const inbox = readFileSync(`${root}/src/workbench-inbox.ts`, "utf8");

  assert.match(
    app,
    /const startNewAssistantConversation[\s\S]*await newSession\(`\$\{home\}\/\.hara\/workspace`\)/,
  );
  assert.match(
    app,
    /onClick=\{\(\) => void startNewAssistantConversation\(\)\}/,
  );
  assert.match(app, /workbenchInboxMode === "agents"/);
  assert.match(app, /workbenchInboxMode === "projects"/);
  assert.match(app, /workbenchInboxMode === "external"/);
  assert.match(app, /setWorkbenchInboxTarget\(\{ kind: "agent", id: agent\.ref \}\)/);
  assert.match(app, /setWorkbenchInboxTarget\(\{ kind: "project", id: cwd \}\)/);
  assert.match(app, /setWorkbenchInboxTarget\(\{ kind: "external", id: session\.id \}\)/);
  assert.match(app, /className="inbox-back"/);
  assert.match(app, /setWorkbenchInboxTarget\(null\)/);
  assert.match(app, /selectedInboxSessions\.map/);
  assert.match(inbox, /mainAgentRef\(session\.agentRef\) === agentRef/);
  assert.match(app, /externalSessionCenterSurface/);
  assert.match(app, /externalSessionsNextCursor/);
  assert.match(app, /loadMoreExternalSessions/);
  assert.match(app, /cursor,\s*limit: 100/);
  assert.match(app, /activeSpaceId === "personal"/);
  assert.doesNotMatch(app, /collapsed\["__history"\]/, "history is no longer a nested third level");
});
