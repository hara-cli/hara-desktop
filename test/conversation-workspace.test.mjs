import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-conversation-component-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import {createElement as h} from "react";
    import {renderToStaticMarkup as render} from "react-dom/server";
    import {AgentContact} from "./src/AgentContact.tsx";
    import AgentDetailsDrawer from "./src/AgentDetailsDrawer.tsx";
    import NewConversationMenu from "./src/NewConversationMenu.tsx";
    import {ComposerInputRow} from "./src/ComposerInputRow.tsx";
    export const contact = (agent, locale) => render(h(AgentContact,{agent,locale,preview:"已检查示例页面",working:false,unread:true,selected:true,time:"12:42",onOpen(){},onDetails(){}}));
    export const details = (agent, locale, count=3) => render(h(AgentDetailsDrawer,{agent,locale,historyCount:count,onClose(){},onHistory(){},onManage(){}}));
    export const menu = (agents, locale) => render(h(NewConversationMenu,{agents,locale,canCreateAgent:true,onSelectAgent(){},onCreateAgent(){},onNewTopic(){}}));
    export const composer = (busy, canSend) => render(h(ComposerInputRow,{inputRef:{current:null},value:"",busy,canSend,sendLabel:"Send",stopLabel:"Stop",onSend(){},onStop(){}}, h("textarea",{rows:1,defaultValue:"draft"})));
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "components.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { contact, details, menu, composer } = createRequire(import.meta.url)(compiled);
const main = { ref:"main",name:"Hara",description:"Coordinates work",home:"/workspace/owned",owner:"personal",scope:"main",allowedActions:["chat","edit_profile"],systemRole:"root_orchestrator",
  identity:{version:1,displayName:"My Hara",title:"Coordinator",bio:"A public profile <script>not executable</script>",traits:["Practical"],source:"hara"} };

test("contact renders stable public identity, readable preview and a visible accessible details/history action", () => {
  for (const locale of ["zh", "en"]) {
    const html = contact(main, locale);
    assert.match(html, /My Hara/);
    assert.match(html, /已检查示例页面/);
    assert.match(html, /aria-current="true"/);
    assert.match(html, /inbox-agent-root-badge/);
    assert.match(html, /inbox-unread-dot/);
    assert.match(html, locale === "zh" ? /My Hara的详情与历史/ : /Details and history for My Hara/);
    assert.equal((html.match(/<button/g) ?? []).length, 2);
    assert.doesNotMatch(html, /inbox-unread">\d|inbox-agent-history|privateSession|Worktree/);
  }
});

test("read-only colleague drawer keeps counted history and explicit permission boundary, never a permission form", () => {
  for (const locale of ["zh", "en"]) {
    const html = details(main, locale);
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.match(html, locale === "zh" ? /聊天历史/ : /Chat history/);
    assert.match(html, locale === "zh" ? /3 段对话记录/ : /3 conversations/);
    assert.match(html, locale === "zh" ? /关闭详情也不会停止工作/ : /closing it stops no work/);
    assert.match(html, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<input|<select|<form|<script>|apiKey|自动授权|Always allow/);
    assert.equal((html.match(/<button/g) ?? []).length, 3);
    assert.match(details(main, locale, 0), /<button type="button" disabled=""/);
  }
});

test("collapsed New menu is a single labeled entry, and the composer preserves send/stop/attachment eligibility", () => {
  for (const locale of ["zh", "en"]) {
    const html = menu([main], locale);
    assert.match(html, /aria-haspopup="menu" aria-expanded="false"/);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.doesNotMatch(html, /role="menuitem"|Talent market|人才市场|New task|新任务/);
  }
  assert.match(composer(false, false), /disabled=""/);
  assert.doesNotMatch(composer(false, true), /disabled=""/);
  assert.match(composer(true, false), /composer-send stop/);
  assert.doesNotMatch(composer(true, false), /disabled=""/);
  assert.match(composer(false, true), /rows="1"/);
});

test("App wires only existing chat/create/history flows and keeps the component preview development-only", () => {
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  const entry = readFileSync(new URL("src/main.tsx", root), "utf8");
  const drawer = readFileSync(new URL("src/AgentDetailsDrawer.tsx", root), "utf8");
  assert.match(app, /onCreateAgent=\{agentBlueprintFeatureReady \? openTalentMarket : openCustomRecruitment\}/);
  assert.match(app, /canCreateAgent=\{activeSpaceId === "personal" && agentCreateReady\}/);
  assert.match(app, /preview=\{inboxMessagePreview\(latest \? transcripts\[latest.id\] : undefined\) \|\| agentPublicTitle\(agent\)\}/);
  assert.match(app, /key=\{`\$\{activeSpaceId\}:\$\{detailsAgent.ref\}`\}/);
  assert.match(app, /setDetailsAgentRef\(null\)/);
  assert.match(entry, /conversationPreview = import.meta.env.DEV && params.get\("preview"\) === "conversation"/);
  assert.doesNotMatch(drawer, /client\.|invoke\(|stopTurn|newSession|setApproval|coordination.runtimes/);
  assert.match(drawer, /previous\.focus\(\{ preventScroll: true \}\)/);
  assert.match(drawer, /element.inert = previousInert/);
  assert.match(app, /const activateSession = [\s\S]*?setActive\(id\);\s*setContactDirectoryOpen\(false\)/,
    "opening an authorized historical topic returns the narrow view to chat");
  assert.match(app, /zone === "chat" && workbenchInboxMode === "agents" && active \? " has-active-conversation"/,
    "single-pane contact navigation must not hide the external-session center");
});
