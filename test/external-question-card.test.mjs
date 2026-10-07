import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-external-question-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import ExternalQuestionCard from "./src/ExternalQuestionCard.tsx";
    import ExternalSessionCenter from "./src/ExternalSessionCenter.tsx";
    import { ConversationTimeline } from "./src/ConversationTimeline.tsx";
    import { restoreSessionApprovals } from "./src/approval-restoration.ts";
    import { makeT } from "./src/i18n.ts";
    export const render = (entry, locale = "zh", disabled = false) => renderToStaticMarkup(createElement(ExternalQuestionCard, {
      entry, locale, disabled, async onReply() {},
    }));
    export const renderRestored = (pending) => renderToStaticMarkup(createElement(ConversationTimeline, {
      items: restoreSessionApprovals([], "s1", undefined, [pending]), busy: false,
      displayMode: "concise", bottomRef: {current:null}, t: makeT("zh"), onRewind() {}, async onApproval() {},
    }));
    export const renderCenter = (entry, sessionId = "external:s1", sourceId = "codex") => renderToStaticMarkup(createElement(ExternalSessionCenter, {
      sources: [{id:sourceId,capabilities:{terminalView:true}}], sessions: [], selected: {id: sessionId, sourceId, title: "Test", workspaceName: "Workspace", state: "waiting"},
      selectedSourceId: sourceId, transcript: {session: {id: sessionId}, messages: [], readOnly: false, controlMode: "managed"},
      activity: [], approval: null, questions: [entry], personal: true, locale: "zh",
      copy: new Proxy({sessionStates: {}, sourceStates: {}}, { get(target,key) {return target[key] ?? String(key);}}),
      async onQuestionReply() {},
    }));
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "card.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render, renderCenter, renderRestored } = createRequire(import.meta.url)(compiled);

const request = {
  questionId: "00000000-0000-4000-8000-000000000001", sessionId: "external:s1", turnId: "turn1", expiresAt: "2099-01-01T00:00:00Z",
  questions: [
    { id: "direction", header: "方向", question: "先从哪一步开始？", options: [
      { label: "先检查", description: "先验证现状。".repeat(80) }, { label: "先规划", description: "保留所有现有数据。" },
    ], isOther: true },
    { id: "scope", question: "选择需要覆盖的范围", multiSelect: true, options: [{ label: "桌面端" }, { label: "手机端" }] },
    { id: "detail", question: "还有什么补充？ <script>not executable</script>" },
  ],
};

test("real question card renders localized multiple questions with no preselected answers", () => {
  for (const locale of ["zh", "en"]) {
    const html = render({ request }, locale);
    assert.match(html, locale === "zh" ? /想请你选一下/ : /A quick question for you/);
    assert.equal((html.match(/<fieldset/g) ?? []).length, 3);
    assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /checked=""/, "no selection is inferred");
    assert.match(html, /type="submit"[^>]*disabled=""/, "submit waits for actual answers");
    assert.match(html, /maxLength="4000"/);
    assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, locale === "zh" ? /请勿输入密码、API Key 或验证码/ : /Do not enter passwords, API keys or verification codes/);
    assert.doesNotMatch(html, /Always allow|始终允许|自动托管|Action needs approval/);
  }
});

test("resolved or expired cards are inert; secret requests have no DOM projection", () => {
  for (const outcome of ["answered", "cancelled", "timed_out", "interrupted"]) {
    const html = render({ request, outcome });
    assert.doesNotMatch(html, /<button/);
    assert.equal((html.match(/<fieldset disabled=""/g) ?? []).length, 3);
  }
  const expired = render({ request: { ...request, expiresAt: "2000-01-01T00:00:00Z" } });
  assert.match(expired, /问题已过期/);
  assert.doesNotMatch(expired, /<button/);
  assert.equal(render({ request: { ...request, questions: [{ id: "private", question: "Private", isSecret: true }] } }), "");
  for (const options of [false, 0, ""]) {
    assert.equal(render({ request: { ...request, questions: [{ ...request.questions[0], options }] } }), "");
  }
});

test("read-only scope disables actions, and session switching never mounts the previous session's question", () => {
  const disabled = render({ request }, "zh", true);
  assert.equal((disabled.match(/<button[^>]*disabled=""/g) ?? []).length, 2);
  const scoped = renderCenter({ request });
  assert.ok(scoped.indexOf("external-session-timeline") < scoped.indexOf("external-question-card"));
  assert.match(scoped, /想请你选一下/);
  assert.match(scoped, /external-session-layout extension-work has-pending-question/);
  assert.doesNotMatch(scoped, /is-extension-maximized/);
  assert.doesNotMatch(renderCenter({ request }, "external:s2"), /external-question-card|先从哪一步开始/);
  const closed = renderCenter({ request, outcome: "answered" });
  assert.doesNotMatch(closed, /has-pending-question/);
  const runtimePending = renderCenter({ request }, request.sessionId, "runtime");
  assert.match(runtimePending, /external-session-layout extension-work has-pending-question has-visible-extension/);
  assert.doesNotMatch(runtimePending, /is-extension-maximized/);
  const runtimeClosed = renderCenter({ request, outcome: "answered" }, request.sessionId, "runtime");
  assert.match(runtimeClosed, /external-session-layout extension-work has-visible-extension is-extension-maximized/);
  const css = readFileSync(new URL("src/App.css", root), "utf8");
  assert.match(css, /@container extension-work \(max-width: 760px\)[\s\S]*?has-pending-question\.has-visible-extension \{ flex-direction: column; \}/);
  assert.match(css, /has-pending-question > \.external-session-primary\.extension-primary \{ display: block; \}/);
});

test("the real foreground-restored Agent proposal retains full instructions and one-time creation actions", () => {
  const instructions = "检查证据，不自动授予权限。".repeat(180);
  const html = renderRestored({ approvalId: "proposal-1", question: "Create?", allowAlways: false, presentation: {
    kind: "agent-create", username: "ada", name: "Ada", role: "Research", description: "Evidence", instructions,
  } });
  assert.ok(html.includes(instructions));
  assert.match(html, /创建这个 Bot/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
  assert.doesNotMatch(html, /始终允许/);
});
