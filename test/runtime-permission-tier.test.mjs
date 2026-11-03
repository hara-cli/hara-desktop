import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {WorkspaceDevModel} from "../src/workspace-dev-state.ts";
import {makeT} from "../src/i18n.ts";
const snapshot=(id="A",tier="full-protected",state="completed")=>({workspaceId:id,resourceGeneration:"generation-1",selectedAgentId:"coder",label:id,
 agents:[{agentId:"coder",kind:"colleague",state:"active",configRevision:2,agentEpoch:1,permissionTier:tier,identity:{displayName:"Colleague"},runtime:{id:"codex",label:"Codex",available:true}}],connections:{revision:1,defaultConnectionId:null,connections:[]},approvals:[],syntheticOnly:true,
 conversation:{revision:1,state,sessionId:id+"-coder",taskId:"old-task",runId:"old-run",taskState:"completed",objective:"fixture",history:[],pastTaskCount:0,completion:null,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},permissionTier:"controlled"}});
function fixture(supported=true){let tier="full-protected",state="completed";const calls=[];
 const rpc={supportsCapability:c=>supported&&c==="workspace.runtime-permissions.v1",async request(method,params){calls.push({method,params});
 if(method==="workspace.list")return{revision:1,activeWorkspaceId:null,syntheticOnly:true,workspaces:[{workspaceId:"A",label:"A",active:true,role:"OWNER"}]};
 if(method==="workspace.agents.setPermissionTier"){tier=params.permissionTier;return{};}
 if(["workspace.select","workspace.snapshot","workspace.agent.select"].includes(method))return snapshot(params.workspaceId,tier,state);
 return{};}};
 const model=new WorkspaceDevModel(rpc);return{model,calls,setState:s=>state=s,ready:()=>model.selectWorkspace("A")};}
test("switch sends only current scoped identity/revisions and leaves the existing task's frozen tier intact",async()=>{
 const f=fixture();await f.ready();const a=f.model.getSnapshot().workspace.agents[0];await f.model.setAgentPermissionTier(a,"controlled");
 const call=f.calls.find(x=>x.method==="workspace.agents.setPermissionTier");assert.deepEqual(call.params,{workspaceId:"A",expectedGeneration:"generation-1",agentId:"coder",permissionTier:"controlled",configRevision:2,agentEpoch:1});
 assert.equal(f.model.getSnapshot().workspace.agents[0].permissionTier,"controlled");assert.equal(f.model.getSnapshot().workspace.conversation.permissionTier,"controlled");
});
test("old Core and active/draining attempts cannot issue a permission mutation",async()=>{
 for(const supported of [false,true]){const f=fixture(supported);await f.ready();if(supported){f.setState("draining");await f.model.refresh();}
 await assert.rejects(f.model.setAgentPermissionTier(f.model.getSnapshot().workspace.agents[0],"controlled"));assert.equal(f.calls.some(x=>x.method==="workspace.agents.setPermissionTier"),false);}
});
const bundle=await build({stdin:{contents:'export {default as Runtime} from "./src/WorkspaceRuntimeAccess.tsx";',loader:"tsx",resolveDir:fileURLToPath(new URL("../",import.meta.url))},bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react"],loader:{".css":"empty",".svg":"dataurl"},write:false});
const require=createRequire(import.meta.url),module={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(require,module,module.exports);const {createElement}=require("react"),{renderToStaticMarkup}=require("react-dom/server");
test("real permission controls render both tiers, frozen task status and localized copy in three languages",()=>{
 for(const locale of ["en","zh-Hans","zh-Hant"]){const v=snapshot(),t=makeT(locale),html=renderToStaticMarkup(createElement(module.exports.Runtime,{agent:v.agents[0],workspace:v,locale,permissionSupported:true,onApplyPermissionTier:async()=>{},listModels:async()=>({runtimeId:"codex",models:[]}),listConnectionModels:async()=>({models:[]}),connectionModelSupported:false,onApplyRuntime:async()=>{},onApplyModel:async()=>{},onApplyConnectionModel:async()=>{},onRescan:async()=>{},onRegisterRuntime:async()=>{},onRuntimeDirectory:()=>{}}));
 assert.ok(html.includes(t("ws.permissions.full")));assert.ok(html.includes(t("ws.permissions.controlled")));assert.ok(html.includes(t("ws.permissions.current",{tier:t("ws.permissions.controlled")})));assert.doesNotMatch(html,/ws\.permissions\./);
 }
});
