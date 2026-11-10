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
const scratch = resolve(output, "../../scratch"); mkdirSync(scratch, {recursive:true});
const profile = mkdtempSync(join(scratch, "hara-s1-chrome-"));
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
async function navigate(width,locale,theme){
 step=`message/${width}/${locale}/${theme}`;
 await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
 const url=new URL('test/fixtures/workspace-shell-preview.html',base);url.search=new URLSearchParams({locale,theme,scenario:'message-polish',reset:'1'}).toString();
 const began=Date.now();await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});
 navigationEvents.push({at:Date.now(),method:'fixture-navigation-duration',elapsedMs:Date.now()-began});
 await ready("!!window.__HARA_SHELL_FIXTURE__ && document.querySelectorAll('.hd-chat-message').length===6",'Synthetic messages must mount');await settled();
}
async function capture(name){const value=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(join(output,`${name}.png`),Buffer.from(value.data,'base64'),{mode:0o600});}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled();}
try{
 await connect();
 for(const [width,locale,theme] of [[1280,'en','light'],[1280,'zh-Hant','dark'],[720,'zh-Hans','light'],[720,'en','dark']]){
  await navigate(width,locale,theme);
  const geometry=await evaluate(`(()=>{const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {body:document.documentElement.scrollWidth,viewport:innerWidth,separators:document.querySelectorAll('.hd-time-separator').length,avatars:document.querySelectorAll('.hd-chat-message .hs-ava,.hd-chat-message .hs-who').length,messages:[...document.querySelectorAll('.hd-chat-message')].map(n=>{const b=n.querySelector('.hs-bub'),s=getComputedStyle(b);return {user:n.classList.contains('is-user'),row:box(n.querySelector('.hs-msg')),bubble:box(b),font:s.fontSize,line:s.lineHeight,radius:s.borderRadius,padding:s.padding,bg:s.backgroundColor,colour:s.color,tableWidth:b.querySelector('table')?.getBoundingClientRect().width,code:b.querySelector('pre')?{width:b.querySelector('pre').clientWidth,scrollWidth:b.querySelector('pre').scrollWidth}:null}})}})()`);
  assert.ok(geometry.body<=width,JSON.stringify(geometry));assert.equal(geometry.separators,2);assert.equal(geometry.avatars,0);
  for(const m of geometry.messages){assert.equal(m.font,'14px');assert.equal(m.line,'22px');assert.equal(m.padding,'10px 14px');assert.ok(m.bubble.width<=760);if(m.user){assert.ok(m.bubble.width<=m.row.width*.7+1);assert.equal(m.radius,'18px 18px 6px');}else{assert.equal(m.radius,'16px');assert.notEqual(m.bg,'rgba(0, 0, 0, 0)');}}
  for(const m of geometry.messages)if(m.tableWidth)assert.ok(Math.abs(m.tableWidth-(m.bubble.width-28))<=2,'Table fills its message content width');
  assert.ok(geometry.messages.some(m=>m.code&&m.code.scrollWidth>m.code.width),'Long code scrolls inside its message');
  const last='.hd-chat-message.is-agent:last-of-type';
  await evaluate(`document.querySelector('${last}').scrollIntoView({block:'center'})`);await settled();
  const target=await evaluate(`(()=>{const r=document.querySelector('${last} .hs-bub').getBoundingClientRect();return {x:r.left+20,y:r.top+12};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await pause(180);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('${last} .hd-message-actions')).opacity`),'1');
  await capture(`s1-actions-${locale}-${theme}-${width}`);
  await click(`${last} .hd-message-actions>.message-copy-button`);
  assert.match(await evaluate('window.__HARA_COPIED_MESSAGES__.at(-1)'),/\*\*Ready for review/u);
  await click(`${last} summary`);await ready(`document.querySelector('${last} details')?.open===true`,'More options must open');
  await capture(`s1-more-${locale}-${theme}-${width}`);
  await click(`${last} .hd-message-options .message-copy-button`);
  const plain=await evaluate('window.__HARA_COPIED_MESSAGES__.at(-1)');assert.match(plain,/Ready for review/u);assert.doesNotMatch(plain,/\*\*|\[synthetic link\]/u);
  await click(`${last} .hd-message-options>button:last-child`);
  assert.match(await evaluate('window.getSelection().toString()'),/Ready for review/u);
  assert.ok(await evaluate(`document.activeElement===document.querySelector('${last} summary')`));
  await click(`${last} summary`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate(`document.querySelector('${last} details').open`),false);
  await evaluate('document.activeElement.blur();window.getSelection().removeAllRanges()');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:2,y:2});await pause(180);
  await capture(`s1-${locale}-${theme}-${width}`);receipts.push({width,locale,theme,geometry,actions:'Markdown/plain copies isolated in fixture memory; selection and Escape preserve keyboard focus'});
 }
 assert.deepEqual(errors,[]);writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,modelCalls:0,receipts,errors,navigationTimings:navigationEvents.filter(event=>event.method==='fixture-navigation-duration')},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
}catch(error){writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,navigationEvents,page:await evaluate('({url:location.href,text:document.body.innerText})').catch(()=>null)},null,2)+'\n',{mode:0o600});await capture('failure').catch(()=>{});throw error;
}finally{try{socket?.close()}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Message browser gate closed'));}pending.clear();await stopOwnedBrowser(chrome);writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});}
