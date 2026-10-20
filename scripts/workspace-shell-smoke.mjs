#!/usr/bin/env node
// Real Workspace React components, in a task-owned headless Chrome profile with synthetic RPC only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeT } from "../src/i18n.ts";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if(base.protocol!=="http:" || base.hostname!=="127.0.0.1" || base.pathname!=="/" || base.username || base.password || base.search || base.hash)throw new Error("Use a task-owned IPv4 loopback Vite root");
if(!process.argv[3])throw new Error("An explicit evidence directory is required");
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true,mode:0o700});
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((value) => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium is required for the component browser gate");
const profile = mkdtempSync(join(tmpdir(), "hara-shell-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-background-mode", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--no-default-browser-check", "--no-first-run",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
let requestId = 0;
let sessionId;
const errors = [];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function connect() {
  const url = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Headless Chrome startup timed out")), 15000);
    chrome.stderr.on("data", (chunk) => {
      text = (text + chunk.toString()).slice(-4000);
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match) { clearTimeout(timer); done(match[1]); }
    });
    chrome.once("error", (error) => { clearTimeout(timer); fail(error); });
    chrome.once("exit", () => { clearTimeout(timer); fail(new Error("Headless Chrome exited before ready")); });
  });
  socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  socket.addEventListener("message", ({data}) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`${request.method}: ${message.error.message}`)); else request.done(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false);
  sessionId = attached.sessionId;
  await send("Runtime.enable"); await send("Page.enable");
}
async function send(method, params = {}, scoped = true) {
  const id = ++requestId;
  const result = new Promise((done, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { done, fail, timer, method });
  });
  socket.send(JSON.stringify({ id, method, params, ...(scoped && sessionId ? { sessionId } : {}) }));
  return result;
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function settled() { await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))"); }
async function ready(expression, label) {
  for(let attempt=0;attempt<160;attempt++){if(await evaluate(expression))return;await pause(75);}
  const diagnostic=await evaluate('({url:location.href,text:document.body.innerText.slice(0,2500),fixture:!!window.__HARA_SHELL_FIXTURE__})');
  writeFileSync(join(output,'failure.json'),JSON.stringify({label,errors,diagnostic},null,2)+'\n',{mode:0o600});await capture('failure');
  throw new Error(label);
}
async function navigate({width=1280,locale='zh-Hant',theme='light',scenario='home',reset=true}={}){
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario,reset:reset?'1':'0'}).toString();
  await send('Page.navigate',{url:url.href});
  await ready("!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.hs-field textarea,[data-tasks-count]')",'Synthetic Workspace fixture must mount');
  await ready("document.querySelector('[data-nav-count]')?.textContent === (new URLSearchParams(location.search).get('scenario')==='many'?'10':new URLSearchParams(location.search).get('scenario')==='partial'?'2':'3')",'Overview must settle with the expected scoped count');
  await settled();assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);assert.equal(await evaluate("document.querySelector('.wsd-app').lang"),locale);
}
async function click(selector){assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),`Missing ${selector}`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
async function buttonText(text, scope='.wss-main'){
 await evaluate(`(()=>{const button=Array.from(document.querySelectorAll(${JSON.stringify(scope+' button')})).find(node=>node.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('Missing button: '+${JSON.stringify(text)});button.click();})()`);await settled();
}
async function setLocale(locale){await evaluate(`localStorage.setItem('hara.locale',${JSON.stringify(locale)});window.dispatchEvent(new Event('hara:locale-changed'))`);await settled();}
async function inputValue(selector,value){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settled();}
async function settingsFits(){const size=await evaluate("(()=>{const main=document.querySelector('.wss-main');return {viewport:innerWidth,body:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScroll:main.scrollWidth,badButtons:Array.from(main.querySelectorAll('button:not(.wss-switch)')).filter(node=>node.getBoundingClientRect().height<31.9).map(node=>node.textContent),badFields:Array.from(main.querySelectorAll('.wsd-connection-form input,.wsd-connection-form select')).filter(node=>node.getBoundingClientRect().height<35.9).map(node=>node.outerHTML.slice(0,160)),inlineLabels:Array.from(main.querySelectorAll('.wsd-connection-form>label')).filter(node=>getComputedStyle(node).display!=='grid').length}})()");assert.ok(size.body<=size.viewport&&size.mainScroll<=size.mainWidth+1,JSON.stringify(size));assert.deepEqual(size.badButtons,[]);assert.deepEqual(size.badFields,[]);assert.equal(size.inlineLabels,0);return size;}
async function key(key,shift=false){const value={key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:{Enter:13,Tab:9,Escape:27}[key]??0};await send('Input.dispatchKeyEvent',{type:'keyDown',...value,...(key==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',...value});await settled();}
async function capture(name){screenshots++;await pause(150);const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(result.data,'base64'),{mode:0o600});}
async function geometry(){return evaluate(`(()=>{
 const rect=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,bottom:r.bottom};};
 const palette=Object.fromEntries(['brand','brand-hover','brand-pressed','brand-soft','brand-text','indicator','text-red','field-ring','control'].map(key=>[key,getComputedStyle(document.querySelector('.wsd-app')).getPropertyValue('--'+key).trim()]));
 const selected=document.querySelector('.hs-row[aria-current=page]');
 return {viewport:innerWidth,body:document.documentElement.scrollWidth,sidebar:rect('.hs-side'),chat:rect('.hs-chat'),composer:rect('.hs-field'),send:rect('.hs-send'),
 palette,indicatorColor:selected?getComputedStyle(selected,'::before').backgroundColor:null,
 badTargets:Array.from(document.querySelectorAll('.hs-icon,.hs-sec-a,.hs-send,.hs-sec-t')).filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.height&&(r.width<31.9||r.height<31.9);}).map(node=>node.className),
 dmCount:document.querySelectorAll('.hs-dm').length,focusColor:getComputedStyle(document.querySelector('.wsd-app')).getPropertyValue('--focus').trim()};})()`);}
async function contrast(){return evaluate(`(()=>{
 const parse=text=>{const v=text.match(/[\\d.]+/g)?.map(Number)??[0,0,0,0];return [v[0]/255,v[1]/255,v[2]/255,v[3]??1];};
 const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat([1]);
 const background=node=>{const chain=[];for(let current=node;current;current=current.parentElement)chain.push(parse(getComputedStyle(current).backgroundColor));return chain.reverse().reduce((bg,fg)=>over(fg,bg),[1,1,1,1]);};
 const lum=v=>v.slice(0,3).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const walk=document.createTreeWalker(document.querySelector('.wsd-app'),NodeFilter.SHOW_TEXT),issues=[];let min=Infinity,n=0,node;
 while(node=walk.nextNode()){
  if(!node.textContent.trim())continue;const element=node.parentElement,style=getComputedStyle(element);
  if(!element.getClientRects().length||style.visibility==='hidden'||element.closest('[inert],[disabled],option'))continue;
  const box=element.getBoundingClientRect();if(box.bottom<=0||box.top>=innerHeight)continue;
  const bg=background(element),fg=over(parse(style.color),bg),a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700);n++;min=Math.min(min,ratio);
  if(ratio<(large?3:4.5))issues.push({text:node.textContent.trim().slice(0,70),ratio,color:style.color,bg});
 }
 return {count:n,min,issues};})()`);}
const receipts=[];
let completed=false;
let screenshots=0;
try{
 await connect();
 for(const theme of ['light','dark'])for(const scenario of ['home','chat','tasks']){
  await navigate({theme,scenario});const measured=await geometry();assert.ok(measured.body<=measured.viewport,JSON.stringify(measured));assert.deepEqual(measured.badTargets,[]);assert.equal(measured.dmCount,10);
  assert.deepEqual(measured.palette,theme==='light'?{brand:'#9b2c24','brand-hover':'#85241d','brand-pressed':'#6f1e18','brand-soft':'#f3e2df','brand-text':'#7a2019',indicator:'#9b2c24','text-red':'#9b2c24','field-ring':'#8c8579',control:'#8c8579'}:{brand:'#c03a33','brand-hover':'#a8322c','brand-pressed':'#922b26','brand-soft':'#3a1e1e','brand-text':'#f2aaa3',indicator:'#f08e84','text-red':'#f08e84','field-ring':'#716b62',control:'#716b62'});
  if(measured.indicatorColor)assert.equal(measured.indicatorColor,theme==='light'?'rgb(155, 44, 36)':'rgb(240, 142, 132)');
  const colors=await contrast();assert.deepEqual(colors.issues,[],`${theme}/${scenario} contrast`);receipts.push({theme,scenario,measured,colors});await capture(`${scenario}-${theme}`);
  if(scenario==='chat'){
   assert.equal(await evaluate("document.querySelectorAll('.hs-msg.cont').length"),1);
   const neutral=await evaluate("(()=>{const input=document.querySelector('.hs-field textarea');input.focus();return {outline:getComputedStyle(input).outlineStyle,shadow:getComputedStyle(input.closest('.hs-field')).boxShadow};})()");
   assert.equal(neutral.outline,'none');assert.equal(/155, 44, 36|192, 58, 51|185, 59, 41|207, 64, 41/.test(neutral.shadow),false);await capture(`composer-focus-${theme}`);
  }
  if(scenario==='tasks')assert.equal(await evaluate("document.querySelector('.hs-tab-panel').textContent.includes('Archived fixture')"),true);
 }
 for(const locale of ['en','zh-Hans','zh-Hant']){
  await navigate({locale});assert.equal(await evaluate("document.querySelector('.hs-sec[aria-label] .hs-sec-t').textContent.includes('同事')"),locale!=='en');receipts.push({locale,ok:true});
 }
 for(const theme of ['light','dark']){
  await navigate({theme});await evaluate("window.__HARA_SHELL_FIXTURE__.idle()");await settled();
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('A synthetic message ready to send')");await settled();await pause(150);
  const enabled=await evaluate("(()=>{const button=document.querySelector('.hs-send'),s=getComputedStyle(button);return {disabled:button.disabled,background:s.backgroundColor,color:s.color};})()");
  assert.equal(enabled.disabled,false);assert.equal(enabled.background,theme==='light'?'rgb(155, 44, 36)':'rgb(192, 58, 51)');assert.equal(enabled.color,'rgb(255, 255, 255)');
  await capture(`composer-enabled-${theme}`);
  const point=await evaluate("(()=>{const r=document.querySelector('.hs-send').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(150);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).backgroundColor"),theme==='light'?'rgb(133, 36, 29)':'rgb(168, 50, 44)');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});await pause(150);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).backgroundColor"),theme==='light'?'rgb(111, 30, 24)':'rgb(146, 43, 38)');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});await settled();
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.send').length"),1);
  receipts.push({theme,composer:'enabled, hover, pressed and single synthetic send checked'});
 }
 for(const width of [700,900,1100]){
  await navigate({width});const measured=await geometry();assert.ok(measured.body<=width);assert.deepEqual(measured.badTargets,[]);assert.ok(measured.composer.width>250);receipts.push({width,measured});if(width===900)await capture('home-900');
 }
 // Independent sections, immediate inertness, keyboard activation and per-workspace storage.
 await navigate();
 await click('.hs-sec:first-child .hs-sec-t');await key('Tab');
 assert.equal(await evaluate("document.querySelector('#sec-colleagues').inert"),true);
 assert.equal(await evaluate("document.querySelector('#sec-channels').inert"),false);
 await click('.hs-sec:nth-child(3) .hs-sec-t');await capture('sections-collapsed');
 assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('hara.sidebar.sections.A'))"),{colleagues:false,channels:true,dms:false});
 await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectWorkspace('B')");await settled();
 assert.equal(await evaluate("document.querySelector('#sec-dms').inert"),false);
 await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectWorkspace('A')");await settled();
 assert.equal(await evaluate("document.querySelector('#sec-dms').inert"),true);
 await navigate({reset:false});assert.equal(await evaluate("document.querySelector('#sec-dms').inert"),true);
 await evaluate("document.querySelector('.hs-sec:nth-child(3) .hs-sec-t').focus()");await key('Enter');assert.equal(await evaluate("document.querySelector('#sec-dms').inert"),false);
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-sec-b')).transitionDuration"),'0s');await send('Emulation.setEmulatedMedia',{features:[]});
 receipts.push({sections:'independent, persisted per workspace, inert, keyboard, reduced motion'});
 // Every urgent approval stays on the home tray; identical counters and original-card navigation.
 await navigate({scenario:'many'});
 assert.equal(await evaluate("document.querySelectorAll('.hs-await .hs-ai').length"),5);
 assert.equal(await evaluate("document.querySelector('[data-await-count]').textContent"),'10');
 await click('.hs-await-all');assert.equal(await evaluate("document.querySelector('[data-tasks-count]').textContent"),'10');
 await click('.hs-task[data-approval-id="fixture-0"] button');
 await ready("document.activeElement?.id==='approval-fixture-0'",'Task link must focus its original decision card');
 await click('.hs-main');await ready("!!document.querySelector('.hs-await')",'Main Hara must open');
 await click('.hs-await [data-approval-id="fixture-0"] .pri');
 assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.approval.respond').length"),0);
 assert.equal(await evaluate("document.querySelectorAll('[id]').length===new Set(Array.from(document.querySelectorAll('[id]')).map(node=>node.id)).size"),true);
 assert.equal(await evaluate("!!document.activeElement.closest('[aria-modal=true]')"),true);
 await key('Tab',true);assert.equal(await evaluate("!!document.activeElement.closest('[aria-modal=true]')"),true);
 await evaluate("(()=>{const button=document.querySelector('.wsd-approval-dialog .pri');button.click();button.click();})()");
 await ready("!document.querySelector('.wsd-approval-dialog')",'Shared approval flow must settle');
 assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.approval.respond').length"),1);
 const decision=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.find(row=>row.method==='workspace.approval.respond').params");
 assert.deepEqual(decision,{workspaceId:'A',expectedGeneration:'g-A',approvalId:'fixture-0',approved:true});
 receipts.push({approvals:'5 urgent + 3 ordinary remain reachable; identical counters; original card; confirm once via existing RPC'});
 // Drafts/IME and local observations never submit or switch workspace authority.
 await navigate();await evaluate("window.__HARA_SHELL_FIXTURE__.idle()");await settled();
 await evaluate("(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Draft kept on this workspace');input.dispatchEvent(new Event('input',{bubbles:true}));})()");await settled();
 assert.equal(await evaluate("document.querySelector('.hs-send').disabled"),false);
 await evaluate("document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))");await settled();
 assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.send').length"),0);
 await click('.hs-set');await ready("!!document.querySelector('.wsd-settings')",'Settings must open');
 await click('.wsd-settings button.hs-btn:nth-child(1)'); // scoped schedules button
 assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.some(row=>row.method==='workspace.features.list'&&row.params.workspaceId==='A'&&row.params.expectedGeneration==='g-A')"),true);
 await key('Escape');assert.equal(await evaluate("document.querySelector('textarea').value"),'Draft kept on this workspace');
 await navigate({locale:'en'});await click('.hs-set');
 await evaluate("(()=>{const select=document.querySelector('select[aria-label=Language]');select.value='zh-Hant';select.dispatchEvent(new Event('change',{bubbles:true}));})()");await settled();
 assert.equal(await evaluate("document.querySelector('.wsd-app').lang"),'zh-Hant');assert.equal(await evaluate("localStorage.getItem('hara.locale')"),'zh-Hant');
 await capture('settings-language');await key('Escape');
 await evaluate("window.__HARA_SHELL_FIXTURE__.incoming('person-9','New fixture message')");
 await ready("document.querySelector('.hs-dm .nm')?.textContent==='Reviewer' && !!document.querySelector('.hs-dm .hs-dot')",'New activity must sort to the top with its unread marker');
 assert.equal(await evaluate("document.querySelector('.hs-dm .hs-dot')?.getAttribute('aria-label')"),'1 則未讀');
 await click('.hs-dm');await ready("!document.querySelector('.hs-dm[aria-current=page] .hs-dot')",'Opening the conversation clears its local unread marker');
 receipts.push({composer:'draft retained across Settings; IME does not submit; new DM activity sorts; local unread clears'});
 // The actual lazy browser surface must share horizontal space with chat in both themes.
 for (const theme of ['light','dark']) for (const width of [1280,1100,900,720,700]) {
  await navigate({theme,width});
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Right panel draft')");
  await click('.hs-head .hs-ghost');await ready("!!document.querySelector('.hs-browser-address')",'Browser panel must mount');
  const measurePanel=()=>evaluate("(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top,bottom:r.bottom}};return {chat:box('.hs-chat'),panel:box('.hs-browser'),composer:box('.hs-field'),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth}})()");
  for (const expanded of [false,true]) {
   if (expanded) await click('.hs-browser-head [aria-pressed]');
   const bounds=await measurePanel();assert.ok(bounds.chat.width>=339,JSON.stringify(bounds));assert.ok(bounds.panel.width>=259,JSON.stringify(bounds));
   assert.ok(bounds.chat.right<=bounds.panel.left+1,JSON.stringify(bounds));assert.ok(bounds.panel.right<=width+1,JSON.stringify(bounds));
   assert.ok(bounds.scrollWidth<=width,JSON.stringify(bounds));assert.ok(await evaluate("document.querySelector('.hs-ai .t').getBoundingClientRect().width>=80"),'Approval text must retain a readable width');assert.equal(await evaluate("document.querySelector('textarea').value"),'Right panel draft');
   if ([1280,900,720].includes(width)&&!expanded) await capture(`browser-${width}-${theme}`);
   if (width===1280&&expanded) await capture(`browser-expanded-${theme}`);
  }
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectWorkspace('B')");await settled();assert.equal(await evaluate("!!document.querySelector('.hs-browser')"),false);
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.some(row=>row.method==='workspace.session.send'||row.method==='workspace.approval.respond')"),false);
  receipts.push({theme,width,browser:'right-side sibling; expand keeps chat/composer visible; draft retained; scoped teardown; no execution'});
 }
 await navigate();await click('.hs-head .hs-ghost');await ready("!!document.querySelector('.hs-browser-address')",'Browser URL form must mount');
 const preview=new URL('test/fixtures/browser-panel-preview.html',base).href;
 await evaluate(`(()=>{const input=document.querySelector('.hs-browser-address input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(preview)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settled();
 await click('.hs-browser-address [type=submit]');await ready("!!document.querySelector('.hs-browser iframe')",'Local preview iframe must load');
 assert.equal(await evaluate("document.querySelector('.hs-browser iframe').getAttribute('sandbox')"),'allow-scripts allow-forms allow-popups');
 await capture('browser-local-preview');await click('.hs-browser-head button:last-child');assert.equal(await evaluate("!!document.querySelector('.hs-browser')"),false);
 receipts.push({browser:'explicit local iframe loads with opaque sandbox, close restores chat'});
 for (const locale of ['en','zh-Hans','zh-Hant']) {
  await navigate({scenario:'native-settings',locale});
  await evaluate("(()=>{const area=document.querySelector('.hs-scroll');area.scrollTop=250;area.dispatchEvent(new Event('scroll',{bubbles:true}));})()");await settled();
  assert.equal(await evaluate("Math.round(document.querySelector('.hs-scroll').scrollTop)"),250);
  await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'Independent settings must load');
  assert.equal(await evaluate("document.querySelector('.wss-app').getAttribute('lang')"),locale);
  const geometry=await evaluate("(()=>{const nav=document.querySelector('.wss-nav').getBoundingClientRect(),main=document.querySelector('.wss-main').getBoundingClientRect();return {navRight:nav.right,mainLeft:main.left,mainWidth:main.width}})()");
  assert.ok(geometry.navRight<=geometry.mainLeft+1,JSON.stringify(geometry));assert.ok(geometry.mainWidth>500,JSON.stringify(geometry));
  await evaluate("Array.from(document.querySelectorAll('.wss-nav nav>button')).find(button=>/Appearance|外观|外觀/.test(button.textContent)).click()");await settled();
  assert.equal(await evaluate("!!document.querySelector('select option[value=zh-Hant]')"),true);
  await capture(`native-settings-${locale}`);await click('.wss-back');await ready("!!document.querySelector('.hs-field textarea')",'Returning from settings must preserve main chat');
  assert.equal(await evaluate("Math.round(document.querySelector('.hs-scroll').scrollTop)"),250,'Returning from full-window Settings must retain the chat reading position');
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspaceId"),'A');
  receipts.push({locale,settings:'independent RPC model; full-window layout; language selector; main chat scope retained'});
 }
 // Settings use the real renderer/model, with in-memory synthetic responses and failed writes only.
 // Change locale while notices and confirmation cards are already open, preserving user drafts.
 for(const theme of ['light','dark']) for(const [index,locale] of ['en','zh-Hans','zh-Hant'].entries()){
  const nextLocale=['en','zh-Hans','zh-Hant'][(index+1)%3], t=makeT(locale), next=makeT(nextLocale);
  await navigate({scenario:'native-settings',locale,theme});await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'Settings i18n fixture must load');
  await buttonText(t('ws.settings.page.connections'),'.wss-nav nav');
  await ready("!!document.querySelector('.wsd-legacy-import')",'Legacy metadata must settle without any import');
  await buttonText(t('ws.connections.import'));await ready("!!document.querySelector('.wss-content [role=dialog]')",'Import confirmation must open');
  await setLocale(nextLocale);assert.equal(await evaluate("document.querySelector('.wss-content [role=dialog]').getAttribute('aria-label')"),next('ws.connections.confirmImport'));
  await buttonText(next('ws.cancel'),'.wss-content [role=dialog]');await setLocale(locale);
  await buttonText(t('ws.connections.edit'));await ready("!!document.querySelector('.wsd-connection-form')",'Blank-key edit form must open');
  const draft='User draft · 資料与内容';await inputValue('.wsd-connection-form input',draft);
  await evaluate("window.__HARA_SHELL_FIXTURE__.setFailure('workspace.connection.edit',true);document.querySelector('.wsd-connection-form').requestSubmit()");
  await ready(`document.querySelector('.wss-main>p[role=alert]')?.textContent===${JSON.stringify(t('ws.connections.editUnknown'))}`,'A failed connection write must use the selected locale');
  await setLocale(nextLocale);
  assert.equal(await evaluate("document.querySelector('.wss-main>p[role=alert]').textContent"),next('ws.connections.editUnknown'));
  assert.equal(await evaluate("document.querySelector('.wsd-connection-form input').value"),draft);
  assert.equal(await evaluate("document.querySelector('input[type=password]').value"),'');
  await buttonText(next('ws.settings.page.runtimes'),'.wss-nav nav');
  await ready("!!document.querySelector('.wss-discard-dialog')",'Dirty settings must retain the leave guard');
  assert.equal(await evaluate("document.querySelector('#wss-discard-title').textContent"),next('ws.settings.discard.title'));
  await key('Escape');assert.equal(await evaluate("document.querySelector('.wsd-connection-form input').value"),draft);
  await buttonText(next('ws.settings.page.runtimes'),'.wss-nav nav');await click('.wss-discard-dialog button:nth-child(2)');
  await ready(`Array.from(document.querySelectorAll('.wss-content button')).some(node=>node.textContent===${JSON.stringify(next('ws.runtimes.useLocal'))})`,'Local runtime discovery must finish');
  await buttonText(next('ws.runtimes.useLocal'));await setLocale(locale);
  assert.equal(await evaluate("document.querySelector('.wss-content [role=dialog]').getAttribute('aria-label')"),t('ws.runtimes.confirmLocal'));
  await buttonText(t('ws.cancel'),'.wss-content [role=dialog]');
  await ready(`Array.from(document.querySelectorAll('.wss-content button')).some(node=>node.textContent===${JSON.stringify(t('ws.runtimes.install'))}&&!node.disabled)`,'Missing runtime can be proposed after discovery');
  await buttonText(t('ws.runtimes.install'));await ready("!!document.querySelector('.wss-content [role=dialog]')",'Runtime installation proposal must open');
  await setLocale(nextLocale);assert.equal(await evaluate("document.querySelector('.wss-content [role=dialog]').getAttribute('aria-label')"),next('ws.runtimes.confirmInstall'));
  await settingsFits();await buttonText(next('ws.runtimes.notNow'),'.wss-content [role=dialog]');
  await ready("!document.querySelector('.wss-content [role=dialog]')",'Runtime rejection must settle without downloading');
  await buttonText(next('ws.settings.page.skills'),'.wss-nav nav');await ready("!!document.querySelector('.wsd-feature-panel input[role=switch]')",'Scoped skill version must load');
  await buttonText(next('ws.skills.review'));await setLocale(locale);
  assert.equal(await evaluate("document.querySelector('.wss-content [role=dialog]').getAttribute('aria-label')"),t('ws.skills.confirmUpdate'));
  await buttonText(t('ws.cancel'),'.wss-content [role=dialog]');await buttonText(t('ws.skills.edit'));
  await ready("!!document.querySelector('.wsd-feature-panel textarea')",'Private skill editor must load');
  await inputValue('.wsd-feature-panel textarea',draft);await setLocale(nextLocale);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel textarea').value"),draft);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel textarea').getAttribute('aria-label')"),next('ws.skills.instructions'));
  await settingsFits();await capture(`settings-skill-draft-${theme}-${locale}`);await buttonText(next('ws.cancel'),'.wss-content [role=dialog]');
  await buttonText(next('ws.settings.page.schedules'),'.wss-nav nav');await ready("!!document.querySelector('.wsd-feature-panel input[role=switch]')",'Scoped schedule metadata must load');
  assert.ok(await evaluate(`document.querySelector('.wss-content').textContent.includes(${JSON.stringify(next('ws.tasks.status.completed'))})`));
  await buttonText(next('ws.schedules.add'));await ready("!!document.querySelector('.wsd-feature-panel form')",'Schedule draft must open');
  await inputValue('.wsd-feature-panel form input',draft);await setLocale(locale);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel form input').value"),draft);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel form h3').textContent"),t('ws.schedules.createTitle',{workspace:'My workspace'}));
  await send('Emulation.setDeviceMetricsOverride',{width:720,height:800,deviceScaleFactor:1,mobile:false});await settled();
  const layout=await settingsFits();await evaluate("document.querySelector('.wss-main').scrollTo(0,document.querySelector('.wss-main').scrollHeight)");await settled();await capture(`settings-schedule-720-${theme}-${locale}`);
  await buttonText(t('ws.settings.page.general'),'.wss-nav nav');await ready("!!document.querySelector('.wss-discard-dialog')",'Schedule draft is guarded before navigation');
  await click('.wss-discard-dialog button:nth-child(2)');await buttonText(t('ws.settings.page.updates'),'.wss-nav nav');
  await settingsFits();assert.equal(await evaluate("document.querySelector('.wss-updates').getAttribute('aria-label')"),t('ws.settings.page.updates'));
  const mutations=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>/workspace\\.(?:connection\\.(?:edit|import|delete|select)|skill\\.fork|schedule\\.(?:save|run|delete)|runtime\\.(?:approve|registerLocal))$/.test(row.method))");
  assert.equal(mutations.length,2,JSON.stringify(mutations));
  assert.equal(mutations.filter(row=>row.method==='workspace.connection.edit').length,1,'Failed edit was submitted once');
  assert.equal(mutations.filter(row=>row.method==='workspace.runtime.approve'&&row.params.approved===false).length,1,'The sole runtime decision is an explicit rejection');
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspaceId"),'A');
  receipts.push({theme,locale,nextLocale,settingsI18n:'open notices/cards retranslate; connection/skill/schedule drafts retained; no import/install/schedule/skill mutation; one failed edit; narrow layout',layout});
 }
 await navigate({scenario:'partial'});assert.equal(await evaluate("!!document.querySelector('.hs-overview-notice[role=status]')"),true);
 await click('.hs-dm');await ready("!!document.querySelector('[data-overview-incomplete]')",'Incomplete counts must remain visible in colleague conversations');
 await navigate({scenario:'legacy'});await click('.hs-dm');assert.equal(await evaluate("document.querySelectorAll('.hs-msg.cont').length"),0);
 await navigate({scenario:'no-connection'});assert.equal(await evaluate("document.querySelector('.hs-send').disabled"),true);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).opacity"),'1');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).backgroundColor"),'rgb(231, 228, 222)');
 await navigate({scenario:'tasks'});assert.equal(await evaluate('location.hash'),'#colleagues/tasks');
 assert.equal(errors.length,0,JSON.stringify(errors));completed=true;
 writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,receipts,errors},null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({ok:true,checks:receipts.length,screenshots,output})+'\n');
}catch(error){
 try{await capture('failure');writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),errors,diagnostic:await evaluate('({url:location.href,active:document.activeElement?.outerHTML.slice(0,1500),text:document.body.innerText.slice(0,2000)})')},null,2)+'\n',{mode:0o600});}catch{}
 throw error;
}finally{
 try{socket?.close();}catch{}
 for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Browser gate closed'));}pending.clear();
 if(chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),pause(4000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await once(chrome,'exit');}}
 let removed=false;for(let attempt=0;attempt<15;attempt++){try{rmSync(profile,{recursive:true,force:true});removed=true;break;}catch{await pause(100);}}
 writeFileSync(join(output,'cleanup.json'),JSON.stringify({completed,chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRemoved:removed,profile:removed?'removed':profile})+'\n',{mode:0o600});
 if(!removed)throw new Error(`Owned browser profile cleanup incomplete: ${profile}`);
}
