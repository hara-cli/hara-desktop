import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { updateDefaults } from "../src/workspace-updater-state.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/WorkspaceSoftwareUpdate.tsx",import.meta.url),"utf8");
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function view(locale) {
  const messages=JSON.parse(readFileSync(new URL(`../src/locales/${locale}/ws.json`,import.meta.url),"utf8"));
  const native=[];const exports={};
  const localRequire=name=>{
    if(name==="react")return {...React,useSyncExternalStore:(_subscribe,get)=>get()};
    if(name==="react/jsx-runtime")return require(name);
    if(name==="./workspace-shell-hooks")return {useWorkspaceLocale:()=>({locale,t:key=>{assert.equal(typeof messages[key],"string",key);return messages[key];}})};
    if(name==="./settings-device-copy")return {settingsTranslator:t=>t};
    if(name==="@tauri-apps/api/core")return {isTauri:()=>true,invoke:command=>{native.push(command);throw Error("render must not invoke native operations");}};
    if(name==="./SettingsChrome")return {SettingsAdvanced:({children})=>React.createElement("details",null,children)};
    if(name==="./SettingsActionDialog")return {SettingsActionResult:()=>null};
    if(name==="./ToggleSwitch")return {ToggleSwitch:()=>React.createElement("input",{type:"checkbox",role:"switch"})};
    return {};
  };
  vm.runInNewContext(`(function(require,exports){${compiled}\n})`)(localRequire,exports);
  return {component:exports.WorkspaceSoftwareUpdate,native,messages};
}
for(const locale of ["en","zh-Hans","zh-Hant"])test(`Dev ${locale} version view keeps real versions and exposes only the development command`,()=>{
  const f=view(locale);const controller={subscribe:()=>()=>{},getSnapshot:()=>({phase:"ready",preferences:updateDefaults(),version:"999.0.0",installing:false})};
  const html=renderToStaticMarkup(React.createElement(f.component,{controller,info:{desktop:"1.2.3",engine:"1.3.0",arch:"aarch64",channel:"development",isolatedDevelopment:true}}));
  assert.equal(html.includes(f.messages["ws.updates.development"]),true);
  assert.equal(html.includes("<code>hara-desk-dev</code>"),true);
  for(const actual of ["1.2.3","1.3.0","aarch64"])assert.equal(html.includes(actual),true);
  assert.equal((html.match(/<button/g)??[]).length,1);
  assert.equal(html.includes(f.messages["ws.updates.copy"]),true);
  assert.doesNotMatch(html,/role="switch"|999\.0\.0/);
  assert.deepEqual(f.native,[]);
});
test("formal version view retains its update action and automatic-check control",()=>{
  const f=view("en");const controller={subscribe:()=>()=>{},getSnapshot:()=>({phase:"latest",preferences:updateDefaults(),version:"",installing:false})};
  const html=renderToStaticMarkup(React.createElement(f.component,{controller,info:{desktop:"1.2.3",engine:"1.3.0",arch:"aarch64",channel:"stable"}}));
  assert.match(html,/<button/);assert.match(html,/role="switch"/);assert.doesNotMatch(html,/hara-desk-dev/);assert.deepEqual(f.native,[]);
});
