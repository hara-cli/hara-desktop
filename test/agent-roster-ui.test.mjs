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
  assert.match(profile, /\{agent\.allowedActions\?\.includes\("archive"\) && onArchive \?/);
  assert.doesNotMatch(profile, /\{editable && agent\.allowedActions\?\.includes\("archive"\)/);
});
