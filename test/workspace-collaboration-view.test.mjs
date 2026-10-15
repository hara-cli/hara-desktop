import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { WorkspaceCollaborationModel } from "../src/workspace-collaboration-state.ts";

const bundle = await build({ stdin: { contents: [
  'import React from "react";',
  'import {renderToStaticMarkup} from "react-dom/server";',
  'import {WorkspaceCollaborationView} from "./src/WorkspaceCollaboration.tsx";',
  'export function render(props) { return renderToStaticMarkup(React.createElement(WorkspaceCollaborationView, props)); }',
].join("\n"), resolveDir: new URL("../", import.meta.url).pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty", ".svg": "dataurl" }, write: false });
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const model = new WorkspaceCollaborationModel({});
const initial = model.getSnapshot();
const ready = { ...initial, phase: "ready", workspaceId: "ws_a", channelId: "ch_a",
  directory: { accountScope: "scope", workspaces: [{ workspaceId: "ws_a", membership: { role: "OWNER" } }], nextCursor: null },
  bootstrap: { workspaceId: "ws_a", displayName: "Nanhara", membership: { role: "OWNER", principalId: "me" },
    channels: [{ id: "ch_a", slug: "general", displayName: "General" }] } };
const render = (view, locale = "en") => module.exports.render({ view, model, locale, onClose() {}, onSignIn() {} });

test("real channel view distinguishes preview limitations from availability in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(ready, locale);
    assert.match(html, /Nanhara/);
    assert.match(html, locale === "en" ? /Agent execution, files and key sharing are not enabled/ : /尚未啟用 Agent 執行/);
    assert.match(html, locale === "en" ? /earlier history is not connected yet/ : /較早的歷史尚未接入/);
    assert.match(html, locale === "en" ? /Back to local Workspace/ : /返回本機工作空間/);
    assert.doesNotMatch(html, /private-account|Bearer|Codex|Claude|OpenCode|Pi runtime/);
  }
});
test("untrusted message markup is plain escaped text and sender identity is explicit", () => {
  const html = render({ ...ready, messages: [
    { id: "m1", channelId: "ch_a", senderPrincipalId: "me", body: '<script>alert("x")</script>', createdAt: "2026-10-15T01:00:00Z" },
    { id: "m2", channelId: "ch_a", senderPrincipalId: "member-abcd", body: "other message", createdAt: "2026-10-15T01:00:00Z" },
    { id: "m3", channelId: "foreign", senderPrincipalId: "member", body: "foreign private message", createdAt: "2026-10-15T01:00:00Z" },
  ] });
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|foreign private message/);
  assert.match(html, />You</); assert.match(html, /Member ber-abcd/);
});
test("only owner/admin gets create controls; member may compose but cannot create", () => {
  assert.match(render(ready), /aria-label="Add channel"/);
  const member = { ...ready, bootstrap: { ...ready.bootstrap, membership: { principalId: "me", role: "MEMBER" } }, draft: "hello" };
  assert.doesNotMatch(render(member), /aria-label="Add channel"/);
  assert.match(render(member), /<button type="submit">Send/);
});
test("unknown outcome is visible, freezes composer, and offers an explicit same-ID retry", () => {
  const html = render({ ...ready, draft: "hello", pending: { body: "hello", state: "unknown", code: "OUTCOME_UNKNOWN" } });
  assert.match(html, /Retry same request/); assert.match(html, /outcome is not confirmed/);
  assert.match(html, /<textarea[^>]*disabled/); assert.match(html, /<button type="submit" disabled/);
});
test("signed-out, revoked and loading states cannot show an enabled composer", () => {
  for (const error of ["AUTH_REQUIRED", "ACCESS_CHANGED", "SCOPE_CHANGED"]) {
    const html = render({ ...initial, phase: "error", error });
    assert.match(html, /role="alert"/); assert.match(html, /<textarea[^>]*disabled/); assert.doesNotMatch(html, /Nanhara|other message/);
  }
  assert.match(render({ ...initial, phase: "loading" }), /aria-busy="true"/);
});
test("a selected later-page Workspace remains explicitly selected in the real picker", () => {
  const html = render({ ...ready, directory: { ...ready.directory,
    workspaces: [{ workspaceId: "ws_b", membership: { role: "MEMBER" } }], nextCursor: "next" } });
  assert.match(html, /<option value="ws_a" selected="">Nanhara · Not in this page/);
});
test("App integration is feature-gated, lazy and does not convert a cloud ID to local spaces.use", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /supportsFeature\("workspace.collaboration.v1"\)/);
  assert.match(app, /const loadWorkspaceCollaboration = \(\) => import\("\.\/WorkspaceCollaboration"\)/);
  const state = readFileSync(new URL("../src/workspace-collaboration-state.ts", import.meta.url), "utf8");
  const executable = state.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.equal(/localStorage\.|useSpace\(|agentRef:|apiKey:|refreshToken:|accessToken:/.test(executable), false);
});
