import test from "node:test";
import assert from "node:assert/strict";
import {localMediaPath} from "../src/workspace-media.ts";
import {WorkspaceDevModel} from "../src/workspace-dev-state.ts";
test("only local references reach media registration; encoded paths retain traversal for Host rejection",()=>{
 for(const source of["https://example.test/a.gif","http://localhost/a.gif","data:image/png;base64,AAAA","blob:x","javascript:alert(1)","//example.test/a.gif"])assert.equal(localMediaPath(source),null);
 assert.equal(localMediaPath("/Users/example/a%20b.gif"),"/Users/example/a b.gif");assert.equal(localMediaPath("file:///Users/example/a.gif"),"file:///Users/example/a.gif");
 assert.equal(localMediaPath("%2e%2e/outside.gif"),"../outside.gif");assert.equal(localMediaPath("a%ZZ.gif"),null);
});
const snapshot=id=>({workspaceId:id,resourceGeneration:"generation-"+id,label:id,syntheticOnly:true,selectedAgentId:"main",agents:[{agentId:"main",kind:"main",state:"active",identity:{displayName:"Main"},runtime:{id:"pi",available:true}}],approvals:[],connections:{revision:0,connections:[]},conversation:{revision:0,history:[],state:"idle",sessionId:id+"-main",taskId:null,runId:null,taskState:null,objective:"",pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}});
test("media registration uses scoped metadata RPC and rejects late responses after Workspace switch",async()=>{
 const calls=[];let finish;const rpc={supportsCapability:c=>c==="workspace.media.v1",async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,activeWorkspaceId:"A",syntheticOnly:true,workspaces:[{workspaceId:"A",label:"A",active:true},{workspaceId:"B",label:"B",active:true}]};if(method==="workspace.select")return snapshot(params.workspaceId);if(method==="workspace.media.register")return new Promise(r=>finish=r);throw Error(method);}};
 const model=new WorkspaceDevModel(rpc);await model.selectWorkspace("A");const originalScope=model.mediaScope,pending=model.registerMedia("a.gif");await model.selectWorkspace("B");assert.notEqual(model.mediaScope,originalScope);await assert.rejects(model.registerMedia("a.gif",originalScope),/media unavailable/);assert.equal(calls.filter(row=>row.method==="workspace.media.register").length,1);finish({id:"a".repeat(64),mime:"image/gif",bytes:34});await assert.rejects(pending,/media unavailable/);
 assert.deepEqual(calls.find(row=>row.method==="workspace.media.register").params,{workspaceId:"A",expectedGeneration:"generation-A",path:"a.gif"});
});


test("scoped media reasons distinguish links and spelling without exposing arbitrary Host errors",async()=>{
 let description={state:"failed",reason:"symlink"};
 const rpc={supportsCapability:()=>true,async request(method,params){
  if(method==="workspace.select")return snapshot(params.workspaceId);
  if(method==="workspace.media.describe")return description;
  if(method==="workspace.list")return{revision:1,activeWorkspaceId:"A",syntheticOnly:true,workspaces:[{workspaceId:"A",label:"A",active:true}]};
  throw Error(method);
 }};
 const model=new WorkspaceDevModel(rpc);await model.selectWorkspace("A");
 assert.deepEqual(await model.describeMedia("alias.gif"),{state:"failed",reason:"symlink"});
 description={state:"failed",reason:"path_spelling"};assert.deepEqual(await model.describeMedia("Cafe.gif"),description);
 description={state:"failed",reason:"private_path_errno"};await assert.rejects(model.describeMedia("a.gif"),/media unavailable/);
});
