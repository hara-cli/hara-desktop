import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { parseContextCompactions } from "../src/context-compaction.ts";
import { makeT } from "../src/i18n.ts";
const row = () => ({ id: randomUUID(), agentId: "ag_" + randomUUID(), sessionId: randomUUID(), runId: randomUUID(), at: new Date().toISOString(), runtimeId: "codex", method: "codex-native", status: "completed", historyStart: 1,
  beforeTokens: 35000, afterTokens: 4200, summary: { goals: ["preserve the project"], decisions: ["keep original files"], unfinished: ["verify saved work"], references: ["src/main.ts"], cards: ['{"created":false,"approvalState":"declined"}'], recent: [{ role: "assistant", text: "earlier original text" }] }, usage: { requests: 1, inputTokens: null, outputTokens: null, cachedInputTokens: null } });
const scope = r => ({ agentId: r.agentId, sessionId: r.sessionId, historyLength: 2 });
test("closed scoped summary view preserves unknown costs and rejects cross-conversation, secret and forged fields", () => {
  const r = row(), before = JSON.stringify(r), parsed = parseContextCompactions([r], scope(r));
  assert.deepEqual(parsed, [r]); assert.equal(parsed[0].usage.inputTokens, null); assert.equal(JSON.stringify(r), before);
  for (const bad of [{ ...r, agentId: "other" }, { ...r, sessionId: randomUUID() }, { ...r, historyStart: 9 }, { ...r, grant: "approve" },
    { ...r, usage: { ...r.usage, cachedInputTokens: 2, inputTokens: 1 } }, { ...r, summary: { ...r.summary, goals: ["api_key=synthetic-secret-value"] } }])
    assert.equal(parseContextCompactions([bad], scope(r)), null);
  assert.equal(parseContextCompactions([r, r], scope(r)), null);
});
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ stdin: { contents: 'export { Transcript } from "./src/WorkspaceLocalDev.tsx"; export { WorkspaceContextCompaction } from "./src/WorkspaceContextCompaction.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
test("summary hint stays inline and collapsed in all three languages while original history remains rendered", () => {
  const r = row(), history = [{ role: "user", content: "ORIGINAL-HISTORY" }, { role: "user", content: "CURRENT-USER" }];
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = renderToStaticMarkup(createElement(module.exports.Transcript, { history, t, contextCompactions: [r] }));
    assert.ok(html.includes(t("ws.compaction.completed"))); assert.ok(html.includes("ORIGINAL-HISTORY")); assert.ok(html.includes("CURRENT-USER"));
    assert.ok(html.includes(t("ws.compaction.reference"))); assert.ok(html.includes(t("ws.compaction.unknown")));
    assert.equal(html.includes('open=""'), false); assert.equal(html.includes('role="dialog"'), false); const compactionOnly = renderToStaticMarkup(createElement(module.exports.WorkspaceContextCompaction, { value: r, t })); assert.equal(compactionOnly.includes("<button"), false);
    assert.ok(html.indexOf("ORIGINAL-HISTORY") < html.indexOf("wsd-context-compaction")); assert.ok(html.indexOf("wsd-context-compaction") < html.indexOf("CURRENT-USER"));
  }
});
test("failed and pending maintenance cannot claim successful compaction or invent zero token cost", () => {
  for (const status of ["failed", "running"]) {
    const r = { ...row(), status }, t = makeT("zh-Hans");
    const html = renderToStaticMarkup(createElement(module.exports.WorkspaceContextCompaction, { value: r, t }));
    assert.equal(html.includes(t("ws.compaction.completed")), false); assert.ok(html.includes(t("ws.compaction.unknown")));
    assert.equal(html.includes("输入 0"), false); assert.equal(html.includes('open=""'), false);
  }
});
