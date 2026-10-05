import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { HaraClient } from "../src/client.ts";
import { reconcileTerminalReply, restoreAuthoritativeConversation } from "../src/conversation-state.ts";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-completion-render-"));
after(() => rmSync(fixture, { recursive: true, force: true }));

// Render the production Timeline, AssistantMessage, and Markdown components, not a
// string-only surrogate. Browser/native layout and Tauri are outside this test.
const bundle = await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ConversationTimeline } from "./src/ConversationTimeline.tsx";
      import { makeT } from "./src/i18n.ts";
      export function render(items, locale, busy = false) {
        return renderToStaticMarkup(createElement(ConversationTimeline, {
          items, busy, assistantName: "Fixture assistant", displayMode: "concise",
          bottomRef: { current: null }, t: makeT(locale), onRewind() {}, async onApproval() {},
        }));
      }
    `,
    resolveDir: root.pathname,
    loader: "tsx",
  },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic",
  loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "timeline.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);
const usage = { input: 2, output: 2 };
const rejected = "REJECTED_COMPLETION_MUST_NOT_APPEAR";

function historyItems(history) {
  return history.map(message => ({ kind: message.role === "user" ? "user" : "text", text: message.text }));
}

function assertRenderedOnce(items, answer) {
  for (const locale of ["en", "zh"]) {
    const html = render(items, locale);
    assert.equal(html.split(answer).length - 1, 1, `${locale}: one visible final reply`);
    assert.equal((html.match(/class="assistant-message"/g) ?? []).length, 1,
      `${locale}: one actual assistant message component`);
    assert.ok(!html.includes(rejected), `${locale}: rejected prose is not rendered`);
  }
}

for (const delivery of ["completion.final_answer", "same-round r.text", "returned-only r.text"]) {
  test(`${delivery} renders once through live client, history, resume, and reconnect`, async (t) => {
    const answer = `Accepted ${delivery} fixture reply`;
    // Serve 0.183.3 owns validation: rejected prose is absent from both public
    // event.text and durable history. Neither UI receives a private tool receipt.
    // A runtime-only assistant message needs no provider-turn parent to be read.
    const runtimeMessage = { kind: "message", role: "assistant", text: answer };
    assert.ok(!("parentItemId" in runtimeMessage));
    const history = [{ role: "user", text: "Verify mock fixture" },
      { role: runtimeMessage.role, text: runtimeMessage.text }];
    const sockets = [];
    const requests = [];
    const originalWebSocket = globalThis.WebSocket;
    const originalWindow = globalThis.window;
    t.after(() => { globalThis.WebSocket = originalWebSocket; globalThis.window = originalWindow; });
    globalThis.window = { setTimeout, clearTimeout };
    class MockWebSocket {
      OPEN = 1;
      readyState = 1;
      constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
      send(raw) {
        const request = JSON.parse(raw);
        requests.push(request);
        const result = request.method === "initialize"
          ? { name: "hara", version: "0.183.3", protocol: 1, capabilities: { methods: [], events: [], features: [] } }
          : { sessionId: "fixture", history, model: "fixture-only" };
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) }));
      }
      close() { this.readyState = 3; this.onclose?.(); }
      notify(method, params) { this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", method, params }) }); }
    }
    globalThis.WebSocket = MockWebSocket;
    const client = new HaraClient();
    t.after(() => client.close());
    let items = [{ kind: "user", text: "Verify mock fixture" }];
    // These are the App event branches; terminal/history reconciliation is the
    // production implementation, while the actual production UI is rendered below.
    client.onEvent = event => {
      if (event.method === "event.text") {
        const last = items.at(-1);
        items = last?.kind === "text"
          ? [...items.slice(0, -1), { kind: "text", text: last.text + event.delta }]
          : [...items, { kind: "text", text: event.delta }];
      } else if (event.method === "event.tool") {
        items = [...items, { kind: "tool", name: event.name, preview: event.preview }];
      } else if (event.method === "event.turn_end") {
        items = [...reconcileTerminalReply(items, event.reply), { kind: "end", usage: event.usage }];
      }
    };
    await client.connect("127.0.0.1", 4242);
    await client.initialize("fixture-only-token");
    const socket = sockets.at(-1);
    socket.notify("event.tool", { sessionId: "fixture", name: "task_checkpoint", preview: "mock receipt rejected" });
    assert.ok(!render(items, "en", true).includes(rejected));
    socket.notify("event.tool", { sessionId: "fixture", name: "task_checkpoint", preview: "mock receipt accepted" });
    socket.notify("event.text", { sessionId: "fixture", delta: answer });
    assertRenderedOnce(items, answer);
    socket.notify("event.turn_end", { sessionId: "fixture", reply: answer, usage });
    assertRenderedOnce(items, answer);

    const read = await client.readSession("fixture");
    assertRenderedOnce(historyItems(read.history), answer);
    const resumed = await client.resumeSession("fixture");
    items = restoreAuthoritativeConversation(historyItems(resumed.history), items);
    assertRenderedOnce(items, answer);

    // A failed partial connection must not be appended to the durable response.
    items = [...items, { kind: "text", text: "partial transport output" }];
    client.close();
    await client.connect("127.0.0.1", 4242);
    await client.initialize("fixture-only-token");
    const restored = await client.resumeSession("fixture");
    items = restoreAuthoritativeConversation(historyItems(restored.history), items);
    assertRenderedOnce(items, answer);
    assert.ok(!render(items, "en").includes("partial transport output"));
    assert.equal(requests.filter(request => request.method === "session.resume").length, 2);
  });
}

test("the real timeline repairs missing final text frames without duplicating the accepted answer", () => {
  const answer = "Terminal reply repairs lost frames";
  for (const streamed of [[], [{ kind: "text", text: "Terminal reply" }],
    [{ kind: "text", text: "incorrect transport fragment" }]]) {
    const items = [{ kind: "user", text: "Verify mock fixture" },
      { kind: "tool", name: "task_checkpoint", preview: "accepted" }, ...streamed];
    assertRenderedOnce(reconcileTerminalReply(items, answer), answer);
  }
});
