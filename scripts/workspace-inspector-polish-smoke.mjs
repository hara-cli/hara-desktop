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
const profile = mkdtempSync(join(scratch, "hara-s5-chrome-"));
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
function contrast(foreground,background){const l=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const a=l(foreground),b=l(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}

async function capture(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(value.data,'base64'),{mode:0o600});}
async function pointClick(point){await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await settled();}
async function click(selector){const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing control');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();if(!r.width||!r.height||!node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('Control is hidden or obstructed');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await pointClick(point);}
async function clickText(text){const point=await evaluate(`(()=>{const node=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===${JSON.stringify(text)}&&node.getClientRects().length);if(!node)throw new Error('Missing visible action');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();if(!node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw new Error('Visible action is obstructed');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await pointClick(point);}
async function key(key){const code=({Escape:27,Tab:9,Home:36,End:35,ArrowLeft:37,ArrowRight:39})[key]??0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});await settled();}
async function value(selector,value,tag='select'){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${tag==='select'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('${tag==='select'?'change':'input'}',{bubbles:true}))})()`);await settled();}
const tab=(value)=>`.hd-inspector-tabs [role=tab][aria-controls$="-${value}-panel"]`;
const panel=(value)=>`.hd-inspector-panel[id$="-${value}-panel"]`;
const probeCount=()=>evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>['workspace.runtime.formOptions','workspace.runtime.models','workspace.connection.models'].includes(row.method)).length");
async function currentDraft(){return evaluate("({engine:document.querySelector('.vg-rf-card select')?.value,model:document.querySelectorAll('.vg-rf-card select')[1]?.value,effort:document.querySelectorAll('.vg-rf-card select')[2]?.value})");}
async function openInspector(){await click('.hd-conversation-capsule');await ready("!!document.querySelector('.hd-tabbed-inspector')",'The colleague inspector must open');}
async function navigate(width,height,locale,theme,features){step=`inspector/${width}x${height}/${locale}/${theme}/${features??'ok'}`;await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario:'inspector-polish',reset:'1',...(features?{features}:{})}).toString();await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});await ready("window.__HARA_SHELL_FIXTURE__?.model.getSnapshot().workspace?.selectedAgentId==='person-0' && !!document.querySelector('.hd-conversation-capsule')",'The inspector fixture must mount');await settled();}
try{
 await connect();
 for(const [width,height,locale,theme] of [[1280,760,'en','light'],[720,760,'en','dark'],[1280,760,'zh-Hans','light'],[720,480,'zh-Hant','dark']]){
  await navigate(width,height,locale,theme);const t=makeT(locale),r=key=>redesignText(locale,key);assert.equal(await probeCount(),0);await openInspector();
  await ready("document.querySelector('.hd-inspector-panel:not([hidden])')?.textContent.includes('Synthetic daily review')",'Known schedules must load in Activity');assert.equal(await probeCount(),0,'Activity never mounts the runtime form');assert.equal(await evaluate(`document.querySelector('${tab('activity')}').getAttribute('aria-selected')`),'true');
  const geometry=await evaluate("(()=>{const p=document.querySelector('#workspace-inspector').getBoundingClientRect(),chat=document.querySelector('.hs-chat').getBoundingClientRect(),tabs=document.querySelector('.hd-inspector-tabs').getBoundingClientRect();const heading=getComputedStyle(document.querySelector('.hd-inspector-section h3')),background=getComputedStyle(document.querySelector('#workspace-inspector')).backgroundColor;return {width:p.width,right:p.right,chatRight:chat.right,left:p.left,tabsBottom:tabs.bottom,viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth,headingTopMargin:heading.marginTop,headingWeight:heading.fontWeight,background,foregrounds:[...document.querySelectorAll('.hd-inspector-tabs>button,.hd-inspector-section h3,.hd-inspector-section dt,.hd-inspector-section dd')].map(node=>getComputedStyle(node).color)}})()");assert.equal(geometry.width,300);assert.equal(geometry.headingTopMargin,'0px');assert.equal(geometry.headingWeight,'600');for(const colour of geometry.foregrounds)assert.ok(contrast(colour,geometry.background)>=4.5,'Panel text must meet AA contrast');assert.ok(geometry.right<=width);assert.ok(geometry.tabsBottom<height);assert.equal(geometry.overflow,false);if(width>=1100)assert.ok(geometry.chatRight<=geometry.left+1,'Wide windows reserve a real inspector column');
  assert.equal(await evaluate("document.querySelector('#workspace-inspector').textContent.includes('Other colleague private schedule')"),false);await capture(`s5-activity-${locale}-${theme}-${width}x${height}`);
  await click(tab('activity'));await key('ArrowRight');assert.equal(await evaluate(`document.activeElement.id===document.querySelector('${tab('resources')}').id`),true);assert.equal(await probeCount(),0,'Resources never mounts the runtime form');
  const resources=await evaluate(`document.querySelector('${panel('resources')}').textContent`);for(const text of ['/synthetic/A/person-0','synthetic-review-skill',r('inspectorMemoryUnavailable')])assert.ok(resources.includes(text),text);assert.equal(await evaluate("!!document.querySelector('.vg-rf-card')"),false);
  await capture(`s5-resources-${locale}-${theme}-${width}x${height}`);await key('End');await ready("!!document.querySelector('.vg-rf-card select') && document.querySelectorAll('.vg-rf-card select').length>=3",'Explicit Settings visits load the runtime form');await ready("!document.querySelector('.vg-rf-apply').disabled || document.querySelectorAll('.vg-rf-card select')[2]?.value==='medium'",'The form baseline must settle');const initialMetadataReads=await probeCount();assert.ok([1,2].includes(initialMetadataReads),'The DEV StrictMode fixture replays the mount effect, but never loops');
  await value('.vg-rf-card select','claude');await ready("document.querySelector('.vg-rf-card select')?.value==='claude' && document.querySelectorAll('.vg-rf-card select').length>=3 && !document.querySelectorAll('.vg-rf-card select')[2].disabled",'A new draft engine inventory settles');await value('.vg-rf-card select[aria-label='+JSON.stringify(t('ws.rf.effort'))+']','low');const draft=await currentDraft();assert.equal(draft.engine,'claude');assert.equal(draft.effort,'low');const probes=await probeCount();assert.equal(probes,initialMetadataReads+1);
  await click(tab('resources'));assert.equal(await evaluate(`document.querySelector('${panel('settings')}').inert`),true);assert.equal(await evaluate("document.querySelector('.vg-rf-card').getClientRects().length"),0);await key('Tab');assert.equal(await evaluate("!!document.activeElement.closest('[hidden],[inert]')"),false);await click(tab('resources'));await key('End');assert.deepEqual(await currentDraft(),draft,'Switching tabs keeps the engine, model and effort draft');assert.equal(await probeCount(),probes,'Returning to Settings reuses the mounted form');
  await click(tab('activity'));await clickText(r('inspectorManageSchedules'));await ready("!!document.querySelector('.vg-colleague-schedules')?.closest('details').open",'Manage schedules opens the existing Settings section');assert.equal(await evaluate(`document.activeElement.id===document.querySelector('${tab('settings')}').id`),true);await click('.vg-colleague-actions>button:first-child');await ready("!!document.querySelector('.vg-colleague-edit input')",'Existing schedule editor opens');await value('.vg-colleague-edit input','Unsent synthetic schedule draft','input');await click(tab('resources'));await click(tab('settings'));assert.equal(await evaluate("document.querySelector('.vg-colleague-edit input').value"),'Unsent synthetic schedule draft');assert.deepEqual(await currentDraft(),draft);assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.some(row=>['workspace.runtime.formApply','workspace.schedule.save','workspace.features.update'].includes(row.method))"),false,'Unsent drafts must not write');await capture(`s5-settings-${locale}-${theme}-${width}x${height}`);
  await click('#workspace-inspector>header>button');await ready("!document.querySelector('#workspace-inspector')",'Close dismisses the inspector');assert.equal(await evaluate("document.activeElement?.getAttribute('aria-controls')"),'workspace-inspector');await evaluate("window.__HARA_SHELL_FIXTURE__.inspectorBlocked(true)");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().runtimeBlocked",'A genuine model metadata refresh blocks execution');await clickText(t('ws.runtimeAccess.openInspector'));await ready(`document.querySelector('${tab('settings')}')?.getAttribute('aria-selected')==='true' && !!document.querySelector('.vg-rf-card')`,'The runtime recovery action must go directly to Settings');await evaluate("window.__HARA_SHELL_FIXTURE__.inspectorBlocked(false)");
  await ready("!window.__HARA_SHELL_FIXTURE__.model.getSnapshot().runtimeBlocked && window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspace?.selectedAgentId==='person-0'",'Recovery metadata settles before changing the tab');await click(tab('activity'));
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-1')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspace?.selectedAgentId==='person-1' && !!document.querySelector('.hd-tabbed-inspector')",'Selecting a different colleague creates a fresh scoped panel');assert.equal(await evaluate(`document.querySelector('${tab('activity')}').getAttribute('aria-selected')`),'true');assert.equal(await evaluate("!!document.querySelector('.vg-rf-card')"),false,'The prior colleague form is unmounted at the scope boundary');assert.equal(await evaluate("document.querySelector('#workspace-inspector').textContent.includes('Unsent synthetic schedule draft')"),false);
  const probesBeforeReturn=await probeCount();await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-0')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().workspace?.selectedAgentId==='person-0' && !!document.querySelector('.hd-tabbed-inspector')",'Returning to the same colleague remounts within the same workspace scope');await settled();
  assert.equal(await evaluate(`document.querySelector('${tab('activity')}').getAttribute('aria-selected')`),'true','A consumed recovery request cannot pull a remounted inspector back to Settings');assert.equal(await evaluate("!!document.querySelector('.vg-rf-card')"),false,'A consumed request cannot probe the runtime inventory again');assert.equal(await probeCount(),probesBeforeReturn);
  if(width<1100){await click('#workspace-inspector>header>button');await ready("!document.querySelector('#workspace-inspector')",'Close the narrow overlay before using an action behind it');}
  await evaluate("window.__HARA_SHELL_FIXTURE__.inspectorBlocked(true)");await ready("!!window.__HARA_SHELL_FIXTURE__.model.getSnapshot().runtimeBlocked",'A later independent recovery request becomes available');await clickText(t('ws.runtimeAccess.openInspector'));await ready(`document.querySelector('${tab('settings')}')?.getAttribute('aria-selected')==='true' && !!document.querySelector('.vg-rf-card')`,'Consuming the first request must not suppress a later request');await evaluate("window.__HARA_SHELL_FIXTURE__.inspectorBlocked(false)");
  receipts.push({width,height,locale,theme,geometry,defaultProbes:0,initialMetadataReads,draft,tabSwitchProbes:probes,settingsDraftKept:true,scheduleDraftKept:true,recoveryOpenedSettings:true,scopeReset:true,recoveryRequestConsumed:true,returnProbes:probesBeforeReturn,repeatRecoveryOpenedSettings:true,modelCalls:0});
 }
 await navigate(720,480,'en','light','failed');await openInspector();await ready("!!document.querySelector('.hd-inspector-panel:not([hidden]) [role=alert]')",'Feature read failures remain visible');assert.equal(await evaluate("document.querySelector('.hd-inspector-panel:not([hidden])').textContent.includes('No schedules for')"),false);assert.equal(await evaluate("!!document.querySelector('.hd-inspector-section h3 small')"),false,'Unknown schedule count is absent');await evaluate("window.__HARA_SHELL_FIXTURE__.setFailure('workspace.features.list',false)");await clickText(redesignText('en','retry'));await ready("document.querySelector('.hd-inspector-panel:not([hidden])').textContent.includes('Synthetic daily review')",'Explicit metadata retry restores the known list');receipts.push({width:720,height:480,locale:'en',theme:'light',failedFeaturesRecovered:true,unknownCountAbsent:true,modelCalls:0});
 assert.deepEqual(errors,[]);writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,modelCalls:0,receipts,errors},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,page:await evaluate('({url:location.href,active:document.activeElement?.outerHTML.slice(0,500),text:document.body.innerText.slice(0,3000)})').catch(()=>null)},null,2)+'\n',{mode:0o600});await capture('failure').catch(()=>{});throw error;
}finally{try{socket?.close()}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Inspector browser gate closed'));}pending.clear();await stopOwnedBrowser(chrome);writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});}
