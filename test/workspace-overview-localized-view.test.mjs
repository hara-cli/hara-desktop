import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WorkspaceDevModel } from '../src/workspace-dev-state.ts';
import { buildWorkspaceShell } from '../src/workspace-shell-state.ts';
import { localizedWorkspaceView } from '../src/workspace-default-labels.ts';

// Regression (release 1.2.0 integration of i18n B2): the screen began passing the localized view's workspace to
// useWorkspaceOverview. readOverview admits only the controller's own snapshot object, so every overview read failed,
// the colleague snapshots never arrived and Needs You showed no count. Only the panel smoke caught it.
const main = { agentId:'main', kind:'main', state:'active', titleSource:'default', titleKey:'core.name.orchestrator', identity:{ displayName:'Hara', title:'Root Orchestrator' } };
const colleagues = ['ops','coder'].map(agentId => ({ agentId, kind:'colleague', state:'active', identity:{ displayName:agentId, title:'Colleague' } }));
const snapshot = agentId => ({ workspaceId:'A', resourceGeneration:'g-A', selectedAgentId:agentId, label:'我的空間', labelSource:'default', labelKey:'core.name.workspace',
  syntheticOnly:true, agents:[main, ...colleagues], connections:{ revision:1, defaultConnectionId:'fixture', connections:[] }, approvals:[],
  conversation: agentId === 'main' ? { state:'idle', history:[] }
    : { state:'waiting_user', taskState:'waiting_user', taskId:`task-${agentId}`, objective:`Reply to ${agentId}`, history:[] } });
async function connected() {
  const model = new WorkspaceDevModel({ async request(method, params) {
    if (method === 'workspace.list') return { revision:1, syntheticOnly:true, workspaces:[{ workspaceId:'A', label:'我的空間', labelSource:'default', labelKey:'core.name.workspace', active:true }] };
    return snapshot(params.agentId ?? 'main');
  } });
  await model.selectWorkspace('A');
  return model;
}

test('the overview reads from the controller snapshot and counts colleague replies for Needs You', async () => {
  const model = await connected(), raw = model.getSnapshot().workspace;
  const localized = localizedWorkspaceView(model.getSnapshot(), 'en').workspace;
  assert.notEqual(localized, raw, 'the localized workspace is a renderer-only copy');
  assert.equal(localized.label, 'My workspace');
  await assert.rejects(model.readOverview(localized, { reuseUnchanged:true }), /Overview view changed/);
  const overview = await model.readOverview(raw, { reuseUnchanged:true });
  assert.equal(overview.incomplete, false);
  const shell = buildWorkspaceShell([raw, ...overview.snapshots.filter(row => row.selectedAgentId !== raw.selectedAgentId)]);
  assert.equal(shell.waiting.length, 2);
  assert.deepEqual(shell.waiting.map(row => row.agentId).sort(), ['coder','ops']);
});

test('the Workspace screen hands useWorkspaceOverview the raw controller snapshot, never the localized copy', () => {
  const source = fs.readFileSync(new URL('../src/WorkspaceLocalDev.tsx', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/useWorkspaceOverview\(\s*model\s*,\s*([^)]+)\)/g)].map(match => match[1].trim());
  assert.deepEqual(calls, ['rawView.workspace']);
});
