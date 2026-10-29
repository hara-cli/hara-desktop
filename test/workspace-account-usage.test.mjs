import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { contents: 'export { colleagueUsageView } from "./src/workspace-account-usage.ts";', resolveDir: root, loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false });
const { colleagueUsageView } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const row = (state, fresh, resetAt = null) => ({ state, view: { fresh, resetAt } });

test("quota chip and attention recover without stale success or a second dispatcher", () => {
  assert.equal(colleagueUsageView(undefined).state, "parse_unavailable");
  assert.equal(colleagueUsageView(row("ok", false)).label, "用量暂不可查");
  assert.equal(colleagueUsageView(row("limit_reached", true)).notice, "这位同事的额度已用尽。可换同事或稍后再试。");
  assert.equal(colleagueUsageView(row("limit_reached", true, "invalid")).notice.includes("Invalid Date"), false);
  assert.equal(colleagueUsageView(row("ok", true)).notice, null);
});
