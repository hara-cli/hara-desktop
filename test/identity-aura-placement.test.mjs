import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL("../src/WorkspaceShell.tsx",import.meta.url))],bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react"],loader:{".css":"empty",".svg":"empty"},write:false});
const target={exports:{}};new Function("require","module","exports",bundle.outputFiles[0].text)(require,target,target.exports);
const {createElement}=require("react"),{renderToStaticMarkup}=require("react-dom/server"),{WorkspaceConversationCapsule,Avatar}=target.exports;
const render=(mainIdentity,kind,empty=true)=>renderToStaticMarkup(createElement(WorkspaceConversationCapsule,{name:"Synthetic identity",label:"Manage",expanded:false,onOpen(){},mainIdentity,empty,avatar:createElement(Avatar,{agent:{agentId:kind,kind,identity:{displayName:"Synthetic identity",character:"specialist"}}})}));
test("only the main Hara avatar receives the iris wrapper",()=>{
 const main=render(true,"main");assert.match(main,/class="hd-identity-aura"/);assert.match(main,/data-hara-empty="true"/);assert.match(main,/is-main/);
 const occupied=render(true,"main",false);assert.match(occupied,/class="hd-identity-aura"/);assert.doesNotMatch(occupied,/data-hara-empty/);
});
test("colleague and unspecified capsules keep shared avatars without an iris",()=>{
 for(const identity of [false,undefined]){const html=render(identity,"colleague");assert.match(html,/hd-colleague-avatar/);assert.doesNotMatch(html,/hd-identity-aura|data-hara-empty/);}
});
