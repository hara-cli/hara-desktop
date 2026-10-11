import test from "node:test";
import assert from "node:assert/strict";
import { after } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { HaraClient } from "../src/client.ts";
import { codingConnectionChoices, codingConnectionCandidate, codingConnectionNeedsRecovery, codingConnectionRequest } from "../src/coding-connection-state.ts";

const target = (patch = {}) => ({ id: `ext_codex_${"a".repeat(24)}`, sourceId: "codex", title: "Implementation",
  workspaceName: "repo", workspaceId: "workspace-a", state: "working", origin: "cli", ephemeral: false,
  createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch });
function testPureSelection() {
  const a = target(), sameTitle = target({ id: `ext_claude_${"b".repeat(24)}`, sourceId: "claude" });
  assert.deepEqual(codingConnectionChoices([a, { ...a }, sameTitle]).map((session) => session.id), [sameTitle.id, a.id]);
  for (const patch of [{ sourceId: "opencode" }, { origin: "subAgent" }, { ephemeral: true }, { sourceId: "runtime", agentKind: "other" }]) {
    assert.equal(codingConnectionCandidate(target(patch)), false);
  }
  assert.equal(codingConnectionCandidate(target({ sourceId: "runtime", agentKind: "claude" })), true);
  assert.deepEqual(codingConnectionChoices([a, sameTitle], "claude"), [sameTitle]);
  assert.equal(codingConnectionNeedsRecovery(target({ state: "stored" })), true);
}
async function testClient(t) {
  const previousSocket = globalThis.WebSocket, previousWindow = globalThis.window; const calls = [];
  class FakeSocket {
    OPEN = 1; readyState = 1;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw) { const call = JSON.parse(raw); calls.push(call); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({jsonrpc:"2.0",id:call.id,result:{link:null}}) })); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = FakeSocket; globalThis.window = { setTimeout, clearTimeout };
  const client = new HaraClient(); t.after(() => { client.close(); globalThis.WebSocket = previousSocket; globalThis.window = previousWindow; });
  await client.connect("127.0.0.1", 4242);
  await client.getConversationCodingLink("chat-a");
  assert.deepEqual(calls.at(-1).params, {sessionId:"chat-a"});
  await client.setConversationCodingLink("chat-a", target().id, "revision-a");
  assert.equal(calls.at(-1).method, "session.coding-link.set");
  assert.deepEqual(calls.at(-1).params, {sessionId:"chat-a",targetSessionId:target().id,expectedRevision:"revision-a"});
  await client.setConversationCodingLink("chat-a", null, "revision-a");
  assert.deepEqual(calls.at(-1).params, {sessionId:"chat-a",targetSessionId:null,expectedRevision:"revision-a"});
  assert.equal(calls.some((call) => /submit|resume|fork|create/.test(call.method)), false);
}

const fixture = mkdtempSync(join(tmpdir(), "hara-coding-picker-render-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const root = new URL("../", import.meta.url);
const bundle = await build({ stdin: { contents: `
  import {createElement} from "react";
  import {renderToStaticMarkup} from "react-dom/server";
  import Picker from "./src/CodingSessionPicker.tsx";
  import Connection from "./src/ConversationCodingConnection.tsx";
  export const renderPicker = (locale="zh",busy=false) => renderToStaticMarkup(createElement(Picker, {
    client:{},sessionId:"chat",view:{link:null},busy,locale,onClose(){},onChanged(){},async onRefreshLink(){}
  }));
  const methods=["session.coding-link.get","session.coding-link.set","external.question.reply","external.approval.reply"];
  const client={supports:name=>methods.includes(name),supportsFeature:()=>true,supportsEvent:()=>true};
  export const renderConnection=(options={})=>renderToStaticMarkup(createElement(Connection, {
    client,sessionId:"chat",personal:true,disabled:false,busy:false,locale:"zh",...options
  }));
`, resolveDir: root.pathname, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", loader: {".css":"empty"}, write:false });
const compiled = join(fixture, "picker.cjs"); writeFileSync(compiled, bundle.outputFiles[0].contents);
const { renderPicker, renderConnection } = createRequire(import.meta.url)(compiled);
test("picker filters unsupported/private workers and does not guess a target from a title", testPureSelection);
test("stalled connection requests time out without retrying or treating a late result as a new selection", async () => {
  let resolveLate, calls = 0;
  const request = new Promise((resolve) => { calls++; resolveLate = resolve; });
  await assert.rejects(codingConnectionRequest(request, 1), /timed out/);
  resolveLate({ link: null }); assert.equal(calls, 1);
  assert.deepEqual(await codingConnectionRequest(Promise.resolve({ link: null }), 100), { link: null });
});
test("actual client sends only the chat address, selected opaque target and CAS revision", testClient);
test("real picker is a localized modal with no preselected session and a disabled connect action", () => {
  for (const locale of ["zh","en"]) {
    const html = renderPicker(locale);
    assert.match(html,/aria-modal="true"/); assert.match(html,/aria-labelledby="coding-session-picker-title"/);
    assert.match(html, locale === "zh" ? /每次发送仍需你确认/ : /Every send still needs your approval/);
    assert.match(html, /<button[^>]*disabled=""[^>]*>(连接到当前对话|Connect to this chat)<\/button>/);
    assert.doesNotMatch(html,/aria-pressed="true"/);
    assert.doesNotMatch(html,/选择工作区并启动|启动 Codex|启动 Claude Code|Hara Live/);
  }
});
test("connection entry is capability- and Personal-Space-gated and does not replace recovery screens", () => {
  assert.match(renderConnection(),/连接编程会话/);
  assert.equal(renderConnection({personal:false}),""); assert.equal(renderConnection({client:null}),"");
  assert.equal(renderConnection({client:{supports:()=>false,supportsFeature:()=>false,supportsEvent:()=>false}}),"");
  assert.match(renderConnection({disabled:true}),/<button[^>]*disabled=""/);
  const css = readFileSync(new URL("src/CodingSessionPicker.css", root),"utf8");
  assert.doesNotMatch(css,/var\(--fg2\)/); assert.match(css,/\.coding-session-picker-list \{ min-height: 0; flex: 1; overflow: auto/);
});
