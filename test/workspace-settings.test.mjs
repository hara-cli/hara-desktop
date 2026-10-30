import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ts from "typescript";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
const require = createRequire(import.meta.url), root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const snapshot = id => ({ workspaceId:id,resourceGeneration:`generation-${id}`,label:id,selectedAgentId:"main",syntheticOnly:false,executionMode:"workspace",
  agents:[{agentId:"main",kind:"main",state:"active",identity:{displayName:"Hara"},runtime:{id:"pi",label:"Pi",available:true}}],
  approvals:[],connections:{revision:3,defaultConnectionId:"one",connections:[{id:"one",label:"Fixture",status:"active",provider:"openai",baseURL:"https://example.invalid/v1",defaultModel:"fake",keySaved:true}]},
  conversation:{history:[],state:"idle",usage:{modelCalls:0},runUsage:{modelCalls:0}} });
function fixture() {
 const calls=[],handlers={}; const model=new WorkspaceDevModel({async request(method,params){calls.push({method,params});if(handlers[method])return handlers[method](params);
 if(method==="workspace.list")return {revision:1,syntheticOnly:false,executionMode:"workspace",workspaces:["A","B"].map(workspaceId=>({workspaceId,active:true}))};return snapshot(params.workspaceId);}},()=>"fake-request",false,"workspace");
 return {model,calls,handlers};
}
function callback(name, bindings, file="src/WorkspaceSettingsPanels.tsx") {
 const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let initializer;
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name){assert.equal(initializer,undefined);initializer=node.initializer.getText(ast);}ts.forEachChild(node,visit);}visit(ast);assert.ok(initializer);
 const result=ts.transpileModule(`return (${initializer});`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}});
 return new Function(...Object.keys(bindings),result.outputText)(...Object.values(bindings));
}
const bundle=await build({stdin:{contents:'export {WorkspaceConnections,WorkspaceFeaturePanel,WorkspaceThemeSettings} from "./src/WorkspaceSettingsPanels.tsx"; export {default as Runtime,WorkspaceConnectionForm} from "./src/WorkspaceRuntimeSettings.tsx";',resolveDir:root,loader:"tsx"},bundle:true,format:"cjs",platform:"node",jsx:"automatic",external:["react"],loader:{".css":"empty"},write:false});
const module={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(require,module,module.exports);
const {createElement}=require("react"),{renderToStaticMarkup}=require("react-dom/server");
const render=(name,props)=>{
 const before=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
 Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:key=>key==="hara.locale"?"zh-Hant":null}});
 try{return renderToStaticMarkup(createElement(module.exports[name],props));}
 finally{if(before)Object.defineProperty(globalThis,"localStorage",before);else delete globalThis.localStorage;}
};
test("connection settings render safe metadata and editable blank-key semantics, never a saved key value",()=>{
 const html=render("WorkspaceConnections",{model:{},workspace:snapshot("A")});
 for(const marker of [/目前連接/,/Fixture/,/Key •••••••••••• · 已存入鑰匙圈/,/新增連接/,/編輯/,/刪除/])assert.ok(marker.test(html),`connection display contract: ${marker}`);
 assert.doesNotMatch(html,/type="password"/); // edit opens only on the user's action
 const form=render("WorkspaceConnectionForm",{model:{},existing:snapshot("A").connections.connections[0]});
 assert.match(form,/留空不修改/);assert.match(form,/type="password"[^>]*value=""/);assert.doesNotMatch(form,/type="password"[^>]*required/);
});
test("pending connection migration is read-only without losing the space or displaying a damaged-data claim",()=>{
 const workspace=snapshot("A");workspace.connections={revision:0,defaultConnectionId:null,connections:[],readOnly:true,migrationPending:true,recovered:false};
 const html=render("WorkspaceConnections",{model:{},workspace});assert.match(html,/連接升級待完成/);assert.match(html,/查看歷史與使用空間其他功能/);
 assert.doesNotMatch(html,/未允許或不可用/); // A first-time prefill is not evidence that the OS denied access.
 assert.match(html,/我已確認系統憑據儲存，重試升級/);assert.match(html,/<button disabled="">新增連接<\/button>/);assert.doesNotMatch(html,/type="password"|資料損壞|設定為唯讀（較新版本/);
 const source=read("src/WorkspaceSettingsPanels.tsx");assert.match(source,/model\.workspaceRequest\("workspace\.connection\.migration\.retry", \{ expectedRevision: workspace\.connections\.revision, approved: true \}\)/);
});
test("invalid and pending credential statuses use the same fixed-length mask without key fragments",()=>{
 for(const keyState of ["invalid","pending"]){const workspace=snapshot("A");workspace.connections.connections[0].keyState=keyState;workspace.connections.connections[0].keySaved=keyState!=="pending";
  const html=render("WorkspaceConnections",{model:{},workspace});assert.equal(html.includes("••••••••••••"),true);assert.equal(html.includes(keyState==="invalid"?"Key 已失效，請更新":"待授權"),true);assert.equal(/last.?4|尾号|prefix/i.test(html),false);}
});
test("a keyless legacy preview is editable but cannot pretend a saved credential or keep a blank key",()=>{
 const workspace=snapshot("A"),connection=workspace.connections.connections[0];connection.keySaved=false;connection.credentialRequired=true;connection.keyState="pending";
 workspace.connections.activeConnectionId=connection.id;workspace.connections.defaultConnectionId=null;
 const html=render("WorkspaceConnections",{model:{},workspace});assert.match(html,/原預設 · 待授權/);assert.match(html,/請編輯新增 Key/);assert.doesNotMatch(html,/已存入鑰匙圈|連接升級待完成/);
 const form=render("WorkspaceConnectionForm",{model:{},existing:connection});assert.match(form,/type="password"[^>]*required/);assert.doesNotMatch(form,/API Key（留空不修改）/);
});
test("unavailable connections and backup-only recovery retain distinct non-destructive notices",()=>{
 for(const flags of [{unavailable:true},{recovered:true},{migrationPending:true,recovered:true}]){
  const workspace=snapshot("A");workspace.connections={revision:0,defaultConnectionId:null,connections:[],readOnly:true,...flags};
  const html=render("WorkspaceConnections",{model:{},workspace});assert.match(html,/原檔|原設定/);assert.match(html,/<button disabled="">新增連接<\/button>/);assert.doesNotMatch(html,/type="password"|我已確認系統憑據存儲，重試升級/);
 }
});
test("detected runtimes offer workspace binding and missing runtimes alone offer installation",()=>{
 const workspace={...snapshot("A"),runtimes:{options:[{runtimeId:"codex",label:"Codex",registered:false,state:"detected",version:"1.2.3",path:"/fixture/nvm/bin/codex"}],operations:[]}};
 const html=render("Runtime",{model:{},workspace});assert.match(html,/1\.2\.3 · 本機已安裝/);assert.match(html,/fixture\/nvm\/bin\/codex/);assert.match(html,/綁定到此空間/);assert.doesNotMatch(html,/使用本機安裝|確認登記本機安裝|>按需安裝<\/button>/);
 const missing=render("Runtime",{model:{},workspace:{...workspace,runtimes:{options:[{runtimeId:"codex",label:"Codex",registered:false,state:"not_installed"}],operations:[]}}});
 assert.match(missing,/正在確認本機安裝/);assert.match(missing,/<button disabled="">按需安裝<\/button>/);
 const failed=render("Runtime",{model:{},workspace:{...workspace,runtimes:{options:[{runtimeId:"codex",label:"Codex",registered:false,state:"integrity_failed"}],operations:[]}}});
 assert.doesNotMatch(failed,/>按需安裝<\/button>|綁定到此空間/);
 const source=read("src/WorkspaceRuntimeSettings.tsx");assert.match(source,/setBound\(\{ runtimeId: local\.runtimeId/);assert.match(source,/model\.listRuntimeModels\(bound\.runtimeId\)/);
 assert.match(source,/model\.selectRuntimeModel\(bound\.runtimeId, selectedModelId, runtimeModels\.revision\)/);
 assert.doesNotMatch(source,/model\.changeConnection|selectedConnection|runtime-model-connection/);
});
test("bound runtime lists and selects its own model with workspace generation and runtime revision",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");
 f.handlers["workspace.runtime.listModels"]=()=>({runtimeId:"codex",revision:7,selectedModelId:null,models:[{id:"o3",label:"o3"}]});
 const listed=await f.model.listRuntimeModels("codex");assert.deepEqual(listed.models,[{id:"o3",label:"o3"}]);
 f.handlers["workspace.runtime.selectModel"]=()=>({selected:true});
 await f.model.selectRuntimeModel("codex","o3",listed.revision);
 assert.deepEqual(f.calls.filter(row=>row.method.startsWith("workspace.runtime.")),[
  {method:"workspace.runtime.listModels",params:{workspaceId:"A",expectedGeneration:"generation-A",runtimeId:"codex"}},
  {method:"workspace.runtime.selectModel",params:{workspaceId:"A",expectedGeneration:"generation-A",runtimeId:"codex",modelId:"o3",expectedRevision:7}}]);
 assert.equal(f.calls.some(row=>row.method==="workspace.connection.select"),false);
});
test("empty, invalid and stale runtime model results never fall back to connection selection",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");
 f.handlers["workspace.runtime.listModels"]=()=>({runtimeId:"codex",revision:2,selectedModelId:null,models:[]});
 assert.deepEqual((await f.model.listRuntimeModels("codex")).models,[]);
 for(const failure of ["Runtime not bound in this workspace","Invalid modelId","Revision mismatch","Generation mismatch"]){
  f.handlers["workspace.runtime.selectModel"]=()=>{throw new Error(failure);};
  await assert.rejects(f.model.selectRuntimeModel("codex","invalid",2),{message:failure});
 }
 f.handlers["workspace.runtime.listModels"]=()=>{throw new Error("Runtime not bound in this workspace");};
 await assert.rejects(f.model.listRuntimeModels("codex"),/Runtime not bound/);
 assert.equal(f.calls.some(row=>row.method==="workspace.connection.select"),false);
 const source=read("src/WorkspaceRuntimeSettings.tsx");assert.match(source,/modelError \? <p role="alert">/);
 assert.match(source,/runtimeModels\?\.models\.length/);assert.match(source,/runtimeModels\.models\.some\(row => row\.id === selectedModelId\)/);
});
test("three-way appearance setting and scoped features are actual rendered controls",()=>{
 const html=render("WorkspaceThemeSettings",{theme:{preference:"system",settings:{readOnly:false},notice:"",change(){}}});
 for(const value of ["system","light","dark"])assert.match(html,new RegExp(`value="${value}"`));assert.match(html,/跟隨系統/);
 for(const kind of ["schedules","skills"]){const feature=render("WorkspaceFeaturePanel",{model:{},workspace:snapshot("A"),kind,onClose(){}});assert.match(feature,new RegExp(`aria-label="本空間${kind==="skills"?"技能":"定時任務"}"`));assert.match(feature,/A · 只顯示目前工作空間/);}
});
test("model mutations pin scope/revision, require explicit approval fields and do not retain key values",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");const fakeKey="fake-never-store-in-view";
 await f.model.editConnection("one",{label:"Edited",apiKey:fakeKey});await f.model.changeConnection("one");await f.model.changeConnection("one",true);await f.model.importConnection("old-source");
 const calls=f.calls.filter(row=>/^workspace\.connection\./.test(row.method));assert.equal(calls.length,4);
 for(const call of calls){assert.equal(call.params.workspaceId,"A");assert.equal(call.params.expectedGeneration,"generation-A");assert.equal(call.params.expectedRevision,3);}
 assert.equal(calls.find(c=>c.method.endsWith("delete")).params.approved,true);assert.equal(calls.find(c=>c.method.endsWith("import")).params.approved,true);
 assert(!JSON.stringify(f.model.getSnapshot()).includes(fakeKey));
});
test("late metadata and failed key writes cannot leak into a different workspace or auto-retry",async()=>{
 const f=fixture();await f.model.selectWorkspace("A");let finish;f.handlers["workspace.connection.legacy"]=()=>new Promise(resolve=>{finish=resolve;});
 const old=f.model.legacyConnections();await f.model.selectWorkspace("B");finish([{id:"old-A"}]);await assert.rejects(old,{messageKey:"ws.notice.scopeChanged"});
 f.handlers["workspace.connection.edit"]=()=>{throw new Error("fixture-secret-in-provider-error");};assert.equal(await f.model.editConnection("one",{apiKey:"fake"}),false);
 assert(!JSON.stringify(f.model.getSnapshot()).includes("fixture-secret"));assert.equal(f.calls.filter(row=>row.method==="workspace.connection.edit").length,1);
 await assert.rejects(f.model.registerLocalRuntime("codex","fingerprint","A","generation-A"),{messageKey:"ws.notice.localConfirmationExpired"});
 assert.equal(f.calls.some(row=>row.method==="workspace.runtime.registerLocal"),false);
});
test("actual confirmation action fences same-frame repeated clicks; cancellation remains a local card action",async()=>{
 const actions=[],fence={current:false};let finish;
 const perform=callback("perform",{fence,setPending:x=>actions.push(["pending",x]),setNotice:x=>actions.push(["notice",x]),setConfirmDelete:x=>actions.push(["delete",x]),setConfirmImport:x=>actions.push(["import",x])});
 const one=perform(()=>new Promise(resolve=>{actions.push(["rpc"]);finish=resolve;}));await perform(async()=>actions.push(["duplicate"]));assert.equal(actions.some(x=>x[0]==="duplicate"),false);
 finish();await one;assert.equal(fence.current,false);assert.equal(actions.filter(x=>x[0]==="rpc").length,1);
 assert.match(read("src/WorkspaceSettingsPanels.tsx"),/onClick=\{\(\) => setConfirmDelete\(null\)\}/);
});
test("actual feature handler sends locked version and workspace revision once without widening permissions",async()=>{
 const calls=[],busy={current:false},states=[];
 const update=callback("update",{value:{revision:7},busy,kind:"skills",setPending(){},setUpgrade:x=>states.push(x),setNotice(){},setValue:x=>states.push(x),model:{async workspaceRequest(method,params){calls.push({method,params});return {revision:8};}}});
 await update("fixture-skill",true,"a".repeat(64));assert.deepEqual(calls,[{method:"workspace.features.update",params:{kind:"skill",id:"fixture-skill",enabled:true,expectedRevision:7,version:"a".repeat(64)}}]);assert.equal(busy.current,false);
 assert.match(read("src/WorkspaceSettingsPanels.tsx"),/workspace\.skill\.fork/);assert.match(read("src/WorkspaceSettingsPanels.tsx"),/approved: true/);
});
test("stable theme RPC is independent of workspace selection, late save uses server revision and not key storage",async()=>{
 const f=fixture();f.handlers["workspace.preferences.get"]=()=>({theme:"dark",revision:3,readOnly:false,recovered:false});f.handlers["workspace.preferences.set"]=params=>({...params,revision:4,readOnly:false});
 assert.equal((await f.model.preferences()).theme,"dark");await f.model.savePreference("light",3);
 assert.deepEqual(f.calls[1],{method:"workspace.preferences.set",params:{theme:"light",expectedRevision:3}});
 const changes=[],busy={current:false};const change=callback("change",{settings:{revision:3,readOnly:false},busy,model:{async preferences(){return {revision:4};},async savePreference(theme,revision){assert.equal(revision,4);return {theme,revision:5};}},setSettings(){},setPreference:x=>changes.push(x),saveThemePreference:x=>changes.push(x),setNotice(){}});
 await change("dark");assert.deepEqual(changes,["dark","dark"]);assert.equal(busy.current,false);
});
test("both v1.4 cascaded palettes meet AA for text, primary states and control boundaries",()=>{
 const css=read("src/workspace-theme.css"), blocks=[{},{}];
 for(const match of css.replace(/\/\*[^]*?\*\//g,"").matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   const selector=match[1].trim();if(selector!==".hs"&&selector!==':root[data-theme="dark"] .hs')continue;
   const tokens=Object.fromEntries([...match[2].matchAll(/--([a-z-]+):\s*#([a-f0-9]{6}|[a-f0-9]{3})(?=[;\s])/g)].map(m=>[m[1],m[2].length===3?m[2].split("").map(x=>x+x).join(""):m[2]]));
   for(const colors of selector===".hs"?blocks:[blocks[1]])Object.assign(colors,tokens);
 }
 const luminance=hex=>hex.match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((total,x,i)=>total+x*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 for(const colors of blocks){for(const bg of ["paper","surface","sidebar","row-selected"])for(const fg of ["ink","muted"])assert(contrast(colors[fg],colors[bg])>=4.5,`${fg}/${bg} AA`);
 for(const [fg,bg] of [["tag-ink","tag-bg"],["brand-text","brand-soft"],["bubble-ink","bubble"],["mine-ink","mine"],["on-brand","brand"]])assert(contrast(colors[fg],colors[bg])>=4.5,`${fg}/${bg} AA`);
 for(const bg of ["brand-hover","brand-pressed"])assert(contrast(colors["on-brand"],colors[bg])>=4.5,`primary ${bg} AA`);
 for(const [fg,bg] of [["field-ring","field-focus"],["control","field"],["indicator","row-selected"],["brand","sidebar"]])assert(contrast(colors[fg],colors[bg])>=3,`${fg}/${bg} control contrast`);
 assert(contrast(colors.focus,colors.surface)>=3);assert.notEqual(colors.focus,colors.brand);}
 const structure=read("src/workspace-local-dev.css")+css;
 for(const selector of ["hs-chat","wsd-settings","wsd-approval","wsd-feature-panel","hs-bub","wsd-modal","textarea"])assert(structure.includes(selector),selector);
 assert.match(css,/data-theme="dark"/);assert.match(css,/color-scheme:dark/);
});
test("native host storage stays fixed across bundle IDs while SDK HOME remains isolated",()=>{
 const native=read("src-tauri/src/lib.rs");assert.match(native,/user_home\(\)\?\.join\("\.hara"\)/);assert.match(native,/join\("workspaces-v1"\)/);
 assert.match(native,/HARA_WORKSPACE_HOST_HOME/);assert.match(native,/\.env\("HOME", &home\)/);assert.match(native,/\.env_clear\(\)/);
 assert.doesNotMatch(read("src/workspace-dev-state.ts"),/localStorage\.setItem|console\.(?:log|error)/);
});
