import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { redesignText } from "../src/desktop-redesign-copy.ts";
import { makeT } from "../src/i18n.ts";
import { messageTimeSeparator, messageTimeLabel, messageShortRole } from "../src/conversation-message-layout.ts";
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/WorkspaceLocalDev.tsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom'],loader:{'.css':'empty','.svg':'empty','.png':'empty','.webp':'empty'},write:false,logLevel:'silent'});
const module={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(require,module,module.exports);
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const agent={agentId:'fixture',kind:'colleague',state:'active',identity:{displayName:'Synthetic Reviewer',title:'Review'},runtime:{id:'pi',label:'Pi',available:true}};
const at=n=>new Date(Date.UTC(2026,10,10,1,n)).toISOString();
const history=[{role:'user',content:'Synthetic question',createdAt:at(0)},{role:'assistant',text:'First visible response',tools:[],createdAt:at(1)},{role:'assistant',text:'Second visible response',tools:[],createdAt:at(2)},{role:'assistant',text:'Later visible response',tools:[],createdAt:at(32)}];
const render=(patch={})=>renderToStaticMarkup(createElement(module.exports.Transcript,{history,agent,t:makeT('en'),locale:'en',...patch}));

test('time separators use actual timestamps and a 30-minute boundary',()=>{
 assert.equal(messageTimeSeparator(at(0)),true);assert.equal(messageTimeSeparator(at(29),at(0)),false);assert.equal(messageTimeSeparator(at(30),at(0)),true);
 assert.equal(messageTimeSeparator(undefined,at(0)),false);assert.equal(messageTimeSeparator('invalid',at(0)),false);assert.equal(messageTimeSeparator(at(0),at(2)),false);
 const now=new Date(2026,10,10,12),yesterday=new Date(2026,10,9,20,30).toISOString();
 assert.match(messageTimeLabel(yesterday,'en',now),/^Yesterday /u);assert.match(messageTimeLabel(yesterday,'zh-Hant',now),/^昨天 /u);assert.equal(messageTimeLabel('invalid','en',now),'');
});
test('direct messages have no repeated author or avatar; same-author messages keep compact spacing',()=>{
 const html=render();assert.equal((html.match(/class="hd-time-separator"/gu)??[]).length,2);
 assert.doesNotMatch(html,/class="hs-who"|class="hs-ava/u);assert.equal((html.match(/hd-chat-message is-agent cont is-direct/gu)??[]).length,1);
 assert.match(html,/First visible response/u);assert.match(html,/class="hd-message-actions" role="group"/u);
});
test('group messages keep one author cue per consecutive block and accept the previous speaker time',()=>{
 const html=render({showAuthor:true});assert.equal((html.match(/class="hs-who"/gu)??[]).length,2);
 assert.match(html,/Synthetic Reviewer<span class="hd-message-role"> · Review/u);
 const next=render({showAuthor:true,previousMessageAt:at(0),history:[{role:'assistant',text:'Next colleague',tools:[],createdAt:at(1)}]});
 assert.doesNotMatch(next,/hd-time-separator/u,'changing speaker is not itself a 30-minute gap');
 assert.equal(messageShortRole({title:'Responsible for synthetic review'}),'');assert.equal(messageShortRole({title:'Responsible for synthetic review',shortTitle:'Reviewer'}),'Reviewer');
});
test('internal reminders and blank tool prose never acquire visible message actions or separators',()=>{
 const html=render({history:[{role:'user',content:'<system-reminder>PRIVATE</system-reminder>',createdAt:at(0)},{role:'assistant',text:'',tools:['synthetic'],createdAt:at(1)},{role:'tool',results:[{id:'synthetic',name:'read',content:'PRIVATE TOOL',isError:false}]}]});
 assert.doesNotMatch(html,/PRIVATE|hd-chat-message|hd-message-actions|hd-time-separator/u);
});

test('topic reply stays absent in every locale until the host contract is wired',()=>{
 for(const locale of ['en','zh-Hans','zh-Hant']){
  const html=render({locale,t:makeT(locale)});
  assert.equal(html.includes(redesignText(locale,'replyInTopic')),false,'No visible or accessible topic reply action without onReply');
 }
});
