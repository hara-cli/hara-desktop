#!/usr/bin/env node
// Real Workspace React components, in a task-owned headless Chrome profile with synthetic RPC only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if(base.protocol!=="http:" || base.hostname!=="127.0.0.1" || base.pathname!=="/" || base.username || base.password || base.search || base.hash)throw new Error("Use a task-owned IPv4 loopback Vite root");
if(!process.argv[3])throw new Error("An explicit evidence directory is required");
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true,mode:0o700});
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((value) => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium is required for the component browser gate");
const profile = mkdtempSync(join(tmpdir(), "hara-shell-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-background-mode", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--no-default-browser-check", "--no-first-run",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
let requestId = 0;
let sessionId;
let browserUserAgent;
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
  const version = await send("Browser.getVersion", {}, false);
  browserUserAgent = version.userAgent;
  await send("Emulation.setUserAgentOverride", { userAgent: version.userAgent, platform: "MacIntel" });
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
async function settled() { await evaluate(`(async()=>{
 for(let frame=0;frame<4;frame++){
  await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  const active=document.getAnimations().filter(animation=>animation.playState==='running'&&Number.isFinite(animation.effect?.getComputedTiming().endTime));
  if(!active.length)return;
  await Promise.all(active.map(animation=>animation.finished.catch(()=>{})));
 }
})()`); }
async function ready(expression, label) {
  for(let attempt=0;attempt<160;attempt++){if(await evaluate(expression))return;await pause(75);}
  const diagnostic=await evaluate('({url:location.href,text:document.body.innerText.slice(0,2500),fixture:!!window.__HARA_SWITCH_FIXTURE__})');
  writeFileSync(join(output,'failure.json'),JSON.stringify({label,errors,diagnostic},null,2)+'\n',{mode:0o600});await capture('failure');
  throw new Error(label);
}
const receipts = [], captures = []; let screenshots = 0, completed = false, documentNode;
async function navigate(view, locale, theme) {
  await send('Emulation.setDeviceMetricsOverride', { width:1280,height:800,deviceScaleFactor:1,mobile:false });
  await send('Input.dispatchMouseEvent', { type:'mouseMoved',x:0,y:0 });
  const url = new URL('test/fixtures/switch-capsule-preview.html', base); url.search = new URLSearchParams({view,locale,theme}).toString();
  await send('Page.navigate', {url:url.href});
  const count = view === 'matrix' ? 16 : view === 'appearance' ? 1 : 2;
  await ready(`!!window.__HARA_SWITCH_FIXTURE__&&document.querySelectorAll('[role=switch]').length===${count}`, 'Real switch consumer must settle'); await settled();
  const height = await evaluate('Math.max(800,Math.ceil(document.documentElement.scrollHeight))');assert.ok(height<=1800);
  await send('Emulation.setDeviceMetricsOverride', {width:1280,height,deviceScaleFactor:1,mobile:false});await settled();
  documentNode = (await send('DOM.getDocument')).root.nodeId;
}
async function force(selector, states) {
  const found = await send('DOM.querySelectorAll', { nodeId:documentNode, selector });
  assert.ok(found.nodeIds.length, selector); for (const nodeId of found.nodeIds) await send('CSS.forcePseudoState', {nodeId,forcedPseudoClasses:states}); await settled();
}
async function paint() {
  return evaluate(`Array.from(document.querySelectorAll('[role=switch]')).map(e=>{
    const track=e.querySelector('.hara-switch-track'),thumb=e.querySelector('.hara-switch-thumb');if(!track||!thumb)throw Error('Switch must use shared capsule control');
    const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const rgb=v=>{const a=v.match(/[\\d.]+/g).map(Number);return [a[0],a[1],a[2],a[3]??1]};
    let bg=[255,255,255],chain=[];for(let p=e.parentElement;p;p=p.parentElement)chain.push(p);
    for(const p of chain.reverse()){const c=rgb(getComputedStyle(p).backgroundColor);bg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]));}
    const s=getComputedStyle(e),t=getComputedStyle(track),k=getComputedStyle(thumb);return {label:e.getAttribute('aria-label'),checked:e.getAttribute('aria-checked'),disabled:e.disabled,background:s.backgroundColor,filter:s.filter,shadow:s.boxShadow,radius:s.borderRadius,outline:s.outlineStyle,outlineWidth:s.outlineWidth,button:box(e),track:box(track),trackRadius:t.borderRadius,trackColor:t.backgroundColor,thumb:box(thumb),thumbRadius:k.borderRadius,parentColor:bg};
  })`);
}
function capsules(rows) {
  for (const r of rows) {
    assert.equal(r.background,'rgba(0, 0, 0, 0)', r.label+' outer hit target'); assert.equal(r.filter,'none'); assert.equal(r.shadow,'none');
    assert.equal(r.button.width,37);assert.equal(r.button.height,32);assert.ok(parseFloat(r.radius)>=r.button.height/2);
    assert.equal(r.track.width,37);assert.equal(r.track.height,23);assert.ok(parseFloat(r.trackRadius)>=r.track.height/2);
    assert.equal(r.thumb.width,17);assert.equal(r.thumb.height,17);assert.equal(r.thumbRadius,'50%');
    assert.ok(r.thumb.left>=r.track.left&&r.thumb.right<=r.track.right&&r.thumb.top>=r.track.top&&r.thumb.bottom<=r.track.bottom);
  }
}
async function capture(name) {
  const rows = await paint();capsules(rows);const result = await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync(join(output,name+'.png'),Buffer.from(result.data,'base64'),{mode:0o600});screenshots++;captures.push({name,rows});return rows;
}
async function pointer(index, click=false) {
  const p=await evaluate(`(()=>{const r=document.querySelectorAll('[role=switch]')[${index}].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
  if(click){await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}await settled();
}
async function key(key, code, virtual) {
  await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual});await settled();
}
const calls = () => evaluate('window.__HARA_SWITCH_FIXTURE__.calls');
try {
  await connect();await send('DOM.enable');await send('CSS.enable');
  for(const theme of ['light','dark'])for(const locale of ['en','zh-Hans','zh-Hant']) {
    await navigate('matrix',locale,theme);
    for(const state of ['hover-off','hover-on'])await force(`[data-case$="-${state}"] button`,['hover']);
    for(const state of ['focus-off','focus-on'])await force(`[data-case$="-${state}"] button`,['focus','focus-visible']);
    const before=await paint();capsules(before);
    await force('[data-case*="disabled"] button',['hover']);const after=await paint();
    for(let i=0;i<after.length;i++)if(after[i].disabled)assert.equal(after[i].trackColor,before[i].trackColor,'Disabled hover cannot recolor the track');
    const focused=await evaluate("Array.from(document.querySelectorAll('[data-case*=focus] button')).map(n=>({outline:getComputedStyle(n).outlineStyle,width:getComputedStyle(n).outlineWidth}))");
    for(const row of focused){assert.equal(row.outline,'solid');assert.equal(row.width,'2px');}
    await capture(`switch-matrix-${locale}-${theme}`);receipts.push({view:'matrix',locale,theme,states:16,disabledHoverStable:true,keyboardFocusOutline:true});
    for(const view of ['appearance','updates','skills','schedules','modules']) {
      await navigate(view,locale,theme);const original=await paint();capsules(original);
      if(view==='skills'||view==='schedules') {
        await evaluate('window.__HARA_SWITCH_FIXTURE__.hold(true)');await pointer(0,true);
        await ready("Array.from(document.querySelectorAll('[role=switch]')).every(n=>n.disabled)",'Pending feature writes disable both controls');
        await capture(`${view}-pending-${locale}-${theme}`);const n=(await calls()).length;await pointer(0,true);assert.equal((await calls()).length,n);
        await evaluate('window.__HARA_SWITCH_FIXTURE__.release()');await ready("!document.querySelector('[role=switch]').disabled&&document.querySelector('[role=switch]').getAttribute('aria-checked')==='false'",'Only the acknowledged feature state changes');
        // A label click must retain native label activation after replacing checkbox styling.
        await evaluate("(()=>{const n=document.querySelectorAll('[role=switch]')[1].closest('label');n.click()})()");await settled();
        await ready("document.querySelectorAll('[role=switch]')[1].getAttribute('aria-checked')==='true'",'Label activates the associated switch exactly once');
        const writes=(await calls()).filter(r=>r.method==='workspace.features.update');assert.equal(writes.length,2);assert.equal(writes[0].values.enabled,false);assert.equal(writes[1].values.enabled,true);
        assert.equal(writes[0].values.kind,view==='skills'?'skill':'schedule');if(view==='skills')assert.equal(writes[0].values.version,'fixture-version');
      } else {
        await pointer(0,true);await ready(`document.querySelector('[role=switch]').getAttribute('aria-checked')===${JSON.stringify(original[0].checked==='true'?'false':'true')}`,'Click updates only the selected preference');
        const n=(await calls()).length;
        if(view==='updates') {const disabled=await paint();await pointer(1,true);assert.equal((await calls()).length,n);assert.equal((await paint())[1].trackColor,disabled[1].trackColor);}
        await key('Tab','Tab',9);await evaluate("document.querySelector('[role=switch]').focus()");await settled();
        assert.equal(await evaluate("document.querySelector('[role=switch]').matches(':focus-visible')"),true);
        await key(' ','Space',32);await ready(`document.querySelector('[role=switch]').getAttribute('aria-checked')===${JSON.stringify(original[0].checked)}`,'Space restores the preference');
        assert.equal((await calls()).length,n+1,'One keyboard activation has one callback');
      }
      await pointer(0);await capture(`${view}-${locale}-${theme}`);receipts.push({view,locale,theme,realConsumer:true,clickKeyboardOrPendingAndLabelVerified:true});
    }
  }
  await navigate('matrix','en','dark');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.hara-switch-thumb,.hara-switch-track')).every(n=>getComputedStyle(n).transitionDuration==='0s')"),true);await send('Emulation.setEmulatedMedia',{features:[]});
  assert.equal(errors.length,0,JSON.stringify(errors));completed=true;
  writeFileSync(join(output,'browser-report.json'),JSON.stringify({ok:true,receipts,captures,errors,reducedMotion:true},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({ok:true,groups:receipts.length,screenshots,output}));
}catch(error){
  try{writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),errors,captures},null,2)+'\n',{mode:0o600});}catch{}throw error;
}finally{
  try{socket?.close();}catch{}for(const request of pending.values()){clearTimeout(request.timer);request.fail(new Error('Browser gate closed'));}pending.clear();
  if(chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([once(chrome,'exit'),pause(4000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await once(chrome,'exit');}}
  let removed=false;for(let n=0;n<15;n++){try{rmSync(profile,{recursive:true,force:true});removed=true;break;}catch{await pause(100);}}
  writeFileSync(join(output,'cleanup.json'),JSON.stringify({completed,chromeExited:chrome.exitCode!==null||chrome.signalCode!==null,profileRemoved:removed})+'\n',{mode:0o600});assert(removed);
}
