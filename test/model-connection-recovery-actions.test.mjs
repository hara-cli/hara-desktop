import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { connectionCanCopyNativeImages, conversationHasNativeImages, focusedModelConnection } from "../src/model-connection-recovery.ts";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const providerParsed = ts.createSourceFile("ProviderSettings.tsx", readFileSync(new URL("../src/ProviderSettings.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, bindings, sourceFile = parsed) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      assert.equal(initializer, undefined);
      initializer = node.initializer?.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(initializer, `missing actual renderer callback ${name}`);
  const { outputText } = ts.transpileModule(`return (${initializer});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  });
  return new Function(...Object.keys(bindings), outputText)(...Object.values(bindings));
}

test("opening connection recovery clears old search and refreshes both route catalogs without sending", async () => {
  const actions = [];
  callback("openConnectionPicker", {
    setAttachmentMenuOpen: value => actions.push(["attachments", value]),
    setModelSearch: value => actions.push(["search", value]),
    setModelConnectionPickerMode: value => actions.push(["connections", value]),
    setModelPickerOpen: value => actions.push(["open", value]),
    activeSession: { cwd: "/tmp/synthetic-project" },
    refreshProviderRoutes: async cwd => actions.push(["personal", cwd]),
    refreshOrganizationRoutes: async cwd => actions.push(["organization", cwd]),
  })();
  await Promise.resolve();
  assert.deepEqual(actions, [["attachments", false], ["search", ""], ["connections", true], ["open", true],
    ["personal", "/tmp/synthetic-project"], ["organization", "/tmp/synthetic-project"]]);
});

test("managing the pinned account is exact, normal settings clears focus, and cancellation changes nothing", () => {
  let focus = { profileId: "previous", request: 3 };
  const actions = [];
  const open = callback("openModelConnections", {
    setZone: value => { actions.push(["zone", value]); return true; },
    setSetSec: value => actions.push(["section", value]),
    setModelPickerOpen: value => actions.push(["picker", value]),
    setProviderSettingsConnectionFocus: update => { focus = typeof update === "function" ? update(focus) : update; },
  });
  assert.equal(open("tokenplan"), true);
  assert.deepEqual(focus, { profileId: "tokenplan", request: 4 });
  assert.deepEqual(actions, [["zone", "settings"], ["section", "providers"], ["picker", false]]);
  open();
  assert.equal(focus, undefined, "ordinary settings must not retain a recovery-account request");
  const cancelled = callback("openModelConnections", {
    setZone: () => false,
    setSetSec: () => assert.fail("cancelled navigation must retain the section"),
    setModelPickerOpen: () => assert.fail("cancelled navigation must retain the picker"),
    setProviderSettingsConnectionFocus: () => assert.fail("cancelled navigation must retain focus"),
  });
  assert.equal(cancelled("tokenplan"), false);
});

test("native-image model changes use only the matching session's capability catalog", async () => {
  for (const modelInfoScope of ["another-session", "session-a"]) {
    const errors = [], staged = [], flushed = [];
    const change = callback("changeModel", {
      clientRef: { current: { connected: true } }, active: "session-a",
      sessionsRef: { current: [{ id: "session-a", model: "original" }] },
      stagedModelChangesRef: { current: {} }, sessEffort: {}, locale: "zh",
      transcriptsRef: { current: { "session-a": [{ kind: "user", attachments: [{ kind: "image", strategy: "native-image" }] }] } },
      conversationHasNativeImages, modelInfoScope,
      modelInfo: { entries: [{ id: "vision", attachmentCapabilities: { image: { mode: "native" } } }] },
      setErr: message => errors.push(message),
      setModelPickerOpen() {}, setModelSearch() {},
      stageModelChange: (...args) => staged.push(args), busyRef: { current: {} },
      flushStagedModelChange: async id => flushed.push(id), push() {},
    });
    await change("vision");
    if (modelInfoScope === "another-session") {
      assert.equal(errors.length, 1);
      assert.deepEqual(staged, [], "another account's capability claim must not stage a change");
      assert.deepEqual(flushed, []);
    } else {
      assert.deepEqual(errors, []);
      assert.deepEqual(staged, [["session-a", "vision", ""]]);
      assert.deepEqual(flushed, ["session-a"]);
    }
  }
});

function personalHarness(support, confirm) {
  const calls = [], errors = [];
  const source = { id: "source", cwd: "/tmp/synthetic-project", model: "vision-original" };
  const client = {
    supportsFeature: () => true,
    useProviderConnection: async () => assert.fail("must not activate a connection"),
    forkSession: async () => assert.fail("must not fork a conversation"),
  };
  const start = callback("startPersonalConnectionSession", {
    clientRef: { current: client }, active: "source", sessionsRef: { current: [source] },
    modelConnectionTransferRef: { current: false },
    spaceDirectoryRef: { current: { spaces: [] } }, sessionSpaceId: () => "personal",
    CROSS_PROFILE_FORK_FEATURE: "fork", SPACE_ROUTE_FEATURE: "space", busyRef: { current: {} },
    providerRoutes: { current: { environmentOverride: false }, switchLocked: false }, locale: "zh",
    connectionCanCopyNativeImages, conversationHasNativeImages,
    transcriptsRef: { current: { source: [{ kind: "user", attachments: [{ kind: "image", strategy: "native-image" }] }] } },
    setErr: message => errors.push(message),
    composerDrafts: {}, emptyComposerDraft: () => ({ text: "", attachments: [] }),
    window: { confirm: () => { calls.push("confirm"); return confirm; } },
  });
  return { errors, calls, start: () => start({ id: "target", label: "Target", model: "target-model", authenticated: true,
    capabilities: { imageInput: support } }) };
}

test("unsupported or unknown image targets do not confirm, mutate defaults, or fork", async () => {
  for (const support of ["unsupported", "unknown", undefined]) {
    const harness = personalHarness(support, true);
    await harness.start();
    assert.equal(harness.errors.length, 1);
    assert.deepEqual(harness.calls, []);
  }
});

test("a compatible image target still requires confirmation and a cancelled transfer has no writes", async () => {
  const harness = personalHarness("supported", false);
  await harness.start();
  assert.deepEqual(harness.errors, []);
  assert.deepEqual(harness.calls, ["confirm"]);
});

function settingsHarness(initialFocus) {
  let view = { kind: "provider", id: "" }, error = "", nextFocus = initialFocus;
  const personal = [{ id: "tokenplan", provider: "token-plan", model: "vision" },
    { id: "other", provider: "token-plan", model: "text", active: true }];
  const organization = { id: "company-model", active: false };
  let organizationsAvailable = true;
  const bindings = {
    client: {
      listProviderSettings: async () => ({ current: { profileId: "other", provider: "token-plan", model: "text" },
        connections: personal, providers: [] }),
      listOrganizationConnections: async () => {
        if (!organizationsAvailable) throw new Error("synthetic list unavailable");
        return { connections: [organization] };
      },
    },
    cwd: "/tmp/synthetic-project", locale: "zh", request: { current: 0 },
    handledConnectionFocus: { current: undefined }, useCallback: fn => fn, focusedModelConnection,
    setPhase() {}, setApiKey() {}, setRegistrationCode() {}, setMessage() {}, setUnsupported() {},
    setState() {}, setDraft() {}, setVisionDraft() {}, setVisionModels() {}, setVisionRouteTested() {},
    setVisionApiKey() {}, setClearVisionApiKey() {}, setPersonalDraft() {}, setModels() {},
    setModelEntries() {}, setVerifiedCustomModels() {}, setOrganizationsUnsupported() {}, setOrganizations() {},
    setError: value => { error = value; },
    setView: update => { view = typeof update === "function" ? update(view) : update; },
  };
  for (const name of ["draftFromState", "visionDraftFromState", "personalDraftForProvider", "viewForPersonalConnection"]) {
    bindings[name] = callback(name, {}, providerParsed);
  }
  for (const name of ["isLegacyProvider", "isLegacyProviderId"]) {
    bindings[name] = callback(name, { LEGACY_PERSONAL_PROVIDER_IDS: new Set() }, providerParsed);
  }
  return {
    get view() { return view; }, get error() { return error; },
    select: id => { view = { kind: "connection", id }; },
    focus: request => { nextFocus = request; },
    organizationsAvailable: available => { organizationsAvailable = available; },
    load: () => callback("load", { ...bindings, focusConnection: nextFocus }, providerParsed)(),
  };
}

test("settings recovery focus is one-shot and refresh preserves a later manual account selection", async () => {
  const harness = settingsHarness({ profileId: "tokenplan", request: 1 });
  await harness.load();
  assert.deepEqual(harness.view, { kind: "connection", id: "tokenplan" });
  harness.select("other");
  await harness.load();
  assert.deepEqual(harness.view, { kind: "connection", id: "other" });
  harness.focus({ profileId: "tokenplan", request: 2 });
  await harness.load();
  assert.deepEqual(harness.view, { kind: "connection", id: "tokenplan" });
});

test("a partial connection-list failure does not declare the requested organization removed or consume its focus", async () => {
  const harness = settingsHarness({ profileId: "company-model", request: 1 });
  harness.organizationsAvailable(false);
  await harness.load();
  assert.doesNotMatch(harness.error, /已移除|was removed/);
  assert.match(harness.error, /未能完整加载/);
  harness.organizationsAvailable(true);
  await harness.load();
  assert.deepEqual(harness.view, { kind: "organization", id: "company-model" });
});

function transferHarness(kind, options = {}) {
  const calls = [], errors = [];
  const source = { id: "source", cwd: "/tmp/synthetic-project", model: "old-model" };
  const route = { current: { authenticated: true, provider: "token-plan", model: "new-model" } };
  let active = "source", drafts = { source: { text: "Unsent synthetic draft", attachments: [] } };
  const transferRef = { current: false };
  const client = {
    supportsFeature: () => true,
    forkSession: async (id, target) => {
      calls.push(["fork", id, target]);
      if (options.fork) return options.fork();
      if (options.rejectFork) throw new Error("synthetic host rejected copy");
      return { sessionId: "copied", history: [] };
    },
    useProviderConnection: async id => {
      calls.push(["default", id]);
      if (options.rejectDefault) throw new Error("synthetic lost default ACK");
      return route;
    },
    useOrganizationConnection: async id => {
      calls.push(["default", id]);
      if (options.rejectDefault) throw new Error("synthetic lost default ACK");
      return { connections: [], activeId: id };
    },
    listProviderSettings: async () => route,
  };
  const bindings = {
    clientRef: { current: client }, active: "source", sessionsRef: { current: [source] },
    spaceDirectoryRef: { current: { spaces: [] } },
    sessionSpaceId: () => kind === "personal" ? "personal" : "company", organizationConnectionSpaceId: () => "company",
    CROSS_PROFILE_FORK_FEATURE: "fork", SPACE_ROUTE_FEATURE: "space", busyRef: { current: {} },
    providerRoutes: { current: { environmentOverride: false }, switchLocked: false }, locale: "zh",
    connectionCanCopyNativeImages, conversationHasNativeImages, transcriptsRef: { current: {} },
    setErr: message => errors.push(message), composerDrafts: drafts, emptyComposerDraft: () => ({ text: "", attachments: [] }),
    window: { confirm: () => true }, discardCurrentExtensionDraft: () => true,
    modelConnectionTransferRef: transferRef, setModelConnectionTransferPending() {},
    setModelPickerOpen() {}, setModelSearch() {}, setProviderRoutes() {}, setOrganizationRoutes() {},
    setSetupRequired() {}, setServer() {}, attachedSessionsRef: { current: new Set() }, setSessionReadOnly() {},
    setTranscripts: update => update({}), conversationItemsFromHistory: () => [], rememberSession() {},
    setComposerDrafts: update => { drafts = update(drafts); },
    refreshSessions: async () => { if (options.rejectRefresh) throw new Error("synthetic refresh unavailable"); },
    setActive: id => { active = id; }, refreshModelInfo: async () => {},
    refreshProviderRoutes: async () => {}, refreshOrganizationRoutes: async () => {}, refreshGroupsDirectory() {},
    companyAccessRecoveryMessage: () => null, quarantineCompanySession: () => assert.fail("not a revocation"),
  };
  const start = callback(kind === "personal" ? "startPersonalConnectionSession" : "startOrganizationSession", bindings);
  const connection = { id: "target", label: "Synthetic target", model: "new-model", availableModels: ["new-model"], authenticated: true };
  return { calls, errors, get active() { return active; }, get drafts() { return drafts; },
    get pending() { return transferRef.current; }, start: () => start(connection, "new-model") };
}

for (const kind of ["personal", "organization"]) {
  test(`${kind}: host-rejected copy never changes the default connection or moves the draft`, async () => {
    const harness = transferHarness(kind, { rejectFork: true });
    await harness.start();
    assert.deepEqual(harness.calls.map(call => call[0]), ["fork"]);
    assert.equal(harness.active, "source");
    assert.ok(harness.drafts.source); assert.equal(harness.drafts.copied, undefined);
    assert.equal(harness.pending, false); assert.equal(harness.errors.filter(Boolean).length, 1);
  });

  test(`${kind}: default update failure retains the successful copy, reports uncertainty and does not retry`, async () => {
    const harness = transferHarness(kind, { rejectDefault: true });
    await harness.start();
    assert.deepEqual(harness.calls.map(call => call[0]), ["fork", "default"]);
    assert.equal(harness.active, "copied");
    assert.equal(harness.drafts.source, undefined); assert.equal(harness.drafts.copied.text, "Unsent synthetic draft");
    assert.match(harness.errors.filter(Boolean).join(""), /复制已完成[\s\S]*默认连接.*未.*确认/);
    assert.equal(harness.pending, false);
  });

  test(`${kind}: concurrent clicks create only one copy and release the guard after completion`, async () => {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const harness = transferHarness(kind, { fork: () => pending });
    const first = harness.start();
    const second = harness.start();
    assert.equal(harness.calls.filter(call => call[0] === "fork").length, 1);
    resolve({ sessionId: "copied", history: [] });
    await Promise.all([first, second]);
    assert.equal(harness.calls.filter(call => call[0] === "default").length, 1);
    assert.equal(harness.pending, false);
  });

  test(`${kind}: a post-copy refresh error is not misreported as a failed copy`, async () => {
    const harness = transferHarness(kind, { rejectRefresh: true });
    await harness.start();
    assert.equal(harness.calls.filter(call => call[0] === "fork").length, 1);
    assert.match(harness.errors.filter(Boolean).join(""), /复制已完成/);
    assert.doesNotMatch(harness.errors.filter(Boolean).join(""), /无法复制/);
    assert.equal(harness.pending, false);
  });
}
