import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

test("Desktop keeps dismissed Agent history legible while removing the Agent from active work", () => {
  const app = readFileSync(new URL("src/App.tsx", root), "utf8");
  const picker = readFileSync(new URL("src/AgentPicker.tsx", root), "utf8");
  const profile = readFileSync(new URL("src/AgentProfileEditor.tsx", root), "utf8");
  const client = readFileSync(new URL("src/client.ts", root), "utf8");

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
  assert.match(profile, /这是你的主 Agent，不属于雇佣列表/);
  assert.match(profile, /载入默认人格/);
  assert.match(profile, /点击“保存名片”后才会生效/);
  assert.match(app, /inbox-agent-root-badge/);
  assert.match(app, /visibleHiredAgentCount/);
  assert.match(app, /agentSessions\.length > 0/);
  assert.match(client, /systemRole\?: "root_orchestrator"/);
});
