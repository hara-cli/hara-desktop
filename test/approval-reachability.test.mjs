import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceShell, conversationTimeline, highPriorityApproval, messageContinues, loadSidebarSections, normalizeShellRoute } from '../src/workspace-shell-state.ts';
import { WorkspaceDevModel } from '../src/workspace-dev-state.ts';
const now = Date.parse('2026-10-20T02:00:00Z');
const card = (id, extra = {}) => ({ id, workspaceId:'A', resourceGeneration:'g-A', agentId:'main', expiresAt:new Date(now + 60*60*1000).toISOString(),
  draft:{username:id,displayName:id,title:'Colleague',instructions:'Fixture only',runtimeId:'pi'}, ...extra });
const snapshot = (approvals = [], extra = {}) => ({ workspaceId:'A',resourceGeneration:'g-A',selectedAgentId:'main',label:'Fixture',syntheticOnly:true,agents:[{agentId:'main'}],
  connections:{revision:1,defaultConnectionId:'fixture',connections:[]},approvals,
  conversation:{state:'running',taskState:'running',taskId:'task-main',objective:'Fixture task',history:[], ...extra} });
for (const [label, approvals] of [ ['zero', []], ['one high priority', [card('urgent', {risk:'high'})]],
  ['five high and three normal', [...Array.from({length:3},(_,i)=>card(`normal-${i}`)), ...Array.from({length:5},(_,i)=>card(`urgent-${i}`,{risk:'high'}))]] ]) {
  test(`approval reachability: ${label}`, () => {
    const snapshots = [snapshot(approvals)], shell = buildWorkspaceShell(snapshots, now);
    assert.equal(shell.homeAwaitBar.count, approvals.length);
    assert.equal(shell.homeAwaitBar.count, shell.navBadge); assert.equal(shell.navBadge, shell.tasksTabBadge);
    for (const approval of approvals) assert.ok(conversationTimeline(snapshots,'main',now).some(item=>item.kind==='approval' && item.approval.id===approval.id));
    const high = approvals.filter(value=>highPriorityApproval(value,now));
    for (const approval of high) assert.ok(shell.homeAwaitBar.items.some(item=>item.id===approval.id));
    const priorityOrder=shell.homeAwaitBar.items.map(item=>item.highPriority);
    assert.deepEqual(priorityOrder,[...priorityOrder].sort((a,b)=>Number(b)-Number(a)));
  });
}
test('all terminal task states invalidate their approvals; closed tasks stay in the closed work record',()=>{
  for(const state of ['completed','cancelled','withdrawn','rejected','expired']) {
    const snapshots=[snapshot([card('stale',{risk:'high'})],{taskState:state})], shell=buildWorkspaceShell(snapshots,now);
    assert.equal(shell.navBadge,0); assert.equal(shell.homeAwaitBar.items.length,0);
    assert.equal(conversationTimeline(snapshots,'main',now).some(item=>item.kind==='approval'),false);
    assert.equal(shell.tasks[0].group,'closed');
  }
});
test('scope, generation, origin, decision and expiry mismatches cannot enter counts or a timeline',()=>{
  const cards=[card('foreign',{workspaceId:'B'}),card('old',{resourceGeneration:'old'}),card('other',{agentId:'other'}),card('done',{status:'approved'}),card('expired',{expiresAt:new Date(now).toISOString()})];
  assert.equal(buildWorkspaceShell([snapshot(cards)],now).navBadge,0);
  assert.equal(conversationTimeline([snapshot(cards)],'main',now).filter(item=>item.kind==='approval').length,0);
});
test('every high risk, paid, external send, destructive and soon-expiring approval outranks normal items',()=>{
  const causes=[{risk:'high'},{paid:true},{externalSend:true},{destructive:true},{expiresAt:new Date(now+29*60000).toISOString()}];
  const urgent=causes.map((extra,i)=>card(`urgent-${i}`,extra));
  const shell=buildWorkspaceShell([snapshot([card('normal'),...urgent])],now);
  assert.equal(shell.homeAwaitBar.items.length,5); assert.equal(shell.homeAwaitBar.items.every(item=>item.highPriority),true);
});
test('counts combine pending approvals, replies, reviews and blocked work from every conversation',()=>{
  const snapshots=[snapshot([card('approval')]), ...['waiting_reply','pending_review','blocked','completed','queued','running'].map((state,i)=>({
    ...snapshot([],{taskState:state,taskId:`task-${i}`}),selectedAgentId:`colleague-${i}`}))];
  const shell=buildWorkspaceShell(snapshots,now); assert.equal(shell.navBadge,4); assert.equal(shell.tasksTabBadge,4);
  assert.deepEqual(shell.tasks.map(task=>task.group),['needsYou','needsYou','needsYou','needsYou','closed','waiting','working']);
});
test('messages group only for the same sender within five minutes; missing times and tools do not imply a group',()=>{
  const first={role:'assistant',text:'One',tools:[],createdAt:new Date(now).toISOString()};
  assert.equal(messageContinues(first,{...first,createdAt:new Date(now+5*60000).toISOString()}),true);
  assert.equal(messageContinues(first,{...first,createdAt:new Date(now+5*60000+1).toISOString()}),false);
  assert.equal(messageContinues(first,{role:'user',content:'Two',createdAt:first.createdAt}),false);
  assert.equal(messageContinues(first,{...first,createdAt:undefined}),false);
  assert.equal(messageContinues({role:'tool',results:[]},first),false);
});
test('sidebar state is independent, workspace scoped and tolerant of blocked/malformed storage',()=>{
  const storage=new Map([['hara.sidebar.sections.A',JSON.stringify({colleagues:false,channels:true,dms:false})]]);
  assert.deepEqual(loadSidebarSections('A',key=>storage.get(key)),{colleagues:false,channels:true,dms:false});
  assert.deepEqual(loadSidebarSections('B',key=>storage.get(key)),{colleagues:true,channels:true,dms:true});
  for(const read of [()=>'{broken',()=>{throw new Error('blocked');},()=>JSON.stringify({colleagues:'no',channels:false})]) {
    const value=loadSidebarSections('A',read); assert.equal(value.colleagues,true); assert.equal(value.dms,true);
  }
  assert.deepEqual(normalizeShellRoute('#tasks'),{section:'colleagues',tab:'tasks'});
  assert.deepEqual(normalizeShellRoute('#/tasks'),{section:'colleagues',tab:'tasks'});
});
test('overview reads use existing read-only RPC and cannot select, send, approve or cross a generation',async()=>{
  const calls=[], agents=['main','ops','coder'].map(agentId=>({agentId}));
  let wrongGeneration=false, fail=false;
  const model=new WorkspaceDevModel({async request(method,params){calls.push({method,params});
    if(method==='workspace.list') return {revision:1,syntheticOnly:true,workspaces:[{workspaceId:'A',active:true}]};
    if(fail && params.agentId==='ops') throw new Error('fixture read failed');
    return {...snapshot([]),agents,selectedAgentId:params.agentId??'main',resourceGeneration:wrongGeneration&&params.agentId==='ops'?'foreign':'g-A'};
  }});
  await model.selectWorkspace('A'); calls.length=0;
  const value=await model.readOverview(model.getSnapshot().workspace);
  assert.equal(value.snapshots.length,3); assert.equal(value.incomplete,false);
  assert.deepEqual(calls.map(call=>call.method),['workspace.snapshot','workspace.snapshot']);
  assert.deepEqual(calls.map(call=>call.params.agentId),['ops','coder']);
  assert.equal(model.getSnapshot().agentId,'main');
  wrongGeneration=true;
  assert.equal((await model.readOverview(model.getSnapshot().workspace)).incomplete,true);
  wrongGeneration=false; fail=true;
  const partial=await model.readOverview(model.getSnapshot().workspace); assert.equal(partial.incomplete,true); assert.equal(partial.snapshots.length,2);
});
test('an old overview cannot repaint a switched workspace',async()=>{
  let resolve; const waiting=new Promise(done=>{resolve=done;});
  const model=new WorkspaceDevModel({async request(method,params){
    if(method==='workspace.list')return {revision:1,syntheticOnly:true,workspaces:['A','B'].map(workspaceId=>({workspaceId,active:true}))};
    if(method==='workspace.snapshot')return waiting;
    return {...snapshot([]),workspaceId:params.workspaceId,resourceGeneration:`g-${params.workspaceId}`,agents:[{agentId:'main'},{agentId:'ops'}]};
  }});
  await model.selectWorkspace('A'); const read=model.readOverview(model.getSnapshot().workspace); await model.selectWorkspace('B');
  resolve({...snapshot([]),selectedAgentId:'ops'}); await assert.rejects(read,/Overview view changed/);
  assert.equal(model.getSnapshot().workspaceId,'B');
});
test('the same approval clicked from two surfaces dispatches one existing Core decision',async()=>{
  let resolve; const waiting=new Promise(done=>{resolve=done;}), calls=[];
  const model=new WorkspaceDevModel({async request(method,params){calls.push({method,params});
    if(method==='workspace.list')return {revision:1,syntheticOnly:true,workspaces:[{workspaceId:'A',active:true}]};
    if(method==='workspace.approval.respond')return waiting;
    return snapshot([card('same')]);
  }});
  await model.selectWorkspace('A'); const approval=model.getSnapshot().workspace.approvals[0];
  const first=model.respond(approval,true); await model.respond(approval,true);
  assert.equal(calls.filter(call=>call.method==='workspace.approval.respond').length,1);
  resolve({}); await first;
  const call=calls.find(call=>call.method==='workspace.approval.respond');
  assert.deepEqual(call.params,{workspaceId:'A',expectedGeneration:'g-A',approvalId:'same',approved:true});
});
