import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { connectionCanCopyNativeImages, conversationHasNativeImages } from "../src/model-connection-recovery.ts";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, bindings) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      assert.equal(initializer, undefined);
      initializer = node.initializer?.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
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
