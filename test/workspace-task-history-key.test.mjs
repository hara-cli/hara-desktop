import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTaskHistoryKey} from '../src/workspace-shell-state.ts';

const snapshot = agentId => ({workspaceId:'A',resourceGeneration:'g-A',selectedAgentId:agentId,connections:{revision:1},
  conversation:{revision:0,taskId:null,taskState:null,pastTaskCount:0,history:[]}});

test('142 channel reply notifications do not invalidate unchanged private-chat task history', () => {
  const rows=Array.from({length:143},(_,i)=>snapshot(i?'colleague-'+i:'main'));
  const initial=workspaceTaskHistoryKey(rows);
  for(let turn=0;turn<142;turn++) {
    const refreshed=rows.map(row=>({...row,connections:{revision:turn+2},channelRevision:turn+1,conversation:{...row.conversation,history:[...row.conversation.history]}}));
    assert.equal(workspaceTaskHistoryKey(refreshed),initial);
  }
});

test('background task changes, roster changes and generation transitions invalidate task history', () => {
  const rows=[snapshot('main'),snapshot('colleague')], initial=workspaceTaskHistoryKey(rows);
  for(const change of [{revision:1},{taskId:'task'},{taskState:'completed'},{pastTaskCount:1}]) {
    assert.notEqual(workspaceTaskHistoryKey([rows[0],{...rows[1],conversation:{...rows[1].conversation,...change}}]),initial);
  }
  assert.notEqual(workspaceTaskHistoryKey(rows.slice(0,1)),initial);
  assert.notEqual(workspaceTaskHistoryKey(rows.map(row=>({...row,resourceGeneration:'g-new'}))),initial);
  assert.notEqual(workspaceTaskHistoryKey(rows.map(row=>({...row,workspaceId:'B'}))),initial);
});
