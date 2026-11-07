import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { rosterGroups, folderPreferenceKey } from "../src/workspace-roster.ts";
import { redesignText } from "../src/desktop-redesign-copy.ts";
import { conversationMarkdown } from "../src/workspace-conversation-actions.ts";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";

test("sidebar folders deduplicate pinned entries, keep hidden recoverable and sort mixed activity", () => {
 const row=(id,kind,order,unread=0)=>({id,kind,name:id,role:"Fixture",preview:"Synthetic",order,unread});
 const entries=[row("pinned","colleague",2),row("folder-a","colleague",4,2),row("folder-b","group",6,3),row("recent-group","group",9),row("recent-person","colleague",7),row("hidden","colleague",10)];
 const prefs={pinned:{pinned:true,section:"Team"},"folder-a":{section:"Team"},"folder-b":{section:"Team",unread:true},hidden:{hidden:true},[folderPreferenceKey("Team")]:{collapsed:true}};
 const value=rosterGroups(entries,prefs);assert.deepEqual(value.pinned.map(x=>x.id),["pinned"]);assert.deepEqual(value.folders[0].rows.map(x=>x.id),["folder-b","folder-a"]);assert.equal(value.folders[0].unread,5);assert.equal(value.folders[0].collapsed,true);
 assert.deepEqual(value.recent.map(x=>x.id),["recent-group","recent-person"]);assert.deepEqual(value.hidden.map(x=>x.id),["hidden"]);
 assert.deepEqual(rosterGroups(entries,prefs,"hidden").recent.map(x=>x.id),["hidden"]);
});
test("exports contain only current visible human/model content, never completion reminders or tool bodies", () => {
 const output=conversationMarkdown([{role:"user",content:"Visible question"},{role:"user",content:"<system-reminder>PRIVATE INTERNAL</system-reminder>"},{role:"tool",results:[{content:"PRIVATE TOOL"}]},{role:"assistant",text:"Visible answer"}],"Synthetic colleague");
 assert.match(output,/Visible question/);assert.match(output,/Visible answer/);assert.doesNotMatch(output,/PRIVATE|system-reminder/);
});
test("created colleague one-liners require a consumed human confirmation and an actual identity", () => {
 const source=readFileSync(new URL("../src/WorkspaceLocalDev.tsx",import.meta.url),"utf8"), ast=ts.createSourceFile("view.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="parseAgentCreateSettle");const compiled=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,exports={};new Function("exports",compiled)(exports);const parse=x=>exports.parseAgentCreateSettle(JSON.stringify(x));
 const receipt={created:true,humanConfirmed:true,approvalState:"consumed",agent:{agentId:"same-agent",identity:{displayName:"Fixture"}}};assert.deepEqual(parse(receipt),{state:"created",name:"Fixture",agentId:"same-agent"});
 for(const patch of [{humanConfirmed:false},{approvalState:"pending"},{agent:{profile:{displayName:"Fixture"}}},{created:"true"}])assert.equal(parse({...receipt,...patch}),null);
 assert.deepEqual(parse({created:false,approvalState:"declined",displayName:"Fixture"}),{state:"declined",name:"Fixture"});
});
test("new copy distinguishes all three locales without unresolved substitutions", () => {
 assert.equal(redesignText("en","orchestrator"),"Orchestrator");assert.equal(redesignText("zh-Hans","orchestrator"),"总调度");assert.equal(redesignText("zh-Hant","orchestrator"),"總調度");
 for(const locale of ["en","zh-Hans","zh-Hant"])for(const key of ["deletedNotice","restored","outside","piDetails","archivedName","createdColleague"])assert.doesNotMatch(redesignText(locale,key,{name:"Fixture",n:2,schedules:""}),/\{\w+\}/);
});
const agent={agentId:"colleague",kind:"colleague",state:"active",configRevision:1,agentEpoch:1,identity:{displayName:"Fixture"},runtime:{id:"pi",label:"Pi",available:true}};
function fixture({hold=false,invalid=false}={}){
 const calls=[];let finish;let state={...agent};const snapshot=id=>({workspaceId:id,resourceGeneration:"generation-"+id,label:id,syntheticOnly:true,selectedAgentId:"main",agents:[{...agent,agentId:"main",kind:"main"},state],approvals:[],connections:{revision:0,connections:[]},conversation:{revision:0,history:[],state:"idle",sessionId:id+"-main",taskId:null,runId:null,taskState:null,objective:"",pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}});
 const rpc={supportsCapability:()=>true,async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,syntheticOnly:true,workspaces:[{workspaceId:"A",active:true},{workspaceId:"B",active:true}]};if(method==="workspace.agents.setArchived"){state={...state,state:params.archived?"archived":"active",agentEpoch:state.agentEpoch+1};const value={agent:invalid?{...state,agentId:"wrong"}:state,pausedSchedules:0};return hold?new Promise(resolve=>finish=()=>resolve(value)):value;}if(method==="workspace.media.describe")return hold?new Promise(resolve=>finish=()=>resolve({state:"outside"})):{state:"ready",media:{id:"a".repeat(64),mime:invalid?"text/html":"application/pdf",bytes:12}};return snapshot(params.workspaceId);}};
 return{model:new WorkspaceDevModel(rpc),calls,release:()=>finish()};
}
test("archive UI sends exact frozen authority and rejects malformed or late receipts",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");const receipt=await f.model.setAgentArchived(agent,true);assert.equal(receipt.agent.state,"archived");assert.deepEqual(f.calls.find(x=>x.method==="workspace.agents.setArchived").params,{workspaceId:"A",expectedGeneration:"generation-A",agentId:"colleague",archived:true,configRevision:1,agentEpoch:1});
 const bad=fixture({invalid:true});await bad.model.selectWorkspace("A");await assert.rejects(bad.model.setAgentArchived(agent,true));
 const late=fixture({hold:true});await late.model.selectWorkspace("A");const pending=late.model.setAgentArchived(agent,true);await late.model.selectWorkspace("B");late.release();await assert.rejects(pending);assert.equal(late.model.getSnapshot().workspaceId,"B");
});
test("media states stay scoped and only closed MIME types reach native actions",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");assert.equal((await f.model.describeMedia("fixture.pdf")).state,"ready");
 const bad=fixture({invalid:true});await bad.model.selectWorkspace("A");await assert.rejects(bad.model.describeMedia("fixture.html"));
 const late=fixture({hold:true});await late.model.selectWorkspace("A");const pending=late.model.describeMedia("fixture.gif");await late.model.selectWorkspace("B");late.release();await assert.rejects(pending);
});
