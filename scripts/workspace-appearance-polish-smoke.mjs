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
const profile = mkdtempSync(join(scratch, "hara-s2-chrome-"));
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
async function capture(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(value.data,'base64'),{mode:0o600});}
async function click(selector){const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Missing control');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();if(!r.width||!r.height)throw new Error('Control is hidden');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await settled();}
async function key(key,extra={}){const code=({Escape:27,Tab:9,i:73,Enter:13})[key]??0;await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key==='i'?'KeyI':key,windowsVirtualKeyCode:code,...extra});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key==='i'?'KeyI':key,windowsVirtualKeyCode:code,...extra});await settled();}
async function navigate(width,height,locale,theme){step=`appearance/${width}x${height}/${locale}/${theme}`;await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario:'appearance-polish',reset:'1'}).toString();await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});await ready("window.__HARA_SHELL_FIXTURE__?.model.getSnapshot().agentId==='person-0' && !!document.querySelector('.hs-field textarea')",'Appearance fixture must mount');await settled();}
const saveSelector='.workspace-profile-sheet .agent-profile-form>button:last-of-type';
async function openProfile(){if(!await evaluate("!!document.querySelector('#workspace-inspector')"))await click('.hd-header button[aria-controls="workspace-inspector"]');await ready("!!document.querySelector('.vg-colleague-manage')",'The existing inspector must mount');await click('.hd-profile-avatar');await ready("!!document.querySelector('.workspace-profile-sheet')",'Existing profile editor must open');await settled();const visible=await evaluate("(()=>{const node=document.querySelector('.workspace-profile-sheet'),r=node.getBoundingClientRect(),points=[[r.left+8,r.top+8],[r.right-8,r.top+8],[r.left+8,r.bottom-8],[r.right-8,r.bottom-8]];return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewport:[innerWidth,innerHeight],unobscured:points.every(([x,y])=>node.contains(document.elementFromPoint(x,y)))}})()");assert.ok(visible.left>=0&&visible.top>=0&&visible.right<=visible.viewport[0]&&visible.bottom<=visible.viewport[1],'Profile dialog stays within the viewport');assert.equal(visible.unobscured,true,'The inspector must not clip or cover the modal');}
async function selectImage(colour,{delayed=false,oversized=false,invalid=false}={}){
 return evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const c=canvas.getContext('2d');c.fillStyle='red';c.fillRect(0,0,100,200);c.fillStyle=${JSON.stringify(colour)};c.fillRect(100,0,200,200);c.fillStyle='red';c.fillRect(300,0,100,200);const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));const file=${oversized?"new File([new Uint8Array(128*1024+1)],'synthetic-oversized.png',{type:'image/png'})":invalid?"new File(['not an image'],'synthetic-invalid.png',{type:'image/png'})":"new File([blob],'synthetic-wide.png',{type:'image/png'})"};
 if(${delayed}){const bytes=await file.arrayBuffer();Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise(done=>{window.__HARA_RELEASE_AVATAR__=()=>done(bytes)})});}
 const files=new DataTransfer();files.items.add(file);const input=document.querySelector('.workspace-profile-sheet input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));return {inputBytes:file.size};})()`);
}
async function imageMetrics(selector){return evaluate(`(async()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw new Error('Avatar image missing');const image=new Image();image.src=node.src;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const context=c.getContext('2d');context.drawImage(image,0,0);const pixels=[[0,0],[c.width-1,c.height-1],[Math.floor(c.width/2),Math.floor(c.height/2)]].map(([x,y])=>[...context.getImageData(x,y,1,1).data]);const encoded=node.src.split(',')[1]??'';return {width:c.width,height:c.height,pixels,bytes:encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0)};})()`)}
async function inputValue(selector,text){await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await settled();}
try{
 await connect();
 for(const [width,height,locale,theme]of [[1280,760,'en','light'],[720,760,'en','dark'],[720,760,'zh-Hans','light'],[1280,760,'zh-Hant','dark'],[720,480,'zh-Hant','light']]){
  await navigate(width,height,locale,theme);const palette=['#ff695f','#4f9c8f','#d99a32','#6e88c8','#a67bc2','#d1667b','#438db3','#7f9a45'],deep=['#c04f47','#407f75','#966b23','#5d74aa','#87649e','#b25768','#397898','#637936'];let common;const colours=[];
  for(let index=0;index<8;index++){
   await evaluate(`window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-${index}')`);await ready(`window.__HARA_SHELL_FIXTURE__.model.getSnapshot().agentId==='person-${index}' && !!document.querySelector('.hs-field textarea')`,'Select a synthetic colleague');await evaluate("window.__HARA_SHELL_FIXTURE__.model.setDraft('Synthetic unsent appearance draft')");await settled();
   const values=await evaluate(`(()=>{const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')+')',row=document.querySelector('[data-roster-id="person-${index}"] .hd-colleague-avatar'),header=document.querySelector('.hd-header .hd-colleague-avatar');return {bubble:getComputedStyle(document.querySelector('.wsd-thread .is-user .hs-bub')).backgroundColor,send:getComputedStyle(document.querySelector('.hs-send')).backgroundColor,sendEnabled:!document.querySelector('.hs-send').disabled,expected:rgb('${deep[index]}'),avatar:getComputedStyle(row).backgroundColor,headerAvatar:getComputedStyle(header).backgroundColor,expectedAvatar:rgb('${palette[index]}'),link:getComputedStyle(document.querySelector('.wsd-thread .md a')).color,assistant:getComputedStyle(document.querySelector('.wsd-thread .is-agent .hs-bub')).backgroundColor,window:getComputedStyle(document.querySelector('.hs-win')).backgroundColor,brand:getComputedStyle(document.querySelector('.vg-app')).getPropertyValue('--hara-brand-primary').trim()}})()`);
   assert.equal(values.bubble,values.expected);assert.equal(values.send,values.expected);assert.equal(values.sendEnabled,true);assert.equal(values.avatar,values.expectedAvatar);assert.equal(values.headerAvatar,values.avatar);
   const fixed={link:values.link,assistant:values.assistant,window:values.window,brand:values.brand};if(common)assert.deepEqual(fixed,common,'Conversation colours must not recolour links, assistant surfaces or the window');else common=fixed;colours.push(values);
  }
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('main')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().agentId==='main'",'Return to main');await settled();assert.equal(await evaluate("document.querySelector('.hs-win').style.getPropertyValue('--chat-accent-deep')"),'#7C3AED');
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectAgent('person-0')");await ready("window.__HARA_SHELL_FIXTURE__.model.getSnapshot().agentId==='person-0'",'Return to editable colleague');await settled();await openProfile();assert.equal(await evaluate(`document.querySelector('${saveSelector}').disabled`),true,'Unchanged profiles do not consume configuration versions');
  await key('i',{modifiers:4});assert.equal(await evaluate("!!document.querySelector('.workspace-profile-sheet')"),true);assert.equal(await evaluate("!!document.querySelector('#workspace-inspector')"),true,'A modal cannot be closed by the global pane shortcut');
  await selectImage('lime',{oversized:true});await ready("!!document.querySelector('.workspace-profile-sheet [role=alert]')",'Oversized files receive an error');assert.equal(await evaluate(`document.querySelector('${saveSelector}').disabled`),true);
  await selectImage('lime',{invalid:true});await ready(`document.querySelector('.workspace-profile-sheet [role=alert]')?.textContent===${JSON.stringify(redesignText(locale,'avatarImageFormat'))}`,'Signature checks reject a fake PNG');
  await selectImage('lime');await ready("!!document.querySelector('.workspace-profile-avatar-preview img') && !document.querySelector('.workspace-profile-sheet [role=alert]') && !document.querySelector('.workspace-profile-sheet [role=status]')",'A bounded PNG is cropped');const green=await imageMetrics('.workspace-profile-avatar-preview img');assert.equal(green.width,green.height);assert.equal(green.width,200);assert.ok(green.bytes<=128*1024);for(const pixel of green.pixels)assert.deepEqual(pixel,[0,255,0,255],'The centre crop excludes both red side bands');
  await selectImage('lime',{delayed:true});await ready("!!window.__HARA_RELEASE_AVATAR__",'The first file read is deliberately held');await selectImage('blue');await ready("!document.querySelector('.workspace-profile-sheet [role=status]')",'The later file finishes first');await evaluate("window.__HARA_RELEASE_AVATAR__();delete window.__HARA_RELEASE_AVATAR__");await settled();const blue=await imageMetrics('.workspace-profile-avatar-preview img');for(const pixel of blue.pixels)assert.deepEqual(pixel,[0,0,255,255],'A cancelled old selection cannot overwrite the new photo');
  await capture(`s2-avatar-${locale}-${theme}-${width}x${height}`);await click(saveSelector);await ready("!document.querySelector('.workspace-profile-sheet')",'Accepted avatar changes close the editor');await ready("!!document.querySelector('.hd-header .hd-colleague-avatar img')",'The stored avatar reaches the conversation');
  const write=await evaluate("(()=>{const row=window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.agents.updatePersona').at(-1);return {keys:Object.keys(row.params.input.profile).sort(),name:row.params.input.profile.displayName,configRevision:row.params.configRevision,agentId:row.params.agentId}})()");assert.deepEqual(write.keys,['avatar','displayName']);assert.equal(write.name,'Coder');assert.equal(write.configRevision,1);assert.equal(write.agentId,'person-0');
  const header=await imageMetrics('.hd-header .hd-colleague-avatar img'),sidebar=await imageMetrics('[data-roster-id="person-0"] .hd-colleague-avatar img');assert.deepEqual(header,blue);assert.deepEqual(sidebar,blue);
  await openProfile();await evaluate("window.__HARA_SHELL_FIXTURE__.appearanceUpdate('person-0',{title:'Synthetic peer change'})");await ready(`document.querySelector('.workspace-profile-sheet [role=status]')?.textContent===${JSON.stringify(redesignText(locale,'profileChanged'))}`,'Incoming profile changes freeze the old editor');assert.equal(await evaluate(`document.querySelector('${saveSelector}').disabled`),true);await key('Escape');assert.equal(await evaluate("!!document.querySelector('.workspace-profile-sheet')"),false);assert.equal(await evaluate("!!document.querySelector('#workspace-inspector')"),true,'Escape closes only the profile modal');assert.equal(await evaluate("document.activeElement?.classList.contains('hd-profile-avatar')"),true,'Closing the sheet restores focus to its avatar trigger');
  await evaluate("window.__HARA_SHELL_FIXTURE__.appearanceUpdate('person-0',{avatar:'data:image/png;base64,iVBORw0KGgo='})");await ready("!document.querySelector('.hd-header .hd-colleague-avatar img') && !document.querySelector('[data-roster-id=person-0] .hd-colleague-avatar img')",'Broken bounded images return to shared initials');
  await capture(`s2-colours-${locale}-${theme}-${width}x${height}`);receipts.push({width,height,locale,theme,colours,green,blue,write,staleBlocked:true,escapeKeptInspector:true,modelCalls:0});
 }
 assert.deepEqual(errors,[]);writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,modelCalls:0,receipts,errors},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,page:await evaluate('({url:location.href,active:document.activeElement?.outerHTML.slice(0,500),text:document.body.innerText.slice(0,3000)})').catch(()=>null)},null,2)+'\n',{mode:0o600});await capture('failure').catch(()=>{});throw error;
}finally{try{socket?.close()}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Appearance browser gate closed'));}pending.clear();await stopOwnedBrowser(chrome);writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});}
