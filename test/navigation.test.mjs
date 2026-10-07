import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import {
  CORE_NAVIGATION_CONTRIBUTIONS,
  availableNavigation,
  initialAppPlace,
  moveNavigation,
  parseNavigationPreferences,
  pluginNavigationContributionId,
  pluginNavigationContributions,
  resetNavigationPreferences,
  visibleNavigation,
  withNavigationVisibility,
} from "../src/navigation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), "hara-navigation-"));
after(() => rmSync(fixture, { recursive: true, force: true }));

// Render the actual settings component and inspect its event handlers without a DOM shim.
const bundle = await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ModuleDockSettings } from "./src/ModuleDockSettings.tsx";
      export function render(props) {
        return renderToStaticMarkup(createElement(ModuleDockSettings, props));
      }
      export function buttons(props) {
        const result = [];
        function visit(node) {
          if (Array.isArray(node)) { node.forEach(visit); return; }
          if (!node || typeof node !== "object") return;
          if (node.type === "button") result.push(node.props);
          if (typeof node.type === "function") visit(node.type(node.props));
          else visit(node.props?.children);
        }
        visit(ModuleDockSettings(props));
        return result;
      }
    `,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  write: false,
});
const compiled = join(fixture, "navigation.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render: renderDock, buttons: dockButtons } = createRequire(import.meta.url)(compiled);

const dockCopy = {
  eyebrow: "个性化", title: "侧栏模块", description: "选择常用入口",
  cardTitle: "导航", cardDescription: "随时可以恢复",
  core: "TECHNICAL_CORE", plugin: "TECHNICAL_PLUGIN",
  visible: "显示中", hidden: "已隐藏", show: "显示", hide: "隐藏",
  moveUp: "上移", moveDown: "下移", fixed: "始终显示", reset: "恢复默认",
  fixedTitle: "固定入口", fixedDescription: "工作台与设置始终可达",
};

function dockProps(overrides = {}) {
  return {
    contributions: CORE_NAVIGATION_CONTRIBUTIONS,
    preferences: parseNavigationPreferences(null),
    labels: {
      "core.chat": { title: "工作台", description: "个人对话与本机项目" },
      "core.tasks": { title: "定时任务", description: "运行计划和记录" },
      "core.groups": { title: "组织工作区", description: "组织工作项" },
    },
    copy: dockCopy,
    onVisibilityChange() {}, onMove() {},
    ...overrides,
  };
}

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
    ["core.chat", "core.groups"],
  );
});

test("organization workspaces appear in the primary dock only after enrollment", () => {
  assert.deepEqual(
    availableNavigation(CORE_NAVIGATION_CONTRIBUTIONS, {
      hasOrganizationWorkspace: false,
    }).map((item) => item.id),
    ["core.chat", "core.tasks"],
  );
  assert.deepEqual(
    availableNavigation(CORE_NAVIGATION_CONTRIBUTIONS, {
      hasOrganizationWorkspace: true,
    }).map((item) => item.id),
    ["core.chat", "core.tasks", "core.groups"],
  );
  assert.deepEqual(
    visibleNavigation(availableNavigation(CORE_NAVIGATION_CONTRIBUTIONS, {
      hasOrganizationWorkspace: false,
    }), parseNavigationPreferences(null)).map((item) => item.id),
    ["core.chat"],
    "Personal starts with the Workbench and the fixed Settings button",
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
  assert.deepEqual(bothHidden.hidden, []);
  assert.equal(initialAppPlace("projects", bothHidden), "projects");
});

test("the stable automation shortcut is opt-in and explicit visibility survives a restart", () => {
  const automation = CORE_NAVIGATION_CONTRIBUTIONS.find((item) => item.id === "core.tasks");
  assert.equal(automation.target, "auto");
  assert.equal(automation.defaultVisible, false);
  let preferences = parseNavigationPreferences(null);
  assert.equal(initialAppPlace("auto", preferences), "chat");
  preferences = withNavigationVisibility(CORE_NAVIGATION_CONTRIBUTIONS, preferences, "core.tasks", true);
  assert.deepEqual(preferences.shown, ["core.tasks"]);
  preferences = parseNavigationPreferences(JSON.stringify(preferences));
  assert.equal(initialAppPlace("auto", preferences), "auto");
  assert.equal(visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).some((item) => item.id === "core.tasks"), true);
  preferences = withNavigationVisibility(CORE_NAVIGATION_CONTRIBUTIONS, preferences, "core.tasks", false);
  assert.deepEqual(preferences.shown, []);
  assert.equal(initialAppPlace("auto", preferences), "chat");
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

test("the Workbench remains reachable even with stale hidden preferences", () => {
  let preferences = parseNavigationPreferences(null);
  const original = preferences;
  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.chat",
    false,
  );
  assert.equal(preferences, original, "the fixed Workbench cannot be hidden");
  assert.deepEqual(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences).map((item) => item.id),
    ["core.chat", "core.groups"],
  );
  assert.equal(initialAppPlace("projects", preferences), "projects");
  assert.equal(
    visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, preferences)
      .some((item) => item.id === "core.groups"),
    true,
  );

  preferences = withNavigationVisibility(
    CORE_NAVIGATION_CONTRIBUTIONS,
    preferences,
    "core.tasks",
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
    ["core.tasks", "core.chat", "core.groups"],
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
  assert.equal(initialAppPlace("chat", preferences), "chat");
  assert.equal(initialAppPlace("settings", preferences), "settings");
  const stale = parseNavigationPreferences(JSON.stringify({
    version: 1, order: [], hidden: ["core.chat", "core.tasks", "core.groups"], shown: [],
  }));
  assert.deepEqual(stale.hidden, ["core.tasks", "core.groups"]);
  assert.deepEqual(visibleNavigation(CORE_NAVIGATION_CONTRIBUTIONS, stale).map((item) => item.id), ["core.chat"]);
  assert.equal(initialAppPlace("chat", stale), "chat");
});

test("editing available shortcuts preserves absent plugin and organization preferences", () => {
  const panel = pluginNavigationContributions([{ plugin: "enabled", panelId: "preview", title: "Preview" }])[0];
  const contributions = [...availableNavigation(CORE_NAVIGATION_CONTRIBUTIONS, {
    hasOrganizationWorkspace: false,
  }), panel];
  let preferences = parseNavigationPreferences(JSON.stringify({
    version: 1,
    order: ["plugin.disabled.preview", "core.chat", "core.groups", "core.tasks", panel.id],
    hidden: ["plugin.disabled.hidden", "core.groups"],
    shown: ["plugin.disabled.preview"],
  }));
  preferences = withNavigationVisibility(contributions, preferences, "core.tasks", true);
  preferences = moveNavigation(contributions, preferences, "core.tasks", -1);
  assert.deepEqual(preferences.order, ["plugin.disabled.preview", "core.tasks", "core.groups", "core.chat", panel.id]);
  assert.deepEqual(preferences.hidden, ["plugin.disabled.hidden", "core.groups"]);
  assert.deepEqual(preferences.shown, ["plugin.disabled.preview", "core.tasks"]);
  preferences = withNavigationVisibility(contributions, preferences, panel.id, true);
  preferences = resetNavigationPreferences(contributions, preferences);
  assert.deepEqual(preferences, {
    version: 1,
    order: ["plugin.disabled.preview", "core.groups"],
    hidden: ["plugin.disabled.hidden", "core.groups"],
    shown: ["plugin.disabled.preview"],
  });
  assert.equal(visibleNavigation(contributions, preferences).some((item) => item.id === "core.tasks" || item.id === panel.id), false);
  const restoredPlugin = pluginNavigationContributions([{ plugin: "disabled", panelId: "preview", title: "Restored preview" }])[0];
  assert.equal(visibleNavigation([...contributions, restoredPlugin], preferences)[0].id, restoredPlugin.id);
});

test("sidebar settings embeds as a card, omits technical badges, and offers no switch for the fixed Workbench", () => {
  const props = dockProps({ embedded: true });
  const html = renderDock(props);
  assert.match(html, /class="settings-card"/);
  assert.doesNotMatch(html, /<h1|class="settings-page"/);
  assert.doesNotMatch(html, /TECHNICAL_CORE|TECHNICAL_PLUGIN|settings-badge/);
  assert.match(html, /始终显示/);
  const switches = dockButtons(props).filter((button) => button.role === "switch");
  assert.equal(switches.length, 2);
  assert.deepEqual(switches.map((button) => button["aria-label"]), ["显示: 定时任务", "隐藏: 组织工作区"]);
  assert.equal(switches[0]["aria-checked"], false);
  assert.doesNotMatch(renderDock(props), /aria-label="(?:显示|隐藏): 工作台"/);
  assert.match(renderDock(dockProps()), /class="settings-page"/);
});

test("sidebar settings controls invoke only the requested navigation preference actions", () => {
  const changes = [];
  const moves = [];
  let resets = 0;
  const props = dockProps({
    embedded: true,
    onVisibilityChange: (...args) => changes.push(args),
    onMove: (...args) => moves.push(args),
    onReset: () => { resets += 1; },
  });
  const buttons = dockButtons(props);
  buttons.find((button) => button["aria-label"] === "显示: 定时任务").onClick();
  buttons.find((button) => button["aria-label"] === "隐藏: 组织工作区").onClick();
  buttons.find((button) => button["aria-label"] === "上移: 定时任务").onClick();
  buttons.find((button) => button.children === "恢复默认").onClick();
  assert.deepEqual(changes, [["core.tasks", true], ["core.groups", false]]);
  assert.deepEqual(moves, [["core.tasks", -1]]);
  assert.equal(resets, 1);
  assert.equal(dockButtons(dockProps()).some((button) => button.children === "恢复默认"), false);
});

test("Groups remains a primary module while stale Office preferences fall back to Workbench", () => {
  assert.equal(
    CORE_NAVIGATION_CONTRIBUTIONS.some((item) => item.id === "core.office"),
    false,
    "Deliverables belongs inside Workbench rather than the primary module dock",
  );
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
  assert.equal(initialAppPlace("office", preferences), "chat");
});

test("Groups is a native organization work surface with no renderer-owned transport", () => {
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

test("Workbench exposes Agent contacts and external sessions while project history stays an internal compatibility facet", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const inbox = readFileSync(`${root}/src/workbench-inbox.ts`, "utf8");
  const tabsStart = app.indexOf('className="workbench-inbox-tabs"');
  const tabsEnd = app.indexOf("</div>", tabsStart);
  const visibleTabs = app.slice(tabsStart, tabsEnd);

  assert.match(
    app,
    /const startNewAssistantConversation[\s\S]*await newSession\(`\$\{home\}\/\.hara\/workspace`\)/,
  );
  assert.doesNotMatch(app, /新任务|New task/,
    "the contact directory does not expose a hidden Session operation as a global task action");
  assert.match(app, /开始新话题|Start a fresh topic/,
    "the history detail uses an explicit conversation action instead of task/session terminology");
  assert.match(app, /workbenchInboxMode === "agents"/);
  assert.match(app, /workbenchInboxMode === "external"/);
  assert.doesNotMatch(visibleTabs, /inboxProjects/, "Project is not a first-class Workbench tab");
  assert.match(app, /void openAgentConversation\(agent\.ref, targetCwd\)/);
  assert.match(app, /inbox-agent-history/, "older execution segments stay available without becoming contacts");
  assert.match(app, /locale === "zh" \? "历史" : "History"/, "history is a named action rather than an icon-only affordance");
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
