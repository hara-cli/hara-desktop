import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-guided-agent-creation-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import React from "react";
    import {renderToStaticMarkup} from "react-dom/server";
    import {NewConversationActions} from "./src/NewConversationMenu.tsx";
    export * from "./src/guided-agent-creation.ts";
    export {makeT} from "./src/i18n.ts";
    export function actions(props) {return NewConversationActions(props);}
    export function render(props) {return renderToStaticMarkup(React.createElement(NewConversationActions,props));}
  `, resolveDir: fileURLToPath(root), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic",
  loader: { ".css": "empty", ".svg": "dataurl" }, write: false,
});
const compiled = join(fixture, "creation.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { actions, render, makeT, supportsGuidedAgentCreation, reusableAgentCreationConversation, agentCreationDraft, openGuidedAgentCreation } = createRequire(import.meta.url)(compiled);

test("guided creation requires an explicit Host feature; older manual-creation engines keep their fallback", () => {
  assert.equal(supportsGuidedAgentCreation(null), false);
  for (const methods of [false, true]) for (const feature of [false, true]) {
    assert.equal(supportsGuidedAgentCreation({
      supports: method => methods && method === "agents.create",
      supportsFeature: name => feature && name === "agent.creation.v1",
    }), methods && feature);
  }
  const html = render({ locale: "en", canCreateAgent: true, onPeople() {}, onConfigureAgent() {} });
  assert.match(html, /Set up a colleague manually/);
  assert.doesNotMatch(html, /Discuss the work with Hara/);
});

function host() {
  const h = {
    state: { engine: {}, spaceId: "personal", spaceRevision: 1, canCreate: true, switching: false },
    active: "main-chat", calls: [],
  };
  h.options = {
    context: () => ({ ...h.state }),
    openMainConversation: async () => { h.calls.push(["open"]); return "main-chat"; },
    selected: id => h.active === id,
    stageDraft: (id, stillCurrent) => { if (stillCurrent()) h.calls.push(["draft", id]); },
    focusComposer: stillCurrent => { if (stillCurrent()) h.calls.push(["focus"]); },
  };
  return h;
}

test("guided creation only opens the main chat and stages a draft; it has no send or create operation", async () => {
  const h = host();
  assert.equal(await openGuidedAgentCreation(h.options), true);
  assert.deepEqual(h.calls, [["open"], ["draft", "main-chat"], ["focus"]]);
});

test("legacy audience, engine readiness and creation capability are checked before opening any chat", async () => {
  for (const patch of [{ engine: null }, { spaceId: "workspace-b" }, { canCreate: false }, { switching: true }]) {
    const h = host(); Object.assign(h.state, patch);
    assert.equal(await openGuidedAgentCreation(h.options), false);
    assert.deepEqual(h.calls, []);
  }
  const mutable = host();
  mutable.options.context = () => mutable.state;
  mutable.options.openMainConversation = async () => { mutable.state.spaceRevision += 2; return "main-chat"; };
  assert.equal(await openGuidedAgentCreation(mutable.options), false,
    "an in-place context mutation cannot retarget the captured origin after A-B-A");
  assert.deepEqual(mutable.calls, []);
});

test("canceled navigation neither adds a draft nor moves focus", async () => {
  const h = host(); h.options.openMainConversation = async () => null;
  assert.equal(await openGuidedAgentCreation(h.options), false);
  assert.deepEqual(h.calls, []);
});

test("opening failures propagate to the existing error surface without a send or implicit retry", async () => {
  const h = host(); h.options.openMainConversation = async () => { throw new Error("fixture-open-failed"); };
  await assert.rejects(openGuidedAgentCreation(h.options), /fixture-open-failed/);
  assert.deepEqual(h.calls, []);
});

test("reconnect, workspace switch including A-B-A, revoked capability and navigation invalidate late drafts", async () => {
  for (const mutate of [
    h => { h.state.engine = {}; },
    h => { h.state.engine = null; },
    h => { h.state.spaceId = "workspace-b"; },
    h => { h.state.spaceRevision += 2; },
    h => { h.state.canCreate = false; },
    h => { h.state.switching = true; },
    h => { h.active = "colleague-chat"; },
  ]) {
    const h = host();
    h.options.openMainConversation = async () => { mutate(h); return "main-chat"; };
    assert.equal(await openGuidedAgentCreation(h.options), false);
    assert.deepEqual(h.calls, []);
  }
});

test("deferred draft/focus callbacks recheck the same context rather than stealing a different chat", async () => {
  const h = host(); const callbacks = [];
  h.options.stageDraft = (_id, guard) => callbacks.push(() => guard() && h.calls.push(["draft"]));
  h.options.focusComposer = guard => callbacks.push(() => guard() && h.calls.push(["focus"]));
  assert.equal(await openGuidedAgentCreation(h.options), true);
  h.state.spaceRevision += 1;
  for (const callback of callbacks) callback();
  assert.deepEqual(h.calls, [["open"]]);
});

const cwd = "/fixture-home/.hara/workspace";
const mainChat = { id: "main-chat", cwd, source: "interactive", title: "Main", updatedAt: "2026-10-14T10:00:00Z" };
test("only the newest eligible main conversation is reused; projects, coworkers, cron and gateway runs are excluded", () => {
  const unrelated = [
    { ...mainChat, id: "project", cwd: "/fixture-project" },
    { ...mainChat, id: "coworker", agentRef: "global:ada" },
    { ...mainChat, id: "cron", source: "cron" },
    { ...mainChat, id: "gateway", source: "gateway" },
    { ...mainChat, id: "archived", archived: true },
  ];
  assert.equal(reusableAgentCreationConversation(unrelated, cwd, () => false, {}), undefined);
  const older = { ...mainChat, id: "older", updatedAt: "2026-10-13T10:00:00Z" };
  const candidates = [older, ...unrelated, mainChat];
  assert.equal(reusableAgentCreationConversation(candidates, cwd, () => false, {}).id, "main-chat");
  assert.equal(reusableAgentCreationConversation(candidates, cwd, id => id === "main-chat", {}), undefined,
    "a busy or read-only latest chat must not silently jump into an older task");
  assert.equal(candidates[0], older, "selection never mutates the authoritative session list");
});

test("existing text, whitespace and attachment drafts are preserved, including changes during async opening", () => {
  for (const draft of [
    { text: "unsent work", attachments: [] }, { text: " ", attachments: [] },
    { text: "", attachments: [{ id: "file-1", kind: "file", path: "/fixture-file", name: "fixture" }] },
  ]) {
    assert.equal(reusableAgentCreationConversation([mainChat], cwd, () => false, { "main-chat": draft }), undefined);
    assert.equal(agentCreationDraft(draft, "guided prompt"), draft);
  }
  const blank = { text: "", attachments: [] };
  assert.deepEqual(agentCreationDraft(blank, "guided prompt"), { ...blank, text: "guided prompt" });
  assert.equal(blank.text, "");
});

function nodes(element, found = []) {
  if (Array.isArray(element)) { for (const item of element) nodes(item, found); }
  else if (element && typeof element === "object" && element.props) { found.push(element); nodes(element.props.children, found); }
  return found;
}
test("real New actions prioritize a discussion with Hara and keep manual configuration a separate opt-in", () => {
  for (const locale of ["en", "zh"]) {
    const called = [];
    const props = { locale, canCreateAgent: true, onPeople: () => called.push("people"),
      onCreateAgent: () => called.push("guided"), onConfigureAgent: () => called.push("manual"), onNewTopic: () => called.push("topic") };
    const html = render(props);
    assert.match(html, locale === "zh" ? /告诉主 Hara 要做什么，先商量再创建/ : /Discuss the work with Hara before creating/);
    assert.match(html, locale === "zh" ? /手动配置同事/ : /Set up a colleague manually/);
    assert.doesNotMatch(html, /人才市场|Talent market|API Key|Always allow/);
    const buttons = nodes(actions(props)).filter(node => node.type === "button");
    assert.deepEqual(called, [], "rendering never starts a conversation or creates an Agent");
    buttons[2].props.onClick(); buttons[3].props.onClick();
    assert.deepEqual(called, ["guided", "manual"]);
    assert.ok(nodes(actions({ ...props, busy: true })).filter(node => node.type === "button").slice(1)
      .every(node => node.props.disabled === true));
    assert.equal(nodes(actions({ ...props, canCreateAgent: false })).filter(node => node.type === "button").length, 2);
  }
});

test("both prompts respect the Host default and creation tool schema, with explicit consent and no grants", () => {
  for (const locale of ["en", "zh"]) {
    const prompt = makeT(locale)("agentCreationPrompt");
    assert.match(prompt, /Pi/);
    assert.match(prompt, locale === "zh" ? /Runtime 由宿主绑定预设值/ : /Host assigns the default Runtime/);
    assert.match(prompt, locale === "zh" ? /不要给 agent_create 添加 Runtime 字段/ : /do not add Runtime fields to agent_create/);
    assert.match(prompt, locale === "zh" ? /手动配置同事/ : /manual colleague setup/);
    assert.match(prompt, locale === "zh" ? /创建审批卡片/ : /creation approval card/);
    assert.match(prompt, locale === "zh" ? /不授予电脑、编码、密钥或工具权限/ : /grants no computer, coding, credential or tool permissions/);
  }
});

test("App wires the guarded workflow, retained manual form, per-Workspace sessions and draft-safe functional update", () => {
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  const begin = app.indexOf("const startAgentCreation = async");
  const end = app.indexOf("/** Office creates", begin);
  const flow = app.slice(begin, end);
  assert.ok(begin >= 0 && end > begin);
  assert.ok(/assistantCreationRef\.current\) return/.test(flow));
  assert.ok(/sessionSpaceId\(session, directory\) === "personal"/.test(flow));
  assert.ok(/newSession\(`\$\{home\}\/\.hara\/workspace`, "main"\)/.test(flow));
  assert.ok(/busyRef\.current\[id\] \|\| readOnlySessionsRef\.current\[id\]/.test(flow));
  assert.ok(/updateComposerDraft\(id, \(draft\) => stillCurrent\(\)/.test(flow));
  assert.ok(/if \(stillCurrent\(\)\) inputRef\.current\?\.focus\(\)/.test(flow));
  assert.ok(!/\.send\(|sendMessage\(|createAgent\(|setApproval\(/.test(flow));
  assert.ok(/onConfigureAgent=\{openCustomRecruitment\}/.test(app));
});
