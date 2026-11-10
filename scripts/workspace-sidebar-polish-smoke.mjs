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
const profile = mkdtempSync(join(scratch, "hara-s3-chrome-"));
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

const receipts = [];
async function navigate(width, locale, theme) {
  step = `sidebar/${width}/${locale}/${theme}`;
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  const url = new URL('test/fixtures/workspace-shell-preview.html',base);
  url.search = new URLSearchParams({locale,theme,scenario:'sidebar-polish',reset:'1'}).toString();
  await navigateCdp(send,socket,{url:url.href,sessionId,step,timeoutMs:receipts.length===0?30000:12000});
  await ready("!!window.__HARA_SHELL_FIXTURE__ && document.querySelector('[data-roster-id=person-1] .hd-unread')?.textContent==='4' && !!document.querySelector('[data-roster-id=person-1] .hd-row-needs-you')",'Scoped overview and unread must settle');
  await settled();
}
const row = id => `[data-roster-id="${id}"]`;
async function capture(name) {
  const result = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(output,`${name}.png`),Buffer.from(result.data,'base64'),{mode:0o600});
}
async function geometry() { return evaluate(`(() => {
  const box = node => { const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
  const rows = [...document.querySelectorAll('.hd-roster-row')].map(node => {
    const text=node.querySelector('.hd-row-text'),avatar=node.querySelector('.hs-ava'),meta=node.querySelector('.hd-row-meta');
    return {id:node.dataset.rosterId,box:box(node),avatar:box(avatar),text:box(text),meta:box(meta),nameFont:getComputedStyle(node.querySelector('.hd-row-name')).fontSize,nameWeight:getComputedStyle(node.querySelector('.hd-row-name')).fontWeight,
      members:[...avatar.querySelectorAll("i,b")].map(box),previewFont:getComputedStyle(node.querySelector('.hd-row-preview')).fontSize,previewHeight:box(node.querySelector('.hd-row-preview')).height,
      badges:[...node.querySelectorAll('.hd-row-badges > span')].map(box)};
  });
  return {rows,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
})()`); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await settled(); }
try {
  await connect();
  for (const [width,locale,theme] of [[1280,'en','light'],[1280,'zh-Hant','dark'],[720,'zh-Hans','light'],[720,'en','dark']]) {
    await navigate(width,locale,theme);
    const measured=await geometry();
    assert.ok(measured.scrollWidth<=width,JSON.stringify(measured));
    for (const item of measured.rows) {
      assert.equal(item.box.height,44,item.id);assert.equal(item.avatar.width,32,item.id);assert.equal(item.avatar.height,32,item.id);
      assert.equal(item.text.left-item.avatar.right,10,item.id);assert.equal(item.previewHeight,18,item.id);
      assert.equal(item.nameFont,'13px');assert.equal(item.nameWeight,'600');assert.equal(item.previewFont,'12px');assert.equal(item.meta.width,52);
      if(item.id.startsWith("channel:"))for(const tile of item.members)assert.ok(tile.width>=10&&tile.height>=10,JSON.stringify(item));
      for(const badge of item.badges)assert.ok(badge.width>0&&badge.left>=item.box.left&&badge.right<=item.box.right-7,item.id);
    }
    const first=measured.rows.find(item=>item.id==='person-0'),second=measured.rows.find(item=>item.id==='person-1');
    assert.equal(second.box.top-first.box.bottom,2);
    assert.equal(await evaluate(`document.querySelector('${row('person-4')} .hd-row-preview').textContent`),redesignText(locale,'noMessages'));
    assert.ok(await evaluate(`!!document.querySelector('${row('person-2')} .hd-unread-dot')`));
    assert.equal(await evaluate(`document.querySelectorAll('.hd-group-avatar').length`),4);
    assert.ok(await evaluate(`(()=>{const avatar=document.querySelector('[data-group-id="00000000-0000-4000-8000-000000000004"] .hd-group-avatar i:last-child'),person=document.querySelector('[data-roster-id="person-3"] .hd-colleague-avatar');return getComputedStyle(avatar).backgroundColor===getComputedStyle(person).backgroundColor})()`),'Character-only colleague has the same colour in a private row and group');

    await capture(`s3-${locale}-${theme}-${width}`);
    receipts.push({width,locale,theme,geometry:measured});
  }
  await navigate(1280,'en','light');
  const before=await evaluate("[...document.querySelectorAll('.hd-sidebar-list [data-roster-id]')].map(node=>[node.dataset.rosterId,node.querySelector('time')?.dateTime])");
  await evaluate("window.__HARA_SHELL_FIXTURE__.backgroundActivity('person-8')");await settled();
  const after=await evaluate("[...document.querySelectorAll('.hd-sidebar-list [data-roster-id]')].map(node=>[node.dataset.rosterId,node.querySelector('time')?.dateTime])");
  assert.deepEqual(after,before,'A tool-only revision / updatedAt must not reorder the sidebar');
  await click(row('person-1'));
  await ready(`document.querySelector('${row('person-1')}')?.getAttribute('aria-current')==='page' && !document.querySelector('${row('person-1')} .hd-unread')`,'Reading clears unread');
  assert.ok(await evaluate(`!!document.querySelector('${row('person-1')} .hd-row-needs-you')`),'Reading must keep the outstanding approval');
  const count=await evaluate("document.querySelector('.hd-needs-you .hd-unread').textContent");assert.equal(count,'3');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.hd-main-card'),'::after').display"),'none','Unselected Hara keeps the no-divider design');
  await evaluate(`document.querySelector('${row('person-1')}').focus()`);await pause(650);
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false,'A fully visible short title does not need a tooltip');
  await evaluate("document.querySelector('.hd-main-card').focus()");await pause(650);
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false,'Hara does not repeat its fully visible name and role');
  assert.ok(await evaluate(`(()=>{const node=document.querySelector('${row('person-1')}');return document.getElementById(node.getAttribute('aria-describedby'))?.textContent.includes('The composer');})()`),'Preview and time remain available as the row description');

  const groupId='00000000-0000-4000-8000-000000000004',groupRow=row(`channel:${groupId}`);
  await click(groupRow);
  await ready("!!document.querySelector('.wsd-channel-thread') || !!document.querySelector('.hs-channel-log') || location.hash.includes('00000000-0000-4000-8000-000000000004')",'Group must open');
  await evaluate(`window.__HARA_SHELL_FIXTURE__.channelHistory('${groupId}',[],[{id:'recent-speaker',turnId:'recent-turn',agentId:'person-3',displayName:'Writer',createdAt:new Date().toISOString(),message:{role:'assistant',text:'Synthetic latest speaker',tools:[]}}])`);
  const firstMemberColour=`getComputedStyle(document.querySelector('${groupRow} .hd-group-avatar i')).backgroundColor`;
  const writerColour=await evaluate(`getComputedStyle(document.querySelector('${row('person-3')} .hd-colleague-avatar')).backgroundColor`);
  await ready(`${firstMemberColour}===${JSON.stringify(writerColour)}`,'Most recent group speaker moves to the first avatar tile');
  const expectedColours=await evaluate(`["person-3","person-0","person-1","person-2"].map(id=>getComputedStyle(document.querySelector('[data-roster-id="'+id+'"] .hd-colleague-avatar')).backgroundColor)`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${groupRow} .hd-group-avatar i')].map(node=>getComputedStyle(node).backgroundColor)`),expectedColours,'Full member order changes even if two colleagues happen to share a colour');

  await click(row('person-0'));
  assert.equal(await evaluate(firstMemberColour),writerColour,'Leaving the group retains observed speaker order');

  await evaluate(`document.querySelector('${row('person-0')}').focus()`);await pause(300);
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false,'Title must not appear immediately');
  await ready("!!document.querySelector('.hd-name-tooltip')",'Keyboard focus exposes full title after 600ms');
  assert.match(await evaluate("document.querySelector('.hd-name-tooltip').textContent"),/Responsible for synthetic interface verification/);
  await capture('s3-keyboard-tooltip');
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false);
  await evaluate('document.activeElement.blur()');
  const target=await evaluate(`(() => {const r=document.querySelector('${row('person-0')}').getBoundingClientRect();return {x:r.left+20,y:r.top+20};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await pause(200);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:15});await pause(450);
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false,'Leaving cancels pending title');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});
  await ready("!!document.querySelector('.hd-name-tooltip')",'Pointer hover exposes title');
  await evaluate("window.__HARA_SHELL_FIXTURE__.model.selectWorkspace('B')");await settled();await pause(650);
  assert.equal(await evaluate("!!document.querySelector('.hd-name-tooltip')"),false,'Workspace change cancels old title');
  assert.deepEqual(errors,[]);
  receipts.push({interactions:'Tool-only order stable; reading leaves approval; focus/hover delay, Escape, pointer leave and workspace cancellation passed'});
  writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,receipts,errors,modelCalls:0},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({ok:true,cases:receipts.length,output}));
} catch(error) {
  writeFileSync(join(output,'failure.json'),JSON.stringify({step,error:String(error),errors,navigationEvents,page:await evaluate('({url:location.href,ready:document.readyState,text:document.body.innerText})').catch(()=>null)},null,2)+'\n',{mode:0o600});
  await capture('failure').catch(()=>{});throw error;
} finally {
  try {socket?.close();} catch {}
  for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Sidebar browser gate closed'));}pending.clear();
  await stopOwnedBrowser(chrome);
  writeFileSync(join(output,'cleanup.json'),JSON.stringify({chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRetainedForCloseout:profile})+'\n',{mode:0o600});
}
