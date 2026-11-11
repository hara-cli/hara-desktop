#!/usr/bin/env node
// Real Workspace React components, in a task-owned headless Chrome profile with synthetic RPC only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeT } from "../src/i18n.ts";
import { redesignText } from "../src/desktop-redesign-copy.ts";
import { waitForLayout } from "./browser-layout-wait.mjs";
import { requestCdp } from "./browser-cdp-request.mjs";
import { navigateCdp } from "./browser-cdp-navigation.mjs";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "./browser-process.mjs";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if(base.protocol!=="http:" || base.hostname!=="127.0.0.1" || base.pathname!=="/" || base.username || base.password || base.search || base.hash)throw new Error("Use a task-owned IPv4 loopback Vite root");
if(!process.argv[3])throw new Error("An explicit evidence directory is required");
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true,mode:0o700});
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((value) => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium is required for the component browser gate");
if (!process.argv[4]) throw new Error("An explicit task scratch directory is required");
const scratch = resolve(process.argv[4]); mkdirSync(scratch, {recursive:true});
const profile = mkdtempSync(join(scratch, "hara-s6-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--no-proxy-server", "--use-mock-keychain", "--password-store=basic", "--disable-background-mode", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--no-default-browser-check", "--no-first-run",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
let requestId = 0;
let sessionId;
let browserUserAgent;
let step = 'connect';
let browserStderrBytes = 0, browserReadySeen = false;
const errors = [];
const navigationEvents = [];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function connect() {
  const url = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Headless Chrome startup timed out")), 15000);
    chrome.stderr.on("data", (chunk) => {
      browserStderrBytes += chunk.length;
      const announcement = readDevToolsAnnouncement(text, chunk); text = announcement.tail;
      if (announcement.url) { browserReadySeen = true; clearTimeout(timer); done(announcement.url); }
    });
    chrome.once("error", (error) => { clearTimeout(timer); fail(error); });
    chrome.once("exit", () => { clearTimeout(timer); fail(new Error("Headless Chrome exited before ready")); });
  });
  socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  socket.addEventListener("message", ({data}) => {
    const message = JSON.parse(data);
    if (['Page.frameNavigated','Page.lifecycleEvent','Network.loadingFailed','Network.responseReceived'].includes(message.method)) {
      const params = message.params ?? {}, response = params.response;
      let localPath; try { const url = new URL(response?.url ?? params.frame?.url ?? 'about:blank'); if (url.hostname === '127.0.0.1') localPath = url.pathname; } catch {}
      navigationEvents.push({at:Date.now(),method:message.method,name:params.name,frameId:params.frame?.id??params.frameId,loaderId:params.frame?.loaderId??params.loaderId,status:response?.status,path:localPath,error:params.errorText});
      if(navigationEvents.length>100)navigationEvents.shift();
    }
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
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Page.setLifecycleEventsEnabled", { enabled: true });
  const version = await send("Browser.getVersion", {}, false);
  browserUserAgent = version.userAgent;
  await send("Emulation.setUserAgentOverride", { userAgent: version.userAgent, platform: "MacIntel" });
}
function send(method, params = {}, scoped = true) {
  return requestCdp(socket, pending, { id: ++requestId, method, params, sessionId: scoped ? sessionId : undefined, step, timeoutMs: method === "Page.navigate" && receipts.length === 0 ? 30000 : 15000 });
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



const receipts=[];
const knownSystem={reduceTransparency:false,increaseContrast:false,reduceMotion:false,lowPowerMode:false};
const unknownSystem={reduceTransparency:null,increaseContrast:null,reduceMotion:null,lowPowerMode:null};
async function capture(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(value.data,'base64'),{mode:0o600});}
async function click(selector,text){const point=await evaluate(`(()=>{const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>${JSON.stringify(text)}===undefined||node.textContent.trim()===${JSON.stringify(text)});if(!n)throw new Error('Control missing');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();if(!r.width||!r.height||!n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('Control obstructed');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});await settled();}
async function key(key){const code=({Escape:27,Tab:9})[key]??0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});await settled();}
async function visuals(mode,transparency='standard',system=knownSystem,motion='standard'){await evaluate(`window.__HARA_SHELL_FIXTURE__.glassVisuals(${JSON.stringify({darkTheme:mode==='obsidian'?'obsidian':'violet-glass',transparency,motion})},${JSON.stringify(system)})`);await settled();}
async function measure(){return evaluate(`(()=>{const get=(n,pseudo)=>getComputedStyle(n,pseudo),win=document.querySelector('.hs-win'),chat=document.querySelector('.hs-chat'),side=document.querySelector('.hd-sidebar'),cap=document.querySelector('.hd-conversation-capsule'),field=document.querySelector('.wsd-composer'),block=document.querySelector('.is-agent .hs-bub');
 const blurred=[...document.querySelectorAll('body *')].filter(n=>{const f=get(n).backdropFilter||get(n).webkitBackdropFilter||'',start=f.indexOf('blur(');return n.getClientRects().length&&get(n).visibility!=='hidden'&&start>=0&&parseFloat(f.slice(start+5))>0}).map(n=>({tag:n.tagName,classes:String(n.className),filter:get(n).backdropFilter||get(n).webkitBackdropFilter}));
 return {dataset:{...document.documentElement.dataset},windowImage:get(win).backgroundImage,windowColor:get(win).backgroundColor,side:get(side).backgroundColor,sideFilter:get(side).backdropFilter,read:get(chat).backgroundColor,inset:get(chat).margin,radius:get(chat).borderRadius,cap:get(cap).backgroundColor,capFilter:get(cap).backdropFilter,composer:get(field).backgroundColor,composerFilter:get(field).backdropFilter,placeholder:get(document.querySelector('.wsd-composer textarea'),'::placeholder')?.color,block:block?get(block).backgroundColor:null,expectedBlock:get(win).getPropertyValue('--hara-assistant-surface').trim(),blurred,saved:localStorage.getItem('hara.violet-appearance.v1')};})()`)}
function assertLayerCount(row,count){assert.equal(row.blurred.length,count,JSON.stringify(row));if(count===2){assert.ok(row.blurred.some(n=>String(n.classes).includes('hd-conversation-capsule')));assert.ok(row.blurred.some(n=>String(n.classes).includes('wsd-composer')));}}
async function media(overrides={}){const values={'prefers-reduced-motion':'no-preference','prefers-reduced-transparency':'no-preference','prefers-contrast':'no-preference','forced-colors':'none',...overrides};await send('Emulation.setEmulatedMedia',{features:Object.entries(values).map(([name,value])=>({name,value}))});}
async function navigate(mode,width=1280,height=760,locale='en',scenario='glass-polish'){step=`glass/${mode}/${width}x${height}/${locale}`;await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await media();const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme:mode==='light'?'light':'dark',visual:mode,scenario,material:'standard',reset:'1'}).toString();await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});await ready(scenario==='glass-welcome'?"!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.wsd-welcome img.hara-mascot')":"!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.wsd-composer textarea') && !!document.querySelector('.is-agent .hs-bub')",'The requested glass fixture must mount');await settled();await visuals(mode);}
async function iris(){return evaluate("(()=>{const a=document.querySelector('.hd-conversation-capsule .hs-ava.is-main'),s=getComputedStyle(a,'::before');return {name:s.animationName,duration:s.animationDuration,state:s.animationPlayState,content:s.content}})()");}
try{
 await connect();
 for(const [mode,width,height,locale]of [['light',1280,760,'en'],['dark',1280,760,'zh-Hans'],['obsidian',720,480,'zh-Hant']]){
  await navigate(mode,width,height,locale);const saved=await evaluate("localStorage.getItem('hara.violet-appearance.v1')");let standard;
  for(const [name,preference,system]of [['standard','standard',knownSystem],['enhanced','enhanced',knownSystem],['off','off',knownSystem],['unknown-system','system',unknownSystem],['known-system','system',knownSystem],['reduced-transparency','enhanced',{...knownSystem,reduceTransparency:true}],['increased-contrast','enhanced',{...knownSystem,increaseContrast:true}]]){
   step=`${mode}/${name}`;await visuals(mode,preference,system);const row=await measure(),solid=['off','unknown-system','reduced-transparency','increased-contrast'].includes(name);assertLayerCount(row,solid?0:2);assert.equal(row.dataset.transparency,solid?'off':preference==='system'?'standard':preference);assert.equal(row.saved,saved,'OS flags are never persisted as user choices');assert.equal(row.inset,'8px');assert.equal(row.radius,'16px');assert.equal(row.sideFilter,'none');
   if(solid){assert.equal(row.windowImage,'none');assert.match(row.side,/^rgb\(/);assert.match(row.read,/^rgb\(/);}else{assert.ok(row.windowImage.includes('radial-gradient'));assert.match(row.side,/^rgba\(/);assert.match(row.read,/^rgba\(/);}
   if(name==='standard'){standard=row;await capture(`s6-${mode}-${width}x${height}`);}receipts.push({mode,width,height,locale,case:name,...row,modelCalls:0});
  }
  await visuals(mode);await click('.hd-composer-plus');await ready("!!document.querySelector('.hd-composer-menu')",'Existing transient menu opens');const menu=await measure();assertLayerCount(menu,3);await key('Escape');await ready("!document.querySelector('.hd-composer-menu')",'Menu closes');assertLayerCount(await measure(),2);
  const before=standard.windowImage;await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-0')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspace?.selectedAgentId==='person-0'",'Switch to a colleague');await visuals(mode);assert.equal((await measure()).windowImage,before,'The Hara window never follows a colleague identity');assert.equal(await evaluate("document.querySelectorAll('.hd-identity-aura').length"),0,'A colleague avatar has no identity ring');await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('main')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspace?.selectedAgentId==='main'",'Return to Hara');await visuals(mode);
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Unsent synthetic glass draft')");await settled();await click('.wsd-composer textarea');await evaluate("document.querySelector('.wsd-composer textarea').setSelectionRange(3,9)");const selection=await evaluate("({value:document.querySelector('.wsd-composer textarea').value,start:document.querySelector('.wsd-composer textarea').selectionStart,end:document.querySelector('.wsd-composer textarea').selectionEnd})");assert.equal(selection.start,3);
  await visuals(mode,'standard',{...knownSystem,reduceTransparency:true});assert.deepEqual(await evaluate("({value:document.querySelector('.wsd-composer textarea').value,start:document.querySelector('.wsd-composer textarea').selectionStart,end:document.querySelector('.wsd-composer textarea').selectionEnd})"),selection,'Material changes do not reset a controlled draft or selection');
  await visuals(mode);await evaluate("window.__HARA_SHELL_FIXTURE__.glassWorking(true)");await ready("!!document.querySelector('.hs-stop')",'Observed running state offers Stop');await visuals(mode);const running=await iris();assert.equal(running.name,'hd-hara-iris');assert.equal(running.duration,'8s');
  await visuals(mode,'standard',{...knownSystem,lowPowerMode:true});assert.equal((await iris()).state,'paused');await visuals(mode);await evaluate("window.dispatchEvent(new Event('blur'))");assert.equal((await iris()).state,'paused');await evaluate("window.dispatchEvent(new Event('focus'))");await visuals(mode);
  await visuals(mode,'standard',knownSystem,'reduced');assert.equal((await iris()).name,'none');await visuals(mode);await media({'prefers-reduced-motion':'reduce'});await settled();assert.equal((await iris()).name,'none');await media();await visuals(mode);
  await media({'prefers-reduced-transparency':'reduce'});await settled();assertLayerCount(await measure(),0);await media();await visuals(mode);
  await evaluate("window.__HARA_SHELL_FIXTURE__.glassEmpty(true)");await ready("document.querySelector('.hd-identity-aura[data-hara-empty]')?.dataset.rippleFirst==='true'",'First empty state animates once');const first=await evaluate("getComputedStyle(document.querySelector('.hd-identity-aura[data-hara-empty]'),'::after').animationName");assert.equal(first,'hd-empty-ripple');await ready("!document.querySelector('.hd-identity-aura[data-ripple-first]')",'The first ripple completes and consumes its flag');assert.equal(await evaluate("!!document.querySelector('.hd-conversation-capsule .hd-identity-aura .hs-ava.is-main') && document.querySelectorAll('.hs-hello img.hara-mascot').length===1 && !document.querySelector('.hs-hello .hd-identity-aura')"),true,'The main avatar keeps its ring while the empty-home mascot remains unwrapped');await visuals(mode,'standard',knownSystem,'reduced');await visuals(mode);assert.equal(await evaluate("getComputedStyle(document.querySelector('.hd-identity-aura[data-hara-empty]'),'::after').animationName"),'none','Re-enabling motion never restarts a completed ripple');await evaluate("window.__HARA_SHELL_FIXTURE__.glassEmpty(false)");await ready("!document.querySelector('.hd-identity-aura[data-hara-empty]')",'A nonempty conversation removes the empty aura');await evaluate("window.__HARA_SHELL_FIXTURE__.glassEmpty(true)");await settled();assert.equal(await evaluate("document.querySelector('.hd-identity-aura[data-hara-empty]')?.dataset.rippleFirst??null"),null,'Reopening an empty conversation does not replay the first ripple');
  receipts.push({mode,width,height,locale,case:'interaction',transientMaximum:3,windowAccentIndependent:true,selectionKept:true,iris:running,lowPowerPaused:true,blurPaused:true,reducedMotionStopped:true,cssTransparencyFallback:true,rippleOnce:true,modelCalls:0});
 }
 await navigate('light');await click('.hd-user-area>button[aria-label='+JSON.stringify(makeT('en')('ws.settings'))+']');await ready("!!document.querySelector('.wss-nav nav')",'Real Settings opens');const appearance=makeT('en')('ws.settings.page.appearance');await click('.wss-nav nav button',appearance);await ready("!!document.querySelector('.vg-material-pref')",'Appearance controls mount');const label=makeT('en')('vg.transparency'),follow=makeT('en')('ws.theme.system');await click('[role=group][aria-label='+JSON.stringify(label)+']>button',follow);await settled();assert.equal(await evaluate("JSON.parse(localStorage.getItem('hara.violet-appearance.v1')).transparency"),'system');assert.equal(await evaluate("document.documentElement.dataset.transparency"),'off','A browser with unknown native transparency safely uses solid surfaces');assert.equal(await evaluate("getComputedStyle(document.querySelector('.wss-overlay')).backdropFilter"),'none');receipts.push({mode:'light',case:'real-preference-ui',systemSaved:true,unknownUsesSolid:true,opaqueScrim:true,modelCalls:0});
 for(const [mode,width,height,locale]of [['light',1280,760,'en'],['dark',1280,760,'zh-Hans'],['obsidian',720,480,'zh-Hant']]){
  await navigate(mode,width,height,locale,'glass-welcome');
  await ready("document.querySelector('.wsd-welcome img.hara-mascot')?.complete && document.querySelector('.wsd-welcome img.hara-mascot')?.naturalWidth>0",'The welcome mascot image loads');
  const welcome=await evaluate("(()=>{const node=document.querySelector('.wsd-welcome'),image=node.querySelector('img.hara-mascot'),r=image.getBoundingClientRect();return {mascots:node.querySelectorAll('img.hara-mascot').length,auras:document.querySelectorAll('.hd-identity-aura').length,logos:node.querySelectorAll('svg').length,mascotWidth:r.width,mascotHeight:r.height,alt:image.alt}})()");
  assert.deepEqual(welcome,{mascots:1,auras:0,logos:0,mascotWidth:160,mascotHeight:160,alt:makeT(locale)('ws.mascot.idle')},'Welcome contains only the mascot, without a Logo or iris ring');
  if(height===480){const point=await evaluate("(()=>{const r=document.querySelector('.hs-chat').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom-30}})()");await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:600});await settled();}
  const createAction=await evaluate("(()=>{const button=document.querySelector('.wsd-welcome button'),r=button.getBoundingClientRect();return {withinViewport:r.top>=0&&r.bottom<=innerHeight,hit:button.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))}})()");
  assert.deepEqual(createAction,{withinViewport:true,hit:true},'The welcome create action remains reachable after ordinary scrolling');
  await capture(`s6-welcome-${mode}-${width}x${height}`);receipts.push({mode,width,height,locale,case:'welcome-mascot-only',...welcome,createAction,modelCalls:0});
 }
 assert.deepEqual(errors,[]);writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,modelCalls:0,systemFlags:'synthetic renderer metadata; native bridge compiled separately',receipts,errors},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,metrics:await measure().catch(()=>null),page:await evaluate('({url:location.href,active:document.activeElement?.outerHTML.slice(0,500),dataset:{...document.documentElement.dataset},text:document.body.innerText.slice(0,2500)})').catch(()=>null)},null,2)+'\n',{mode:0o600});await capture('failure').catch(()=>{});throw error;
}finally{try{socket?.close()}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Glass browser gate closed'));}pending.clear();await stopOwnedBrowser(chrome);writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});}
