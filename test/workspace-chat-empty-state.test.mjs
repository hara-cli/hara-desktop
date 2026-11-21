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
const colleague = { kind: "colleague", identity: { displayName: "Nova", title: "release planning" } };

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

test("a colleague empty chat renders their name and role in all three locales", () => {
  const expectations = [
    ["en", "What would you like to work on with Nova?", "Nova handles release planning. Just say what you’d like to do."],
    ["zh-Hans", "和 Nova 一起做点什么？", "Nova 负责 release planning，直接说要做的事就好。"],
    ["zh-Hant", "和 Nova 一起做點什麼？", "Nova 負責 release planning，直接說要做的事就好。"],
  ];
  for (const [locale, title, hint] of expectations) {
    const html = render(colleague, makeT(locale));
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
      const html = render({ ...colleague, identity: { displayName: "Nova", title } }, t);
      assert.equal(html, '<div class="hs-hello"><h2>' + t("ws.home.colleague.title", { name: "Nova" }) +
        '</h2><p>' + hint + '</p></div>', locale);
    }
  }
});
