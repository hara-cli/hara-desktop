#!/usr/bin/env node
// Real Workspace React components, in a task-owned headless Chrome profile with synthetic RPC only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeT } from "../src/i18n.ts";
import { waitForLayout } from "./browser-layout-wait.mjs";
import { requestCdp } from "./browser-cdp-request.mjs";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if(base.protocol!=="http:" || base.hostname!=="127.0.0.1" || base.pathname!=="/" || base.username || base.password || base.search || base.hash)throw new Error("Use a task-owned IPv4 loopback Vite root");
if(!process.argv[3])throw new Error("An explicit evidence directory is required");
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true,mode:0o700});
const channelsOnly=process.argv[4]==='--channels-only';
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((value) => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium is required for the component browser gate");
const profile = mkdtempSync(join(tmpdir(), "hara-shell-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-background-mode", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--no-default-browser-check", "--no-first-run",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
let requestId = 0;
let sessionId;
let browserUserAgent;
let step = 'connect';
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
  await send("Target.activateTarget", { targetId: target.targetId }, false);
  await send("Page.bringToFront");
  await send("Runtime.enable"); await send("Page.enable");
  const version = await send("Browser.getVersion", {}, false);
  browserUserAgent = version.userAgent;
  await send("Emulation.setUserAgentOverride", { userAgent: version.userAgent, platform: "MacIntel" });
}
function send(method, params = {}, scoped = true) {
  return requestCdp(socket, pending, { id: ++requestId, method, params, sessionId: scoped ? sessionId : undefined, step });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
async function settled() { await waitForLayout(evaluate, {label:step}); }
async function ready(expression, label) {
  for(let attempt=0;attempt<160;attempt++){if(await evaluate(expression))return;await pause(75);}
  const diagnostic=await evaluate('({url:location.href,text:document.body.innerText.slice(0,2500),fixture:!!window.__HARA_SHELL_FIXTURE__})');
  writeFileSync(join(output,'failure.json'),JSON.stringify({label,errors,diagnostic},null,2)+'\n',{mode:0o600});await capture('failure');
  throw new Error(label);
}
async function navigate({width=1280,locale='zh-Hant',theme='light',scenario='home',reset=true}={}){
  step = `${scenario}/${theme}/${locale}/${width}`;
  process.stdout.write(`Checking ${step}\n`);
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario,reset:reset?'1':'0'}).toString();
  await send('Page.navigate',{url:url.href});
  await ready("!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.hs-field textarea,[data-tasks-count]')",'Synthetic Workspace fixture must mount');
  await ready("document.querySelector('[data-nav-count]')?.textContent === (new URLSearchParams(location.search).get('scenario')==='many'?'10':new URLSearchParams(location.search).get('scenario')==='partial'?'2':'3')",'Overview must settle with the expected scoped count');
  await settled();assert.equal(await evaluate('document.documentElement.dataset.theme'),theme);
  if(!['system','saved'].includes(locale))assert.equal(await evaluate("document.querySelector('.wsd-app').lang"),locale);
}
async function click(selector){assert.ok(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),`Missing ${selector}`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
async function buttonText(text, scope='.wss-main'){
 await evaluate(`(()=>{const button=Array.from(document.querySelectorAll(${JSON.stringify(scope+' button')})).find(node=>node.textContent.trim()===${JSON.stringify(text)});if(!button)throw new Error('Missing button: '+${JSON.stringify(text)});button.click();})()`);await settled();
}
async function setLocale(locale){await evaluate(`localStorage.setItem('hara.locale',${JSON.stringify(locale)});window.dispatchEvent(new Event('hara:locale-changed'))`);await settled();}
async function setSystemLanguage(language){
 await send('Emulation.setUserAgentOverride',{userAgent:browserUserAgent,platform:'MacIntel',acceptLanguage:language});
 await evaluate("window.dispatchEvent(new Event('languagechange'))");await settled();
 assert.equal(await evaluate('navigator.language'),language);
}
async function selectValue(selector,value){await evaluate(`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settled();}
async function inputValue(selector,value){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settled();}
async function settingsFits(){const size=await evaluate("(()=>{const main=document.querySelector('.wss-main');return {viewport:innerWidth,body:document.documentElement.scrollWidth,mainWidth:main.clientWidth,mainScroll:main.scrollWidth,badButtons:Array.from(main.querySelectorAll('button:not(.wss-switch)')).filter(node=>node.getBoundingClientRect().height<31.9).map(node=>node.textContent),badFields:Array.from(main.querySelectorAll('.wsd-connection-form input,.wsd-connection-form select')).filter(node=>node.getBoundingClientRect().height<35.9).map(node=>node.outerHTML.slice(0,160)),inlineLabels:Array.from(main.querySelectorAll('.wsd-connection-form>label')).filter(node=>getComputedStyle(node).display!=='grid').length}})()");assert.ok(size.body<=size.viewport&&size.mainScroll<=size.mainWidth+1,JSON.stringify(size));assert.deepEqual(size.badButtons,[]);assert.deepEqual(size.badFields,[]);assert.equal(size.inlineLabels,0);return size;}
async function key(key,shift=false){const value={key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:{Enter:13,Tab:9,Escape:27}[key]??0};await send('Input.dispatchKeyEvent',{type:'keyDown',...value,...(key==='Enter'?{text:'\r'}:{})});await send('Input.dispatchKeyEvent',{type:'keyUp',...value});await settled();}
async function capture(name){step=name;screenshots++;await pause(150);const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(result.data,'base64'),{mode:0o600});}
async function geometry(){return evaluate(`(()=>{
 const rect=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
 const palette=Object.fromEntries(['brand','brand-hover','brand-pressed','brand-soft','brand-text','indicator','text-red','field-ring','control'].map(key=>[key,getComputedStyle(document.querySelector('.wsd-app')).getPropertyValue('--'+key).trim()]));
 const selected=document.querySelector('.hs-row[aria-current=page]');
 const frame=getComputedStyle(document.querySelector('.hs-frame')),win=getComputedStyle(document.querySelector('.hs-win'));
 return {viewport:innerWidth,viewportHeight:innerHeight,body:document.documentElement.scrollWidth,frame:rect('.hs-frame'),window:rect('.hs-win'),sidebar:rect('.hs-side'),chat:rect('.hs-chat'),composer:rect('.hs-field'),send:rect('.hs-send'),
 framePadding:frame.padding,windowRadius:win.borderRadius,windowShadow:win.boxShadow,sidebarDivider:getComputedStyle(document.querySelector('.hs-side')).borderRightWidth,sidebarTop:rect('.hs-top'),dragRegion:rect('.hs-titlebar-drag'),
 palette,indicatorColor:selected?getComputedStyle(selected,'::before').backgroundColor:null,
 badTargets:Array.from(document.querySelectorAll('.hs-icon,.hs-sec-a,.hs-send,.hs-sec-t')).filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.height&&(r.width<31.9||r.height<31.9);}).map(node=>node.className),
 dmCount:document.querySelectorAll('.hs-dm').length,focusColor:getComputedStyle(document.querySelector('.wsd-app')).getPropertyValue('--focus').trim()};})()`);}
function fullBleed(measured){
 for(const box of [measured.frame,measured.window])assert.deepEqual([box.left,box.top,box.right,box.bottom],[0,0,measured.viewport,measured.viewportHeight]);
 assert.equal(measured.framePadding,'0px');assert.equal(measured.windowRadius,'0px');assert.equal(measured.windowShadow,'none');
 assert.equal(measured.sidebar.left,0);assert.equal(measured.sidebar.top,0);assert.equal(measured.sidebar.bottom,measured.viewportHeight);assert.equal(measured.sidebarDivider,'1px');
 assert.equal(measured.chat.left,measured.sidebar.right);assert.equal(measured.chat.top,0);assert.equal(measured.chat.bottom,measured.viewportHeight);
 assert.ok(measured.sidebarTop.top>=44);assert.ok(measured.dragRegion.width>=80&&measured.dragRegion.height>=32,'macOS traffic lights have a reserved draggable area');
}
async function contrast(){return evaluate(`(()=>{
 const parse=text=>{const v=text.match(/[\\d.]+/g)?.map(Number)??[0,0,0,0];return [v[0]/255,v[1]/255,v[2]/255,v[3]??1];};
 const over=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat([1]);
 const background=node=>{const chain=[];for(let current=node;current;current=current.parentElement)chain.push(parse(getComputedStyle(current).backgroundColor));return chain.reverse().reduce((bg,fg)=>over(fg,bg),[1,1,1,1]);};
 const lum=v=>v.slice(0,3).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 const walk=document.createTreeWalker(document.querySelector('.wsd-app,.wsd-boot'),NodeFilter.SHOW_TEXT),issues=[];let min=Infinity,n=0,node;
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
 // Startup must remain legible before the lazy shell defines every theme token.
 for(const theme of ['light','dark']){
  step=`boot-hover-fallback/${theme}`;
  process.stdout.write(`Checking ${step}\n`);
  await send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const url=new URL('test/fixtures/workspace-boot-preview.html',base);url.search=new URLSearchParams({locale:'en',theme}).toString();
  await send('Page.navigate',{url:url.href});
  await ready("window.__HARA_BOOT_FIXTURE__?.model.getSnapshot().phase==='failed' && !!document.querySelector('.wsd-boot button')",'Startup failure fixture must settle');
  await settled();
  await evaluate("document.querySelector('.wsd-boot button').style.setProperty('--row-hover','initial')");
  const point=await evaluate("(()=>{const r=document.querySelector('.wsd-boot button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await settled();
  assert.equal(await evaluate("document.querySelector('.wsd-boot button').matches(':hover')"),true);
  const colors=await contrast();assert.deepEqual(colors.issues,[],`${theme} startup hover without row-hover token`);
  const hover=await evaluate("getComputedStyle(document.querySelector('.wsd-boot button')).backgroundColor");
  await capture(`boot-hover-fallback-${theme}`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});await settled();
  assert.equal(await evaluate("document.querySelector('.wsd-boot button').disabled"),true);
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.wsd-boot button')).backgroundColor"),hover,'Disabled reconnect must not retain its hover fill');
  assert.equal(await evaluate("window.__HARA_BOOT_FIXTURE__.calls()"),2);
  await capture(`boot-disabled-fallback-${theme}`);
  receipts.push({theme,scenario:'boot-hover-fallback',rowHoverTokenAbsent:true,colors,disabledHoverExcluded:true,attachmentCalls:2});
 }
 if(!channelsOnly){
 for(const theme of ['light','dark'])for(const scenario of ['home','chat','tasks']){
  await navigate({theme,scenario});const measured=await geometry();fullBleed(measured);assert.ok(measured.body<=measured.viewport,JSON.stringify(measured));assert.deepEqual(measured.badTargets,[]);assert.equal(measured.dmCount,10);
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
  await navigate({width});const measured=await geometry();fullBleed(measured);assert.ok(measured.body<=width);assert.deepEqual(measured.badTargets,[]);assert.ok(measured.composer.width>250);receipts.push({width,measured});if(width===900)await capture('home-900');
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
   fullBleed(await geometry());
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
  const geometry=await evaluate("(()=>{const nav=document.querySelector('.wss-nav').getBoundingClientRect(),main=document.querySelector('.wss-main').getBoundingClientRect(),back=document.querySelector('.wss-back').getBoundingClientRect();return {navRight:nav.right,mainLeft:main.left,mainWidth:main.width,navLeft:nav.left,navTop:nav.top,navBottom:nav.bottom,mainRight:main.right,backTop:back.top}})()");
  assert.ok(geometry.navRight<=geometry.mainLeft+1,JSON.stringify(geometry));assert.ok(geometry.mainWidth>500,JSON.stringify(geometry));
  assert.deepEqual([geometry.navLeft,geometry.navTop,geometry.navBottom,geometry.mainRight],[0,0,800,1280]);assert.ok(geometry.backTop>=44);
  await evaluate("Array.from(document.querySelectorAll('.wss-nav nav>button')).find(button=>/Appearance|外观|外觀/.test(button.textContent)).click()");await settled();
  assert.equal(await evaluate("!!document.querySelector('select option[value=zh-Hant]')"),true);
  await capture(`native-settings-${locale}`);await click('.wss-back');await ready("!!document.querySelector('.hs-field textarea')",'Returning from settings must preserve main chat');
  assert.equal(await evaluate("Math.round(document.querySelector('.hs-scroll').scrollTop)"),250,'Returning from full-window Settings must retain the chat reading position');
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspaceId"),'A');
  const readingTop=await evaluate("(()=>{const area=document.querySelector('.hs-scroll');area.scrollTop=area.scrollHeight-area.clientHeight-100;area.dispatchEvent(new Event('scroll',{bubbles:true}));return area.scrollTop;})()");await settled();
  assert.equal(await evaluate("Math.round((()=>{const area=document.querySelector('.hs-scroll');return area.scrollHeight-area.clientHeight-area.scrollTop;})())"),100);
  await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'Settings must open from a near-bottom reading position');
  await click('.wss-back');await ready("!!document.querySelector('.hs-field textarea')",'Main chat must return from settings');
  assert.equal(await evaluate("document.querySelector('.hs-scroll').scrollTop"),readingTop,'Reading 100px above the bottom must not be mistaken for following the bottom');
  await capture(`native-settings-reading-return-${locale}`);
  receipts.push({locale,settings:'independent RPC model; full-window layout; language selector; main chat scope and exact reading positions retained'});
 }
 // Settings use the real renderer/model, with in-memory synthetic responses and failed writes only.
 // Change locale while notices and confirmation cards are already open, preserving user drafts.
 for(const theme of ['light','dark']) for(const [index,locale] of ['en','zh-Hans','zh-Hant'].entries()){
  const nextLocale=['en','zh-Hans','zh-Hant'][(index+1)%3], t=makeT(locale), next=makeT(nextLocale);
  await navigate({scenario:'native-settings',locale,theme});await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'Settings i18n fixture must load');
  const connectionSummary=await evaluate(`Array.from(document.querySelectorAll('.wss-overview button')).find(button=>button.querySelector('h2')?.textContent===${JSON.stringify(t('ws.settings.page.connections'))})?.querySelector('p')?.textContent`);
  assert.equal(connectionSummary,t('ws.settings.connectionOne',{n:1}),'One active connection must use singular copy in the rendered settings overview');
  await capture(`settings-overview-${theme}-${locale}`);
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
  await buttonText(next('ws.settings.page.skills'),'.wss-nav nav');await ready("!!document.querySelector('.wsd-feature-panel [role=switch]')",'Scoped skill version must load');
  await buttonText(next('ws.skills.review'));await setLocale(locale);
  assert.equal(await evaluate("document.querySelector('.wss-content [role=dialog]').getAttribute('aria-label')"),t('ws.skills.confirmUpdate'));
  await buttonText(t('ws.cancel'),'.wss-content [role=dialog]');await buttonText(t('ws.skills.edit'));
  await ready("!!document.querySelector('.wsd-feature-panel textarea')",'Private skill editor must load');
  await inputValue('.wsd-feature-panel textarea',draft);await setLocale(nextLocale);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel textarea').value"),draft);
  assert.equal(await evaluate("document.querySelector('.wsd-feature-panel textarea').getAttribute('aria-label')"),next('ws.skills.instructions'));
  await settingsFits();await capture(`settings-skill-draft-${theme}-${locale}`);await buttonText(next('ws.cancel'),'.wss-content [role=dialog]');
  await buttonText(next('ws.settings.page.schedules'),'.wss-nav nav');await ready("!!document.querySelector('.wsd-feature-panel [role=switch]')",'Scoped schedule metadata must load');
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
 for(const [language,locale] of [['zh-CN','zh-Hans'],['zh-TW','zh-Hant'],['en-US','en']]){
  await setSystemLanguage(language);await navigate({scenario:'native-settings',locale:'system'});
  assert.equal(await evaluate("document.querySelector('.wsd-app').lang"),locale);
  assert.equal(await evaluate("localStorage.getItem('hara.locale')"),null,'A default system locale must not become a persisted manual choice');
  await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'System-language settings must mount');
  await buttonText(makeT(locale)('ws.settings.page.appearance'),'.wss-nav nav');
  assert.equal(await evaluate("document.querySelector('.wss-page-card>label select').value"),'system');
  await capture(`system-language-${locale}`);receipts.push({systemLanguage:language,resolvedLocale:locale,defaultPreference:'system'});
 }
 await selectValue('.wss-page-card>label select','zh-Hant');
 await setSystemLanguage('zh-CN');assert.equal(await evaluate("document.querySelector('.wss-app').lang"),'zh-Hant','Manual choice ignores a system language change');
 await navigate({scenario:'native-settings',locale:'saved'});
 assert.equal(await evaluate("document.querySelector('.wsd-app').lang"),'zh-Hant','Manual choice survives a reload');
 await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Language preference draft')");
 await click('.hs-set');await ready("!!document.querySelector('.wss-nav nav')",'Saved-language settings must mount');
 await buttonText(makeT('zh-Hant')('ws.settings.page.appearance'),'.wss-nav nav');
 assert.equal(await evaluate("document.querySelector('.wss-page-card>label select').value"),'zh-Hant');
 await selectValue('.wss-page-card>label select','system');assert.equal(await evaluate("document.querySelector('.wss-app').lang"),'zh-Hans');
 await setSystemLanguage('en-US');assert.equal(await evaluate("document.querySelector('.wss-app').lang"),'en','System mode reacts to a language change');
 assert.equal(await evaluate("document.querySelector('.wss-page-card>label select').value"),'system');
 await capture('system-language-manual-and-resume');await click('.wss-back');
 assert.equal(await evaluate("document.querySelector('textarea').value"),'Language preference draft');
 receipts.push({languagePreference:'manual persists across reload and system change; returning to system is reactive; draft retained'});
 for(const theme of ['light','dark']) for(const locale of ['en','zh-Hans','zh-Hant']){
  const t=makeT(locale);await navigate({theme,locale,scenario:'operations'});
  const summaries=await evaluate("Array.from(document.querySelectorAll('.wsd-execution summary')).map(node=>node.textContent)");
  assert.deepEqual(summaries,[`${t('ws.execution.count',{n:3})} · ${t('ws.execution.details')}`,`${t('ws.execution.one')} · ${t('ws.execution.details')}`]);
  assert.equal(await evaluate("document.querySelectorAll('.wsd-execution[open]').length"),0);
  await capture(`operations-${theme}-${locale}`);await click('.wsd-execution summary');
  assert.equal(await evaluate("document.querySelectorAll('.wsd-execution[open] pre').length"),3);
  assert.equal(await evaluate("document.querySelector('.wsd-execution[open] pre.is-error').textContent"),'Local result 3');
  assert.equal(await evaluate("document.querySelectorAll('.wsd-execution[open]').length"),1,'A separate operation stays collapsed');
  if(theme==='light'&&locale==='zh-Hans')await capture('operations-expanded-zh-Hans');
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.some(row=>row.method==='workspace.session.send'||row.method==='workspace.approval.respond')"),false);
  receipts.push({theme,locale,operations:'three adjacent calls form one row; result order/error retained; next user turn stays separate'});
 }
 }
 for(const theme of ['light','dark'])for(const locale of ['en','zh-Hans','zh-Hant']){
  const t=makeT(locale),name=`Local planning ${locale}`;
  await navigate({theme,locale,scenario:'channels'});
  await ready(`!!document.querySelector(${JSON.stringify(`.hs-sec-a[aria-label=${JSON.stringify(t('ws.channels.new'))}]:not(:disabled)`)})`,'Local channel capability must be ready');
  await click(`.hs-sec-a[aria-label=${JSON.stringify(t('ws.channels.new'))}]`);
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-choices input[type=checkbox]').length"),13);
  await inputValue(`.hs-channel-dialog input[aria-label=${JSON.stringify(t('ws.channels.name'))}]`,name);
  await buttonText(t('ws.channels.all'),'.hs-channel-dialog');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-choices input:checked').length"),13);
  await inputValue('.hs-channel-dialog input[type=search]','  qa  ');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-choice').length"),1);
  await inputValue('.hs-channel-dialog input[type=search]','no matching colleague');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-choice').length"),0);
  assert.equal(await evaluate("document.querySelector('.hs-channel-search-empty[role=status]').textContent"),t('ws.search.empty'));
  assert.ok(await evaluate(`document.querySelector('.hs-channel-picker-actions').textContent.includes(${JSON.stringify(t('ws.channels.memberCount',{n:13}))})`),'Searching does not change selected members');
  await inputValue('.hs-channel-dialog input[type=search]','');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-choices input:checked').length"),13);
  await send('Emulation.setDeviceMetricsOverride',{width:1000,height:600,deviceScaleFactor:1,mobile:false});await settled();
  const shortDialog=await evaluate("(()=>{const d=document.querySelector('.hs-channel-dialog'),f=d.querySelector('.hs-channel-dialog-footer'),r=f.getBoundingClientRect(),note=f.querySelector('p').getBoundingClientRect(),body=d.querySelector('.hs-channel-dialog-body');return {top:r.top,bottom:r.bottom,noteBottom:note.bottom,bodyScrollable:body.scrollHeight>body.clientHeight,outerScrollable:d.scrollHeight>d.clientHeight+1};})()");
  assert.ok(shortDialog.top>=0&&shortDialog.bottom<=600&&shortDialog.noteBottom<=600&&!shortDialog.outerScrollable,JSON.stringify(shortDialog));
  assert.equal(shortDialog.bodyScrollable,true,'The member form scrolls while the save button and local-storage note remain visible');
  await capture(`channel-create-short-${locale}-${theme}`);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await settled();
  const dialogSize=await evaluate("(()=>{const d=document.querySelector('.hs-channel-dialog'),r=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,scroll:d.scrollHeight,client:d.clientHeight,choices:getComputedStyle(d.querySelector('.hs-channel-choice')).display};})()");
  assert.ok(dialogSize.top>=0&&dialogSize.bottom<=800&&dialogSize.width<=1280,JSON.stringify(dialogSize));assert.equal(dialogSize.choices,'flex');
  const createColors=await contrast();assert.deepEqual(createColors.issues,[],`${theme}/${locale} channel creation contrast`);
  await capture(`channel-create-${locale}-${theme}`);await buttonText(t('ws.channels.new'),'.hs-channel-dialog');
  await ready("!!document.querySelector('.hs-channel-compose textarea')",'Created local channel must open');
  const channelId=await evaluate("document.querySelector('[data-local-channel]').dataset.localChannel");
  await inputValue('.hs-channel-compose textarea','Discuss this plan.');await click('.hs-channel-compose .hs-send');
  await ready("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length===13&&!document.querySelector('.hs-channel-thread .wsd-typing')",'All 13 selected colleagues must reply exactly once');
  assert.equal(await evaluate("document.querySelectorAll('[data-channel-speaker=user]').length"),1);
  assert.equal(await evaluate("document.querySelector('.hs-channel-thread').textContent.includes('PRIVATE_DM_ONLY')"),false);
  const colors=await contrast();assert.deepEqual(colors.issues,[],`${theme}/${locale} channel transcript contrast`);
  await capture(`channel-chat-${locale}-${theme}`);
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients>summary').textContent"),t('ws.channels.replyAll',{n:13}));
  await click('.hs-channel-recipients>summary');
  await inputValue('.hs-channel-recipients input[type=search]','  qa  ');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-recipient').length"),1);
  await capture(`channel-recipients-${locale}-${theme}`);
  await click('.hs-channel-recipient input');
  await inputValue('.hs-channel-recipients input[type=search]','no matching colleague');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-recipient').length"),0);
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients .hs-channel-search-empty[role=status]').textContent"),t('ws.search.empty'));
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients>summary').textContent"),t('ws.channels.replyCount',{n:12}));
  await inputValue('.hs-channel-recipients input[type=search]','');
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-recipient input:checked').length"),12,'Search keeps hidden recipients and a deliberate checkbox change');
  await buttonText(t('ws.channels.all'),'.hs-channel-recipients fieldset');await click('.hs-channel-recipients>summary');
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients>summary').textContent"),t('ws.channels.replyAll',{n:13}));
  await send('Emulation.setDeviceMetricsOverride',{width:1480,height:800,deviceScaleFactor:1,mobile:false});await settled();
  await click(`.hs-head [aria-label=${JSON.stringify(t('ws.header.browser'))}]`);
  const roomyPreviewClose=`#workspace-browser-panel [aria-label=${JSON.stringify(t('ws.browser.close'))}]`;
  await ready(`!!document.querySelector(${JSON.stringify(roomyPreviewClose)})`,'Channel preview must mount beside the chat');await settled();
  const headerLayout=await evaluate("(()=>{const h=document.querySelector('.hs-head').getBoundingClientRect(),p=document.querySelector('.hs-browser').getBoundingClientRect(),c=document.querySelector('.hs-chat').getBoundingClientRect();return {chatWidth:c.width,chatRight:c.right,panelLeft:p.left,controls:[...document.querySelectorAll('.hs-head button')].map(n=>{const r=n.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom}}),header:{left:h.left,right:h.right,top:h.top,bottom:h.bottom},actionFont:getComputedStyle(document.querySelector('.hs-channel-header-actions button')).fontSize,body:document.documentElement.scrollWidth};})()");
  assert.ok(headerLayout.panelLeft>=headerLayout.chatRight&&headerLayout.body<=1480,JSON.stringify(headerLayout));
  for(const control of headerLayout.controls)assert.ok(control.height>=32&&control.height<=40&&control.left>=headerLayout.header.left&&control.right<=headerLayout.header.right&&control.top>=headerLayout.header.top&&control.bottom<=headerLayout.header.bottom,JSON.stringify(headerLayout));
  if(headerLayout.chatWidth<=700)assert.equal(headerLayout.actionFont,'0px');
  await capture(`channel-browser-${locale}-${theme}`);await click(roomyPreviewClose);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await settled();
  await inputValue('.hs-channel-compose textarea','channel draft preserved');await click('.hs-set');await key('Escape');
  assert.equal(await evaluate("document.querySelector('.hs-channel-compose textarea').value"),'channel draft preserved');
  await click('.hs-main');await ready("!!document.querySelector('.wsd-composer textarea')",'Main chat must remain separate');
  await inputValue('.wsd-composer textarea','PRIVATE_DM_ONLY');await click(`[data-channel-id=${JSON.stringify(channelId)}]`);
  await ready("!!document.querySelector('.hs-channel-compose textarea')",'Channel must reopen after main chat');
  assert.equal(await evaluate("document.querySelector('.hs-channel-compose textarea').value"),'channel draft preserved');
  assert.equal(await evaluate("document.querySelector('.hs-channel-thread').textContent.includes('PRIVATE_DM_ONLY')"),false);
  await click(`.hs-channel-header-actions [aria-label=${JSON.stringify(t('ws.channels.invite'))}]`);
  assert.ok(await evaluate(`document.querySelector('[role=dialog]').textContent.includes(${JSON.stringify(t('ws.channels.inviteBody'))})`));
  assert.equal(await evaluate("!!document.querySelector('[role=dialog] input,[role=dialog] a')"),false);await key('Escape');
  if(locale==='zh-Hans'&&theme==='light'){
   await click('.hs-channel-recipients>summary');await buttonText(t('ws.channels.notesOnly'),'.hs-channel-recipients fieldset');await click('.hs-channel-recipient input');await click('.hs-channel-recipients>summary');
   await click('.hs-set');await key('Escape');
   assert.equal(await evaluate(`document.querySelector('.hs-channel-recipients>summary').textContent`),t('ws.channels.replyCount',{n:1}),'Settings cannot widen the selected recipients');
   await inputValue('.hs-channel-compose textarea','one chosen before membership update');await click('.hs-channel-compose .hs-send');
   await ready("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length===14&&!document.querySelector('.hs-channel-thread .wsd-typing')",'Only the one chosen colleague must reply');
   assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').at(-1).params.recipientIds.length"),1);
   await click(`.hs-channel-header-actions [aria-label=${JSON.stringify(t('ws.channels.members'))}]`);
   await buttonText(t('ws.channels.none'),'.hs-channel-dialog');await click('.hs-channel-choices input');
   await buttonText(t('ws.channels.save'),'.hs-channel-dialog');await ready("!document.querySelector('[role=dialog]')",'Membership update must save');
   assert.equal(await evaluate("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length"),14,'Removing colleagues keeps original messages');
   await inputValue('.hs-channel-compose textarea','one selected colleague');await click('.hs-channel-compose .hs-send');
   await ready("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length===15&&!document.querySelector('.hs-channel-thread .wsd-typing')",'Only the remaining selected colleague replies');
   await click('.hs-channel-recipients>summary');await buttonText(t('ws.channels.notesOnly'),'.hs-channel-recipients fieldset');await click('.hs-channel-recipients>summary');
   await inputValue('.hs-channel-compose textarea','local note without AI');await click('.hs-channel-compose .hs-send');await ready("document.querySelectorAll('[data-channel-speaker=user]').length===4",'Notes-only send must be stored');
   assert.equal(await evaluate("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length"),15);
   assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').at(-1).params.recipientIds.length"),0);
   await click('.hs-channel-recipients>summary');await buttonText(t('ws.channels.all'),'.hs-channel-recipients fieldset');await click('.hs-channel-recipients>summary');
   await evaluate("window.__HARA_SHELL_FIXTURE__.channelLoseAck()");await inputValue('.hs-channel-compose textarea','exactly once after lost ACK');await click('.hs-channel-compose .hs-send');
   await ready(`Array.from(document.querySelectorAll('.hs-channel-compose button')).some(node=>node.textContent===${JSON.stringify(t('ws.composer.verify'))})`,'Lost channel ACK must offer read-only verification');
   const sentBeforeVerify=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').length");
   await buttonText(t('ws.composer.verify'),'.hs-channel-compose');
   await ready("!!document.querySelector('.hs-channel-compose .hs-send')&&!document.querySelector('.hs-channel-thread .wsd-typing')",'Original channel receipt must settle');
   assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').length"),sentBeforeVerify);
   await evaluate("window.__HARA_SHELL_FIXTURE__.channelSlow(true)");await inputValue('.hs-channel-compose textarea','stop queued replies');await click('.hs-channel-compose .hs-send');
   await ready("!!document.querySelector('.hs-channel-compose .hs-stop')",'Active channel must offer stop');await click('.hs-channel-compose .hs-stop');
   await ready("!!document.querySelector('.hs-channel-compose .hs-send')&&!document.querySelector('.hs-channel-thread .wsd-typing')",'Stopping a channel must finish without queued replies');
   await evaluate("window.__HARA_SHELL_FIXTURE__.channelSlow(false)");
   await selectValue('.hs-space','B');await ready("document.querySelector('.hs-space').value==='B'&&!document.querySelector('[data-channel-id]')",'Other Workspace cannot show original channels');
   await selectValue('.hs-space','A');await ready(`!!document.querySelector('[data-channel-id="${channelId}"]')`,'Original channel catalog must recover');
   await click(`[data-channel-id=${JSON.stringify(channelId)}]`);await ready("!!document.querySelector('.hs-channel-compose textarea')",'Original channel must open');
   const messageCount=await evaluate("document.querySelectorAll('[data-channel-speaker]').length");
   await evaluate("(()=>{const u=new URL(location.href);u.searchParams.set('reset','0');history.replaceState(null,'',u.href);window.__HARA_RELOAD_MARKER__=true;})()");await send('Page.reload');
   await ready(`!window.__HARA_RELOAD_MARKER__&&!!document.querySelector('.hs-channel-compose textarea')&&document.querySelectorAll('[data-channel-speaker]').length===${messageCount}`,'Local channel history must survive fixture reload in a new document');
   assert.equal(await evaluate("document.querySelectorAll('[data-channel-speaker]').length"),messageCount);
   await send('Emulation.setDeviceMetricsOverride',{width:720,height:800,deviceScaleFactor:1,mobile:false});await settled();
   await click(`.hs-head [aria-label=${JSON.stringify(t('ws.header.browser'))}]`);
   const previewClose=`#workspace-browser-panel [aria-label=${JSON.stringify(t('ws.browser.close'))}]`;
   await ready(`!!document.querySelector(${JSON.stringify(previewClose)})`,'Lazy channel preview must finish mounting beside chat');await settled();
   const measured=await geometry();assert.ok(measured.chat.width>150&&measured.body<=720,JSON.stringify(measured));
   const pane=await evaluate("(()=>{const a=document.querySelector('.hs-chat').getBoundingClientRect(),b=document.querySelector('#workspace-browser-panel').getBoundingClientRect();return {chatRight:a.right,panelLeft:b.left,panelRight:b.right};})()");
   assert.ok(pane.panelLeft>=pane.chatRight&&pane.panelRight<=721,JSON.stringify(pane));await capture('channel-narrow-browser-zh-Hans-light');
   await click(previewClose);
  }
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.some(row=>/workspace\.session\.send|collaboration|account|login/.test(row.method))"),false);
  await click('.hs-channel-recipients>summary');await inputValue('.hs-channel-recipients input[type=search]','QA');
  await click(`.hs-sec-a[aria-label=${JSON.stringify(t('ws.channels.new'))}]`);
  await inputValue(`.hs-channel-dialog input[aria-label=${JSON.stringify(t('ws.channels.name'))}]`,'Local notes');
  await buttonText(t('ws.channels.new'),'.hs-channel-dialog');
  const notesChannelId=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.create').at(-1).params.channelId");
  assert.notEqual(notesChannelId,channelId);
  await ready(`document.querySelector('[data-local-channel]')?.getAttribute('data-local-channel')===${JSON.stringify(notesChannelId)}&&!document.querySelector('[role=dialog]')`,'Creating from an existing channel must open the accepted new room and close its dialog');
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients>summary').textContent"),t('ws.channels.notesOnly'));
  await evaluate("document.querySelector('.hs-channel-recipients').open=true");await settled();
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients .hs-channel-search-empty').textContent"),t('ws.channels.noRecipients'));
  assert.equal(await evaluate("document.querySelectorAll('.hs-channel-recipient').length"),0);
  await capture(`channel-notes-only-${locale}-${theme}`);
  await inputValue('.hs-channel-compose textarea','A local note with no colleague recipient');await click('.hs-channel-compose .hs-send');
  await ready("document.querySelectorAll('[data-channel-speaker=user]').length===1",'The note is saved in its own channel');
  assert.equal(await evaluate("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length"),0);
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').at(-1).params.recipientIds.length"),0);
  await click(`[data-channel-id=${JSON.stringify(channelId)}]`);await ready("!!document.querySelector('.hs-channel-recipients input[type=search]')",'The original populated channel can be reopened');
  assert.equal(await evaluate("document.querySelector('.hs-channel-recipients input[type=search]').value"),'','A different channel does not inherit the recipient search');
  receipts.push({theme,locale,channels:'create with 13 members; short-window footer; member/recipient searches preserve hidden selections; counted replies; side-by-side header; notes-only channel; drafts, DM isolation and invite placeholder verified',shortDialog,headerLayout,colors});
 }
 if(!channelsOnly){
 await navigate({scenario:'partial'});assert.equal(await evaluate("!!document.querySelector('.hs-overview-notice[role=status]')"),true);
 await click('.hs-dm');await ready("!!document.querySelector('[data-overview-incomplete]')",'Incomplete counts must remain visible in colleague conversations');
 await navigate({scenario:'legacy'});await click('.hs-dm');assert.equal(await evaluate("document.querySelectorAll('.hs-msg.cont').length"),0);
 await navigate({scenario:'no-connection'});assert.equal(await evaluate("document.querySelector('.hs-send').disabled"),true);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).opacity"),'1');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.hs-send')).backgroundColor"),'rgb(231, 228, 222)');
 await navigate({scenario:'tasks'});assert.equal(await evaluate('location.hash'),'#colleagues/tasks');
 }
 assert.equal(errors.length,0,JSON.stringify(errors));completed=true;
 writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,receipts,errors},null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({ok:true,checks:receipts.length,screenshots,output})+'\n');
}catch(error){
 console.error(JSON.stringify({step,error:String(error),runtimeErrors:errors,pending:[...pending.values()].map(request=>request.method)}));
 writeFileSync(join(output,'protocol-failure.json'),JSON.stringify({error:String(error),step,errors,pending:[...pending.values()].map(request=>request.method)},null,2)+'\n',{mode:0o600});
 try{await capture('failure');writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),errors,diagnostic:await evaluate('({url:location.href,active:document.activeElement?.outerHTML.slice(0,1500),previewButtons:Array.from(document.querySelectorAll("#workspace-browser-panel button")).map(node=>({label:node.getAttribute("aria-label"),text:node.textContent})),text:document.body.innerText.slice(0,2000)})')},null,2)+'\n',{mode:0o600});}catch{}
 throw error;
}finally{
 try{socket?.close();}catch{}
 for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Browser gate closed'));}pending.clear();
 if(chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),pause(4000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await once(chrome,'exit');}}
 let removed=false;for(let attempt=0;attempt<15;attempt++){try{rmSync(profile,{recursive:true,force:true});removed=true;break;}catch{await pause(100);}}
 writeFileSync(join(output,'cleanup.json'),JSON.stringify({completed,chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRemoved:removed,profile:removed?'removed':profile})+'\n',{mode:0o600});
 if(!removed)throw new Error(`Owned browser profile cleanup incomplete: ${profile}`);
}
