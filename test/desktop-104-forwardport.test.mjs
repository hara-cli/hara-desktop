import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: [new URL("../src/WorkspaceBrowserExtension.tsx", import.meta.url).pathname],
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", external: ["react"], loader: { ".css": "empty" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");

test("1.0.4 preview fix survives the 1.1 redesign without restoring the old overlay", () => {
  const browser = read("src/workspace-browser.css"), screen = read("src/WorkspaceLocalDev.tsx");
  assert.equal(/\.hs \.hs-win\.has-browser\s*\{\s*grid-template-columns:/.test(browser), true, "dedicated preview column");
  assert.equal(/:has\(> \.hs-browser\.is-expanded\)/.test(browser), true, "explicit panel widening");
  assert.equal(/position\s*:\s*(?:absolute|fixed)|\.hs-chat\s*\{[^}]*display\s*:\s*none/.test(browser), false, "preview cannot cover or hide chat");
  assert.equal(/<main className="hs-chat(?: [^"]*)?"/.test(screen), true, "chat remains a sibling");
  assert.equal(screen.includes("browser && workspace ? <Suspense"), true, "only preview is conditional on open state");
  assert.equal(screen.includes("<BrowserExtension"), true, "real preview stays mounted through its own boundary");
  assert.doesNotMatch(read("src/WorkspaceBrowserExtension.tsx"), /ExtensionDock|setDraft|setAgentId|model\.submit/);
});
for (const locale of ["en", "zh-Hans", "zh-Hant"]) test(`real 1.1 preview preserves localized controls and authority boundary: ${locale}`, () => {
  const t = makeT(locale);
  const html = renderToStaticMarkup(createElement(module.exports.default, { label: "Fixture workspace", locale, onClose() {} }));
  assert(html.includes(t("ws.browser.title")));
  assert(html.includes(t("ws.browser.expand")));
  assert(html.includes(t("ws.browser.close")));
  assert(html.includes('aria-pressed="false"'));
  assert(!html.includes("<iframe") && !html.includes('type="password"'));
  const source = read("src/WorkspaceBrowserExtension.tsx");
  assert.match(source, /sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer"/);
  assert.match(source, /workspacePreviewURL\(address\)/);
});
