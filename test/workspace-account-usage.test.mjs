import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// P0 (audit §1.1): this module used to be Simplified-only, so English users saw Chinese.
// The bundle now pulls the locale JSON, exactly like the renderer does.
const bundle = await build({ stdin: { contents: 'export { colleagueUsageView } from "./src/workspace-account-usage.ts";', resolveDir: root, loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false, loader: { ".json": "json" } });
const { colleagueUsageView } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const row = (state, fresh, resetAt = null) => ({ state, view: { fresh, resetAt } });

test("quota chip and attention recover without stale success or a second dispatcher", () => {
  assert.equal(colleagueUsageView(undefined).state, "parse_unavailable");
  assert.equal(colleagueUsageView(row("ok", false), "zh-Hans").label, "用量暂不可查");
  assert.equal(colleagueUsageView(row("limit_reached", true), "zh-Hans").notice, "这位同事的额度已用尽。可换同事或稍后再试。");
  assert.equal(colleagueUsageView(row("limit_reached", true, "invalid"), "zh-Hans").notice.includes("Invalid Date"), false);
  assert.equal(colleagueUsageView(row("ok", true)).notice, null);
});

test("English readers never see Chinese quota copy", () => {
  const cjk = /[\u3400-\u9fff]/u;
  for (const value of [undefined, row("ok", false), row("limit_reached", true), row("limit_reached", true, "2999-01-01T00:00:00Z"), row("ok", true)]) {
    const view = colleagueUsageView(value, "en");
    assert.equal(cjk.test(view.label), false, view.label);
    assert.equal(cjk.test(view.notice ?? ""), false, view.notice ?? "");
  }
  assert.equal(colleagueUsageView(row("ok", false), "en").label, "Usage unavailable");
  assert.equal(colleagueUsageView(row("limit_reached", true), "en").label, "Quota used up");
});

test("Traditional Chinese stays Traditional, and the reset time follows the locale", () => {
  assert.equal(colleagueUsageView(row("ok", false), "zh-Hant").label, "用量暫不可查");
  assert.equal(colleagueUsageView(row("limit_reached", true), "zh-Hant").label, "額度已用盡");
  const withReset = colleagueUsageView(row("limit_reached", true, "2999-01-01T00:00:00Z"), "zh-Hant");
  assert.match(withReset.notice, /這位同事的額度已用盡。可換同事，或在 .* 後再試。/);
  // The reset time is handed to the locale instead of the device default (audit §5):
  // a Chinese sentence now carries a Chinese-formatted date, not an English one.
  const interpolated = withReset.notice.slice("這位同事的額度已用盡。可換同事，或在 ".length, -" 後再試。".length);
  assert.equal(interpolated, new Date("2999-01-01T00:00:00Z").toLocaleString("zh-Hant"));
  const english = colleagueUsageView(row("limit_reached", true, "2999-01-01T00:00:00Z"), "en").notice;
  assert.equal(english.includes(new Date("2999-01-01T00:00:00Z").toLocaleString("en")), true);
});
