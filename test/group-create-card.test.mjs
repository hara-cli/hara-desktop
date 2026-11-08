import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {makeT} from "../src/i18n.ts";
import {redesignText} from "../src/desktop-redesign-copy.ts";
const source=fs.readFileSync(new URL("../src/WorkspaceLocalDev.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("view.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=ast.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text==="ApprovalCard");
const code=ts.transpileModule(declaration.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
const symbols={React,useState:React.useState,useRef:React.useRef,redesignText,CalendarDaysIcon:()=>null,UserPlusIcon:()=>null,UsersIcon:()=>null,ShieldCheckIcon:()=>null};
const exports={};new Function("exports",...Object.keys(symbols),code)(exports,...Object.values(symbols));
const card={id:"group-card",workspaceId:"fixture",resourceGeneration:"generation",agentId:"main",expiresAt:new Date(Date.now()+60000).toISOString(),kind:"group_create",catalogRevision:3,channelRevision:0,draft:{name:"Project planning",memberIds:["alpha","beta"],memberNames:["Alpha","Beta"]}};
for(const [locale,title,confirm]of[["en","Confirm a new group","Create group"],["zh-Hans","确认建立群聊","确认建群"],["zh-Hant","確認建立群聊","確認建群"]]){
 test("actual group card renders its frozen membership in "+locale,()=>{
  const model={respond:async()=>{},getSnapshot:()=>({workspace:{approvals:[card],agents:[],runtimeOptions:[]}})};
  const html=renderToStaticMarkup(React.createElement(exports.ApprovalCard,{card,model,t:makeT(locale),locale}));
  assert(html.includes(title));assert(html.includes(confirm));assert(html.includes("Project planning"));assert(html.includes("Alpha"));assert(html.includes("Beta"));
  assert.doesNotMatch(html,/<(?:input|textarea|select)\b/);assert.doesNotMatch(html,/<button[^>]*disabled/);
 });
}

for(const locale of["en","zh-Hans","zh-Hant"])for(const kind of["instruction_update","memory_promote"])test("actual frozen "+kind+" card exposes its content with no editable draft in "+locale,()=>{
 const current={...card,kind,draft:kind==="instruction_update"?{file:"AGENTS.md",previousSha256:null,content:"Approved guidance <safe>"}:{scope:"global",content:"Approved shared fact <safe>"}},model={respond:async()=>{},getSnapshot:()=>({workspace:{approvals:[current],agents:[],runtimeOptions:[]}})};
 const html=renderToStaticMarkup(React.createElement(exports.ApprovalCard,{card:current,model,t:makeT(locale),locale}));
 assert(html.includes(kind==="instruction_update"?"AGENTS.md":"Approved shared fact"));assert(html.includes("&lt;safe&gt;"));assert(html.includes(redesignText(locale,"confirmChange")));assert.doesNotMatch(html,/<(?:input|textarea|select)\b/);assert.doesNotMatch(html,/<button[^>]*disabled/);
});
