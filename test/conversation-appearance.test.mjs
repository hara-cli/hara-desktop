import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {AGENT_ACCENT_PALETTE,agentAvatarAccent,agentConversationAccent,agentAvatarInitials} from "../src/agent-visual.ts";
const luminance=hex=>{const v=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
test("all eight conversation colours have accessible white text and avatar ink",()=>{
 assert.equal(new Set(AGENT_ACCENT_PALETTE).size,8);
 for(const accent of AGENT_ACCENT_PALETTE){const value=agentConversationAccent("synthetic",{accent});assert.equal(value.accent,accent);assert.ok(contrast(value.deep,"#ffffff")>=4.5,accent);assert.ok(contrast(accent,"#1a1325")>=4.5,accent);}
 const main=agentConversationAccent("main",{accent:"#ff695f"},true);assert.deepEqual(main,{accent:"#7C3AED",deep:"#7C3AED"});assert.ok(contrast(main.deep,"#fffFFF")>=4.5);
});
test("invalid imported colours cannot become CSS and character-preserving fallback stays shared",()=>{
 for(const accent of [undefined,"#010101","#ff0000","red","url(https://example.invalid)","#000000;display:none"]){
  for(let index=0;index<50;index++){const id=`synthetic-${index}`,identity={accent,character:"specialist"};const value=agentConversationAccent(id,identity);assert.ok(AGENT_ACCENT_PALETTE.includes(value.accent));assert.equal(value.accent,agentAvatarAccent(id,identity));assert.match(value.deep,/^#[a-f0-9]{6}$/);}
 }
 assert.equal(agentConversationAccent("case",{accent:"#FF695F"}).accent,"#ff695f");
 assert.equal(agentAvatarInitials("林安"),"林");assert.equal(agentAvatarInitials("Alex Smith"),"AS");
});
const require=createRequire(import.meta.url);
const bundled=await build({stdin:{contents:`import {createElement as h} from 'react';import {renderToStaticMarkup as render} from 'react-dom/server';import {Avatar} from './src/WorkspaceShell.tsx';import {SidebarAvatar} from './src/SidebarAvatar.tsx';export const avatar=(sidebar,agent)=>render(h(sidebar?SidebarAvatar:Avatar,{agent}));`,resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'tsx'},bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom'],loader:{'.css':'empty','.svg':'empty'},write:false,logLevel:'silent'});
const output={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(require,output,output.exports);
const agent=(index,extra={})=>({agentId:`synthetic-${index}`,kind:'colleague',state:'active',identity:{displayName:'Alex Smith',character:'specialist',...extra},runtime:{id:'pi',label:'Pi',available:true}});
test("sidebar and conversation avatars share colours, monograms and accepted image sources",()=>{
 for(let i=0;i<50;i++){const item=agent(i);const sidebar=output.exports.avatar(true,item),conversation=output.exports.avatar(false,item);assert.equal(sidebar,conversation);assert.match(sidebar,/>AS<\/span>/);assert.ok(sidebar.includes(agentAvatarAccent(item.agentId,item.identity)));}
 const stored=agent(0,{avatar:'/avatars/synthetic-avatar.webp'});assert.equal(output.exports.avatar(true,stored),output.exports.avatar(false,stored));assert.match(output.exports.avatar(false,stored),/<img/);
 for(const avatar of ['https://example.invalid/private.png','file:///private/fixture.png','data:image/svg+xml;base64,AAAA'])assert.doesNotMatch(output.exports.avatar(false,agent(0,{avatar})),/<img/);
 const main={...agent(0),kind:'main',identity:{displayName:'Hara',avatar:'https://example.invalid/private.png'}};assert.match(output.exports.avatar(false,main),/is-main/);assert.doesNotMatch(output.exports.avatar(false,main),/example.invalid/);
});
