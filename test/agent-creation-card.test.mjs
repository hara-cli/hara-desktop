import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-agent-card-"));
after(() => rmSync(fixture, { recursive: true, force: true }));

// Bundle React and the actual Desktop component together so the rendered card is
// checked without adding a browser, a DOM shim, or a second React instance.
const bundle = await build({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { ConversationTimeline } from "./src/ConversationTimeline.tsx";
      import { makeT } from "./src/i18n.ts";
      export function render(locale, approval) {
        return renderToStaticMarkup(createElement(ConversationTimeline, {
          items: [{ kind: "approval", ...approval }], busy: false,
          displayMode: "concise", bottomRef: { current: null }, t: makeT(locale),
          onRewind() {}, async onApproval() {},
        }));
      }
    `,
    resolveDir: root.pathname,
    loader: "tsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  write: false,
});
const compiled = join(fixture, "card.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render } = createRequire(import.meta.url)(compiled);

const presentation = {
  kind: "agent-create", username: "ada", name: "Ada", role: "Research colleague",
  description: "Checks evidence, not guesses.",
  instructions: `${"Check evidence. ".repeat(150)}Never send messages without approval. <script>unsafe()</script>`,
};
const approval = { approvalId: "creation-1", question: "Create Ada?", allowAlways: true, presentation };

test("the real creation card shows full instructions and only one-time consent, in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const html = render(locale, approval);
    assert.match(html, /@ada/);
    assert.match(html, /Research colleague/);
    assert.match(html, /Never send messages without approval/);
    assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/,
      "standing instructions remain text, not executable HTML");
    assert.doesNotMatch(html, /<script>/);
    assert.equal((html.match(/<button\b/g) ?? []).length, 2, "create and decline only; never Always allow");
    assert.match(html, locale === "zh" ? /不授予电脑、编码、密钥或工具权限/ : /No computer, coding, credential or tool permissions/);
    assert.match(html, locale === "zh" ? /创建这个 Bot/ : /Create this Bot/);
  }
});

test("authorization and a finished creation are not conflated", () => {
  const approved = render("en", { ...approval, answered: "allow" });
  assert.match(approved, /Creation approved/);
  assert.doesNotMatch(approved, /Bot created|Creation completed|<button\b/);
  const denied = render("zh", { ...approval, answered: "deny" });
  assert.match(denied, /已拒绝/);
  assert.doesNotMatch(denied, /<button\b/);
});

test("ordinary permission cards keep their existing scoped Always option", () => {
  const html = render("en", { approvalId: "ordinary-1", question: "Edit the file?", allowAlways: true });
  assert.match(html, /Always allow here/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 3);
});

test("confirmation clicks are single-flight, retryable after failure, and restored from the foreground snapshot", () => {
  const timeline = readFileSync(new URL("src/ConversationTimeline.tsx", root), "utf8");
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  const styles = readFileSync(new URL("src/App.css", root), "utf8");
  assert.match(timeline, /if \(answered \|\| locked\.current\) return/);
  assert.match(timeline, /locked\.current = true;[\s\S]*?await onApproval/);
  assert.match(timeline, /catch \{[\s\S]*?locked\.current = false;[\s\S]*?setFailed\(true\)/);
  assert.match(timeline, /key=\{item\.approvalId\}/, "card-local submission state follows its approval identity");
  assert.match(app, /for \(const approval of snapshot\.approvals\)[\s\S]*?approval\.scope === "session"[\s\S]*?method: "approval.request"/);
  assert.match(app, /item\.approvalId === e\.approvalId[\s\S]*?item\.answered \? \{ answered: item\.answered \}/,
    "replayed cards neither duplicate nor reopen an answered card");
  assert.match(app, /await reply\(sessionId, approvalId, verdict, commandId\)/);
  assert.match(app, /case "event.agents_changed":[\s\S]*?refreshAgentCatalog\(\{ sessionId: e\.sessionId \}\)/);
  const instructions = styles.match(/\.agent-create-proposal pre \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(instructions, /max-height: 260px/);
  assert.match(instructions, /overflow: auto/);
  assert.match(instructions, /white-space: pre-wrap/);
  assert.match(instructions, /overflow-wrap: anywhere/);
  assert.doesNotMatch(instructions, /line-clamp|text-overflow:\s*ellipsis/,
    "long instructions scroll instead of omitting the behavior a human is authorizing");
});
