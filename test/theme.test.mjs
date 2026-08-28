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

const cssVariables = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()]),
  );
};

const resolveThemeColor = (variables, name, seen = new Set()) => {
  assert.ok(!seen.has(name), `theme variable cycle at --${name}`);
  seen.add(name);
  const value = variables[name];
  assert.ok(value, `missing theme variable --${name}`);
  const reference = /^var\(--([a-z0-9-]+)\)$/i.exec(value);
  if (reference) return resolveThemeColor(variables, reference[1], seen);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(hex, `--${name} must resolve to an opaque six-digit color, received ${value}`);
  return hex[1];
};

const contrastRatio = (foreground, background) => {
  const luminance = (hex) => {
    const channels = hex.match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

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

test("saved provider details keep readable semantic ink in both themes", () => {
  const night = readFileSync(`${root}/src/App.css`, "utf8");
  const daylight = readFileSync(`${root}/src/theme-light.css`, "utf8");
  const themes = [
    ["dark", cssVariables(night, ":root")],
    ["light", cssVariables(daylight, 'html[data-theme="light"]')],
  ];

  for (const [theme, variables] of themes) {
    const surface = resolveThemeColor(variables, "surface-raised");
    for (const ink of ["ink-strong", "ink-muted"]) {
      const ratio = contrastRatio(resolveThemeColor(variables, ink), surface);
      assert.ok(ratio >= 4.5, `${theme} ${ink} on surface-raised is only ${ratio.toFixed(2)}:1`);
    }
  }
});

test("external session center inherits semantic light and dark theme colors", () => {
  const source = readFileSync(`${root}/src/ExternalSessionCenter.css`, "utf8");
  assert.match(source, /--external-ink:\s*var\(--text,/);
  assert.match(source, /--external-muted:\s*var\(--muted,/);
  assert.match(source, /color:\s*var\(--external-ink\)/);
  assert.match(source, /var\(--bg,/);
  assert.match(source, /var\(--surface-panel,/);
});

test("shared interface icons inherit semantic color and replace font-dependent controls", () => {
  const icons = readFileSync(`${root}/src/icons.tsx`, "utf8");
  const rail = readFileSync(`${root}/src/AppRail.tsx`, "utf8");
  const talent = readFileSync(`${root}/src/TalentMarket.tsx`, "utf8");
  const profile = readFileSync(`${root}/src/AgentProfileEditor.tsx`, "utf8");
  const providers = readFileSync(`${root}/src/ProviderSettings.tsx`, "utf8");
  const external = readFileSync(`${root}/src/ExternalSessionCenter.tsx`, "utf8");

  assert.match(icons, /stroke="currentColor"/);
  assert.doesNotMatch(icons, /(?:stroke|fill)="#[0-9a-f]{3,8}"/i);
  assert.match(rail, /name === "tasks"[\s\S]*<IconTasks/);
  assert.match(rail, /name === "office"[\s\S]*<IconOffice/);
  assert.match(talent, /<IconSearch/);
  assert.match(talent, /<IconClose/);
  assert.match(profile, /<IconClose/);
  assert.match(providers, /<IconPlus/);
  assert.match(external, /<IconRefresh/);
  assert.match(external, /<IconCommandLine/);
  assert.doesNotMatch(`${talent}\n${profile}\n${external}`, />\s*[×⌕↻]\s*</u);
});
