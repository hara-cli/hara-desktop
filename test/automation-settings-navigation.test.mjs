import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, Fragment, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Run the actual renderer callbacks with a controlled engine and navigation refs. This keeps
// asynchronous navigation regressions observable without booting Tauri or copying the guards.
function callback(name, bindings) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      assert.equal(initializer, undefined, `${name} must have a single renderer declaration`);
      initializer = node.initializer?.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(initializer, `the renderer must declare ${name}`);
  return evaluate(initializer, bindings);
}

function evaluate(initializer, bindings) {
  const name = "sourceValue";
  const { outputText } = ts.transpileModule(`const ${name} = ${initializer};\nreturn ${name};`, {
    fileName: "App.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  });
  return new Function(...Object.keys(bindings), outputText)(...Object.values(bindings));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const run = { id: "scheduled-run", title: "Daily report", sourceName: "Daily", cwd: "/tmp/reports" };
const history = [
  { role: "user", text: "internal" },
  { role: "user", text: "visible instruction" },
  { role: "assistant", text: "Saved result" },
];

function replayHarness(place = "settings") {
  const pending = deferred();
  const calls = [];
  const replay = [];
  const errors = [];
  const client = { resumeSession: (id) => { calls.push(id); return pending.promise; } };
  const bindings = {
    useCallback: (fn) => fn,
    clientRef: { current: client },
    spaceDirectoryRef: { current: { activeId: "personal" } },
    sessionOpenRequestRef: { current: 0 },
    zoneRef: { current: place },
    settingsSectionRef: { current: "automations" },
    attachedSessionsRef: { current: new Set() },
    setAutoReplay: (value) => replay.push(value),
    setErr: (message) => errors.push(message),
    isInternalUserText: (text) => text === "internal",
    displayHistoryText: (text) => `display:${text}`,
  };
  return { ...bindings, pending, calls, replay, errors, open: callback("openReplay", bindings) };
}

test("automation shortcuts use Settings and retain the requested task, attention, paused, or runs view", () => {
  for (const view of ["tasks", "attention", "paused", "runs"]) {
    const actions = [];
    const open = callback("openAutomations", {
      setZone: (place) => { actions.push(["zone", place]); return true; },
      preloadSettingsSection: (section) => actions.push(["preload", section]),
      setSetSec: (section) => actions.push(["section", section]),
      setAutoView: (next) => actions.push(["view", next]),
    });
    assert.equal(open(view), true);
    assert.deepEqual(actions, [
      ["zone", "settings"], ["preload", "automations"], ["section", "automations"], ["view", view],
    ]);
  }
  const blocked = callback("openAutomations", {
    setZone: () => false,
    preloadSettingsSection: () => assert.fail("cancelled navigation must not preload a destination"),
    setSetSec: () => assert.fail("cancelled navigation must keep its section"),
    setAutoView: () => assert.fail("cancelled navigation must keep its view"),
  });
  assert.equal(blocked("runs"), false);
});

test("changing Settings sections invalidates pending opens and synchronizes the section ref immediately", () => {
  const request = { current: 3 };
  const section = { current: "automations" };
  const replays = [];
  const selected = [];
  const select = callback("setSetSec", {
    useCallback: (fn) => fn,
    sessionOpenRequestRef: request,
    settingsSectionRef: section,
    setAutoReplay: (value) => replays.push(value),
    setSettingsSection: (value) => selected.push(value),
  });
  select("automations");
  assert.equal(request.current, 3, "selecting the current section keeps an in-flight replay valid");
  select("lang");
  assert.equal(request.current, 4);
  assert.equal(section.current, "lang");
  assert.deepEqual(replays, [null]);
  assert.deepEqual(selected, ["automations", "lang"]);
});

test("Settings and an explicitly opened task shortcut display filtered, read-only automation results", async () => {
  for (const place of ["settings", "auto"]) {
    const harness = replayHarness(place);
    const opening = harness.open(run);
    harness.pending.resolve({ history });
    await opening;
    assert.deepEqual(harness.calls, [run.id]);
    assert.deepEqual(harness.replay, [{
      ...run,
      items: [
        { role: "user", text: "display:visible instruction" },
        { role: "assistant", text: "Saved result" },
      ],
    }]);
    assert.equal(harness.attachedSessionsRef.current.has(run.id), true);
    assert.deepEqual(harness.errors, []);
  }
});

const staleReplayTransitions = {
  "engine replacement": (h) => { h.clientRef.current = {}; },
  "company Space": (h) => { h.spaceDirectoryRef.current = { activeId: "company" }; },
  "another place": (h) => { h.zoneRef.current = "chat"; },
  "another Settings section": (h) => { h.settingsSectionRef.current = "lang"; },
  "newer open request": (h) => { h.sessionOpenRequestRef.current += 1; },
};

for (const [label, transition] of Object.entries(staleReplayTransitions)) {
  test(`a late automation replay is discarded after ${label}`, async () => {
    const harness = replayHarness();
    const opening = harness.open(run);
    transition(harness);
    harness.pending.resolve({ history });
    await opening;
    assert.deepEqual(harness.replay, []);
    assert.equal(harness.attachedSessionsRef.current.size, 0);
    assert.deepEqual(harness.errors, []);
  });
}

test("a stale replay failure does not overwrite the newly selected surface error", async () => {
  const stale = replayHarness();
  const oldOpen = stale.open(run);
  stale.settingsSectionRef.current = "providers";
  stale.pending.reject(new Error("old engine failed"));
  await oldOpen;
  assert.deepEqual(stale.errors, []);

  const current = replayHarness();
  const currentOpen = current.open(run);
  current.pending.reject(new Error("current engine failed"));
  await currentOpen;
  assert.deepEqual(current.errors, ["current engine failed"]);
});

test("automation replay access fails closed without an engine or in a company Space", async () => {
  for (const change of [
    (h) => { h.clientRef.current = null; },
    (h) => { h.spaceDirectoryRef.current = { activeId: "company" }; },
  ]) {
    const harness = replayHarness();
    change(harness);
    await harness.open(run);
    assert.deepEqual(harness.calls, []);
    assert.deepEqual(harness.replay, []);
  }
});

function forkHarness(cwd = "/tmp/reports", overrides = {}) {
  const pending = deferred();
  const forks = [];
  const remembered = [];
  const destinations = [];
  const errors = [];
  const forkingStates = [];
  let transcripts = { existing: [{ kind: "text", text: "existing result" }] };
  let refreshes = 0;
  const client = { forkSession: (id) => { forks.push(id); return pending.promise; } };
  const bindings = {
    clientRef: { current: client },
    autoForkingRef: { current: false },
    setAutoForking: (value) => forkingStates.push(value),
    autoReplay: { ...run, cwd },
    isAssistantCwd: (path) => path.endsWith("/.hara/workspace"),
    sessionOpenRequestRef: { current: 0 },
    spaceDirectoryRef: { current: { activeId: "personal" } },
    attachedSessionsRef: { current: new Set() },
    zoneRef: { current: "settings" },
    settingsSectionRef: { current: "automations" },
    setTranscripts: (update) => { transcripts = update(transcripts); },
    displayHistoryText: (text) => `display:${text}`,
    rememberSession: (...args) => remembered.push(args),
    refreshSessions: async () => { refreshes += 1; },
    setZone: (place) => destinations.push(place),
    setErr: (message) => errors.push(message),
    ...overrides,
  };
  return {
    ...bindings, pending, forks, remembered, destinations, errors, forkingStates,
    get transcripts() { return transcripts; },
    get refreshes() { return refreshes; },
    continue: callback("continueManually", bindings),
  };
}

test("only explicitly continuing a replay forks it and returns to its isolated interactive place", async () => {
  for (const [cwd, destination] of [["/tmp/reports", "projects"], ["/Users/alice/.hara/workspace", "chat"]]) {
    const harness = forkHarness(cwd);
    assert.deepEqual(harness.forks, [], "opening a result alone never starts an interactive fork");
    const continuing = harness.continue();
    harness.pending.resolve({ sessionId: "manual-fork", history: history.slice(1) });
    await continuing;
    assert.deepEqual(harness.forks, [run.id]);
    assert.deepEqual(harness.destinations, [destination]);
    assert.deepEqual(harness.remembered, [["manual-fork", { cwd, source: "interactive" }]]);
    assert.equal(harness.refreshes, 1);
    assert.deepEqual(harness.transcripts["manual-fork"], [
      { kind: "user", text: "display:visible instruction" },
      { kind: "text", text: "Saved result" },
    ]);
    assert.equal(harness.attachedSessionsRef.current.has("manual-fork"), true);
    assert.deepEqual(harness.errors, []);
  }
});

for (const [label, transition] of Object.entries({
  "engine replacement": staleReplayTransitions["engine replacement"],
  "company Space": staleReplayTransitions["company Space"],
  "newer navigation request": staleReplayTransitions["newer open request"],
})) {
  test(`a late manual fork cannot replace the active surface after ${label}`, async () => {
    const harness = forkHarness();
    const continuing = harness.continue();
    transition(harness);
    harness.pending.resolve({ sessionId: "manual-fork", history: [] });
    await continuing;
    assert.deepEqual(harness.destinations, []);
    assert.deepEqual(harness.remembered, []);
    assert.equal(harness.attachedSessionsRef.current.size, 0);
    assert.equal(harness.refreshes, 0);
    assert.equal(harness.transcripts["manual-fork"], undefined);
  });
}

test("the manual fork action requires a replay on an active Personal automation surface", async () => {
  for (const overrides of [
    { autoReplay: null },
    { clientRef: { current: null } },
    { spaceDirectoryRef: { current: { activeId: "company" } } },
    { zoneRef: { current: "chat" } },
    { settingsSectionRef: { current: "providers" } },
  ]) {
    const harness = forkHarness("/tmp/reports", overrides);
    await harness.continue();
    assert.deepEqual(harness.forks, []);
    assert.deepEqual(harness.destinations, []);
  }
});

test("late manual fork failures do not overwrite an engine, Space, or navigation replacement", async () => {
  for (const transition of [
    staleReplayTransitions["engine replacement"],
    staleReplayTransitions["company Space"],
    staleReplayTransitions["newer open request"],
  ]) {
    const harness = forkHarness();
    const continuing = harness.continue();
    transition(harness);
    harness.pending.reject(new Error("stale fork failed"));
    await continuing;
    assert.deepEqual(harness.errors, []);
  }
  const current = forkHarness();
  const continuing = current.continue();
  current.pending.reject(new Error("current fork failed"));
  await continuing;
  assert.deepEqual(current.errors, ["current fork failed"]);
});

test("double-clicking manual continuation forks once and a failed attempt can be retried", async () => {
  const harness = forkHarness();
  const first = harness.continue();
  await harness.continue();
  assert.deepEqual(harness.forks, [run.id]);
  assert.equal(harness.autoForkingRef.current, true);
  assert.deepEqual(harness.forkingStates, [true]);
  harness.pending.reject(new Error("retryable fork failure"));
  await first;
  assert.equal(harness.autoForkingRef.current, false);
  assert.deepEqual(harness.forkingStates, [true, false]);

  const retry = deferred();
  harness.clientRef.current.forkSession = (id) => { harness.forks.push(id); return retry.promise; };
  const second = harness.continue();
  retry.resolve({ sessionId: "retry-fork", history: [] });
  await second;
  assert.deepEqual(harness.forks, [run.id, run.id]);
  assert.deepEqual(harness.destinations, ["projects"]);
  assert.equal(harness.autoForkingRef.current, false);
  assert.deepEqual(harness.forkingStates, [true, false, true, false]);
});

function refreshHarness() {
  const pending = deferred();
  const results = [];
  let reads = 0;
  const client = { listAutomation: () => { reads += 1; return pending.promise; } };
  const bindings = {
    useCallback: (fn) => fn,
    clientRef: { current: client },
    spaceDirectoryRef: { current: { activeId: "personal" } },
    setAuto: (value) => results.push(value),
  };
  return {
    ...bindings, pending, results,
    get reads() { return reads; },
    refresh: callback("refreshAuto", bindings),
  };
}

test("automation refresh preserves jobs and scheduler while failing closed on non-cron history", async () => {
  const harness = refreshHarness();
  const snapshot = {
    jobs: [{ id: "daily", name: "Daily" }],
    scheduler: { healthy: true },
    sessions: [
      { ...run, source: "cron" },
      { ...run, id: "gateway-chat", source: "gateway" },
      { ...run, id: "unknown-source" },
      { ...run, id: "manual", source: "interactive" },
    ],
  };
  const refreshing = harness.refresh();
  harness.pending.resolve(snapshot);
  await refreshing;
  assert.equal(harness.reads, 1);
  assert.equal(harness.results[0].jobs, snapshot.jobs);
  assert.equal(harness.results[0].scheduler, snapshot.scheduler);
  assert.deepEqual(harness.results[0].sessions, [snapshot.sessions[0]]);
  assert.equal(snapshot.sessions.length, 4, "refresh must not mutate the engine snapshot");
});

test("a late automation refresh does not publish data after its engine or Personal Space changes", async () => {
  for (const transition of [staleReplayTransitions["engine replacement"], staleReplayTransitions["company Space"]]) {
    const harness = refreshHarness();
    const refreshing = harness.refresh();
    transition(harness);
    harness.pending.resolve({ jobs: [], sessions: [{ ...run, source: "cron" }] });
    await refreshing;
    assert.deepEqual(harness.results, []);
  }
});

test("automation refresh skips company and unresolved Spaces and preserves the old-engine notice", async () => {
  for (const directory of [{ activeId: "company" }, null]) {
    const harness = refreshHarness();
    harness.spaceDirectoryRef.current = directory;
    await harness.refresh();
    assert.equal(harness.reads, 0);
    assert.deepEqual(harness.results, [null]);
  }
  const unsupported = refreshHarness();
  const refreshing = unsupported.refresh();
  unsupported.pending.resolve(null);
  await refreshing;
  assert.deepEqual(unsupported.results, ["old-server"]);
});

test("ready Personal Spaces refresh in the background, on focus, and every 30 seconds with cleanup", () => {
  let source;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect"
      && node.arguments[0]?.getText(parsed).includes("refreshAuto()")
      && node.arguments[0].getText(parsed).includes("30_000")) {
      assert.equal(source, undefined, "the renderer must register only one recurring automation refresh");
      source = node.arguments[0].getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(source);
  assert.doesNotMatch(source, /\bzone\b|\bsetSec\b/, "hidden task navigation must keep background unread state current");

  for (const [phase, activeId, expected] of [["ready", "personal", true], ["ready", "company", false], ["connecting", "personal", false]]) {
    let reads = 0;
    const intervals = [];
    const listeners = [];
    const cleared = [];
    const removed = [];
    const effect = evaluate(source, {
      phase,
      spaceDirectory: { activeId },
      refreshAuto: () => { reads += 1; },
      window: {
        setInterval: (fn, ms) => { intervals.push({ fn, ms }); return 42; },
        addEventListener: (...args) => listeners.push(args),
        clearInterval: (id) => cleared.push(id),
        removeEventListener: (...args) => removed.push(args),
      },
    });
    const cleanup = effect();
    if (expected) {
      assert.equal(reads, 1);
      assert.equal(intervals[0].ms, 30_000);
      assert.equal(listeners[0][0], "focus");
      intervals[0].fn();
      listeners[0][1]();
      assert.equal(reads, 3);
      cleanup();
      assert.deepEqual(cleared, [42]);
      assert.deepEqual(removed, listeners);
    } else {
      assert.equal(reads, 0);
      assert.deepEqual(intervals, []);
      assert.deepEqual(listeners, []);
      assert.equal(cleanup, undefined);
    }
  }
});

function renderAutomationSurface(overrides = {}) {
  const pages = [];
  const sidebars = [];
  let forks = 0;
  const action = () => {};
  const bindings = {
    React: { createElement, Fragment },
    Suspense,
    activeSpaceId: "personal",
    localResourceIsolationNotice: "Personal resources are isolated",
    auto: { jobs: [{ id: "daily", name: "Daily" }], sessions: [run], scheduler: { healthy: true } },
    autoReplay: null,
    autoForking: false,
    settingsAutomationOpen: true,
    locale: "en",
    AUTOMATION_COPY_EN: {},
    autoView: "tasks",
    t: (key) => key,
    sessionOpenRequestRef: { current: 0 },
    setAutoView: action,
    setAutoReplay: action,
    markAutoSeen: action,
    addAutomationDraft: action,
    updateAutomationDraft: action,
    runAutomationNow: action,
    toggleAutomation: action,
    deleteAutomation: action,
    installAutomationScheduler: action,
    openAutomationReplay: action,
    pickAutomationDirectory: action,
    openAutomations: action,
    continueManually: () => { forks += 1; },
    AssistantMessage: ({ text }) => createElement("p", null, text),
    AutomationSidebar: (props) => {
      sidebars.push(props);
      return createElement("nav", { "data-view": props.view });
    },
    AutomationsPage: (props) => {
      pages.push(props);
      return createElement("main", { "data-view": props.view });
    },
    ...overrides,
  };
  const replayElement = callback("automationReplaySurface", bindings);
  const element = callback("automationContent", { ...bindings, automationReplaySurface: replayElement });
  return {
    bindings, replayElement, pages, sidebars,
    html: renderToStaticMarkup(element),
    get forks() { return forks; },
  };
}

test("the Settings surface retains all four views, compact navigation, and schedule controls", () => {
  for (const view of ["tasks", "attention", "paused", "runs"]) {
    const surface = renderAutomationSurface({ autoView: view });
    assert.equal(surface.pages.length, 1);
    assert.equal(surface.sidebars.length, 1);
    assert.equal(surface.sidebars[0].compact, true);
    assert.equal(surface.sidebars[0].view, view);
    assert.equal(surface.pages[0].view, view);
    assert.equal(surface.pages[0].jobs, surface.bindings.auto.jobs);
    assert.equal(surface.pages[0].sessions, surface.bindings.auto.sessions);
    for (const [prop, binding] of [
      ["add", "addAutomationDraft"], ["update", "updateAutomationDraft"], ["run", "runAutomationNow"],
      ["toggle", "toggleAutomation"], ["delete", "deleteAutomation"], ["install", "installAutomationScheduler"],
      ["openReplay", "openAutomationReplay"],
    ]) assert.equal(surface.pages[0][prop], surface.bindings[binding]);
    assert.equal(surface.pages[0].onManage, undefined);
  }
});

test("pending automation data remains null so the page renders loading rather than a misleading empty result", () => {
  const surface = renderAutomationSurface({ auto: null });
  assert.equal(surface.pages[0].jobs, null);
  assert.equal(surface.pages[0].sessions, null);
  assert.equal(surface.sidebars[0].jobs, null);
  assert.equal(surface.sidebars[0].sessions, null);
});

test("company Spaces and unsupported engines do not mount personal automation data", () => {
  for (const [overrides, notice] of [
    [{ activeSpaceId: "company", autoReplay: { ...run, items: [{ role: "assistant", text: "Private result" }] } }, "Personal resources are isolated"],
    [{ auto: "old-server" }, "autoNeedsUpdate"],
  ]) {
    const surface = renderAutomationSurface(overrides);
    assert.deepEqual(surface.pages, []);
    assert.deepEqual(surface.sidebars, []);
    assert.match(surface.html, new RegExp(notice));
    assert.doesNotMatch(surface.html, /Private result/);
  }
});

test("the shared replay surface remains read-only until its explicit fork button is selected", () => {
  const surface = renderAutomationSurface({
    autoReplay: { ...run, items: [{ role: "user", text: "<script>unsafe</script>" }, { role: "assistant", text: "Saved result" }] },
  });
  assert.deepEqual(surface.pages, []);
  assert.deepEqual(surface.sidebars, []);
  assert.match(surface.html, /readonlyAuto/);
  assert.match(surface.html, /forkFromHere/);
  assert.match(surface.html, /Saved result/);
  assert.match(surface.html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(surface.html, /<textarea|contenteditable|<form|<script>/);
  assert.equal(surface.forks, 0);
  const anchor = surface.replayElement.props.children[0];
  const forkButton = anchor.props.children.find((child) => child?.type === "button" && child.props.className === "paneltab");
  assert.ok(forkButton, "continuing must be an explicit replay action");
  forkButton.props.onClick();
  assert.equal(surface.forks, 1);
});

test("returning from a replay invalidates late replay and fork responses without reopening the result", async () => {
  for (const action of ["replay", "fork"]) {
    const harness = action === "replay" ? replayHarness() : forkHarness();
    const pending = action === "replay" ? harness.open(run) : harness.continue();
    const cleared = [];
    const surface = renderAutomationSurface({
      autoReplay: { ...run, items: [] },
      sessionOpenRequestRef: harness.sessionOpenRequestRef,
      setAutoReplay: (value) => cleared.push(value),
    });
    const before = harness.sessionOpenRequestRef.current;
    const anchor = surface.replayElement.props.children[0];
    const back = anchor.props.children.find((child) => child?.type === "button" && child.props.className === "linky");
    assert.ok(back);
    back.props.onClick();
    assert.equal(harness.sessionOpenRequestRef.current, before + 1);
    assert.deepEqual(cleared, [null]);
    harness.pending.resolve({ sessionId: "late-fork", history });
    await pending;
    assert.equal(harness.attachedSessionsRef.current.size, 0);
    if (action === "replay") assert.deepEqual(harness.replay, []);
    else {
      assert.deepEqual(harness.destinations, []);
      assert.deepEqual(harness.remembered, []);
      assert.equal(harness.autoForkingRef.current, false);
      assert.deepEqual(harness.forkingStates, [true, false]);
    }
  }
});

test("changing a task classification invalidates pending results and marks only run history as seen", () => {
  const views = [];
  const cleared = [];
  let seen = 0;
  const surface = renderAutomationSurface({
    setAutoView: (value) => views.push(value),
    setAutoReplay: (value) => cleared.push(value),
    markAutoSeen: () => { seen += 1; },
  });
  for (const view of ["attention", "paused", "tasks", "runs"]) surface.sidebars[0].onViewChange(view);
  assert.equal(surface.bindings.sessionOpenRequestRef.current, 4);
  assert.deepEqual(views, ["attention", "paused", "tasks", "runs"]);
  assert.deepEqual(cleared, [null, null, null, null]);
  assert.equal(seen, 1);
  const pendingFork = renderAutomationSurface({ autoReplay: { ...run, items: [] }, autoForking: true });
  assert.match(pendingFork.html, /class="paneltab" disabled=""/);
});

test("Settings and an optional task shortcut share their result renderer and route secondary entry points consistently", () => {
  assert.match(app, /setSec === "automations"[\s\S]*?automation-settings-surface">\{automationContent\}/);
  assert.match(app, /zone === "auto" \? \([\s\S]*?<main className="chat board automation-board">\s*\{automationContent\}/);
  assert.match(app, /e\.key === "3"[\s\S]*?apiRef\.current\.openAutomations\(\)/);
  assert.match(app, /if \(place === "auto"\)[\s\S]*?openAutomations\("runs"\)[\s\S]*?openReplay\(session\)/);
  assert.match(app, /id === "core\.tasks"[\s\S]*?openAutomations\(\)/);
  assert.match(app, /automationNotice=\{activeSpaceId === "personal"[\s\S]*?openAutomations\("runs"\)/);
});

test("sidebar customization stays inside advanced Appearance controls with a recovery path", () => {
  assert.match(app, /const advancedSidebarSettings = \([\s\S]*?<details className="settings-sidebar-advanced"[\s\S]*?<ModuleDockSettings\s+embedded/);
  assert.match(app, /setSec === "lang"[\s\S]*?\{advancedSidebarSettings\}/);
  assert.doesNotMatch(app, /\["modules", t\("setModules"\)\]/);
  assert.doesNotMatch(app, /setSec === "modules"/);
  const selected = [];
  const open = callback("openSidebarSettings", {
    setZone: (place) => { selected.push(place); return true; },
    setSetSec: (section) => selected.push(section),
    setSidebarPreferencesOpen: (visible) => selected.push(visible),
  });
  open();
  assert.deepEqual(selected, ["settings", "lang", true]);
});
