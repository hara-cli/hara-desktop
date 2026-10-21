import { fileURLToPath } from "node:url";
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
    import AgentInboxList from "./src/AgentInboxList.tsx";
    import AgentDetailsDrawer from "./src/AgentDetailsDrawer.tsx";
    import NewConversationMenu from "./src/NewConversationMenu.tsx";
    import SpaceSwitcher from "./src/SpaceSwitcher.tsx";
    import {ComposerInputRow} from "./src/ComposerInputRow.tsx";
    export const contact = (agent, locale) => render(h(AgentContact,{agent,locale,preview:"已检查示例页面",working:false,unread:true,selected:true,time:"12:42",onOpen(){},onDetails(){}}));
    export const details = (agent, locale, count=3) => render(h(AgentDetailsDrawer,{agent,locale,historyCount:count,onClose(){},onHistory(){},onManage(){}}));
    export const menu = (agents, locale) => render(h(NewConversationMenu,{agents,locale,canCreateAgent:true,onSelectAgent(){},onCreateAgent(){},onNewTopic(){}}));
    export const composer = (busy, canSend) => render(h(ComposerInputRow,{inputRef:{current:null},value:"",busy,canSend,sendLabel:"Send",stopLabel:"Stop",onSend(){},onStop(){}}, h("textarea",{rows:1,defaultValue:"draft"})));
    export const inbox = (entries, locale) => render(h(AgentInboxList,{entries,locale,renderContact:({agent})=>h(AgentContact,{key:agent.ref,agent,locale,preview:"preview",working:false,unread:false,selected:false,onOpen(){},onDetails(){}})}));
    export const workspace = (directory, locale, switching=false) => render(h(SpaceSwitcher,{directory,locale,switching,onSelect(){}}));
  `, resolveDir: fileURLToPath(root), loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty", ".svg": "dataurl" }, write: false,
});
const compiled = join(fixture, "components.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { contact, details, menu, composer, inbox, workspace } = createRequire(import.meta.url)(compiled);

test("even a solo Workspace has a readable context selector, without an enterprise hierarchy", () => {
  const directory = {activeId:"personal",activeProfileId:"token-plan",activeSource:"default",switchLocked:false,
    spaces:[{id:"personal",name:"Personal",kind:"personal",profileId:"token-plan",active:true,authoritative:true,agentProfilePermission:"edit"}]};
  for (const locale of ["zh", "en"]) {
    const html = workspace(directory, locale);
    assert.match(html, locale === "zh" ? /我的工作空间/ : /My Workspace/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /Personal Space|个人空间|Company Space|公司空间|is-personal|is-organization/);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.equal(workspace({ ...directory, activeId: "missing" }, locale), "", "never impersonate the first Workspace");
    assert.match(workspace(directory, locale, true), /disabled=""/);
  }
});
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

test("main assistant is separated from colleagues by stable role, with each searched entry rendered once", () => {
  const colleague = { ...main, ref: "global:ordinary", systemRole: undefined, name: "Hara", identity: { ...main.identity, displayName: "Ordinary colleague" } };
  const renamedRoot = { ...main, ref: "organization:coordinator", name: "Coordinator", identity: { ...main.identity, displayName: "My renamed coordinator" } };
  const entries = [colleague, renamedRoot].map(agent => ({ agent, sessions: [] }));
  for (const locale of ["zh", "en"]) {
    const html = inbox(entries, locale);
    assert.ok(html.indexOf("My renamed coordinator") < html.indexOf("Ordinary colleague"));
    assert.equal((html.match(/inbox-contact-shell/g) ?? []).length, 2);
    assert.equal((html.match(/agent-portrait-brand/g) ?? []).length, 1);
    assert.match(html, locale === "zh" ? /aria-label="主助手"/ : /aria-label="Main assistant"/);
    assert.match(html, /inbox-colleagues/);
    assert.doesNotMatch(inbox([entries[0]], locale), /inbox-main-coordinator|agent-portrait-brand/);
    assert.doesNotMatch(inbox([], locale), /inbox-main-coordinator|inbox-colleagues/);
  }
});

test("root uses the canonical logo by default while chosen avatar and nickname remain independent", () => {
  const standard = contact(main, "zh");
  assert.match(standard, /agent-portrait-brand/);
  assert.match(standard, /data:image\/svg\+xml/);
  const avatar = "data:image/png;base64,iVBORw0KGgo=";
  const customized = contact({ ...main, identity: { ...main.identity, avatar } }, "en");
  assert.match(customized, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(customized, /My Hara/);
  assert.doesNotMatch(customized, /agent-portrait-brand/);
  const portrait = readFileSync(new URL("src/AgentPortrait.tsx", root), "utf8");
  const portraitCss = readFileSync(new URL("src/AgentPortrait.css", root), "utf8");
  const list = readFileSync(new URL("src/AgentInboxList.tsx", root), "utf8");
  assert.match(portrait, /isRootAgent\(\{ ref: agentRef, systemRole \}\)/);
  assert.match(portraitCss, /\.agent-portrait\.is-root\.is-idle \.agent-portrait-presence \{ display: none; \}/);
  assert.doesNotMatch(list, /client\.|invoke\(|listAgents|newSession|setApproval|\.name\s*===/);
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
  const entry = readFileSync(new URL("src/LegacyDesktopEntry.tsx", root), "utf8");
  const drawer = readFileSync(new URL("src/AgentDetailsDrawer.tsx", root), "utf8");
  assert.ok(/onCreateAgent=\{guidedAgentCreateReady \? \(\) => void startAgentCreation\(\) : undefined\}/.test(app), "supported guided creation starts with the main assistant, not a mandatory catalog visit");
  assert.ok(/onConfigureAgent=\{openCustomRecruitment\}/.test(app), "manual configuration remains an explicit fallback");
  assert.ok(/onBrowseCandidates=\{agentBlueprintFeatureReady \? openTalentMarket : undefined\}/.test(app), "optional role browsing remains capability gated");
  assert.ok(/suspended=\{talentMarketOpen && !hireAgentBlueprint\}/.test(app), "browsing keeps the custom form mounted, with its draft preserved");
  assert.ok(/canCreateAgent=\{activeSpaceId === "personal" && agentCreateReady\}/.test(app), "old engines retain their existing audience and creation guards");
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
