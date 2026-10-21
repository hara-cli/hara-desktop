import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { transcriptBlocks } from "../src/workspace-shell-state.ts";
import { makeT } from "../src/i18n.ts";
const assistant = (tools, text = "") => ({ role: "assistant", text, tools });
const result = (id, content, isError = false) => ({ role: "tool", results: [{ id, name: "workspace_read", content, isError }] });
const history = [{ role: "user", content: "Three checks" }, assistant(["one"]), result("same-id", "first"),
  assistant(["two", "three"]), result("same-id", "second <script>local only</script>", true)];
test("adjacent operation batches share one count while retaining ordered results and errors", () => {
  const before = JSON.stringify(history), blocks = transcriptBlocks(history);
  assert.equal(blocks.length, 2); assert.equal(blocks[1].kind, "execution"); assert.equal(blocks[1].count, 3);
  assert.deepEqual(blocks[1].results.map(row => row.result.content), ["first", "second <script>local only</script>"]);
  assert.equal(blocks[1].results[1].result.isError, true);
  assert.equal(new Set(blocks[1].results.map(row => row.key)).size, 2, "result keys stay unique when upstream IDs repeat");
  assert.equal(JSON.stringify(history), before);
});
test("visible assistant replies and user turns separate operations, including pending calls", () => {
  const blocks = transcriptBlocks([...history, assistant(["four"], "New explanation"), result("four", "fourth"),
    { role: "user", content: "Next task" }, assistant(["pending"])]);
  assert.deepEqual(blocks.map(row => row.kind), ["message", "execution", "message", "execution", "message", "execution"]);
  assert.deepEqual(blocks.filter(row => row.kind === "execution").map(row => row.count), [3, 1, 1]);
  assert.equal(blocks.at(-1).results.length, 0, "a pending operation still contributes to the count");
});
const require = createRequire(import.meta.url), root = new URL("../", import.meta.url).pathname;
const bundled = await build({ stdin: { contents: 'export { Transcript } from "./src/WorkspaceLocalDev.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
test("the actual transcript renders one localized disclosure and preserves escaped error details", () => {
  for (const [locale, label] of [["en", "3 operations · "], ["zh-Hans", "3 个操作 · "], ["zh-Hant", "3 個操作 · "]]) {
    const render = detailed => renderToStaticMarkup(createElement(module.exports.Transcript, { history, t: makeT(locale), detailed }));
    const html = render(false);
    assert.equal((html.match(/<details/g) ?? []).length, 1); assert.equal(html.includes(label), true);
    assert.equal(html.includes('open=""'), false); assert.equal(html.includes('class="is-error"'), true);
    assert.equal(html.includes("&lt;script&gt;local only&lt;/script&gt;"), true); assert.equal(html.includes("<script>"), false);
    assert.equal(render(true).includes('open=""'), true);
  }
});
