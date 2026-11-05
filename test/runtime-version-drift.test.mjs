import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {parseRuntimeVersionStatus, runtimeVersionFor} from '../src/runtime-version-drift.ts';
import {makeT} from '../src/i18n.ts';
const status=(patch={})=>({schemaVersion:1,lastSuccessfulVersion:'1.2.3',currentVersion:'1.3.0',change:'upgraded',compatibility:'unverified',binaryChanged:true,requiresRetrust:true,...patch});
const option=(runtimeId='codex',value=status())=>({runtimeId,label:runtimeId,installed:true,registered:true,version:'1.3.0',state:'local_registered',generalAgentDriverAvailable:true,versionStatus:value});
const binding=(value=status(),runtimeId='codex')=>({runtimeId,status:value});
const variants=[status(),status({currentVersion:'1.0.0',change:'downgraded'}),status({currentVersion:'1.2.3',change:'same',compatibility:'previously_succeeded',binaryChanged:false,requiresRetrust:false}),
  status({currentVersion:'1.2.3',change:'same'}),status({lastSuccessfulVersion:null,change:'no_history',binaryChanged:null}),
  status({currentVersion:null,change:'unknown',compatibility:'unknown',binaryChanged:false}),status({lastSuccessfulVersion:null,change:'unknown',compatibility:'unknown',binaryChanged:null}),
  status({lastSuccessfulVersion:null,currentVersion:null,change:'unknown',compatibility:'unknown',binaryChanged:null})];
test('strict version projection preserves legal history, unknown, binary and retrust states',()=>{
  for(const value of variants)assert.deepEqual(parseRuntimeVersionStatus(value),value);
  assert.ok(parseRuntimeVersionStatus(status({lastSuccessfulVersion:'1.9.0',currentVersion:'1.10.0'})),'numeric version comparison');
  assert.ok(parseRuntimeVersionStatus(status({lastSuccessfulVersion:'1.2.9999',currentVersion:'2.0.0'})));
});
test('malformed, contradictory and sensitive fields never supply compatibility evidence',()=>{
  const missing=status();delete missing.binaryChanged;
  for(const value of [missing,{...status(),prompt:'private'},status({schemaVersion:2}),status({currentVersion:'sk-private'}),status({currentVersion:'1.3.0-beta'}),status({currentVersion:'10000.1.0'}),
    ...['1.3.0\n','1.3.0\r','1.3.0\nPRIVATE_BANNER',' 1.3.0'].map(currentVersion=>status({currentVersion})),
    ...['1.2.3\n','1.2.3\r','1.2.3\nPRIVATE_BANNER','1.2.3 '].map(lastSuccessfulVersion=>status({lastSuccessfulVersion})),
    status({currentVersion:'https://private.example'}),status({lastSuccessfulVersion:1}),status({change:'compatible'}),status({binaryChanged:1}),status({requiresRetrust:null}),
    status({currentVersion:'1.0.0'}),status({change:'downgraded'}),status({change:'same'}),status({compatibility:'previously_succeeded'}),
    status({currentVersion:'1.2.3',change:'same',compatibility:'previously_succeeded',binaryChanged:null,requiresRetrust:false}),
    status({currentVersion:'1.2.3',change:'same',compatibility:'previously_succeeded',binaryChanged:false,requiresRetrust:true}),
    status({change:'unknown',compatibility:'unknown'}),status({change:'no_history'}),status({lastSuccessfulVersion:null,currentVersion:null,change:'no_history',binaryChanged:null}),
    status({currentVersion:null,change:'unknown'}),status({compatibility:'unknown'})])assert.equal(parseRuntimeVersionStatus(value),null);
});
test('only the unique current runtime row is selected; older Core stays absent and bad metadata stays unknown',()=>{
  const rows=[option(),option('claude',status({currentVersion:'9.0.0'}))];
  assert.deepEqual(runtimeVersionFor(rows,'codex'),binding());
  assert.equal(runtimeVersionFor(rows,'claude').status.currentVersion,'9.0.0');
  assert.equal(runtimeVersionFor(rows,'opencode'),null);assert.equal(runtimeVersionFor(rows,'untrusted'),null);
  assert.equal(runtimeVersionFor(undefined,'codex'),null);assert.equal(runtimeVersionFor([{runtimeId:'codex',registered:true}],'codex'),null);
  assert.equal(runtimeVersionFor([option(),option()],'codex'),null);
  assert.deepEqual(runtimeVersionFor([option('codex',{...status(),raw:'private'})],'codex'),binding(null));
  const success=variants[2];assert.deepEqual(runtimeVersionFor([{...option('codex',success),registered:false}],'codex'),binding(null));
});
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const bundled=await build({stdin:{contents:'export {WorkspaceRuntimeVersion} from "./src/WorkspaceRuntimeVersion.tsx";export {default as WorkspaceRuntimeAccess} from "./src/WorkspaceRuntimeAccess.tsx";export {WorkspaceTaskRecovery} from "./src/WorkspaceTaskRecovery.tsx";export {WorkspaceScreen} from "./src/WorkspaceLocalDev.tsx";',resolveDir:root,loader:'tsx'},bundle:true,format:'cjs',platform:'node',jsx:'automatic',external:['react'],loader:{'.css':'empty','.svg':'dataurl'},write:false});
const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,module,module.exports);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{WorkspaceRuntimeVersion,WorkspaceRuntimeAccess,WorkspaceTaskRecovery,WorkspaceScreen}=module.exports;
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
test('upgrade and downgrade explain exact versions in all three languages without declaring compatibility',()=>{
  for(const locale of ['en','zh-Hans','zh-Hant'])for(const value of variants){
    const t=makeT(locale),html=render(WorkspaceRuntimeVersion,{runtimeId:'codex',binding:binding(value),t});
    assert.ok(html.includes(t('ws.runtimeVersion.title')));
    assert.ok(html.includes(t(`ws.runtimeVersion.${value.change}`,{from:value.lastSuccessfulVersion??'',to:value.currentVersion??''})));
    assert.equal(html.includes('ws.runtimeVersion.'),false);assert.equal(html.includes('<button'),false);
    if(value.change==='unknown')assert.ok(html.includes(t('ws.runtimeVersion.unknownVersion')));
    if(value.compatibility==='previously_succeeded')assert.ok(html.includes(t('ws.runtimeVersion.previously_succeeded')));
    if(value.binaryChanged)assert.ok(html.includes(t('ws.runtimeVersion.binaryChanged')));
    if(value.requiresRetrust)assert.ok(html.includes(t('ws.runtimeVersion.retrust')));
  }
});
test('same-version binary replacement keeps trust separate and malformed data gets a fixed unknown message',()=>{
  const t=makeT('en'),value=status({currentVersion:'1.2.3',change:'same'});
  const html=render(WorkspaceRuntimeVersion,{runtimeId:'codex',binding:binding(value),t});
  assert.ok(html.includes(t('ws.runtimeVersion.same',{to:'1.2.3'})));assert.ok(html.includes(t('ws.runtimeVersion.binaryChanged')));assert.ok(html.includes(t('ws.runtimeVersion.retrust')));
  const malformed=render(WorkspaceRuntimeVersion,{runtimeId:'codex',binding:binding({...value,currentVersion:'PRIVATE_TOKEN'}),t});
  assert.ok(malformed.includes(t('ws.runtimeVersion.invalid')));assert.equal(malformed.includes('PRIVATE_TOKEN'),false);assert.equal(malformed.includes('1.2.3'),false);
  for(const props of [{runtimeId:'claude',binding:binding()},{runtimeId:'codex',binding:null},{runtimeId:'unknown',binding:binding(status(),'unknown')}])assert.equal(render(WorkspaceRuntimeVersion,{...props,t}),'');
});
const agent=(id='codex',agentId='main')=>({agentId,kind:'main',state:'active',configRevision:2,agentEpoch:1,identity:{displayName:agentId},runtime:{id,label:id,available:true}});
const conversation=(patch={})=>({revision:1,state:'blocked',taskState:'blocked',sessionId:'synthetic-session',taskId:'synthetic-task',runId:'synthetic-run',objective:'Synthetic',history:[{role:'user',content:'Synthetic prompt'},{role:'assistant',text:'Synthetic reply',tools:[]}],pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null,blockReason:'codex Runtime failed (command_failed)',resumeAdmission:{allowed:true,reason:null},...patch});
const workspace=(patch={})=>({workspaceId:'fixture',resourceGeneration:'generation',label:'Synthetic workspace',selectedAgentId:'main',syntheticOnly:false,executionMode:'workspace',agents:[agent()],connections:{revision:1,defaultConnectionId:null,connections:[]},approvals:[],conversation:conversation(),runtimeOptions:[{id:'codex',label:'Codex',available:true},{id:'claude',label:'Claude',available:true}],runtimes:{builtIn:'pi',options:[option(),option('claude',status({currentVersion:'9.0.0'}))],operations:[]},...patch});
test('Inspector selects the bound colleague runtime and does not register or execute while rendering',()=>{
  let requests=0;const noAction=()=>{requests++;throw Error('must not run')};
  const base={workspace:workspace(),locale:'en',listModels:noAction,listConnectionModels:noAction,connectionModelSupported:false,onApplyRuntime:noAction,onApplyModel:noAction,onApplyConnectionModel:noAction,onRescan:noAction,onRegisterRuntime:noAction,onRuntimeDirectory:noAction};
  const codex=render(WorkspaceRuntimeAccess,{...base,agent:agent()});assert.ok(codex.includes('CLI upgraded from 1.2.3 to 1.3.0.'));assert.equal(codex.includes('9.0.0'),false);
  const claude=render(WorkspaceRuntimeAccess,{...base,agent:agent('claude','other')});assert.ok(claude.includes('CLI upgraded from 1.2.3 to 9.0.0.'));assert.equal(claude.includes('CLI upgraded from 1.2.3 to 1.3.0.'),false);
  const old=render(WorkspaceRuntimeAccess,{...base,agent:agent(),workspace:workspace({runtimes:undefined})});assert.equal(old.includes('CLI version history'),false);assert.equal(requests,0);
});
test('failure card version context matches both the current runtime and the reported failure runtime',()=>{
  for(const locale of ['en','zh-Hans','zh-Hant']){
    const t=makeT(locale),props={conversation:conversation(),runtimeId:'codex',runtimeVersion:binding(),t,disabled:false,onContinue(){throw Error('no auto retry')},onRepair(){throw Error('no auto repair')}};
    assert.ok(render(WorkspaceTaskRecovery,props).includes(t('ws.runtimeVersion.upgraded',{from:'1.2.3',to:'1.3.0'})));
    for(const patch of [{runtimeVersion:binding(status(),'claude')},{runtimeId:'claude',runtimeVersion:binding(status(),'claude')},{conversation:conversation({state:'error',blockReason:'opencode Runtime failed (runtime_network)'})},{runtimeVersion:undefined},
      {conversation:conversation({resumeAdmission:{allowed:false,reason:'connection_auth_required'}})}])assert.equal(render(WorkspaceTaskRecovery,{...props,...patch}).includes(t('ws.runtimeVersion.title')),false);
    const unknown=render(WorkspaceTaskRecovery,{...props,runtimeVersion:binding(null)});assert.ok(unknown.includes(t('ws.runtimeVersion.invalid')));
    const locked=render(WorkspaceTaskRecovery,{...props,continueDisabled:true});assert.match(locked,/data-recovery-retry="true"[^>]*disabled/);
  }
});
test('actual WorkspaceScreen passes only current snapshot version data down to the failure card',()=>{
  const ws=workspace(),value={directory:{revision:1,activeWorkspaceId:'fixture',workspaces:[{workspaceId:'fixture',label:'Synthetic',role:'owner',active:true}],syntheticOnly:false,executionMode:'workspace'},workspaceId:'fixture',agentId:'main',roster:ws.agents,draft:'',loading:false,sending:false,pendingUnknown:false,error:'',syncNotice:'',localHistoryStart:0,runtimeChanging:false,runtimeBlocked:false,workspace:ws};
  const model={getSnapshot:()=>value,subscribe:()=>()=>{},runtimeStageReports:()=>[],supportsNativeSessions:()=>false};
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>key==='hara.locale'?'en':null}});
  try {const html=render(WorkspaceScreen,{model,disconnected:'',root:'/synthetic',mode:'workspace',onReconnect(){}});assert.ok(html.includes('CLI upgraded from 1.2.3 to 1.3.0.'));assert.equal(html.includes('9.0.0'),false);}
  finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});

test('server rendering never reads a live assistant draft or reports browser paint',()=>{
  const ws=workspace(),value={directory:{revision:1,activeWorkspaceId:'fixture',workspaces:[{workspaceId:'fixture',label:'Synthetic',role:'owner',active:true}],syntheticOnly:false,executionMode:'workspace'},workspaceId:'fixture',agentId:'main',roster:ws.agents,draft:'',loading:false,sending:false,pendingUnknown:false,error:'',syncNotice:'',localHistoryStart:0,runtimeChanging:false,runtimeBlocked:false,workspace:ws};
  let reads=0,subscriptions=0,paints=0,timingReads=0,timingSubscriptions=0,optimisticReads=0,clockReads=0;
  const model={getSnapshot:()=>value,subscribe:()=>()=>{},runtimeStageReports:()=>[],supportsNativeSessions:()=>false,
    getAssistantPreviewSnapshot(){reads++;return {text:'PRIVATE_OLD_DRAFT'};},
    subscribeAssistantPreview(){subscriptions++;return()=>{};},paintAssistantPreview(){paints++;},
    getWaitTimingSnapshot(){timingReads++;throw Error('SSR must not read the live wait clock');},
    subscribeWaitTiming(){timingSubscriptions++;return()=>{};},
    getOptimisticMessage(){optimisticReads++;return 'PRIVATE_OPTIMISTIC_DRAFT';},
    waitClock:{now(){clockReads++;throw Error('SSR must not advance the client clock');}}};
  const html=render(WorkspaceScreen,{model,disconnected:'',root:'/synthetic',mode:'workspace',onReconnect(){}});
  assert.equal(html.includes('PRIVATE_OLD_DRAFT'),false);
  assert.equal(html.includes('wsd-assistant-draft'),false);
  assert.equal(html.includes('PRIVATE_OPTIMISTIC_DRAFT'),false);
  assert.equal(reads,0);assert.equal(subscriptions,0);assert.equal(paints,0);
  assert.equal(timingReads,0);assert.equal(timingSubscriptions,0);assert.equal(optimisticReads,0);assert.equal(clockReads,0);
});
