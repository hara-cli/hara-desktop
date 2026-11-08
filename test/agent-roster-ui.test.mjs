import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

test("Desktop keeps dismissed Agent history legible while removing the Agent from active work", () => {
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  const picker = readFileSync(new URL("src/AgentPicker.tsx", root), "utf8");
  const profile = readFileSync(new URL("src/AgentProfileEditor.tsx", root), "utf8");
  const client = readFileSync(new URL("src/client.ts", root), "utf8");
  const contact = readFileSync(new URL("src/AgentContact.tsx", root), "utf8");

  assert.match(client, /dismissedAgentRefs\?: string\[\]/);
  assert.match(app, /activeAgentDismissed = Boolean\(/);
  assert.match(app, /activeDraftContentCanSend && !activeAgentDismissed/);
  assert.match(app, /disabled=\{!!activeReadOnlySession \|\| activeAgentDismissed\}/);
  assert.match(app, /历史对话仍保留在本机；重新从人才市场雇佣后/);
  assert.match(app, /dismissedAgentRefs=\{agentCatalog\?\.dismissedAgentRefs\}/);
  assert.match(app, /activeSession\?\.agentRef === agent\.ref[\s\S]*?sessionId: activeSession\.id/);
  assert.match(picker, /dismissedActive \? undefined : agents\.find/);
  assert.match(picker, /已离职 Agent/);
  assert.match(profile, /\{!isRootOrchestrator && agent\.allowedActions\?\.includes\("archive"\) && onArchive \?/);
  assert.doesNotMatch(profile, /\{editable && agent\.allowedActions\?\.includes\("archive"\)/);
  assert.match(profile, /systemRole === "root_orchestrator"/);
  // B1 moved this copy into the locale JSON; the component references the keys.
  const hans = JSON.parse(readFileSync(new URL("src/locales/zh-Hans/ws.json", root), "utf8"));
  assert.match(profile, /t\("ws\.profile\.rootNote"\)/);
  assert.match(profile, /t\("ws\.profile\.loadDefaultIdentity"\)/);
  assert.match(profile, /t\("ws\.profile\.defaultLoadedNotice"\)/);
  const hant = JSON.parse(readFileSync(new URL("src/locales/zh-Hant/ws.json", root), "utf8"));
  assert.match(hans["ws.profile.rootNote"], /这是你的主 Agent，不属于雇佣列表/);
  assert.match(hant["ws.profile.rootNote"], /這是你的主 Agent，不屬於僱用清單/);
  assert.match(hant["ws.profile.defaultLoadedNotice"], /已載入 Hara 預設人格草稿/);
  assert.match(contact, /inbox-agent-root-badge/);
  assert.match(app, /visibleHiredAgentCount/);
  assert.match(app, /historyCount=\{inboxSessionsForAgent\(spaceSessions, detailsAgent\.ref\)\.length\}/);
  assert.match(client, /systemRole\?: "root_orchestrator"/);
});
