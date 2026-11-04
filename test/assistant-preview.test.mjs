import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseWorkspaceAssistantPreview } from "../src/assistant-preview.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
function fixture(){
 const workspaceId="ws_"+randomUUID(),agentId="ag_"+randomUUID(),otherId="ag_"+randomUUID(),resourceGeneration=randomUUID(),sessionId=randomUUID(),requestId=randomUUID(),runId=randomUUID();
 const base={workspaceId,selectedAgentId:agentId,resourceGeneration,label:"Fixture",syntheticOnly:true,agents:[agentId,otherId].map(id=>({agentId:id,kind:id===agentId?"main":"colleague",state:"active",identity:{displayName:"Fixture"},runtime:{id:"pi",label:"Pi",available:true}})),connections:{revision:1,defaultConnectionId:"fixture",connections:[]},approvals:[],conversation:{revision:0,state:"idle",sessionId,taskId:null,runId:null,taskState:null,objective:"",history:[],pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}};
 let current=structuredClone(base),listener;const calls=[];
 const rpc={supportsCapability:()=>true,timingNow:()=>({hostAtMs:123,errorMs:1}),setAssistantPreviewListener(fn){listener=fn;},async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,syntheticOnly:true,activeWorkspaceId:workspaceId,workspaces:[{workspaceId,label:"Fixture",active:true,role:"OWNER"}]};if(method==="workspace.session.send"){current.conversation={...current.conversation,state:"running",runId};return{runId};}if(method==="workspace.agent.select")current={...current,selectedAgentId:params.agentId};return structuredClone(current);}};
 const model=new WorkspaceDevModel(rpc,()=>requestId);
 const frame={schemaVersion:1,workspaceId,resourceGeneration,agentId,sessionId,runId,attemptId:randomUUID(),historyStart:0,requestId,nativeTurnId:"native-turn",itemId:"native-item",seq:1,text:"你",draft:true,evidenceVerified:false};
 return{model,frame,calls,otherId,emit:value=>listener(value),setSnapshot:value=>{current=value;},getSnapshot:()=>current,async start(){await model.selectWorkspace(workspaceId);model.setDraft("你好");await model.send();}};
}
test("preview has a closed metadata shape and never accepts success or injected content fields",()=>{
 const {frame}=fixture();assert.ok(parseWorkspaceAssistantPreview(frame));for(const value of [{...frame,evidenceVerified:true},{...frame,rawRpc:"private"},{...frame,seq:0},{...frame,attemptId:"wrong"},{...frame,text:"x".repeat(24001)}])assert.equal(parseWorkspaceAssistantPreview(value),null);
});
test("drafts update their own subscription without snapshot churn and paint is recorded once",async()=>{
 const f=fixture();await f.start();let normal=0,drafts=0;f.model.subscribe(()=>normal++);f.model.subscribeAssistantPreview(()=>drafts++);const before=f.model.getSnapshot();
 f.emit(f.frame);f.emit({...f.frame,seq:2,text:"你好！"});assert.equal(f.model.getSnapshot(),before);assert.equal(normal,0);assert.equal(drafts,2);
 await f.model.paintAssistantPreview(f.frame);await f.model.paintAssistantPreview(f.frame);assert.equal(f.calls.filter(row=>row.method==="workspace.session.paint").length,1);
 assert.deepEqual(f.model.getSnapshot().workspace.conversation.history,[]);
});
test("foreign request, sequence gaps, regressions and stale selection epochs cannot append",async()=>{
 const f=fixture();await f.start();for(const value of [{...f.frame,requestId:randomUUID()},{...f.frame,runId:randomUUID()},{...f.frame,seq:2}])f.emit(value);
 assert.equal(f.model.getAssistantPreviewSnapshot(),null);f.emit(f.frame);for(const value of [{...f.frame,seq:3,text:"gap"},{...f.frame,seq:2,text:"changed prefix"},{...f.frame,seq:2,attemptId:randomUUID()}])f.emit(value);
 assert.equal(f.model.getAssistantPreviewSnapshot().text,"你");await f.model.selectAgent(f.otherId);assert.equal(f.model.getAssistantPreviewSnapshot(),null);await f.model.selectAgent(f.frame.agentId);f.emit({...f.frame,seq:2,text:"你好"});assert.equal(f.model.getAssistantPreviewSnapshot(),null);
});
test("cancel/disconnect clear drafts and canonical history replaces a draft once",async()=>{
 for(const action of ["cancel","disconnect","final"]){const f=fixture();await f.start();f.emit(f.frame);if(action==="cancel")await f.model.cancel();else if(action==="disconnect")f.emit(null);else{const c=f.getSnapshot();f.setSnapshot({...c,conversation:{...c.conversation,state:"completed",history:[{role:"assistant",text:"你好！",tools:[]}]}});await f.model.refresh();}assert.equal(f.model.getAssistantPreviewSnapshot(),null);f.emit({...f.frame,seq:2,text:"你好！"});assert.equal(f.model.getAssistantPreviewSnapshot(),null);}
});
