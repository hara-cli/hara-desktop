import { fileURLToPath } from "node:url";
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
  'import WorkspaceMembers from "./src/WorkspaceMembers.tsx";',
  'export function render(props) { return renderToStaticMarkup(React.createElement(WorkspaceCollaborationView, props)); }',
  'export function renderMembers(props) { return renderToStaticMarkup(React.createElement(WorkspaceMembers, props)); }',
].join("\n"), resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
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
test("history-ready view replaces the preview limitation with real older-page controls", () => {
  const html = render({ ...ready, history: { phase: "ready", nextBefore: "opaque", error: null, limited: false },
    workspaceNames: { ws_a: "Nanhara", ws_b: "Studio" },
    directory: { ...ready.directory, workspaces: [...ready.directory.workspaces, { workspaceId: "ws_b", membership: { role: "MEMBER" } }] } });
  assert.match(html, /Load earlier messages/); assert.doesNotMatch(html, /earlier history is not connected yet/);
  assert.match(html, /<option value="ws_b">Studio/);
  assert.match(html, /Enter to send/);
});
test("history failure is a separate read state and uncertain sends retain the explicit retry bubble", () => {
  const html = render({ ...ready, history: { phase: "error", nextBefore: null, error: "HISTORY_STALE", limited: false },
    pending: { body: "still unconfirmed", state: "unknown", code: "OUTCOME_UNKNOWN", idempotencyKey: "same" } });
  assert.match(html, /Retry history/); assert.match(html, /Retry same request/); assert.match(html, /still unconfirmed/);
  assert.match(html, /unconfirmed sends are retained/);
});
test("loading and bounded history do not claim transcript completeness", () => {
  assert.match(render({ ...ready, history: { phase: "loading", nextBefore: null, error: null, limited: false } }), /Loading channel history/);
  const html = render({ ...ready, history: { phase: "ready", nextBefore: "older", error: null, limited: true } });
  assert.match(html, /up to 500 messages/); assert.doesNotMatch(html, /Load earlier messages/);
});
test("manual chat viewport intent is not overridden by native scroll anchoring", () => {
  const css = readFileSync(new URL("../src/WorkspaceCollaboration.css", import.meta.url), "utf8");
  assert.match(css, /\.workspace-collaboration-messages\s*\{[^}]*overflow-anchor:\s*none\s*;/);
});
test("trusted roster names identify senders but never turn a human named Hara into an Agent", () => {
  const view = { ...ready, members: { phase: "ready", items: [
    { principalId: "human-hara", kind: "human", displayName: "Hara", role: "MEMBER" },
    { principalId: "known", kind: "human", displayName: "<script>not markup</script>", role: "ADMIN" },
  ], nextCursor: "page-2", limited: false, error: null }, messages: [
    { id: "m1", channelId: "ch_a", senderPrincipalId: "human-hara", body: "human text", createdAt: "2026-10-16T01:00:00Z" },
    { id: "m2", channelId: "ch_a", senderPrincipalId: "known", body: "other text", createdAt: "2026-10-16T01:00:00Z" },
  ] };
  const html = render(view);
  assert.match(html, /Members · 2\+/); assert.match(html, /title="Hara"/);
  assert.match(html, /&lt;script&gt;not markup&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|AI employee|Online/);
});
test("real member panel is bounded, non-modal, human-only and honest about partial search", () => {
  const html = module.exports.renderMembers({ members: { phase: "ready", items: [
    { principalId: "human", kind: "human", displayName: "Hara", role: "MEMBER" },
  ], nextCursor: "opaque", limited: false, error: null }, labels: new Map([["human", "Hara"]]), ownPrincipalId: "human",
    locale: "en", onClose() {}, onRefresh() {}, onMore() {} });
  assert.match(html, /role="dialog"/); assert.doesNotMatch(html, /aria-modal="true"/);
  assert.match(html, /Human · Member · You/); assert.match(html, /Load more members/);
  assert.match(html, /Search loaded members/); assert.match(html, /not a global directory/);
  assert.match(html, /Agent members are not connected/); assert.doesNotMatch(html, /Online|Hire|Start Codex|Task accepted/);
});
test("App integration is feature-gated, lazy and does not convert a cloud ID to local spaces.use", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /supportsFeature\("workspace.collaboration.v1"\)/);
  assert.match(app, /const loadWorkspaceCollaboration = \(\) => import\("\.\/WorkspaceCollaboration"\)/);
  const state = readFileSync(new URL("../src/workspace-collaboration-state.ts", import.meta.url), "utf8");
  const executable = state.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  assert.equal(/localStorage\.|useSpace\(|agentRef:|apiKey:|refreshToken:|accessToken:/.test(executable), false);
});
test("mention chips and references use escaped member labels, not text parsing or Agent impersonation", () => {
  const member = { principalId: "person", kind: "human", displayName: "<Hara>", role: "MEMBER" };
  const view = { ...ready, mentionsSupported: true, members: { ...initial.members, phase: "ready", items: [member] },
    draftMentions: [{ kind: "human", principalId: "person" }], messages: [{ id: "m", channelId: "ch_a", senderPrincipalId: "me", body: "@Hara text",
      createdAt: "2026-10-16T00:00:00Z", mentions: [{ kind: "human", principalId: "person" }] }] };
  const html = render(view);
  assert.match(html, /Draft mentions/); assert.match(html, /Mention references/); assert.match(html, /@&lt;Hara&gt;/);
  assert.match(html, /Choose mention targets from roster/); assert.match(html, /not notification delivery or Agent task acceptance/);
  assert.doesNotMatch(html, /<Hara>|Task accepted|Notification delivered/);
  assert.doesNotMatch(render(ready), /Choose mention targets from roster/);
});
test("only a definite first target rejection offers an editable-draft action", () => {
  const pending = { state: "failed", code: "MENTION_TARGET_UNAVAILABLE", body: "text", mentions: [{ kind: "human", principalId: "unknown" }] };
  assert.match(render({ ...ready, pending }), /Return to draft to check targets/);
  assert.doesNotMatch(render({ ...ready, pending: { ...pending, state: "unknown", code: "OUTCOME_UNKNOWN", outcomeUncertain: true } }), /Return to draft to check targets/);
  assert.match(render({ ...ready, pending }), /@Member unknown/);
});
test("member selection is explicit, non-sending and bounded; unavailable rosters cannot add targets", () => {
  const props = { labels: new Map(), locale: "en", onClose() {}, onRefresh() {}, onMore() {},
    members: { ...initial.members, phase: "ready", items: [{ principalId: "p", kind: "human", displayName: "Human", role: "MEMBER" }] },
    mentionSelection: { ids: new Set(), disabled: false, onToggle() {} } };
  const html = module.exports.renderMembers(props);
  assert.match(html, /aria-label="Mention Human"/); assert.match(html, /aria-pressed="false"/); assert.match(html, /selecting does not send/);
  assert.match(module.exports.renderMembers({ ...props, mentionSelection: { ...props.mentionSelection, ids: new Set(Array.from({ length: 10 }, (_, i) => "p" + i)) } }), /aria-label="Mention Human" disabled/);
  assert.match(module.exports.renderMembers({ ...props, members: { ...props.members, phase: "error" } }), /aria-label="Mention Human" disabled/);
});
test("viewport intent is reapplied when pending status or mention-chip height changes", () => {
  const source = readFileSync(new URL("../src/WorkspaceCollaboration.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("view.pending?.state, view.pending?.code, view.draftMentions.length"), true);
});
