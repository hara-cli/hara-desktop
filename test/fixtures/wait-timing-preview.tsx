import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Transcript, AssistantDraft } from "../../src/WorkspaceLocalDev";
import { WorkspaceWaiting, WorkspaceOptimisticMessage } from "../../src/WorkspaceWaitTiming";
import { WorkspaceDevModel, type WorkspaceDevSnapshot, type WorkspaceDevRpc } from "../../src/workspace-dev-state";
import { parseRuntimeStageReport, type RuntimeStageReport, type RuntimeStageFailure } from "../../src/runtime-stage-events";
import type { MessageTimingReport } from "../../src/message-timing";
import type { WorkspaceAssistantPreview } from "../../src/assistant-preview";
import { makeT, type Locale } from "../../src/i18n";
const query=new URLSearchParams(location.search),scene=query.get("scene")??"thinking",theme=query.get("theme")??"dark",locale=(query.get("locale")??"zh-Hans") as Locale;
document.documentElement.dataset.theme=theme;document.documentElement.dataset.motion=query.get("motion")??"off";
const t=makeT(locale),uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const ids={workspaceId:"ws_"+uuid(1),resourceGeneration:uuid(2),agentId:"ag_"+uuid(3),sessionId:uuid(4),runId:uuid(5),attemptId:uuid(6),historyStart:0};
const stage:RuntimeStageReport={schemaVersion:1,...ids,state:"running",durationMs:null,errorKind:null,runtime:{id:"codex",version:"0.166.0",loginSource:"unknown",model:"fixture-model",effort:"low",effortSource:"auto"},contextTokens:24000,events:[{seq:1,kind:"model_roundtrip",phase:"start",offsetMs:100,durationMs:null,call:1,toolName:null,outcome:null,source:"host",errorKind:null}],droppedEvents:0};
function finishStage(state: "completed" | "cancelled" | "error", duration: number, errorKind: RuntimeStageFailure | null = null) {
 stage.state=state;stage.durationMs=duration;stage.errorKind=errorKind;
 const ended=state==="completed"?"completed":state==="cancelled"?"cancelled":"error";
 stage.events.push({seq:stage.events.length+1,kind:"model_roundtrip",phase:"end",offsetMs:duration,durationMs:duration-100,call:1,toolName:null,outcome:ended,source:"host",errorKind});
 stage.events.push({seq:stage.events.length+1,kind:"complete",phase:"mark",offsetMs:duration,durationMs:duration,call:null,toolName:null,outcome:ended,source:"host",errorKind});
 if(!parseRuntimeStageReport(stage))throw new Error("Synthetic terminal stage must satisfy the real closed parser");
}
const timing:MessageTimingReport={schemaVersion:1,...ids,origin:"host_receive",clientClockErrorMs:1,points:{T0:0,T1:0,T2:40,T3:100,T4:200,T5:null,T6:null,T7:null,T8:null,T9:null}};
const agents:WorkspaceDevSnapshot["agents"]=[{agentId:ids.agentId,kind:"main",state:"active",identity:{displayName:"Hara"},runtime:{id:"codex",label:"Codex",available:true}}];
let snapshot:WorkspaceDevSnapshot={workspaceId:ids.workspaceId,resourceGeneration:ids.resourceGeneration,selectedAgentId:ids.agentId,label:"Timing fixture",syntheticOnly:true,agents,connections:{revision:1,defaultConnectionId:"fixture",connections:[]},approvals:[],conversation:{revision:1,sessionId:ids.sessionId,runId:null,taskId:uuid(7),state:"idle",taskState:null,objective:"",pastTaskCount:0,history:[],usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}};
const calls:{method:string;params:Record<string,unknown>}[]=[];let offset=0,previewListener:((v:WorkspaceAssistantPreview|null)=>void)|undefined;
const rpc:WorkspaceDevRpc={supportsCapability:()=>true,setAssistantPreviewListener(fn){previewListener=fn;},async request<T>(method:string,params:Record<string,unknown>){calls.push({method,params});let result:unknown=snapshot;
 if(method==="workspace.list")result={revision:1,syntheticOnly:true,workspaces:[{workspaceId:ids.workspaceId,label:"Fixture",active:true,role:"OWNER"}]};
 if(method==="workspace.session.send"){snapshot.conversation={...snapshot.conversation,state:"running",runId:ids.runId,taskState:"running",history:[{role:"user",content:String(params.message)}],runtimeStages:[stage],messageTimings:[timing]};result={runId:ids.runId};}
 if(method==="workspace.session.cancel"){snapshot.conversation.state="cancelled";snapshot.conversation.taskState="cancelled";finishStage("cancelled",25000);timing.points.T9=25000;}
 if(method==="workspace.runtime.diagnostics.export")result={fileName:"fixture.json",path:"/synthetic/fixture.json",bytes:123,sha256:"a".repeat(64)};
 return structuredClone(result) as T;}};
const model=new WorkspaceDevModel(rpc,()=>uuid(9),true,"synthetic",false,()=>performance.now()+offset);
await model.selectWorkspace(ids.workspaceId);model.setDraft(locale==="en"?"Please check the project’s latest changes.":locale==="zh-Hant"?"幫我看看專案最近的修改。":"帮我看看项目最近的修改。");await model.send();
offset=scene==="thinking"?12000:scene==="silent"?24000:6000;
if(scene==="tool")stage.events.push({seq:2,kind:"tool_call",phase:"start",offsetMs:4000,durationMs:null,call:2,toolName:"workspace_read",targetLabel:"project-notes.md",outcome:null,source:"host",errorKind:null});
if(scene==="failed"){finishStage("error",6000,"runtime_auth_required");snapshot.conversation.state="error";snapshot.conversation.taskState="failed";timing.points.T9=6000;}
if(["draft","finalizing","completed","slow"].includes(scene)){timing.points.T5=2100;timing.points.T6=2200;}
if(["finalizing","completed","slow"].includes(scene))timing.points.T8=scene==="slow"?30000:6000;
if(["completed","slow"].includes(scene)){const duration=scene==="slow"?33200:8200;timing.points.T9=duration;finishStage("completed",duration);snapshot.conversation.state="completed";snapshot.conversation.taskState="completed";snapshot.conversation.completion={state:"verified"};snapshot.conversation.history.push({role:"assistant",text:locale==="en"?"The project is ready for review. The latest changes add a compact waiting status and timing details.":locale==="zh-Hant"?"已查看最近的修改。等待狀態會隨執行階段更新，完成後可點擊耗時查看分段資訊。":"已查看最近的修改。等待状态会随执行阶段更新，完成后可点击耗时查看分段信息。",tools:[]});}
snapshot.conversation.nativeSession={runtimeId:"codex",revision:1,status:"ready",contextTokens:24000,contextLimit:100000,lastAttempt:{input:24000,output:0,cachedInput:0},lastResetRequestId:null};
if(!parseRuntimeStageReport(stage))throw new Error("Synthetic stage must satisfy the real closed parser");
await model.refresh();
if(["draft","finalizing"].includes(scene))previewListener?.({schemaVersion:1,...ids,requestId:uuid(9),nativeTurnId:"native-fixture",itemId:"reply-fixture",seq:1,text:locale==="en"?"I have read the project notes. The latest changes…":"已读取项目说明，正在查看最近的修改…",draft:true,evidenceVerified:false});
function App(){const view=useSyncExternalStore(model.subscribe,model.getSnapshot,model.getSnapshot),w=view.workspace!;return <div className="timing-fixture"><style>{`body{background:var(--hara-bg-content);color:var(--hara-text-primary);font-family:var(--hara-font-ui,system-ui)}.timing-fixture{max-width:760px;margin:42px auto;padding:0 28px}.fixture-heading{border-bottom:1px solid var(--hara-border-default);padding-bottom:20px;margin-bottom:40px;font-size:14px;display:flex;justify-content:space-between;color:var(--hara-text-secondary)}.timing-fixture .hs-who{display:flex;align-items:center;margin:22px 0 10px 42px;gap:7px}.timing-fixture .hs-msg{display:flex;gap:12px;margin:12px 0}.timing-fixture .hs-msg.me{justify-content:flex-end}.timing-fixture .hs-bub{padding:14px 18px;border-radius:14px;background:var(--hara-bg-surface);max-width:85%;line-height:1.65}.fixture-footer{margin:60px 0 0;padding:18px;border:1px solid var(--hara-border-default);border-radius:12px;font-size:13px;color:var(--hara-text-tertiary)}`}</style>
 <div className="fixture-heading"><strong>Hara</strong><span>{locale==="en"?"Project workspace":"项目 Workspace"}</span></div>
 <Transcript history={w.conversation.history} stages={model.runtimeStageReports()} conversation={w.conversation} messageTimings={w.conversation.messageTimings} t={t} onExportStage={r=>model.exportRuntimeDiagnostic(r)} />
 <WorkspaceOptimisticMessage model={model} t={t}/><AssistantDraft model={model} agent={agents[0]} t={t} follow={()=>{}}/>
 <WorkspaceWaiting model={model} t={t} name="Hara" runtime="Codex" disabled={false} onSettings={action=>{document.getElementById("fixture-action")!.textContent=action;}}/>
 <div className="fixture-footer">{t("ws.composer.placeholder",{name:"Hara"})}<span id="fixture-action" role="status"/></div></div>;}
(window as unknown as {__WAIT_FIXTURE__:unknown}).__WAIT_FIXTURE__={model,calls,scene};
createRoot(document.getElementById("root")!).render(<App/>);
