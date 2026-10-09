import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { bindTalentDrawerFocus, talentMarketEscapeAction } from "../src/talent-market-navigation.ts";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-talent-navigation-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import TalentMarket from "./src/TalentMarket.tsx";
    export const render = (locale, suspended = false) => renderToStaticMarkup(createElement(TalentMarket, {
      locale, suspended, hiredBlueprintIds:[], onClose(){}, onCustomHire(){}, onHire(){throw new Error("Browsing cannot hire");},
    }));
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty", ".svg": "dataurl" }, write: false,
});
const compiled = join(fixture, "market.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);

test("initial real catalog has no selected candidate, drawer, or hiring action in either locale", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(locale);
    assert.doesNotMatch(html, /class="talent-dossier|talent-card is-selected|Hire &amp; configure|雇佣并配置|talent-market-(?:hero|stats|journey)/);
    assert.equal((html.match(/class="talent-card(?: |")/g) ?? []).length, 48);
    assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 48);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 48);
    assert.match(html, locale === "zh" ? /查看详情/ : /View details/);
    assert.match(html, locale === "zh" ? /浏览不会授予工具权限/ : /Browsing grants no tool permissions/);
    assert.match(html, locale === "zh" ? /搜索候选人/ : /Search candidates/);
  }
  assert.match(render("en", true), /aria-hidden="true" inert=""/);
});

test("Escape dismisses the drawer before the market and never touches the suspended hiring modal", () => {
  assert.equal(talentMarketEscapeAction(true, false), "drawer");
  assert.equal(talentMarketEscapeAction(false, false), "market");
  assert.equal(talentMarketEscapeAction(true, true), null);
  assert.equal(talentMarketEscapeAction(false, true), null);
});

function focusFixture(count = 3) {
  const document = { activeElement: null };
  const listeners = new Map();
  const item = () => ({ focus() { document.activeElement = this; } });
  const items = Array.from({ length: count }, item);
  const drawer = {
    ownerDocument: document,
    querySelectorAll(selector) { assert.match(selector, /button:not\(:disabled\)/); return items; },
    focus() { document.activeElement = this; },
    addEventListener(name, fn) { assert.equal(name, "keydown"); listeners.set(name, fn); },
    removeEventListener(name, fn) { assert.equal(listeners.get(name), fn); listeners.delete(name); },
  };
  const press = (key, shiftKey = false) => {
    let prevented = false;
    listeners.get("keydown")?.({ key, shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { document, listeners, items, drawer, press };
}

test("drawer focuses its first action, wraps both directions, allows interior Tab, and removes its listener", () => {
  const f = focusFixture();
  const release = bindTalentDrawerFocus(f.drawer);
  assert.equal(f.document.activeElement, f.items[0]);
  assert.equal(f.press("Tab", true), true);
  assert.equal(f.document.activeElement, f.items[2]);
  assert.equal(f.press("Tab"), true);
  assert.equal(f.document.activeElement, f.items[0]);
  f.document.activeElement = f.items[1];
  assert.equal(f.press("Tab"), false);
  assert.equal(f.document.activeElement, f.items[1]);
  f.document.activeElement = {};
  assert.equal(f.press("Tab"), true);
  assert.equal(f.document.activeElement, f.items[0]);
  assert.equal(f.press("Enter"), false);
  release();
  assert.equal(f.listeners.size, 0);
});

test("a drawer without available controls stays focusable rather than leaking keyboard focus", () => {
  const f = focusFixture(0);
  const release = bindTalentDrawerFocus(f.drawer);
  assert.equal(f.document.activeElement, f.drawer);
  assert.equal(f.press("Tab"), true);
  assert.equal(f.document.activeElement, f.drawer);
  release();
});

test("actual component wires explicit selection, protected focus return and unchanged hire callback", () => {
  const source = readFileSync(new URL("src/TalentMarket.tsx", root), "utf8");
  assert.match(source, /useState<string \| null>\(null\)/);
  assert.doesNotMatch(source, /filtered\[0\]|find\(\(item\) => item.featured\)/);
  const select = source.match(/onClick=\{\(event\) => \{([\s\S]*?)setSelectedId\(blueprint.id\);/)[1];
  assert.match(select, /selectedCardRef.current = event.currentTarget/);
  assert.doesNotMatch(select, /onHire/);
  assert.match(source, /if \(action === "drawer"\) setSelectedId\(null\);\s*else onClose\(\)/);
  assert.match(source, /inert=\{!!selected\}/);
  assert.match(source, /!suspendedRef.current && selectedCardRef.current\?\.isConnected/);
  assert.match(source, /selectedCardRef.current.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /disabled=\{isHired\} onClick=\{\(\) => onHire\(selected\)\}/);
  assert.match(source, /hiring grants nothing automatically/);
});
