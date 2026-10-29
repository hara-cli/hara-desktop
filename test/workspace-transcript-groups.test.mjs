import { fileURLToPath } from "node:url";
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
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
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
test("brief hides successful operation groups while detailed mode retains an open disclosure", () => {
  const success = [{ role: "user", content: "Check" }, assistant(["read"]), result("read", "safe receipt")];
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const props = { history: success, t: makeT(locale) };
    const brief = renderToStaticMarkup(createElement(module.exports.Transcript, { ...props, detailed: false }));
    assert.equal(brief.includes("wsd-execution"), false);
    assert.equal(brief.includes("safe receipt"), false);
    assert.equal(brief.includes(makeT(locale)("ws.execution.details")), false);
    const detailed = renderToStaticMarkup(createElement(module.exports.Transcript, { ...props, detailed: true }));
    assert.match(detailed, /<details class="wsd-execution" open="">/);
    assert.match(detailed, /safe receipt/);
  }
});
// Node has no DOM for DOMPurify, so Md would fall back to plain text; a pass-through stub isolates the marked wiring.
const purifyStub = { name: "purify-stub", setup(b) { b.onResolve({ filter: /^dompurify$/ }, () => ({ path: "dompurify", namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default { sanitize: html => html };", loader: "js" })); } };
const mdBundle = await build({ stdin: { contents: 'export { Transcript } from "./src/WorkspaceLocalDev.tsx";', resolveDir: root, loader: "tsx" }, plugins: [purifyStub],
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const mdModule = { exports: {} }; new Function("require", "module", "exports", mdBundle.outputFiles[0].text)(require, mdModule, mdModule.exports);
test("assistant bubbles render Markdown while user bubbles stay plain text", () => {
  const reply = "我是 **Hara 同事**。\n\n- 写代码\n- 查资料\n\n| 能力 | 状态 |\n|---|---|\n| 对话 | 可用 |";
  const html = renderToStaticMarkup(createElement(mdModule.exports.Transcript, { history: [{ role: "user", content: "**hi**" }, assistant([], reply)], t: makeT("zh-Hans") }));
  const agentBubble = html.slice(html.indexOf("is-agent"));
  assert.match(agentBubble, /<div class="md">/); assert.match(agentBubble, /<strong>Hara 同事<\/strong>/);
  assert.match(agentBubble, /<ul>\s*<li>写代码<\/li>/); assert.match(agentBubble, /<table>[\s\S]*<th>能力<\/th>[\s\S]*<td>可用<\/td>/);
  assert.equal(agentBubble.includes("**"), false); assert.equal(agentBubble.includes("|---|"), false);
  assert.match(html, /<div class="hs-bub wsd-bubble">\*\*hi\*\*<\/div>/, "user input is not interpreted as Markdown");
});
test("Soft Dark bubble CSS resets pre-wrap and styles Markdown without App.css", async () => {
  const { readFile } = await import("node:fs/promises"), css = await readFile(new URL("../src/workspace-local-dev.css", import.meta.url), "utf8");
  assert.match(css, /\.hs \.hs-bub \.md \{ white-space:normal; \}/);
  for (const selector of ["ul", "table", "th", "pre", "code", "blockquote", "a"]) assert.match(css, new RegExp(`\\.hs \\.hs-bub \\.md ${selector}\\b`));
});
