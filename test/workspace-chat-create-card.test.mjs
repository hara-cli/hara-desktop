import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { makeT } from "../src/i18n.ts";

const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({ stdin: { contents: 'export { ApprovalCard } from "./src/WorkspaceLocalDev.tsx";', resolveDir: root, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", external: ["react"], loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, module, module.exports);
const { createElement } = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const card = { id: "draft-1", workspaceId: "ws", resourceGeneration: "gen", agentId: "main", kind: "agent_create",
  draft: { username: "video-helper", displayName: "Video Helper", title: "Video lead", instructions: "Manage video work", project: "",
    runtimeId: "pi", permissionTier: "full-protected" }, projectOptions: ["Project: /known/video", "Other (type an answer)"] };
const model = { respond() { throw new Error("render cannot submit"); }, getSnapshot() { return { workspace: { approvals: [card], runtimeOptions: [
  { id: "pi", label: "Pi", available: true }, { id: "codex", label: "Codex", available: true }, { id: "agy", label: "Unavailable", available: false }] } }; } };
test("new colleague card exposes editable name, role, project, runtime, tier and instructions in three locales", () => {
  for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    const t = makeT(locale), html = renderToStaticMarkup(createElement(module.exports.ApprovalCard, { card, model, t }));
    assert.match(html, /value="Video Helper"/); assert.match(html, /value="video-helper"/); assert.match(html, /value="Video lead"/);
    assert.match(html, /Project: \/known\/video/); assert.match(html, /<textarea[^>]*>Manage video work<\/textarea>/);
    assert.match(html, /<option value="pi"/); assert.match(html, /<option value="codex"/); assert.doesNotMatch(html, /Unavailable/);
    assert.match(html, new RegExp(t("ws.approval.project").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(t("ws.approval.tier").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
test("card blocks confirmation when no runtime is available", () => {
  const unavailable = { getSnapshot() { return { workspace: { approvals: [card], runtimeOptions: [] } }; } };
  const html = renderToStaticMarkup(createElement(module.exports.ApprovalCard, { card, model: unavailable, t: makeT("en") }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>Confirm/);
});
