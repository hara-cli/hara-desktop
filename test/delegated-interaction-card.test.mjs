import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const fixture = mkdtempSync(join(tmpdir(), "hara-delegated-card-"));
after(() => rmSync(fixture, { recursive: true, force: true }));
const bundle = await build({
  stdin: { contents: `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import DelegatedInteractionCards from "./src/DelegatedInteractionCards.tsx";
    import ExternalSessionCenter from "./src/ExternalSessionCenter.tsx";
    import { ConversationTimeline } from "./src/ConversationTimeline.tsx";
    import { makeT } from "./src/i18n.ts";
    export const render = (questions, approvals, activeSessionId = "parent-1", personal = true, disabled = false, locale = "zh") => renderToStaticMarkup(createElement(ConversationTimeline, {
      items: [{kind:"notice",text:"Fix this project"}], busy:false, displayMode:"concise", bottomRef:{current:null},
      t:makeT(locale), onRewind(){}, async onApproval(){},
      interactionCards: createElement(DelegatedInteractionCards, { questions, approvals, activeSessionId, personal, disabled, locale,
        async onQuestionReply(){}, async onApprovalReply(){} }),
    }));
    export const center = (question) => renderToStaticMarkup(createElement(ExternalSessionCenter, {
      sources:["runtime","codex","claude","opencode"].map(id=>({id,label:id,state:"ready",capabilities:{}})),
      sessions:[],selected:{id:"external-1",sourceId:"codex",title:"Existing",workspaceName:"Project",state:"waiting"},
      selectedSourceId:"codex",transcript:{session:{id:"external-1"},messages:[],readOnly:false,controlMode:"managed"},
      activity:[],approval:null,questions:[question],personal:true,locale:"zh",async onQuestionReply(){},
      copy:new Proxy({sessionStates:{},sourceStates:{},engineSources:"ENGINE GROUP",terminalSources:"ADVANCED TERMINAL GROUP",managedTerminal:"MANAGED TERMINAL"}, {get(target,key){return target[key]??String(key);}}),
    }));
  `, resolveDir: root.pathname, loader: "tsx" },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, write: false,
});
const compiled = join(fixture, "cards.cjs");
writeFileSync(compiled, bundle.outputFiles[0].contents);
const { render, center } = createRequire(import.meta.url)(compiled);
const question = { request: { questionId:"00000000-0000-4000-8000-000000000001",sessionId:"external-1",turnId:"turn-1",
  parentSessionId:"parent-1",agentPath:"/root/code",expiresAt:"2099-01-01T00:00:00Z",
  questions:[{id:"scope",question:"Which files?",options:[{label:"Source"},{label:"Tests"}]}] } };
const approval = { request: {approvalId:"approval-1",sessionId:"external-2",turnId:"turn-2",parentSessionId:"parent-1",
  agentPath:"/root/patch",expiresAt:"2099-01-01T00:00:00Z",question:"Apply these changes?"} };

test("real main timeline contains delegated questions and one-action approvals without a session-console switch", () => {
  for (const locale of ["zh", "en"]) {
    const html = render([question], [approval], "parent-1", true, false, locale);
    assert.match(html, /Which files\?/);
    assert.match(html, /Apply these changes\?/);
    assert.match(html, /\/root\/code/);
    assert.match(html, /\/root\/patch/);
    assert.equal((html.match(/external-question-card/g) ?? []).length, 1);
    assert.equal((html.match(/approval-card-head/g) ?? []).length, 1);
    assert.equal((html.match(/<button/g) ?? []).length, 4);
    assert.doesNotMatch(html, /Always allow|始终允许|task-approval-choice|external-session-center|checked=""/);
    assert.ok(html.indexOf("Which files?") > html.indexOf("Fix this project"));
  }
});

test("switching parent or Space removes all private card content; read-only keeps actions disabled", () => {
  for (const html of [render([question], [approval], "other-parent"), render([question], [approval], "parent-1", false), render([question], [approval], null)]) {
    assert.doesNotMatch(html, /Which files|Apply these changes|\/root\/code|delegated-interaction-cards/);
  }
  const html = render([question], [approval], "parent-1", true, true);
  assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 4);
});

test("answered/expired cards are inert and unsafe metadata or secret questions have no projection", () => {
  const closed = render([{ ...question, outcome:"answered" }], [{...approval,outcome:"interrupted"}]);
  assert.doesNotMatch(closed, /<button/);
  assert.match(closed, /这项执行确认已结束/);
  const expired = render([{request:{...question.request,expiresAt:"2000-01-01T00:00:00Z"}}], [{request:{...approval.request,expiresAt:"2000-01-01T00:00:00Z"}}]);
  assert.doesNotMatch(expired, /<button/);
  const secret = {request:{...question.request,questions:[{id:"private",question:"Private material",isSecret:true}]}};
  assert.doesNotMatch(render([secret], []), /Private material|external-question-card/);
  assert.doesNotMatch(render([{request:{...question.request,parentSessionId:""}}], [{request:{...approval.request,agentPath:"x".repeat(513)}}]), /Which files|Apply these changes/);
});

test("advanced sessions group engines separately and never duplicate a parent question", () => {
  const html = center(question);
  assert.match(html, /aria-label="ENGINE GROUP"/);
  assert.match(html, /aria-label="ADVANCED TERMINAL GROUP"/);
  assert.match(html, /MANAGED TERMINAL/);
  assert.equal((html.match(/class="external-source-tab/g) ?? []).length, 4);
  assert.doesNotMatch(html, /Which files|external-question-card|has-pending-question/);
  assert.match(center({request:{...question.request,parentSessionId:undefined}}), /Which files|external-question-card/);
});

test("App wiring keeps legacy approvals separate, foreground cards in the timeline and original reply identity", () => {
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  assert.match(app, /interactionCards=\{delegatedInteractionSurface\}/);
  assert.match(app, /externalInteractionReplyAllowed\(entry.request/);
  assert.match(app, /entry.request.sessionId !== reply.sessionId \|\| entry.request.turnId !== reply.turnId/);
  assert.match(app, /approval.scope === "external" && approval.parentSessionId === undefined/);
  assert.match(app, /parentInteractionPending \? "docked"/);
  const clearSurfaces = app.slice(app.indexOf("const clearEngineBoundSurfaces"), app.indexOf("const connect ="));
  assert.doesNotMatch(clearSurfaces, /delegatedApprovalSubmissionRef.current\s*=/, "reconnect must preserve uncertain command IDs and original decisions");
});
