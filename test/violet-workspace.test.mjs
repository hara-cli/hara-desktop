import test from "node:test";
import assert from "node:assert/strict";
import { parseAppearance, DEFAULT_APPEARANCE } from "../src/violet-appearance.ts";
import { normalizeShellRoute } from "../src/workspace-shell-state.ts";
import { makeT } from "../src/i18n.ts";

test("malformed visual preferences fall back independently without admitting CSS values", () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance({ darkTheme: "url(secret)", transparency: "enhanced", motion: "reduced" }),
    { darkTheme: "violet-glass", transparency: "enhanced", motion: "reduced" });
  assert.deepEqual(parseAppearance({ darkTheme: "obsidian", transparency: "off", motion: "off" }),
    { darkTheme: "obsidian", transparency: "off", motion: "off" });
});
test("workspace route is view-only and does not disturb private chats, channel identities or task links", () => {
  assert.deepEqual(normalizeShellRoute("#workspace"), { section: "workspace", tab: "people" });
  assert.equal(normalizeShellRoute("#tasks").tab, "tasks");
  assert.equal(normalizeShellRoute("#settings/skills").section, "chat");
  assert.equal(normalizeShellRoute("#channels/12345678-1234-1234-1234-123456789abc").channelId, "12345678-1234-1234-1234-123456789abc");
});
test("new shell and theme labels are translated in all three supported locales", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale);
    for (const key of ["vg.workspace", "vg.inspector", "vg.closeSettings", "vg.theme.violet", "vg.motion", "vg.transparency"])
      assert.notEqual(t(key), key);
  }
});
