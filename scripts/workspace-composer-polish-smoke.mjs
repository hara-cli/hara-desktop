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
const profile = mkdtempSync(join(scratch, "hara-s4-chrome-"));
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
const inputSelector='.wsd-composer-wrap textarea';
async function capture(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(value.data,'base64'),{mode:0o600});}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
async function key(key,extra={}){const code=({Enter:13,Escape:27,Tab:9,ArrowDown:40,ArrowUp:38,Home:36,End:35})[key]??0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code,...extra});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code,...extra});await settled();}
async function composerContrast(){return evaluate(`(() => {
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true});
 const parse=v=>{c.clearRect(0,0,1,1);c.fillStyle=v;c.fillRect(0,0,1,1);return [...c.getImageData(0,0,1,1).data].map(n=>n/255)};
 const over=(fg,bg)=>[0,1,2].map(i=>fg[i]*fg[3]+bg[i]*(1-fg[3])).concat([1]);
 const bg=n=>{const chain=[];for(let a=n;a;a=a.parentElement)chain.push(parse(getComputedStyle(a).backgroundColor));return chain.reverse().reduce((b,f)=>over(f,b),[1,1,1,1])};
 const lum=v=>v.slice(0,3).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
 const rows=[];const check=(node,fg,label)=>{const b=bg(node),f=over(parse(fg),b),a=lum(f),d=lum(b);rows.push({label,ratio:(Math.max(a,d)+.05)/(Math.min(a,d)+.05)})};
 for(const root of document.querySelectorAll('.hd-header,.wsd-composer-wrap')){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){const e=node.parentElement;if(!node.textContent.trim()||!e.getClientRects().length||getComputedStyle(e).visibility==='hidden'||e.closest('[aria-hidden=true],button:disabled'))continue;check(e,getComputedStyle(e).color,node.textContent.trim())}
 }
 const input=document.querySelector('${inputSelector}');check(input,getComputedStyle(input).color,'input text');check(input,getComputedStyle(input,'::placeholder').color,'placeholder');
 return {min:Math.min(...rows.map(row=>row.ratio)),rows,issues:rows.filter(row=>row.ratio<4.5)};
})()`)}
async function navigate(width,locale,theme,scenario='composer-polish'){
 step=`composer/${width}/${locale}/${theme}`;await send('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false});
 const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario,reset:'1'}).toString();
 const began=Date.now();await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});
 navigationEvents.push({at:Date.now(),method:'fixture-navigation-duration',elapsedMs:Date.now()-began});
 await ready("!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.hd-conversation-capsule') && !!document.querySelector('.wsd-composer-wrap textarea')",'Composer fixture must mount');await settled();
}
try {
 await connect();
 for(const [width,locale,theme] of [[1280,'en','light'],[720,'en','dark'],[720,'zh-Hans','light'],[1280,'zh-Hant','dark']]){
  await navigate(width,locale,theme);
  const geometry=await evaluate(`(() => {const input=document.querySelector('${inputSelector}'),field=input.closest('.hs-field'),header=document.querySelector('.hd-header'),capsule=document.querySelector('.hd-conversation-capsule'),actions=document.querySelector('.hd-header-actions');const r=n=>{const a=n.getBoundingClientRect();return {x:a.x,y:a.y,width:a.width,height:a.height,right:a.right,bottom:a.bottom}};const css=getComputedStyle(input);return {input:r(input),field:r(field),capsule:r(capsule),header:r(header),actions:r(actions),scroll:r(document.querySelector('.hs-scroll')),fontSize:css.fontSize,lineHeight:css.lineHeight,radius:getComputedStyle(field).borderRadius,buttonRadius:getComputedStyle(document.querySelector('.wsd-send')).borderRadius};})()`);
  assert.equal(geometry.capsule.height,34);assert.equal(geometry.field.height,52);assert.equal(geometry.input.height,44);assert.equal(geometry.fontSize,'14px');assert.equal(geometry.lineHeight,'22px');assert.equal(geometry.radius,'22px');
  assert.ok(geometry.capsule.right <= geometry.actions.x-5,'Title and actions must not overlap');assert.ok(geometry.scroll.y <= geometry.header.y+1,'Messages must scroll under the floating header');
  if(width===1280)assert.ok(Math.abs(geometry.capsule.x+geometry.capsule.width/2-(geometry.header.x+geometry.header.width/2))<1,'Capsule is centred within the conversation');
  assert.equal(await evaluate("!!document.querySelector('.hs-stop')"),false);
  const detail=await evaluate("document.getElementById(document.querySelector('.hd-conversation-capsule').getAttribute('aria-describedby'))?.textContent");assert.match(detail,/Pi/);
  await evaluate("document.querySelector('.hd-conversation-capsule').focus()");let skipTabSteps=0;
  while(skipTabSteps<8 && !await evaluate("document.activeElement?.classList.contains('hd-skip-composer')")){await key('Tab');skipTabSteps++;}
  assert.ok(await evaluate("document.activeElement?.classList.contains('hd-skip-composer')"),'Real Tab from the header reaches the skip link before message actions');await settled();
  assert.ok(await evaluate("document.querySelector('.hd-skip-composer').getBoundingClientRect().width>100"));await key('Enter');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${inputSelector}')`),true);assert.equal(await evaluate('location.hash'),'','Skip link must not change the conversation route');
  await click('.hd-composer-plus');await ready("document.activeElement?.getAttribute('role')==='menuitem'",'The first quick action receives focus');
  const contrast=await composerContrast();assert.deepEqual(contrast.issues,[]);
  await key('ArrowDown');assert.match(await evaluate('document.activeElement.textContent'),new RegExp(redesignText(locale,'mention')));
  await key('Escape');assert.equal(await evaluate("!!document.querySelector('.hd-composer-menu')"),false);assert.equal(await evaluate("document.activeElement.className"),'hd-composer-plus');
  await click('.hd-composer-plus');await click('.hd-composer-menu button:last-child');await ready("!!document.querySelector('.hd-mention-menu')",'Existing mention menu remains reachable');await key('Escape');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${inputSelector}')`),true);
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Preserve my draft')");await settled();
  const sendsBefore=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.send').length");
  await evaluate(`document.querySelector('${inputSelector}').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,isComposing:true}))`);await settled();
  assert.equal(await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.send').length"),sendsBefore,'Composing Enter cannot send');
  const multiline=Array.from({length:9},(_,i)=>'Line '+i+' '+ 'draft '.repeat(12)).join('\n');
  await evaluate(`window.__HARA_SHELL_FIXTURE__.model.setDraft(${JSON.stringify(multiline)})`);await settled();
  await evaluate(`(() => {const input=document.querySelector('${inputSelector}');input.focus();input.setSelectionRange(4,9)})()`);
  const draft=await evaluate(`document.querySelector('${inputSelector}').value`);assert.equal(draft.split('\n').length,9);
  const tall=await evaluate(`({height:document.querySelector('${inputSelector}').getBoundingClientRect().height,overflow:getComputedStyle(document.querySelector('${inputSelector}')).overflowY})`);
  assert.equal(tall.height,154);assert.equal(tall.overflow,'auto');
  await send('Emulation.setDeviceMetricsOverride',{width:width===1280?900:800,height:860,deviceScaleFactor:1,mobile:false});await settled();
  assert.equal(await evaluate(`document.querySelector('${inputSelector}').value`),draft);assert.equal(await evaluate(`document.querySelector('${inputSelector}').selectionStart`),4);
  await send('Emulation.setDeviceMetricsOverride',{width,height:860,deviceScaleFactor:1,mobile:false});await settled();
  await evaluate("window.__HARA_SHELL_FIXTURE__.composerState('running')");await settled();await evaluate("window.__HARA_SHELL_FIXTURE__.incoming('main','Synthetic streaming completion does not take keyboard focus.')");await settled();
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${inputSelector}')`),true);assert.equal(await evaluate(`document.querySelector('${inputSelector}').selectionStart`),4);assert.equal(await evaluate(`document.querySelector('${inputSelector}').value`),draft);
  assert.equal(await evaluate("document.querySelector('.wsd-send').disabled"),true);assert.equal(await evaluate("!!document.querySelector('.hs-stop:not(:disabled)')"),true);
  await capture(`s4-running-${locale}-${theme}-${width}`);
  await click('.hs-stop');await ready("!document.querySelector('.hs-stop')",'Stopping the selected run removes only its stop action');
  const cancels=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.cancel').map(row=>row.params)");assert.equal(cancels.length,1);assert.equal(cancels[0].agentId,'main');assert.equal(cancels[0].runId,'run-main');
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-5')");await ready(`document.querySelector('${inputSelector}').value===''`,'Another colleague must have its own draft');
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Other colleague draft');window.__HARA_SHELL_FIXTURE__.model.selectAgent('main')");await ready(`document.querySelector('${inputSelector}').value===${JSON.stringify(draft)}`,'The original conversation draft is restored');
  await click('.hd-conversation-capsule');await ready("!!document.querySelector('#workspace-inspector')",'Clicking identity opens the existing panel');
  assert.equal(await evaluate("document.querySelector('.hd-conversation-capsule').getAttribute('aria-expanded')"),'true');
  if(width<1100){await key('Escape');await ready("!document.querySelector('#workspace-inspector')",'Escape closes the narrow existing panel');}
  else await click('.hd-header-actions button[aria-controls="workspace-inspector"]');
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Synthetic Enter sends once')");await settled();await evaluate(`document.querySelector('${inputSelector}').focus()`);await key('Enter');
  await ready("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.session.send').length===1",'Normal Enter submits exactly once');
  await ready(`document.querySelector('${inputSelector}').value===''`,'Only accepted send clears its own draft');
  await capture(`s4-${locale}-${theme}-${width}`);receipts.push({width,locale,theme,geometry,tall,contrast,skipTabSteps,detail,imeSendCount:sendsBefore,cancels,focus:'Running-turn updates and width changes preserved focus and selection; quick-menu Escape restored focus',draft:'Switching colleagues restores the exact draft; accepted Enter clears only that draft'});
 }

 for(const theme of ['light','dark']){
  step=`group-composer/${theme}`;await navigate(900,'en',theme);
  await evaluate(`(async()=>{const f=window.__HARA_SHELL_FIXTURE__;await f.model.workspaceRequest('workspace.channels.create',{channelId:'44444444-4444-4444-4444-444444444444',name:'Composer group',memberIds:['person-0','person-1']});await f.model.refresh();location.hash='#channels/44444444-4444-4444-4444-444444444444'})()`);
  await ready("!!document.querySelector('.hs-channel-compose textarea')",'Existing group composer must mount');await settled();
  const field=await evaluate("({height:document.querySelector('.hd-channel-composer').getBoundingClientRect().height,inputHeight:document.querySelector('.hs-channel-compose textarea').getBoundingClientRect().height})");assert.equal(field.height,52);assert.equal(field.inputHeight,44);
  await evaluate("window.__HARA_SHELL_FIXTURE__.channelSlow(true)");
  await evaluate(`(() => {const input=document.querySelector('.hs-channel-compose textarea'),set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(input,'Synthetic group question');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settled();
  await click('.hs-channel-compose .hs-send');await ready("!!document.querySelector('.hs-channel-compose .hs-stop')",'Group run keeps its own stop action');
  assert.equal(await evaluate("document.querySelector('.hs-channel-compose .hs-send').disabled"),true,'Without a queue contract, busy group send remains disabled');
  await capture(`44444444-4444-4444-4444-444444444444-running-${theme}`);await click('.hs-channel-compose .hs-stop');await ready("!document.querySelector('.hs-channel-compose .hs-stop')",'Only the selected group is cancelled');
  const cancels=await evaluate("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.cancel').map(row=>row.params)");assert.equal(cancels.length,1);assert.equal(cancels[0].channelId,'44444444-4444-4444-4444-444444444444');
  const groupDraft=Array.from({length:9},(_,index)=>'Group draft '+index).join(String.fromCharCode(10));assert.equal(groupDraft.split(String.fromCharCode(10)).length,9);
  await evaluate(`(() => {const input=document.querySelector('.hs-channel-compose textarea'),set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(input,${JSON.stringify(groupDraft)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settled();
  await evaluate("location.hash=''");await ready("!!document.querySelector('.wsd-composer-wrap textarea')",'Return to private chat');
  await evaluate("location.hash='#channels/44444444-4444-4444-4444-444444444444'");await ready("!!document.querySelector('.hs-channel-compose textarea')",'Reopen the same group');await settled();
  assert.equal(await evaluate("document.querySelector('.hs-channel-compose textarea').value"),groupDraft);assert.equal(await evaluate("document.querySelector('.hs-channel-compose textarea').getBoundingClientRect().height"),154,'A restored group draft is sized after its textarea mounts');
  receipts.push({group:true,theme,field,cancels});
 }

 for(const theme of ['light','dark']){
  step=`valid-preview/${theme}`;await send('Emulation.setDeviceMetricsOverride',{width:900,height:860,deviceScaleFactor:1,mobile:false});
  const url=new URL('test/fixtures/workspace-composer-stream-preview.html',base);url.search=new URLSearchParams({locale:'en',theme}).toString();
  await navigateCdp(send,socket,{url:url.href,sessionId,step});await ready("!!window.__HARA_STREAM_FIXTURE__ && !!document.querySelector('.wsd-composer-wrap textarea')",'Strict-identity stream fixture must mount');
  await evaluate("window.__HARA_STREAM_FIXTURE__.model.setDraft('Synthetic preview request')");await settled();await click('.wsd-send');
  await ready("!!document.querySelector('.hs-stop')",'Synthetic streaming run must be active');
  await evaluate("window.__HARA_STREAM_FIXTURE__.model.setDraft('Draft while streaming')");await settled();
  await evaluate(`(() => {const input=document.querySelector('${inputSelector}');input.focus();input.setSelectionRange(3,7)})()`);
  assert.equal(await evaluate(`document.querySelector('${inputSelector}').selectionStart`),3,'Selection is established after the controlled value renders');
  await evaluate("window.__HARA_STREAM_FIXTURE__.emit('Synthetic preview')");await settled();await evaluate("window.__HARA_STREAM_FIXTURE__.emit('Synthetic preview delta')");await settled();
  assert.equal(await evaluate("window.__HARA_STREAM_FIXTURE__.model.getAssistantPreviewSnapshot()?.seq"),2,'The real preview parser admitted both frames');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${inputSelector}')`),true);assert.equal(await evaluate(`document.querySelector('${inputSelector}').selectionStart`),3);assert.equal(await evaluate(`document.querySelector('${inputSelector}').selectionEnd`),7);
  assert.equal(await evaluate(`document.querySelector('${inputSelector}').value`),'Draft while streaming');
  assert.match(await evaluate("document.querySelector('.wsd-thread').textContent"),/Synthetic preview delta/);
  await capture(`s4-streaming-${theme}`);receipts.push({stream:true,theme,acceptedFrames:2,focusPreserved:true,selection:[3,7],modelCalls:0});
 }
 await navigate(720,'en','light','no-connection');
 assert.equal(await evaluate("document.querySelector('.wsd-composer-wrap textarea').disabled"),true);assert.equal(await evaluate("!!document.querySelector('.hd-skip-composer')"),false,'No dead skip link when the input is disabled');
 await capture('s4-disabled-input');receipts.push({disabledComposer:true,deadSkipLink:false});
 assert.deepEqual(errors,[]);writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,modelCalls:0,receipts,errors,navigationTimings:navigationEvents.filter(event=>event.method==='fixture-navigation-duration')},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,navigationEvents,page:await evaluate('({url:location.href,text:document.body.innerText})').catch(()=>null)},null,2)+'\n',{mode:0o600});await capture('failure').catch(()=>{});throw error;
}finally{try{socket?.close()}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Composer browser gate closed'));}pending.clear();await stopOwnedBrowser(chrome);writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});}
