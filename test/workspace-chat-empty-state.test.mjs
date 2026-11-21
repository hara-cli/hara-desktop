import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeT } from "../src/i18n.ts";

const source = await build({
  stdin: {
    contents: 'export { WorkspaceChatEmptyState } from "./src/WorkspaceLocalDev.tsx";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "tsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react"],
  loader: { ".css": "empty", ".svg": "dataurl" },
  write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", source.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { WorkspaceChatEmptyState } = module.exports;
const main = { kind: "main", identity: { displayName: "Hara", title: "Orchestrator" } };
const colleague = { kind: "colleague", identity: { displayName: "Nova" } };

function render(agent, t) {
  return renderToStaticMarkup(createElement(WorkspaceChatEmptyState, {
    agent,
    t,
    onDiscuss() {},
    onAskAboutTasks() {},
  }));
}

test("the main empty chat retains the Hara greeting, mascot and two shortcut buttons", () => {
  const t = makeT("zh-Hans");
  const html = render(main, t);
  assert.equal(html.includes('<h2>' + t("ws.home.title") + '</h2>'), true);
  assert.equal(html.includes('<p>' + t("ws.home.hint") + '</p>'), true);
  assert.equal(html.includes('data-mascot-state="idle"'), true);
  assert.equal(html.includes('class="hs-chips"'), true);
  assert.equal((html.match(/<button class="hs-chip"/g) ?? []).length, 2);
  assert.equal(html.includes(t("ws.home.chip.colleague")), true);
  assert.equal(html.includes(t("ws.home.chip.tasks")), true);
  assert.equal(render(undefined, t), html);
});

test("a colleague empty chat renders their role as a title label in all three locales", () => {
  const expectations = [
    ["en", "Fixture colleague", "What would you like to work on with Nova?", "Nova (Fixture colleague) is here. Just say what you’d like to do."],
    ["zh-Hans", "财务同事", "和 Nova 一起做点什么？", "Nova（财务同事）在这里，直接说要做的事就好。"],
    ["zh-Hant", "財務同事", "和 Nova 一起做點什麼？", "Nova（財務同事）在這裡，直接說要做的事就好。"],
  ];
  for (const [locale, role, title, hint] of expectations) {
    const html = render({ ...colleague, identity: { ...colleague.identity, title: role } }, makeT(locale));
    assert.equal(html, '<div class="hs-hello"><h2>' + title + '</h2><p>' + hint + '</p></div>', locale);
  }
});

test("a colleague with a missing or blank role gets the localized direct-chat hint", () => {
  const hints = [
    ["en", "Tell Nova what you want to work on."],
    ["zh-Hans", "直接告诉 Nova 要做的事就好。"],
    ["zh-Hant", "直接告訴 Nova 要做的事就好。"],
  ];
  for (const [locale, hint] of hints) {
    const t = makeT(locale);
    for (const title of [undefined, "", "  "]) {
      const html = render({ ...colleague, identity: { ...colleague.identity, title } }, t);
      assert.equal(html, '<div class="hs-hello"><h2>' + t("ws.home.colleague.title", { name: "Nova" }) +
        '</h2><p>' + hint + '</p></div>', locale);
    }
  }
});
