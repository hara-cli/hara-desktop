import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-settings-navigation-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import React from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {SettingsNavigation,SETTINGS_NAVIGATION_GROUPS} from "./src/SettingsNavigation.tsx";
    import {makeT} from "./src/i18n.ts";
    export {SETTINGS_NAVIGATION_GROUPS};
    export function props(locale) {const t=makeT(locale);return {section:"providers",label:t("settingsNavigation"),
      groupLabels:{work:t("settingsGroupWork"),app:t("settingsGroupApp")},
      labels:{providers:t("setProviders"),connections:t("setConnections"),automations:t("setAutomations"),
      learning:t("setLearning"),capabilities:t("setCapabilities"),engine:t("setServer"),security:t("setSecurity"),
      mobile:t("setMobile"),lang:t("setLang")},onIntent(){},onSelect(){}};}
    export function render(input) {return renderToStaticMarkup(React.createElement(SettingsNavigation,input));}
    export function tree(input) {return SettingsNavigation(input);}
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false,
});
const compiled = join(fixture, "navigation.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render, tree, props, SETTINGS_NAVIGATION_GROUPS } = createRequire(import.meta.url)(compiled);
function nodes(element, found = []) {
  if (Array.isArray(element)) { for (const item of element) nodes(item, found); }
  else if (element && typeof element === "object" && element.props) { found.push(element); nodes(element.props.children, found); }
  return found;
}

test("work and application settings retain each stable route exactly once without claiming new Workspace authority", () => {
  assert.deepEqual(SETTINGS_NAVIGATION_GROUPS.map((group) => group.id), ["work", "app"]);
  assert.deepEqual(SETTINGS_NAVIGATION_GROUPS[0].items, ["providers", "connections", "automations", "learning", "capabilities"]);
  assert.deepEqual(SETTINGS_NAVIGATION_GROUPS[1].items, ["engine", "security", "mobile", "lang"]);
  const ids = SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.items);
  assert.equal(new Set(ids).size, 9);
  for (const locale of ["en", "zh"]) {
    const html = render(props(locale));
    assert.equal((html.match(/role="group"/g) ?? []).length, 2);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.match(html, locale === "zh" ? /工作设置/ : /Work settings/);
    assert.match(html, locale === "zh" ? /应用与设备/ : /App &amp; device/);
    assert.doesNotMatch(html, /workspace\.v2|enterprise key|企业 Key/);
  }
});

test("actual navigation keeps hover/focus intent separate from selecting a route and never executes work", () => {
  const actions = [];
  const input = { ...props("en"), onIntent: (id) => actions.push(["intent", id]), onSelect: (id) => actions.push(["select", id]) };
  const buttons = nodes(tree(input)).filter((node) => node.type === "button");
  assert.deepEqual(actions, []);
  buttons[2].props.onMouseEnter();
  buttons[2].props.onFocus();
  buttons[2].props.onClick();
  assert.deepEqual(actions, [["intent", "automations"], ["intent", "automations"], ["select", "automations"]]);
});

test("only the supplied automation count is displayed and zero counts do not invent unread state", () => {
  assert.doesNotMatch(render(props("en")), /settings-automation-count/);
  const html = render({ ...props("en"), section: "security", automationCount: 3 });
  assert.match(html, /class="settings-automation-count">3</);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});
