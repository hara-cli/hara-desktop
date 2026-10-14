import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const center = readFileSync(new URL("../src/ExternalSessionCenter.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("ExternalSessionCenter.tsx", center, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function createCallback(bindings) {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "createRuntime") {
      initializer = node.initializer?.getText(parsed);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(initializer);
  const { outputText } = ts.transpileModule(`return (${initializer});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return new Function(...Object.keys(bindings), outputText)(...Object.values(bindings));
}

test("the standalone coding center entry is retired, not replaced with data cleanup", () => {
  assert.equal(/const openCodingRecovery\s*=/.test(app), false);
  assert.equal(/onClick=\{openCodingRecovery\}/.test(app), false);
  assert.equal(/<SettingsCard title=\{t\("codingRecoveryTitle"\)\}/.test(app), false);
  assert.ok(/<ExternalSessionCenter[\s\S]*?allowStandaloneLaunch=\{false\}/.test(app));
  assert.ok(/onOpenRuntimeSession=\{\(sessionId\) =>/.test(app),
    "an Agent's exact existing execution remains inspectable");
  assert.ok(/onResume=\{resumeSelectedExternalSession\}/.test(app));
  assert.ok(/onQuestionReply=\{answerExternalQuestion\}/.test(app));
});

test("the retired launcher is opt-in and hidden even when an older engine advertises create", () => {
  assert.ok(/allowStandaloneLaunch = false/.test(center));
  assert.ok(/\{allowStandaloneLaunch && selectedSourceId === "runtime" && runtimeSource\?\.capabilities\.create \?/.test(center));
  const calls = [];
  const create = createCallback({
    allowStandaloneLaunch: false,
    onCreate: (...args) => calls.push(args),
  });
  create();
  assert.deepEqual(calls, [], "closing the entry must not launch, stop or delete a session");
});
