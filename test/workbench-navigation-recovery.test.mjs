import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { CORE_NAVIGATION_CONTRIBUTIONS } from "../src/navigation.ts";
import { makeT } from "../src/i18n.ts";

const raw = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("App.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate, root = tree) {
  let result;
  function visit(node) {
    if (predicate(node)) { assert.equal(result, undefined); result = node; return; }
    ts.forEachChild(node, visit);
  }
  visit(root); assert.ok(result); return result;
}
function evaluate(source, bindings) {
  const code = ts.transpileModule("return (" + source + ");", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}
const variable = name => find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name).initializer;
const railOnSelect = find(node => ts.isJsxAttribute(node) && node.name.getText(tree) === "onSelect", variable("rail")).initializer.expression;

for (const initialMode of ["deliverables", "external", "projects"]) {
  test(`the actual chat-rail callback leaves ${initialMode} and restores the Agent directory without touching history`, () => {
    let mode = initialMode, target = { kind: "project", id: "synthetic" }, query = "old search", directory = false;
    const actions = [];
    const bindings = {
      CORE_NAVIGATION_CONTRIBUTIONS, zoneRef: { current: "chat" }, workbenchPlaceRef: { current: "chat" },
      setZone: place => { actions.push(place); return true; },
      setWorkbenchInboxMode: value => { mode = value; }, setWorkbenchInboxTarget: value => { target = value; },
      setContactDirectoryOpen: value => { directory = value; }, setQ: value => { query = value; },
    };
    bindings.returnToAgentDirectory = evaluate(variable("returnToAgentDirectory").getText(tree), bindings);
    evaluate(railOnSelect.getText(tree), bindings)("core.chat");
    assert.deepEqual(actions, ["chat"]); assert.equal(mode, "agents"); assert.equal(target, null);
    assert.equal(query, ""); assert.equal(directory, true);
  });
}

test("cancelling the place transition cannot change the current browse mode", () => {
  evaluate(railOnSelect.getText(tree), { CORE_NAVIGATION_CONTRIBUTIONS,
    zoneRef: { current: "projects" }, workbenchPlaceRef: { current: "chat" }, setZone: () => false,
    returnToAgentDirectory: () => assert.fail("cancelled navigation must not discard the current view"),
  })("core.chat");
});

test("the actual sidebar heading names the current mode and always offers an exit from non-Agent views", () => {
  const heading = find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(property =>
    ts.isJsxAttribute(property) && property.name.getText(tree) === "className"
    && property.initializer?.getText(tree) === '"workbench-inbox-heading"'));
  for (const locale of ["zh", "en"]) for (const mode of ["agents", "deliverables", "external", "projects"]) {
    const html = renderToStaticMarkup(evaluate(heading.getText(tree), { React, IconUsers: () => null, IconBack: () => null,
      workbenchInboxMode: mode, t: makeT(locale), locale, visibleHiredAgentCount: 8, returnToAgentDirectory() {},
    }));
    if (mode === "agents") { assert.match(html, />8<\/span>/); assert.doesNotMatch(html, /<button/); }
    else { assert.match(html, /<button/); assert.doesNotMatch(html, />8<\/span>/); }
    if (mode === "deliverables") assert.match(html, locale === "zh" ? /交付物/ : /Deliverables/);
  }
});

test("Computer Use opens its global security section and cancellation leaves the old section untouched", () => {
  const changes = [];
  const open = evaluate(variable("openSecuritySettings").getText(tree), {
    setZone: place => { changes.push(["place", place]); return true; },
    setSecuritySettingsAnchor: value => changes.push(["anchor", value]),
    setSetSec: value => changes.push(["section", value]),
  });
  assert.equal(open("settings-computer-use"), true);
  assert.deepEqual(changes, [["place", "settings"], ["anchor", "settings-computer-use"], ["section", "security"]]);
  const cancelled = evaluate(variable("openSecuritySettings").getText(tree), {
    setZone: () => false, setSecuritySettingsAnchor: () => assert.fail("no anchor write"), setSetSec: () => assert.fail("no section write"),
  });
  assert.equal(cancelled("settings-computer-use"), false);
});
