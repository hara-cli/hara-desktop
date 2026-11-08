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
function fixture({hold=false,invalid=false,holdStatus=false,badStatus=false}={}){
 const calls=[];let finish;let state={...agent};const snapshot=id=>({workspaceId:id,resourceGeneration:"generation-"+id,label:id,syntheticOnly:true,selectedAgentId:"main",agents:[{...agent,agentId:"main",kind:"main"},state],approvals:[],connections:{revision:0,connections:[]},conversation:{revision:0,history:[],state:"idle",sessionId:id+"-main",taskId:null,runId:null,taskState:null,objective:"",pastTaskCount:0,usage:{modelCalls:0,inputTokens:0,outputTokens:0},runUsage:{modelCalls:0,inputTokens:0,outputTokens:0},completion:null}});
 const rpc={supportsCapability:()=>true,async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,syntheticOnly:true,workspaces:[{workspaceId:"A",active:true},{workspaceId:"B",active:true}]};if(method==="workspace.agents.archiveStatus"){const status={workspaceId:params.workspaceId,resourceGeneration:"generation-"+params.workspaceId,agentId:params.agentId,configRevision:params.configRevision,agentEpoch:params.agentEpoch,scheduledTasks:1,runs:badStatus?[null]:[{runId:"run-fixture",taskId:"task-fixture",title:"Synthetic active task",kind:"chat",state:"running"}]};return holdStatus?new Promise(resolve=>finish=()=>resolve(status)):status;}if(method==="workspace.agents.setArchived"){state={...state,state:params.archived?"archived":"active",agentEpoch:state.agentEpoch+1};const value={agent:invalid?{...state,agentId:"wrong"}:state,pausedSchedules:0};return hold?new Promise(resolve=>finish=()=>resolve(value)):value;}if(method==="workspace.media.describe")return hold?new Promise(resolve=>finish=()=>resolve({state:"outside"})):{state:"ready",media:{id:"a".repeat(64),mime:invalid?"text/html":"application/pdf",bytes:12}};return snapshot(params.workspaceId);}};
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

test("export keeps only the current history boundary, actual channel authors and visible text",()=>{
 const history=[{role:"user",content:"OLD HIDDEN"},{role:"assistant",text:"OLD ANSWER",tools:[]},{role:"user",content:"Current question"},{role:"assistant",text:"   ",tools:["tool"]},{role:"assistant",text:"Current answer",tools:[]}];
 const text=conversationMarkdown(history,"Private colleague",{historyStart:2,userLabel:"你"});
 assert(!text.includes("OLD"));assert(text.includes("### 你\n\nCurrent question"));assert(!text.includes("### Private colleague\n\n   "));
 const group=conversationMarkdown([{role:"user",content:"Question"},{role:"assistant",text:"A",tools:[]},{role:"assistant",text:"B",tools:[]}],"Synthetic group",{authors:["Jeff","Alice","Bob"]});
 assert(group.includes("### Jeff\n\nQuestion"));assert(group.includes("### Alice\n\nA"));assert(group.includes("### Bob\n\nB"));assert(!group.includes("### Synthetic group"));
 assert.throws(()=>conversationMarkdown(history,"Private colleague",{historyStart:-1}),/boundary/);assert.throws(()=>conversationMarkdown(history,"Private colleague",{historyStart:NaN}),/boundary/);
});

test("archive preview is read-only, freezes scope and passes only reviewed run IDs",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");const status=await f.model.agentArchiveStatus(agent);
 assert.equal(status.runs[0].title,"Synthetic active task");assert(!f.calls.some(row=>row.method==="workspace.agents.setArchived"),"canceling the confirmation writes nothing");
 await f.model.setAgentArchived(agent,true,status);assert.deepEqual(f.calls.find(row=>row.method==="workspace.agents.setArchived").params.confirmedRunIds,["run-fixture"]);
 const foreign=fixture();await foreign.model.selectWorkspace("A");const old=await foreign.model.agentArchiveStatus(agent);await foreign.model.selectWorkspace("B");await assert.rejects(foreign.model.setAgentArchived(agent,true,old));assert(!foreign.calls.some(row=>row.method==="workspace.agents.setArchived"));
 const bad=fixture({badStatus:true});await bad.model.selectWorkspace("A");await assert.rejects(bad.model.agentArchiveStatus(agent));
 const late=fixture({holdStatus:true});await late.model.selectWorkspace("A");const pending=late.model.agentArchiveStatus(agent);await late.model.selectWorkspace("B");late.release();await assert.rejects(pending);
});

test("all redesign copy keys have three complete languages and matching placeholders",()=>{
 const source=readFileSync(new URL("../src/desktop-redesign-copy.ts",import.meta.url),"utf8"),ast=ts.createSourceFile("copy.ts",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(row=>[...row.declarationList.declarations]).find(row=>row.name.getText(ast)==="copy");let value=declaration.initializer;while(ts.isAsExpression(value)||ts.isParenthesizedExpression(value))value=value.expression;assert(ts.isObjectLiteralExpression(value));
 for(const property of value.properties){const key=property.name.text,templates=["zh-Hans","en","zh-Hant"].map(locale=>redesignText(locale,key));for(const text of templates)assert(text.trim(),key);
  const names=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();assert.deepEqual(names(templates[0]),names(templates[1]),key);assert.deepEqual(names(templates[1]),names(templates[2]),key);
  assert.doesNotMatch(templates[1],/[\u3400-\u9fff]/u,key);assert.doesNotMatch(templates[2],/[这删开显对组错]/u,key);
  const params=Object.fromEntries(names(templates[0]).map(name=>[name,"Fixture"]));for(const locale of["en","zh-Hans","zh-Hant"])assert.doesNotMatch(redesignText(locale,key,params),/\{\w+\}/u,key);
 }
});
