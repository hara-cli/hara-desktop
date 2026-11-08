import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import ts from "typescript";
import {makeT} from "../src/i18n.ts";
import {redesignText} from "../src/desktop-redesign-copy.ts";
import {WorkspaceDevModel} from "../src/workspace-dev-state.ts";
const require=createRequire(import.meta.url),React=require("react");
const source=readFileSync(new URL("../src/WorkspaceLocalDev.tsx",import.meta.url),"utf8");
const ast=ts.createSourceFile("WorkspaceLocalDev.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="ApprovalCard");
assert.ok(declaration);
const compiled=ts.transpileModule('import {useState,useRef} from "react";\n'+declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const base={id:"card",workspaceId:"A",resourceGeneration:"generation-A",agentId:"main",expiresAt:"2099-01-01T00:00:00Z"};
const colleague={username:"video",displayName:"Video",title:"Video lead",instructions:"Manage video.",project:"",runtimeId:"pi",permissionTier:"full-protected"};
function mount(card,{disabled=false,runtimeOptions=[],agents=[]}={}){
 const calls=[],slots=[];let cursor=0,release,settled=0;
 const wait=new Promise(resolve=>release=resolve);
 const hooks={useRef(value){const index=cursor++;return slots[index]??={current:value};},useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==="function"?initial():initial;return[slots[index],value=>{slots[index]=typeof value==="function"?value(slots[index]):value;}];}};
 const exports={};new Function("require","exports","redesignText","CalendarDaysIcon","UserPlusIcon","ShieldCheckIcon",compiled)(name=>name==="react"?{...React,...hooks}:require(name),exports,redesignText,...["CalendarDaysIcon","UserPlusIcon","ShieldCheckIcon"].map(key=>require("@heroicons/react/24/outline")[key]));
 const model={getSnapshot:()=>({workspace:{approvals:calls.length?[]:[card],runtimeOptions,agents}}),respond(...args){calls.push(args);return wait;}};
 const tree=exports.ApprovalCard({card,model,t:makeT("en"),disabled,onSettled:()=>settled++});
 const nodes=[];function walk(value){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object"&&value.props){nodes.push(value);walk(value.props.children);}}walk(tree);
 return{tree,calls,buttons:nodes.filter(node=>node.type==="button"),release,settled:()=>settled};
}
for(const action of ["read","exec"])test(`extension ${action} confirmation sends no colleague draft and is fenced while pending`,async()=>{
 const card={...base,kind:"extension_call",draft:{sourceName:"Fixture",toolName:"fixture",target:"synthetic target",action}};
 const f=mount(card);assert.equal(f.buttons.length,2);f.buttons[1].props.onClick();f.buttons[1].props.onClick();
 assert.deepEqual(f.calls,[[card,true,undefined]]);f.release();await tick();assert.equal(f.settled(),1);
});
test("schedule approval needs no colleague editor or runtime choice",async()=>{
 const card={...base,kind:"schedule_create",draft:{title:"Fixture",task:"Read fixture",timing:"tomorrow",tz:"UTC"}};
 const f=mount(card);f.buttons[1].props.onClick();assert.deepEqual(f.calls,[[card,true,undefined]]);f.release();await tick();
});
test("legacy colleague cards retain draft validation and disabled approvals cannot dispatch",async()=>{
 const card={...base,draft:{...colleague}};
 const f=mount(card,{runtimeOptions:[{id:"pi",available:true,label:"Pi"}]});f.buttons[1].props.onClick();assert.deepEqual(f.calls,[[card,true,colleague]]);f.release();await tick();
 for(const patch of [{disabled:true,runtimeOptions:[{id:"pi",available:true,label:"Pi"}]},{runtimeOptions:[]}]){
  const blocked=mount(card,patch);blocked.buttons[1].props.onClick();assert.equal(blocked.calls.length,0);blocked.release();
 }
});
function modelFixture(card){
 const calls=[];let approvals=[card];
 const snapshot=id=>({workspaceId:id,resourceGeneration:`generation-${id}`,label:id,syntheticOnly:false,executionMode:"workspace",selectedAgentId:"main",agents:[{agentId:"main",agentEpoch:1,state:"active",kind:"main"}],approvals,connections:{revision:0,defaultConnectionId:null,connections:[]},conversation:{history:[],state:"idle"}});
 const model=new WorkspaceDevModel({supportsCapability:()=>true,async request(method,params){calls.push({method,params});if(method==="workspace.list")return{revision:1,syntheticOnly:false,executionMode:"workspace",workspaces:[{workspaceId:"A",active:true}]};if(method==="workspace.approval.respond"){approvals=[];return{approved:true};}return snapshot(params.workspaceId);}},()=>"request",false,"workspace");
 return{model,calls};
}
for(const kind of ["extension_call","schedule_create"])test(`model excludes a supplied colleague payload for ${kind}`,async()=>{
 const card={...base,kind,draft:kind==="extension_call"?{sourceName:"Fixture",toolName:"fixture",target:"fixture",action:"read"}:{title:"Fixture",task:"Read fixture",timing:"tomorrow",tz:"UTC"}};
 const f=modelFixture(card);await f.model.selectWorkspace("A");await f.model.respond(card,true,colleague);
 assert.deepEqual(f.calls.find(row=>row.method==="workspace.approval.respond").params,{workspaceId:"A",expectedGeneration:"generation-A",approvalId:"card",approved:true});
});

test("duplicate display names show an advisory without blocking confirmation",async()=>{
 const card={...base,draft:{...colleague}},f=mount(card,{runtimeOptions:[{id:"pi",available:true,label:"Pi"}],agents:[{state:"active",identity:{displayName:" video "}}]});
 assert.match(JSON.stringify(f.tree),/A colleague already uses this name/);
 assert.equal(f.buttons[1].props.disabled,false);f.buttons[1].props.onClick();assert.deepEqual(f.calls,[[card,true,colleague]]);f.release();await tick();
});
