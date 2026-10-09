import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-task-approval-card-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { ConversationTimeline } from "./src/ConversationTimeline.tsx";
    import TaskApprovalStatus from "./src/TaskApprovalStatus.tsx";
    import { restoreSessionApprovals } from "./src/approval-restoration.ts";
    import { makeT } from "./src/i18n.ts";
    export const renderCard = (item, supported = true, locale = "zh", sessionId = "s1") => renderToStaticMarkup(createElement(ConversationTimeline, {
      items:[item], busy:false, displayMode:"concise", bottomRef:{current:null}, t:makeT(locale),
      sessionId, taskApprovalSupported:supported, onRewind() {}, async onApproval() {},
    }));
    export const renderRestored = (pending, previous) => renderCard(restoreSessionApprovals([], "s1", undefined, [pending], previous).at(-1));
    export const renderStatus = (state, locale = "zh") => renderToStaticMarkup(createElement(TaskApprovalStatus, {
      state, locale, sessionId:"s1", async onRevoke() {},
    }));
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "card.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { renderCard, renderStatus, renderRestored } = createRequire(import.meta.url)(compiled);

const item = {
  kind: "approval", approvalId: "task-1", question: "Review project files?", allowAlways: true, allowForTask: true,
  expiresAt: "2099-01-01T00:00:00Z", taskApproval: { summary: "Review this project <script>unsafe</script>", toolFamily: "bash", durationMs: 900_000 },
};
const active = { active: true, toolFamilies: ["bash", "file-change"], expiresAt: "2099-01-01T00:15:00Z", canRevoke: true };

test("ordinary approval card offers explicit task scope only with eligibility and full capability, never preselects", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderCard(item, true, locale);
    assert.match(html, locale === "zh" ? /允许本任务 · 最多15分钟/ : /Allow for this task · up to 15 minutes/);
    assert.match(html, locale === "zh" ? /Computer Use 专用工具仍须另行确认/ : /dedicated Computer Use tools still require separate confirmation/);
    assert.match(html, locale === "zh" ? /当前执行 Agent、任务、项目和工具类别/ : /this execution Agent, task, project and tool family/);
    assert.equal((html.match(/<button/g) ?? []).length, 4);
    assert.doesNotMatch(html, /checked=|selected=|autoFocus=|task-approval-status/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  }
  assert.doesNotMatch(renderCard(item, false), /task-approval-choice|允许本任务/);
  assert.equal((renderCard(item, false).match(/<button/g) ?? []).length, 3);
  assert.doesNotMatch(renderCard(item, true, "zh", null), /task-approval-choice/);
  for (const changes of [{ taskApproval: undefined }, { allowForTask: false }, { expiresAt: undefined }, { taskApproval: { ...item.taskApproval, toolFamily:"computer" } }]) {
    assert.doesNotMatch(renderCard({ ...item, ...changes }), /task-approval-choice/);
  }
});

test("creation proposal cannot acquire task permission even with injected eligibility metadata", () => {
  const proposal = { ...item, allowAlways: false, presentation: {
    kind:"agent-create", username:"ada", name:"Ada", role:"Research", description:"Checks evidence", instructions:"Never inherit permissions.",
  } };
  const html = renderCard(proposal);
  assert.match(html, /创建这个 Bot/);
  assert.doesNotMatch(html, /允许本任务|task-approval-choice|始终允许/);
  assert.equal((html.match(/<button/g) ?? []).length, 2);
});

test("expired and answered requests are inert, and uncertain task receipt permits only identical task retry", () => {
  const expired = renderCard({ ...item, expiresAt:"2000-01-01T00:00:00Z" });
  assert.match(expired, /确认已过期/);
  assert.doesNotMatch(expired, /<button/);
  const answered = renderCard({ ...item, answered:"task" });
  assert.match(answered, /本任务允许已确认/);
  assert.doesNotMatch(answered, /<button|task-approval-status|任务已完成|completed/);
  const uncertain = renderCard({ ...item, taskApprovalCommandId:"same-intent" });
  assert.equal((uncertain.match(/<button[^>]*disabled=""/g) ?? []).length, 3);
  assert.match(uncertain, /<button type="button" class="ghost task-approval-choice"/);
  assert.doesNotMatch(uncertain, /task-approval-status|本任务允许已确认/);
  const restored = renderRestored(item, { sessionId:"s1", items:[{...item, taskApprovalCommandId:"same-intent"}] });
  assert.equal((restored.match(/<button[^>]*disabled=""/g) ?? []).length, 3);
});

test("active strip uses only server state; inactive and invalid states render no claimed grant", () => {
  assert.equal(renderStatus({ active:false, toolFamilies:[], canRevoke:false }), "");
  assert.equal(renderStatus({ ...active, toolFamilies:["computer"] }), "");
  for (const locale of ["zh", "en"]) {
    const html = renderStatus(active, locale);
    assert.match(html, locale === "zh" ? /本任务临时允许/ : /Temporary task permission/);
    assert.match(html, locale === "zh" ? /撤销允许/ : /Revoke permission/);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
  }
  assert.doesNotMatch(renderStatus({ ...active, canRevoke:false }), /<button/);
});

test("client clock ahead keeps safe revoke affordance until an authoritative inactive state", () => {
  const html = renderStatus({ ...active, expiresAt:"2000-01-01T00:00:00Z" });
  assert.match(html, /待核验到期/);
  assert.match(html, /撤销允许/);
  assert.doesNotMatch(html, /已撤销|确认已过期/);
  assert.equal(renderStatus({ active:false, toolFamilies:[], canRevoke:false }), "");
});

test("pending card layout is a temporary compact split and status remains in terminal-only surface", () => {
  const css = readFileSync(new URL("src/App.css", root), "utf8");
  assert.match(css, /has-pending-approval > \.extension-primary \{ display: flex; \}/);
  assert.match(css, /@container extension-work \(max-width: 760px\)[\s\S]*?has-pending-approval\.has-visible-extension \{ flex-direction: column; \}/);
  const source = readFileSync(new URL("src/App.tsx", root), "utf8");
  assert.match(source, /const effectiveConversationDockMode = parentInteractionPending \? "docked" : approvalDockMode\(contextExtensionDock\?\.mode \?\? "docked", items, approvalClock\)/);
  assert.match(source, /effectiveConversationDockMode === "maximized" \? taskApprovalStatusSurface : null/);
  assert.match(source, /taskApprovalSupported=\{taskApprovalSupported && !readOnlySessions\[active\]\}/);
  assert.doesNotMatch(source, /setExtensionDockMode\(effectiveConversationDockMode/);
});
