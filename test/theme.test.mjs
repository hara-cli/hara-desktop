import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  THEME_MEDIA_QUERY,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  applyThemePreference,
  bindThemePreference,
  loadThemePreference,
  parseThemePreference,
  resolveTheme,
  saveThemePreference,
} from "../src/theme.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("theme preferences fail safely to the system appearance", () => {
  assert.deepEqual(THEME_PREFERENCES, ["system", "light", "dark"]);
  assert.equal(parseThemePreference(null), "system");
  assert.equal(parseThemePreference("sepia"), "system");
  assert.equal(parseThemePreference("system"), "system");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(loadThemePreference(() => "light"), "light");
  assert.equal(loadThemePreference(() => { throw new Error("storage denied"); }), "system");
});

test("theme persistence uses one bounded local preference key", () => {
  const writes = [];
  saveThemePreference("dark", (key, value) => writes.push([key, value]));
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, "dark"]]);
  assert.doesNotThrow(() => saveThemePreference("light", () => { throw new Error("quota"); }));
});

test("system appearance resolves without changing an explicit choice", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("applying a theme updates the root contract and native control color scheme", () => {
  const target = { dataset: {}, style: { colorScheme: "" } };
  assert.equal(applyThemePreference("system", false, target), "light");
  assert.deepEqual(target, {
    dataset: { theme: "light", themePreference: "system" },
    style: { colorScheme: "light" },
  });

  assert.equal(applyThemePreference("dark", false, target), "dark");
  assert.equal(target.dataset.theme, "dark");
  assert.equal(target.dataset.themePreference, "dark");
  assert.equal(target.style.colorScheme, "dark");
});

test("only follow-system mode subscribes to OS appearance changes and cleans up", () => {
  let listener;
  let addCount = 0;
  let removeCount = 0;
  const media = {
    matches: false,
    addEventListener(type, next) {
      assert.equal(type, "change");
      addCount += 1;
      listener = next;
    },
    removeEventListener(type, next) {
      assert.equal(type, "change");
      assert.equal(next, listener);
      removeCount += 1;
    },
  };
  const target = { dataset: {}, style: { colorScheme: "" } };
  const unbind = bindThemePreference("system", media, target);
  assert.equal(addCount, 1);
  assert.equal(target.dataset.theme, "light");

  media.matches = true;
  listener();
  assert.equal(target.dataset.theme, "dark");
  unbind();
  assert.equal(removeCount, 1);

  bindThemePreference("light", media, target)();
  assert.equal(addCount, 1, "an explicit theme never keeps a system listener alive");
  assert.equal(target.dataset.theme, "light");
  assert.equal(THEME_MEDIA_QUERY, "(prefers-color-scheme: dark)");
});

test("Desktop initializes theme before React and exposes an accessible three-way setting", () => {
  for (const entry of ["main.tsx", "pet-chat-main.tsx"]) {
    const source = readFileSync(`${root}/src/${entry}`, "utf8");
    assert.match(source, /initializeThemePreference\(\);/);
    assert.ok(
      source.indexOf("initializeThemePreference();") < source.indexOf("ReactDOM.createRoot"),
      `${entry} applies appearance before the first React frame`,
    );
    assert.match(source, /import "\.\/theme-light\.css"/);
  }

  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const i18n = readFileSync(`${root}/src/i18n.ts`, "utf8");
  const daylight = readFileSync(`${root}/src/theme-light.css`, "utf8");
  assert.match(app, /THEME_PREFERENCES\.map/);
  assert.match(app, /role="radiogroup"/);
  assert.match(app, /role="radio"/);
  assert.match(app, /aria-checked=\{selected\}/);
  assert.match(app, /chooseTheme\(preference\)/);
  for (const key of ["appearanceTheme", "themeSystem", "themeLight", "themeDark"]) {
    assert.equal((i18n.match(new RegExp(`${key}:`, "g")) ?? []).length, 2, `${key} is translated in both locales`);
  }
  assert.match(daylight, /html\[data-theme="light"\]/);
  assert.match(daylight, /--bg:\s*#f3f0e8/);
  assert.match(daylight, /\.workforce-surface/);
  assert.match(daylight, /\.pet-chat/);
  assert.match(daylight, /\.talent-market-shell/);
});
