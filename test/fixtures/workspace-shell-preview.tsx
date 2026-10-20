// DEV-only real-component fixture. No Tauri bridge, credentials, filesystem or model access.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceScreen } from '../../src/WorkspaceLocalDev';
import { WorkspaceDevModel, type WorkspaceDevApproval, type WorkspaceDevSnapshot } from '../../src/workspace-dev-state';
import type { LocalChannelCatalog, LocalChannelSnapshot } from '../../src/workspace-local-channels';
if (!import.meta.env.DEV || !['127.0.0.1','localhost'].includes(location.hostname)) throw new Error('Synthetic localhost development fixture only');
const params = new URLSearchParams(location.search), scenario = params.get('scenario') ?? 'home';
const productionFixture = scenario === 'native-settings';
const locale = params.get('locale') ?? 'zh-Hant';
if (locale === 'system') localStorage.removeItem('hara.locale'); else if (locale !== 'saved') localStorage.setItem('hara.locale', locale);
if (params.get('reset') !== '0') { localStorage.removeItem('hara.sidebar.sections.A'); localStorage.removeItem('hara.sidebar.sections.B'); }
const currentTime = Date.now(), stamp = (minutes: number) => new Date(currentTime - minutes*60000).toISOString();
const agents = [
  {agentId:'main',kind:'main',state:'active',identity:{displayName:'Hara'},runtime:{id:'pi',label:'Pi',available:true}},
  ...['Coder','Ops','Frontend Developer','Writer','Iris','Mia','Researcher','Planner','Translator','Reviewer',...(scenario==='channels'?['Data Analyst','QA','Security']:[])].map((name,index)=>({
    agentId:`person-${index}`,kind:'colleague',state:'active',identity:{displayName:name,title:['Engineering','Operations','Frontend','Writing','Research','Design','Research','Planning','Language','Review'][index]},runtime:{id:'pi',label:'Pi',available:true}})),
  {agentId:'archived',kind:'colleague',state:'archived',identity:{displayName:'Archived fixture'},runtime:{id:'pi',label:'Pi',available:true}}
] as WorkspaceDevSnapshot['agents'];
const calls: {method:string;params:Record<string,unknown>}[] = [];
const failures = new Set<string>();
const snapshots = new Map<string,WorkspaceDevSnapshot>();
const makeCard = (id:string,agentId:string,urgent=true):WorkspaceDevApproval => ({id,agentId,workspaceId:'A',resourceGeneration:'g-A',expiresAt:new Date(currentTime+(urgent?10:60)*60000).toISOString(),
  draft:{username:'release-helper',displayName:'Release Helper',title:'Draft release notes',instructions:'Work only in this synthetic workspace. Ask for confirmation before any external action.',runtimeId:'pi'}});
for (const workspaceId of ['A','B']) for (const [index,agent] of agents.entries()) {
  const state=workspaceId==='B'?'completed':agent.agentId==='person-1'?'running':agent.agentId==='person-2'?'pending_review':agent.agentId==='person-3'?'waiting_reply':index>5?'completed':agent.agentId==='main'?'idle':'running';
  const minutes=Math.max(1,index*3);
  const conversation:WorkspaceDevSnapshot['conversation']={revision:1,state,taskState:state==='idle'?null:state,sessionId:`session-${workspaceId}-${agent.agentId}`,taskId:state==='idle'?null:`task-${workspaceId}-${agent.agentId}`,
    runId:state==='idle'?null:`run-${agent.agentId}`,objective:agent.agentId==='person-2'?'Review the responsive Settings layout':agent.agentId==='person-3'?'Choose the release note outline':'Prepare the workspace redesign',history:agent.agentId==='main'?[]:[
      {role:'user',content:'Please check the redesigned workspace shell.',createdAt:stamp(minutes+2)},
      {role:'assistant',text:'The sidebar is now compact, and each section keeps its own expanded state.',tools:[],createdAt:stamp(minutes+1)},
      {role:'assistant',text:'The composer uses a neutral focus ring. Pending approvals remain reachable from the home tray and their original conversations.',tools:[],createdAt:stamp(minutes)},
    ],pastTaskCount:3,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:state==='completed'?{state:'verified'}:null,updatedAt:stamp(minutes)};
  const approvals=workspaceId==='A'&&agent.agentId==='person-1'?[makeCard('fixture-approval','person-1')]:[];
  snapshots.set(`${workspaceId}:${agent.agentId}`,{workspaceId,resourceGeneration:`g-${workspaceId}`,label:workspaceId==='A'?'My workspace':'Studio',colleagueLimit:scenario==='channels'?undefined:10,selectedAgentId:agent.agentId,agents,syntheticOnly:!productionFixture,executionMode:productionFixture?'workspace':'synthetic',
    connections:{revision:1,defaultConnectionId:scenario==='no-connection'?null:'fixture',connections:productionFixture ? [{id:'fixture',label:'Model fixture',provider:'openai',status:'active',baseURL:'https://example.invalid/v1',defaultModel:'fixture-model',keySaved:true,keyState:'saved'}] : []},
    ...(productionFixture ? {runtimes:{builtIn:'pi',options:[{runtimeId:'codex',label:'Local fixture',installed:true,registered:false,version:'0.0.0',state:'detected',generalAgentDriverAvailable:false,path:'/synthetic/codex',fingerprint:'fixture-fingerprint'},
      {runtimeId:'opencode',label:'Missing fixture',installed:false,registered:false,version:null,state:'not_installed',generalAgentDriverAvailable:false}],operations:[]}} : {}),approvals,conversation});
}
if(productionFixture) snapshots.get('A:main')!.conversation.history = Array.from({length:24},(_,index)=>index%2
  ? {role:'assistant' as const,text:`Native settings scroll reply ${index}`,tools:[],createdAt:stamp(24-index)}
  : {role:'user' as const,content:`Native settings scroll message ${index}`,createdAt:stamp(24-index)});
if(scenario==='operations') snapshots.get('A:main')!.conversation.history = [
  {role:'user',content:'Run three local checks.'},
  ...['workspace_read','workspace_write','workspace_verify'].flatMap((name,index):WorkspaceDevSnapshot['conversation']['history']=>[
    {role:'assistant',text:'',tools:[`operation-${index}`]},
    {role:'tool',results:[{id:`operation-${index}`,name,content:`Local result ${index+1}`,isError:index===2}]}
  ]),
  {role:'assistant',text:'The three checks are finished.',tools:[]},
  {role:'user',content:'Keep this separate operation visible.'},
  {role:'assistant',text:'',tools:['separate-operation']},
  {role:'tool',results:[{id:'separate-operation',name:'workspace_read',content:'Separate local result',isError:false}]}
];
if(scenario==='many') snapshots.get('A:person-1')!.approvals=Array.from({length:8},(_,index)=>makeCard(`fixture-${index}`,'person-1',index<5));
if(scenario==='legacy') for(const snapshot of snapshots.values()) {delete snapshot.conversation.updatedAt;for(const message of snapshot.conversation.history)delete message.createdAt;}
if(scenario==='tasks') location.hash='#tasks';
let theme: 'light'|'dark' = params.get('theme')==='dark'?'dark':'light';
const channelStorageKey='hara.shell-fixture.local-channels';
if(params.get('reset')!=='0')localStorage.removeItem(channelStorageKey);
const channelData: {catalogs:Record<string,LocalChannelCatalog>;snapshots:Record<string,LocalChannelSnapshot>} = JSON.parse(localStorage.getItem(channelStorageKey)??'null') ?? {
  catalogs:Object.fromEntries(['A','B'].map(workspaceId=>[workspaceId,{workspaceId,resourceGeneration:`g-${workspaceId}`,revision:0,channels:[]}])),snapshots:{},
};
const persistChannels=()=>localStorage.setItem(channelStorageKey,JSON.stringify(channelData));
const channelTimers=new Map<string,ReturnType<typeof setTimeout>>();
let slowChannel=false,unknownChannelAck=false;
const rpc={supportsCapability:(capability:string)=>capability==='workspace.local-channels.v1',async request<T>(method:string, values:Record<string,unknown>):Promise<T>{
  calls.push({method,params:values});const workspaceId=String(values.workspaceId??'A'), agentId=String(values.agentId??'main');
  if(failures.has(method))throw new Error('Synthetic read/write failure');
  let result:unknown;
  if(method==='workspace.list')result={revision:1,activeWorkspaceId:'A',syntheticOnly:!productionFixture,executionMode:productionFixture?'workspace':'synthetic',workspaces:['A','B'].map(id=>({workspaceId:id,label:id==='A'?'My workspace':'Studio',active:true,role:'owner'}))};
  else if(method==='workspace.preferences.get')result={revision:1,theme,readOnly:false,recovered:false};
  else if(method==='workspace.preferences.set'){theme=values.theme as typeof theme;result={revision:2,theme,readOnly:false,recovered:false};}
  else if(['workspace.select','workspace.settings.select','workspace.agent.select','workspace.snapshot'].includes(method)){
    if(scenario==='partial'&&method==='workspace.snapshot'&&agentId==='person-1')throw new Error('Synthetic read unavailable');
    result=structuredClone(snapshots.get(`${workspaceId}:${agentId}`));
  } else if(method==='workspace.approval.respond'){
    for(const snapshot of snapshots.values())if(snapshot.workspaceId===workspaceId)snapshot.approvals=snapshot.approvals.filter(card=>card.id!==values.approvalId);
    result={accepted:true};
  } else if(method==='workspace.channels.list')result=structuredClone(channelData.catalogs[workspaceId]);
  else if(method==='workspace.channels.create'){
    const catalog=channelData.catalogs[workspaceId],id=String(values.channelId),row={id,name:String(values.name),memberIds:values.memberIds as string[],createdAt:new Date().toISOString()};
    if(!catalog.channels.some(row=>row.id===id))catalog.channels.push(row);catalog.revision++;
    channelData.snapshots[id]??={workspaceId,resourceGeneration:`g-${workspaceId}`,channel:row,revision:0,state:'idle',messages:[],turns:[],approvals:[]};persistChannels();result=structuredClone(catalog);
  } else if(method==='workspace.channels.update'){
    const catalog=channelData.catalogs[workspaceId],id=String(values.channelId),row=catalog.channels.find(row=>row.id===id)!;
    row.name=String(values.name);row.memberIds=values.memberIds as string[];catalog.revision++;channelData.snapshots[id].channel=row;persistChannels();result=structuredClone(catalog);
  } else if(['workspace.channels.select','workspace.channels.snapshot'].includes(method))result=structuredClone(channelData.snapshots[String(values.channelId)]);
  else if(method==='workspace.channels.receipt')result={workspaceId,resourceGeneration:`g-${workspaceId}`,channelId:values.channelId,requestId:values.requestId,state:channelData.snapshots[String(values.channelId)].turns.some(row=>row.id===values.requestId)?'accepted':'unknown'};
  else if(method==='workspace.channels.send'){
    const id=String(values.channelId),snapshot=channelData.snapshots[id],turnId=String(values.requestId),recipients=values.recipientIds as string[];
    if(!snapshot.turns.some(row=>row.id===turnId)){
      const turn={id:turnId,state:recipients.length?'running':'completed',replies:recipients.map(agentId=>({agentId,displayName:agents.find(row=>row.agentId===agentId)!.identity.displayName,state:'queued'}))};
      snapshot.turns.push(turn);snapshot.state=turn.state;snapshot.messages.push({id:turnId,turnId,agentId:null,displayName:'',createdAt:new Date().toISOString(),message:{role:'user',content:String(values.message)}});snapshot.revision++;persistChannels();
      let index=0;const reply=()=>{
        const target=turn.replies[index];if(!target){snapshot.state=turn.state='completed';channelTimers.delete(id);persistChannels();void model.refresh();return;}
        target.state='completed';snapshot.messages.push({id:`${turnId}:${target.agentId}`,turnId,agentId:target.agentId,displayName:target.displayName,createdAt:new Date().toISOString(),message:{role:'assistant',text:`${target.displayName}: ${String(values.message)}`,tools:[]}});index++;snapshot.revision++;persistChannels();void model.refresh();
        channelTimers.set(id,setTimeout(reply,slowChannel?30000:15));
      };if(recipients.length)channelTimers.set(id,setTimeout(reply,slowChannel?30000:15));
    }
    result={workspaceId,resourceGeneration:`g-${workspaceId}`,channelId:id,requestId:turnId,accepted:true};
    if(unknownChannelAck){unknownChannelAck=false;throw new Error('Synthetic ACK lost after acceptance');}
  } else if(method==='workspace.channels.cancel'){
    const id=String(values.channelId),snapshot=channelData.snapshots[id];clearTimeout(channelTimers.get(id));channelTimers.delete(id);snapshot.state='cancelled';
    for(const turn of snapshot.turns)if(turn.state==='running'){turn.state='cancelled';for(const row of turn.replies)if(row.state==='queued')row.state='cancelled';}persistChannels();result={state:'draining'};
  } else if(method==='workspace.session.send'){
    const snapshot=snapshots.get(`${workspaceId}:${agentId}`)!;
    snapshot.conversation.history.push({role:'user',content:String(values.message),createdAt:new Date().toISOString()});snapshot.conversation.revision++;result={runId:'fixture-run'};
  } else if(method==='workspace.connection.synthetic'){
    for(const snapshot of snapshots.values())if(snapshot.workspaceId===workspaceId)snapshot.connections.defaultConnectionId='fixture';result={};
  } else if(method==='workspace.session.cancel'){
    snapshots.get(`${workspaceId}:${agentId}`)!.conversation.state='cancelled';result={};
  } else if(method==='workspace.tasks')result=[];
  else if(method==='workspace.connection.legacy')result=productionFixture ? [{id:'old-fixture',label:'Legacy fixture',provider:'openai',baseURL:'https://example.invalid/v1',defaultModel:'fixture-model',keySaved:true,source:'synthetic'}] : [];
  else if(method==='workspace.runtime.detect')result={};
  else if(method==='workspace.runtime.propose')result={id:'fixture-proposal',runtimeId:values.runtimeId,label:'Missing fixture',version:'0.0.0',origin:'https://example.invalid',sha256:'a'.repeat(64),maxBytes:1024,target:{platform:'darwin',arch:'arm64'}};
  else if(method==='workspace.runtime.approve'&&values.approved===false)result={};
  else if(method==='workspace.skill.read')result={id:values.id,content:'Reviewed synthetic skill text'};
  else if(method==='workspace.features.list')result={workspaceId,revision:1,skills:productionFixture ? [{id:'fixture-skill',description:'Reviewed fixture description',enabled:true,version:'a'.repeat(64),availableVersion:'b'.repeat(64),locked:true,source:'global'}] : [],
    schedules:productionFixture ? [{id:'fixture-schedule',name:'Fixture schedule',schedule:{kind:'cron',expr:'0 8 * * *'},enabled:true}] : [],
    scheduler:{schedules:productionFixture ? [{id:'fixture-schedule',nextRunAt:currentTime+3600000,awaitingHandoff:false,lastRun:{state:'completed',reason:null,occurredAt:currentTime-3600000}}] : []}};
  else throw new Error(`Unsupported synthetic method ${method}`);
  return result as T;
}};
const model=new WorkspaceDevModel(rpc,()=>crypto.randomUUID(),!productionFixture,productionFixture?'workspace':'synthetic');
await model.loadDirectory();await model.selectWorkspace('A');if(scenario==='chat')await model.selectAgent('person-0');
(window as any).__HARA_SHELL_FIXTURE__={model,calls,setFailure(method:string,enabled:boolean){if(enabled)failures.add(method);else failures.delete(method);},async incoming(agentId:string,text:string){const snapshot=snapshots.get(`A:${agentId}`)!;snapshot.conversation.history.push({role:'assistant',text,tools:[],createdAt:new Date().toISOString()});snapshot.conversation.revision++;snapshot.conversation.updatedAt=new Date().toISOString();await model.refresh();},
  channelSlow(value:boolean){slowChannel=value;},channelLoseAck(){unknownChannelAck=true;},
  async finishApprovals(){const snapshot=snapshots.get('A:person-1')!;snapshot.conversation.state='completed';snapshot.conversation.taskState='completed';await model.refresh();},
  async idle(){for(const snapshot of snapshots.values())if(snapshot.workspaceId==='A'&&snapshot.selectedAgentId!=='person-1') {snapshot.conversation.state='idle';snapshot.conversation.taskState=null;snapshot.conversation.taskId=null;}await model.refresh();}};
model.setSettingsFactory(async () => ({ model: new WorkspaceDevModel(rpc, undefined, !productionFixture, productionFixture ? 'workspace' : 'synthetic', true), close() {} }));
createRoot(document.getElementById('root')!).render(<React.StrictMode><WorkspaceScreen model={model} disconnected='' onReconnect={()=>{}} root='/synthetic/fixture' mode='lab' onOpenBrowser={()=>{}} /></React.StrictMode>);
