// Local synthetic preview frames use the real closed identity contract. No Tauri or model bridge.
import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceScreen } from "../../src/WorkspaceLocalDev";
import { WorkspaceDevModel, type WorkspaceDevSnapshot } from "../../src/workspace-dev-state";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Local synthetic fixture only");
const params = new URLSearchParams(location.search), theme = params.get("theme") === "dark" ? "dark" : "light";
localStorage.setItem("hara.locale", params.get("locale") ?? "en");
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const workspaceId = `ws_${uuid("1")}`, agentId = `ag_${uuid("2")}`, resourceGeneration = uuid("3"), sessionId = uuid("4"), runId = uuid("5"), attemptId = uuid("6");
const calls: { method: string; params: Record<string, unknown> }[] = [];
const snapshot: WorkspaceDevSnapshot = {workspaceId,resourceGeneration,selectedAgentId:agentId,label:"Synthetic streaming",syntheticOnly:true,
 agents:[{agentId,kind:"main",state:"active",identity:{displayName:"Hara"},runtime:{id:"pi",label:"Pi",available:true}}],approvals:[],
 connections:{revision:1,defaultConnectionId:"synthetic",connections:[]},conversation:{revision:0,state:"idle",sessionId,taskId:null,runId:null,taskState:null,objective:"",history:[],pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}};
const rpc = { supportsCapability: () => false, async request<T>(method: string, values: Record<string, unknown>): Promise<T> {
 calls.push({method,params:values}); let result: unknown;
 if (method === "workspace.list") result={revision:1,activeWorkspaceId:workspaceId,syntheticOnly:true,executionMode:"synthetic",workspaces:[{workspaceId,label:snapshot.label,active:true,role:"owner"}]};
 else if (method === "workspace.preferences.get") result={revision:1,theme,readOnly:false,recovered:false};
 else if (["workspace.select","workspace.snapshot","workspace.agent.select"].includes(method)) result=structuredClone(snapshot);
 else if (method === "workspace.session.send") { snapshot.conversation.state="running"; snapshot.conversation.taskState="running"; snapshot.conversation.runId=runId; snapshot.conversation.taskId=uuid("7"); snapshot.conversation.history.push({role:"user",content:String(values.message),createdAt:new Date().toISOString()}); snapshot.conversation.revision++; result={runId}; }
 else if (method === "workspace.session.cancel") {snapshot.conversation.state="cancelled"; result={};}
 else throw new Error(`Unsupported synthetic method ${method}`);
 return result as T;
}};
const model = new WorkspaceDevModel(rpc, () => crypto.randomUUID());
await model.loadDirectory(); await model.selectWorkspace(workspaceId);
let seq=0;
(window as any).__HARA_STREAM_FIXTURE__ = {model,calls,emit(text:string){const request=calls.filter(row=>row.method==="workspace.session.send").at(-1); if(!request)throw new Error("First submit a synthetic message");
 model.assistantPreview({schemaVersion:1,workspaceId,resourceGeneration,agentId,sessionId,runId,attemptId,historyStart:snapshot.conversation.history.length-1,requestId:request.params.requestId,nativeTurnId:"synthetic-turn",itemId:"synthetic-item",seq:++seq,text,draft:true,evidenceVerified:false}); }};
createRoot(document.getElementById("root")!).render(<React.StrictMode><WorkspaceScreen model={model} disconnected="" onReconnect={()=>{}} root="/synthetic/stream" mode="lab" /></React.StrictMode>);
