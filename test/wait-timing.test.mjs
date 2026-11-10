import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { LocalWaitClock, waitScope, deriveWaitingView, timingSummary, timingVerified, failureActions, currentWaitReport } from "../src/wait-timing.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { parseRuntimeStageReport } from "../src/runtime-stage-events.ts";
import { makeT } from "../src/i18n.ts";
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const ids={workspaceId:"ws_"+uuid(1),resourceGeneration:uuid(2),agentId:"ag_"+uuid(3),sessionId:uuid(4),runId:uuid(5),attemptId:uuid(6),historyStart:0};
const points={T0:0,T1:0,T2:10,T3:50,T4:100,T5:null,T6:null,T7:null,T8:null,T9:null};
const timing=(p={})=>({schemaVersion:1,...ids,origin:"host_receive",clientClockErrorMs:1,points:{...points,...p}});
const event=(p={})=>({seq:1,kind:"model_roundtrip",phase:"start",offsetMs:0,durationMs:null,call:1,toolName:null,outcome:null,source:"host",errorKind:null,...p});
const report=(p={})=>({schemaVersion:1,...ids,runtime:{id:"codex",version:null,loginSource:"unknown",model:null,effort:"low",effortSource:"auto"},state:"running",durationMs:null,errorKind:null,events:[event()],droppedEvents:0,...p});
const c=(p={})=>({revision:1,state:"running",sessionId:ids.sessionId,taskId:uuid(7),runId:ids.runId,taskState:"running",objective:"",history:[{role:"user",content:"fixture"}],pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null,...p});
const local=(p={})=>({requestId:uuid(9),startedAtMs:1000,lastEventAtMs:1000,runId:ids.runId,attemptId:ids.attemptId,accepted:true,unknown:false,dispatchElapsedMs:100,repliedElapsedMs:null,completedElapsedMs:null,...p});
const derive=(now,p={})=>deriveWaitingView({conversation:c(),report:report(),timing:timing(),local:local(),now,...p});
const tick=()=>new Promise(r=>setImmediate(r));
test("0.4s status and 2s digits use only the monotonic local send clock",()=>{
 assert.equal(derive(1399).visible,false);assert.equal(derive(1400).visible,true);assert.equal(derive(2999).showSeconds,false);assert.equal(derive(3000).showSeconds,true);assert.equal(derive(1400).phase,"thinking");
 assert.equal(derive(9000,{local:null}).elapsedMs,null);assert.equal(derive(9000,{local:local({runId:null}),sending:true}).phase,"preparing");
});
test("phase priority distinguishes native startup, recovery, one tool, asks, queue and T8 finalization",()=>{
 const spawn=report({events:[event({kind:"spawn",call:null})]});assert.equal(derive(2000,{report:spawn,timing:timing({T4:null})}).phase,"spawn");
 assert.equal(derive(2000,{report:report({events:[event({kind:"cold_start",call:null})]}),timing:timing({T4:null})}).phase,"recovering");
 const tool=report({events:[event({kind:"tool_call",toolName:"workspace_read",targetLabel:"index.ts"})]});assert.equal(derive(2000,{report:tool}).phase,"tool");
 assert.equal(derive(2000,{approvalCount:1}).phase,"approval");assert.equal(derive(2000,{conversation:c({pendingQuestion:{id:"question"}})}).phase,"question");
 assert.equal(derive(2000,{report:report({events:[event({kind:"queued",call:null})]})}).phase,"queued");
 const v=derive(9000,{preview:true,timing:timing({T5:500,T8:6000}),local:local({repliedElapsedMs:6000})});assert.equal(v.phase,"finalizing");assert.equal(v.elapsedMs,6000);
 assert.equal(derive(2000,{pendingUnknown:true,local:local({runId:null})}).phase,"unknown");
});
test("1.5s startup, 8s long history, 20s event silence and 60s no first token thresholds",()=>{
 const spawn=report({events:[event({kind:"spawn",call:null,offsetMs:0})]});
 assert.equal(derive(2511,{report:spawn,timing:timing({T4:null})}).hint,"spawn_slow");
 assert.equal(derive(9099,{report:report({contextTokens:20000})}).hint,null);assert.equal(derive(9100,{report:report({contextTokens:20000})}).hint,"long_history");
 assert.equal(derive(21000).hint,"silent");assert.equal(derive(61100).hint,"no_first");assert.equal(derive(61100,{preview:true,local:local({lastEventAtMs:61099})}).hint,null);
 assert.equal(derive(9100,{conversation:c({state:"awaiting_user",pendingQuestion:{id:"q"}}),report:report({contextTokens:20000})}).hint,null);
});
test("local clock clamps regressions, isolates scopes and freezes only matched T8/T9",()=>{
 let now=1000;const clock=new LocalWaitClock(()=>now),scope="A";clock.begin(scope,uuid(9),[uuid(10)]);clock.accept(scope,uuid(9),ids.runId);
 now=2000;clock.observe(scope,c(),[report()], [timing()]);const first=clock.get(scope);now=2500;clock.observe(scope,c(),[report()],[timing()]);assert.equal(clock.get(scope).lastEventAtMs,first.lastEventAtMs);
 now=9000;clock.observe(scope,c(),[report()],[timing({T8:6000})]);assert.equal(clock.get(scope).repliedElapsedMs,6000);assert.equal(clock.get(scope).completedElapsedMs,null);
 clock.observe(scope,c(),[report()],[timing({T8:6000,T9:8000})]);assert.equal(clock.get(scope).completedElapsedMs,8000);
 now=500;assert.equal(clock.now(),9000);clock.begin("B",uuid(11),[]);assert.equal(clock.get("B").startedAtMs,9000);assert.equal(clock.get("missing"),null);
 assert.notEqual(waitScope({workspaceId:ids.workspaceId,resourceGeneration:ids.resourceGeneration,selectedAgentId:ids.agentId,conversation:c()}),waitScope({workspaceId:ids.workspaceId,resourceGeneration:ids.resourceGeneration,selectedAgentId:ids.agentId,conversation:c({sessionId:uuid(99)})}));
});
test("T9 plus matching Core verification is required; missing segments stay unknown",()=>{
 const done=report({state:"completed",durationMs:8000}),conversation=c({state:"completed",taskState:"completed",completion:{state:"verified"}});
 assert.equal(timingVerified(done,timing({T8:6000}),conversation),false);assert.equal(timingVerified(done,timing({T8:6000,T9:8000}),conversation),true);
 assert.equal(timingVerified(done,timing({T9:8000}),{...conversation,runId:uuid(99)}),false);
 const s=timingSummary(done,timing({T5:1000,T8:6000,T9:8000}));assert.equal(s.totalMs,8000);assert.equal(s.startupMs,null);assert.equal(s.toolMs,null);assert.equal(s.finalizeMs,2000);
 assert.equal(currentWaitReport(c(),[done],local({runId:null})),undefined);
});
test("closed action mapping never offers unknown-outcome replay",()=>{
 assert.deepEqual(failureActions("runtime_auth_required"),["login"]);assert.deepEqual(failureActions("runtime_auth_rejected"),["login"]);
 assert.deepEqual(failureActions("runtime_network",{canRetry:true}),["proxy-settings","retry"]);assert.deepEqual(failureActions("runtime_proxy"),["proxy-settings"]);
 for(const kind of ["runtime_rate_limit","runtime_quota","invalid_model"])assert.deepEqual(failureActions(kind,{canRetry:true}),["retry","model-settings"]);
 assert.deepEqual(failureActions("timeout",{canRetry:true}),["retry"]);assert.deepEqual(failureActions("not_installed"),["runtime-settings"]);
 assert.deepEqual(failureActions("timeout",{canRetry:true,unknown:true}),["verify","runtime-settings"]);assert.deepEqual(failureActions(null,{contextFull:true,canNewSession:true}),["new-session"]);
});
test("Desk parser accepts optional closed additions but rejects paths, secrets and arbitrary provenance",()=>{
 const value=report({contextTokens:123,events:[event({kind:"tool_call",toolName:"workspace_read",targetLabel:"index.ts"}),event({seq:2,kind:"retry",phase:"mark",call:null,errorKind:"timeout"})]});assert.ok(parseRuntimeStageReport(value));
 for(const targetLabel of ["../private.txt",".env","token=hidden","x".repeat(41)])assert.equal(parseRuntimeStageReport({...value,events:[{...value.events[0],targetLabel}]}),null);
 assert.equal(parseRuntimeStageReport({...value,runtime:{...value.runtime,effortSource:"guessed"}}),null);
});
function modelFixture(){
 let snapshot={workspaceId:ids.workspaceId,resourceGeneration:ids.resourceGeneration,selectedAgentId:ids.agentId,label:"Fixture",syntheticOnly:true,agents:[{agentId:ids.agentId,kind:"main",state:"active",identity:{displayName:"Hara"},runtime:{id:"pi",label:"Pi",available:true}}],connections:{revision:1,defaultConnectionId:"fixture",connections:[]},approvals:[],conversation:c({state:"idle",runId:null,history:[]})};
 const calls=[];let snapshotGate=null;
 const rpc={supportsCapability:()=>true,async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,syntheticOnly:true,activeWorkspaceId:ids.workspaceId,workspaces:[{workspaceId:ids.workspaceId,label:"Fixture",active:true,role:"OWNER"}]};
 if(method==="workspace.session.send"){snapshot={...snapshot,conversation:c({runtimeStages:[report()],messageTimings:[timing()]})};return{runId:ids.runId};}
 if(method==="workspace.snapshot"&&snapshotGate)return snapshotGate();return structuredClone(snapshot);}};
 const model=new WorkspaceDevModel(rpc,()=>uuid(9));return{model,calls,set:value=>{snapshot=value;},get:()=>snapshot,gate:value=>{snapshotGate=value;},ready:()=>model.selectWorkspace(ids.workspaceId)};
}
test("local send observes an accepted scope without creating clock-driven RPC or replay",async()=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();const before=f.calls.length;
 assert.equal(f.model.getWaitTimingSnapshot().runId,ids.runId);assert.equal(f.model.getOptimisticMessage(),null);
 for(let n=0;n<100;n++)deriveWaitingView({conversation:f.get().conversation,local:f.model.getWaitTimingSnapshot(),report:report(),now:performance.now()+1000*n});
 assert.equal(f.calls.length,before);assert.equal(f.calls.filter(x=>x.method==="workspace.session.send").length,1);
});
test("a push arriving during refresh schedules another snapshot and retains final T9",async()=>{
 const f=modelFixture();await f.ready();let resolve;const pending=new Promise(r=>resolve=r);const stale=structuredClone(f.get());let reads=0;
 f.gate(()=>++reads===1?pending:Promise.resolve(structuredClone(f.get())));const refresh=f.model.refresh();await tick();
 f.model.workspaceChanged(ids.workspaceId,ids.agentId);const final={...f.get(),conversation:c({state:"completed",taskState:"completed",completion:{state:"verified"},runtimeStages:[report({state:"completed",durationMs:8000})],messageTimings:[timing({T8:6000,T9:8000})]})};f.set(final);resolve(stale);await refresh;await tick();await tick();
 assert.equal(reads,2);assert.equal(f.model.getSnapshot().workspace.conversation.messageTimings[0].points.T9,8000);
});
const require=createRequire(import.meta.url),root=fileURLToPath(new URL("../",import.meta.url));
const bundle=await build({stdin:{contents:'export { Transcript } from "./src/WorkspaceLocalDev.tsx";export { WorkspaceTimingChip, WorkspaceDraftTiming, WorkspaceWaiting, friendlyTool } from "./src/WorkspaceWaitTiming.tsx";',resolveDir:root,loader:"tsx"},bundle:true,format:"cjs",platform:"node",jsx:"automatic",external:["react"],loader:{".css":"empty",".svg":"dataurl"},write:false});
const module={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(require,module,module.exports);
const React=require("react"),{renderToStaticMarkup}=require("react-dom/server");
test("M1 renders timing below bubbles with a slow dot and folded failures in all locales",()=>{
 for(const locale of ["en","zh-Hans","zh-Hant"]){const t=makeT(locale),done=report({state:"completed",durationMs:8200}),history=[{role:"user",content:"question"},{role:"assistant",text:"answer",tools:[]}];
 const render=(extra={})=>renderToStaticMarkup(React.createElement(module.exports.Transcript,{history,stages:[done],messageTimings:[timing({T5:1000,T8:6000,T9:8200})],conversation:c({state:"completed",taskState:"completed",completion:{state:"verified"}}),t,...extra}));
 const html=render();assert.ok(html.includes("wsd-timing-chip"));assert.ok(html.includes("8.2s"));assert.equal(html.includes("✓"),false);assert.ok(html.indexOf("wsd-bubble")<html.indexOf("hd-message-meta"));assert.equal(html.includes("wsd-runtime-stages"),false);assert.equal(html.includes("ws.wait."),false);
 assert.equal(render({messageTimings:[timing({T8:6000})]}).includes("✓"),false);
 const slow=render({stages:[report({state:"completed",durationMs:32000})],messageTimings:[timing({T8:30000,T9:32000})]});assert.ok(slow.includes("hd-slow-dot"));assert.equal(slow.replace(/<[^>]*>/g,"").includes(t("ws.wait.slow")),false);assert.equal(slow.includes("wsd-runtime-stages"),false);
 const failed=render({stages:[report({state:"error",durationMs:8000,errorKind:"runtime_network"})]});assert.ok(failed.includes("wsd-runtime-stages"));assert.equal(failed.includes('open=""'),false);
 assert.equal(module.exports.friendlyTool("private-tool-name",t),t("ws.wait.tool.generic"));}
});
test("full diagnostics remains opt-in, compaction stays at its absolute boundary",()=>{
 const t=makeT("en"),value={id:uuid(12),agentId:ids.agentId,sessionId:ids.sessionId,runId:ids.runId,at:new Date(0).toISOString(),runtimeId:"codex",method:"codex-native",status:"completed",historyStart:2,beforeTokens:null,afterTokens:null,summary:{goals:[],decisions:[],unfinished:[],references:[],cards:[],recent:[]},usage:{requests:1,inputTokens:null,outputTokens:null,cachedInputTokens:null}};
 const html=renderToStaticMarkup(React.createElement(module.exports.Transcript,{history:[{role:"user",content:"one"},{role:"assistant",text:"two",tools:[]},{role:"user",content:"three"}],compactions:[value],stages:[report({state:"completed",durationMs:8000})],t,alwaysShowTimingDiagnostics:true}));
 assert.ok(html.indexOf("two")<html.indexOf("wsd-context-compaction"));assert.ok(html.indexOf("wsd-context-compaction")<html.indexOf("three"));assert.ok(html.includes("wsd-runtime-stages"));assert.equal(html.includes('open=""'),false);
});
test("normal chat has no busy interval; reduced motion and accessible popover exits are implemented",()=>{
 const source=readFileSync(new URL("../src/WorkspaceLocalDev.tsx",import.meta.url),"utf8"),ui=readFileSync(new URL("../src/WorkspaceWaitTiming.tsx",import.meta.url),"utf8"),css=readFileSync(new URL("../src/wait-timing.css",import.meta.url),"utf8");
 assert.equal(source.includes('setInterval(() => { void model.refresh(); }, 1000)'),false);assert.ok(ui.includes('event.key === "Escape"'));assert.ok(ui.includes('aria-expanded={open}'));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(css.includes('[data-motion="off"]'));
});

test("a dropped terminal push is recovered after three stale seconds without replay",async t=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();
 t.mock.timers.enable({apis:["setTimeout"]});const stop=f.model.watchStaleConversation();
 try{const before=f.calls.filter(x=>x.method==="workspace.snapshot").length;
 f.set({...f.get(),conversation:c({state:"completed",taskState:"completed",completion:{state:"verified"},runtimeStages:[report({state:"completed",durationMs:8000})],messageTimings:[timing({T8:6000,T9:8000})]})});
 t.mock.timers.tick(2999);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before);
 t.mock.timers.tick(1);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 assert.equal(f.model.getSnapshot().workspace.conversation.messageTimings[0].points.T9,8000);
 t.mock.timers.tick(20000);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 assert.equal(f.calls.filter(x=>/workspace.session.(send|resume)$/.test(x.method)).length,1);
 }finally{stop();}
});
test("active pushes rearm fallback, local drafts do not, and disconnect cleanup cancels it",async t=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();
 t.mock.timers.enable({apis:["setTimeout"]});const stop=f.model.watchStaleConversation();
 try{const before=f.calls.filter(x=>x.method==="workspace.snapshot").length;
 for(let i=0;i<5;i++){t.mock.timers.tick(2000);f.model.workspaceChanged(ids.workspaceId,ids.agentId);await tick();}
 assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+5,"healthy pushes add no fallback polling");
 t.mock.timers.tick(2000);f.model.setDraft("keep typing");t.mock.timers.tick(1000);await tick();
 assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+6,"local typing cannot hide a missing terminal push");
 stop();t.mock.timers.tick(10000);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+6);
 }finally{stop();}
});
test("stale fallback does not duplicate an in-flight read or schedule after teardown",async t=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();let resolve;
 f.gate(()=>new Promise(r=>{resolve=r;}));t.mock.timers.enable({apis:["setTimeout"]});const stop=f.model.watchStaleConversation();
 const before=f.calls.filter(x=>x.method==="workspace.snapshot").length;
 try{t.mock.timers.tick(3000);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 t.mock.timers.tick(9000);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 stop();resolve(structuredClone(f.get()));await tick();t.mock.timers.tick(10000);await tick();
 assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 }finally{stop();if(resolve)resolve(structuredClone(f.get()));}
});

test("the draft timing header keeps a current-run Stop control in every locale",async()=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();
 for(const locale of ["en","zh-Hans","zh-Hant"]){const t=makeT(locale),html=renderToStaticMarkup(React.createElement(module.exports.WorkspaceDraftTiming,{model:f.model,t}));assert.ok(html.includes("wsd-wait-stop"));assert.ok(html.includes(t("ws.wait.action.stop")));assert.equal(html.includes('disabled=""'),false);}
 f.set({...f.get(),conversation:c({state:"draining"})});await f.model.refresh();
 assert.ok(renderToStaticMarkup(React.createElement(module.exports.WorkspaceDraftTiming,{model:f.model,t:makeT("en")})).includes('disabled=""'));
});

test("active validated preview pushes also defer stale snapshot fallback",async t=>{
 const f=modelFixture();await f.ready();f.model.setDraft("fixture");await f.model.send();
 t.mock.timers.enable({apis:["setTimeout"]});const stop=f.model.watchStaleConversation();
 try{const before=f.calls.filter(x=>x.method==="workspace.snapshot").length;
 for(let i=0;i<5;i++){t.mock.timers.tick(2000);f.model.assistantPreview({schemaVersion:1,...ids,requestId:uuid(9),nativeTurnId:"native-fixture",itemId:"item-fixture",seq:i+1,text:"x".repeat(i+1),draft:true,evidenceVerified:false});await tick();}
 assert.ok(f.model.getAssistantPreviewSnapshot());assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before);
 t.mock.timers.tick(3000);await tick();assert.equal(f.calls.filter(x=>x.method==="workspace.snapshot").length,before+1);
 }finally{stop();}
});


test("authentication failures check account access without requiring a new local login",()=>{
 let settings=0;
 for(const locale of ["en","zh-Hans","zh-Hant"])for(const kind of ["runtime_auth_required","runtime_auth_rejected"])for(const loginSource of ["host","isolated","unknown"]){
  const failed=report({state:"error",durationMs:8000,errorKind:kind,runtime:{...report().runtime,loginSource}});
  const conversation=c({state:"blocked",taskState:"blocked",resumeAdmission:{allowed:false,reason:"runtime_unavailable"}});
  const model={getSnapshot:()=>({workspace:{conversation,approvals:[]},loading:false,sending:false,pendingUnknown:false,runtimeBlocked:false}),
   subscribeWaitTiming:()=>()=>{},getWaitTimingSnapshot:()=>null,subscribeAssistantPreview:()=>()=>{},getAssistantPreviewSnapshot:()=>null,
   runtimeStageReports:()=>[failed],supportsNativeSessions:()=>false,waitClock:{now:()=>0}};
  const t=makeT(locale),html=renderToStaticMarkup(React.createElement(module.exports.WorkspaceWaiting,{model,t,name:"Hara",runtime:"Codex",disabled:false,onSettings(){settings++;}}));
  assert.ok(html.includes(t("ws.wait.action.login")));assert.ok(html.includes(t(`ws.wait.failure.${kind}`)));
  assert.doesNotMatch(html,/sign in again|needs you to sign in|needs to be renewed|重新登[录入]|需要登[录入]/i);
 }
 assert.equal(settings,0,"rendering never starts login, opens settings, or replays the task");
});

test("brief hidden tool metadata keeps a continuous sender while visible cards separate it",()=>{
 const history=[{role:"assistant",text:"First visible reply",tools:["workspace_read"]},{role:"tool",results:[{id:"call",name:"workspace_read",content:"Synthetic read",isError:false}]},{role:"assistant",text:"Second visible reply",tools:[]}];
 const render=detailed=>renderToStaticMarkup(React.createElement(module.exports.Transcript,{history,t:makeT("en"),detailed,showAuthor:true}));
 assert.equal((render(false).match(/class="hs-who"/g)??[]).length,1);assert.equal((render(true).match(/class="hs-who"/g)??[]).length,2);
});
