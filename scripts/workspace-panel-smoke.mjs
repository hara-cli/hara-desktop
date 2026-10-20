#!/usr/bin/env node
// Render real Workspace components against in-memory RPC, in an owned headless browser only.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert(process.argv[2], "explicit private evidence directory required");
const output = resolve(process.argv[2]), baseline = process.argv.includes("--baseline");
mkdirSync(output, { recursive: true, mode: 0o700 });
const root = new URL("../", import.meta.url).pathname;
const compiled = await build({ entryPoints: [join(root, "test/fixtures/workspace-panel.tsx")], bundle: true, format: "esm", jsx: "automatic",
  outdir: output, write: false, loader: { ".svg": "dataurl" }, define: { "import.meta.env.DEV": "false" } });
const js = compiled.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = compiled.outputFiles.find(file => file.path.endsWith(".css")).text;
writeFileSync(join(output, "fixture.js"), js, { mode: 0o600 }); writeFileSync(join(output, "fixture.css"), css, { mode: 0o600 });
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathname === "/fixture.js") { res.setHeader("content-type", "text/javascript"); res.end(js); }
  else if (pathname === "/fixture.css") { res.setHeader("content-type", "text/css"); res.end(css); }
  else if (pathname === "/preview") res.end("<!doctype html><meta charset=utf-8><h1>Local synthetic preview</h1>");
  else if (pathname === "/") res.end('<!doctype html><meta charset=utf-8><style>html,body{margin:0}body{overflow:hidden}</style><link rel=stylesheet href=/fixture.css><div id=root></div><script type=module src=/fixture.js></script>');
  else { res.statusCode = 404; res.end(); }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const port = server.address().port, base = `http://127.0.0.1:${port}`;
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(value => value && existsSync(value));
assert(chromePath, "Chrome/Chromium is required");
const profile = mkdtempSync(join(tmpdir(), "hara-panel-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket, sessionId, requestId = 0; const pending = new Map(), receipts = [], errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, scoped = true) {
  const id = ++requestId, result = new Promise((done, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { done, fail, timer });
  }); socket.send(JSON.stringify({ id, method, params, ...(scoped && sessionId ? { sessionId } : {}) })); return result;
}
async function evaluate(expression) {
  const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
  return value.result?.value;
}
const settled = () => evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))");
async function click(selector) { assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `missing ${selector}`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settled(); }
async function input(selector, value) {
  await evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)});node.focus();Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event('input',{bubbles:true})); })()`); await settled();
}
async function capture(name) { const value = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(join(output, `${name}.png`), Buffer.from(value.data, "base64"), { mode: 0o600 }); }
async function geometry() { return evaluate(`(() => {
  const rect=selector=>{const n=document.querySelector(selector);if(!n)return null;const b=n.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,visible:b.width>0&&b.height>0};};
  const title=document.querySelector('.extension-dock-identity strong');const style=title&&getComputedStyle(title);
  return {viewport:innerWidth,body:document.documentElement.scrollWidth,chat:rect('.wsd-chat'),panel:rect('.wsd-browser-extension'),input:rect('.wsd-composer textarea'),toolbar:rect('.wsd-browser-address'),frame:rect('.wsd-browser-extension iframe'),titleColor:style?.color,background:document.querySelector('.wsd-app')&&getComputedStyle(document.querySelector('.wsd-app')).getPropertyValue('--wsd-surface').trim(),mode:document.querySelector('.extension-dock')?.className};
})()`); }
function parallel(value) { assert(value.chat.visible && value.chat.width >= 279, "chat must remain readable"); assert(value.panel.visible && value.panel.width >= 239, "panel must remain visible"); assert(value.chat.right <= value.panel.left + 1, "default panel must never cover chat"); assert(value.panel.right <= value.viewport + 1); assert(value.body <= value.viewport + 1); }
try {
  const endpoint = await new Promise((resolve, reject) => { let data = ""; const timer = setTimeout(() => reject(new Error("Chrome startup deadline")), 15000);
    chrome.stderr.on("data", chunk => { data = (data + chunk).slice(-5000); const match = /DevTools listening on (ws:\/\/\S+)/.exec(data); if (match) { clearTimeout(timer); resolve(match[1]); } }); chrome.once("error", reject); });
  socket = new WebSocket(endpoint); await once(socket, "open");
  socket.addEventListener("message", ({ data }) => { const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error(message.error.message)); else request.done(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable");
  for (const locale of ["en", "zh", "zh-Hant"]) for (const theme of ["light", "dark"]) for (const width of [720, 900, 1100, 1280, 1600]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${base}/?${new URLSearchParams({ locale, theme, width: "72" })}` });
    let mounted = false; for (let i=0;i<100;i++) { if (await evaluate("!!document.querySelector('.wsd-composer textarea')")) { mounted=true;break; } await pause(50); } assert(mounted, "fixture must mount"); await settled();
    const draft = "Retain my draft 草稿保留";
    await input(".wsd-composer textarea", draft);
    await evaluate("window.retainedComposer=document.querySelector('.wsd-composer textarea');window.retainedScroll=document.querySelector('.wsd-scroll');window.retainedScroll.scrollTop=220;window.panelRequestCount=window.panelFixture.requests.length;");
    await click(".wsd-header>button");
    for (let i=0;i<100;i++) { if (await evaluate("!!document.querySelector('.extension-dock')")) break; await pause(30); } await settled();
    const value = await geometry(); receipts.push({ locale, theme, width, ...value });
    if (baseline) { if (locale === "zh" && theme === "light") await capture(`baseline-${width}`); continue; }
    parallel(value);
    const readingPosition = await evaluate("document.querySelector('.wsd-scroll').scrollTop");
    const expected = { en: "Browser extension", zh: "浏览器扩展", "zh-Hant": "瀏覽器擴展" }[locale];
    assert.equal(await evaluate("document.querySelector('.extension-dock-identity strong').textContent"), expected);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.extension-dock-identity strong')).color===getComputedStyle(document.querySelector('.wsd-chat')).color"), true, "title uses readable workspace ink");
    await input(".wsd-browser-address input", `${base}/preview`); await click(".wsd-browser-address button");
    const loaded = await geometry(); assert(loaded.frame.height > 100 && loaded.frame.top >= loaded.toolbar.bottom - 1, "iframe below a compact toolbar");
    assert.equal(await evaluate("document.querySelector('.wsd-browser-extension iframe').getAttribute('sandbox')"), "allow-scripts allow-forms allow-popups");
    await capture(`${locale}-${theme}-${width}-docked`);
    await click(".extension-dock-mode-action"); assert.equal((await geometry()).chat.visible, false, "explicit maximize only");
    await click(".extension-dock-mode-action"); parallel(await geometry());
    assert.equal(await evaluate("document.querySelector('.wsd-composer textarea')===window.retainedComposer && document.querySelector('.wsd-scroll')===window.retainedScroll"), true, "chat DOM never remounts");
    assert.equal(await evaluate("document.querySelector('.wsd-composer textarea').value"), draft);
    assert.equal(await evaluate("document.querySelector('.wsd-scroll').scrollTop"), readingPosition, "maximize/restore retains the docked reading position");
    assert.equal(await evaluate("window.panelFixture.model.getSnapshot().workspace.conversation.sessionId"), "panel-session");
    assert.equal(await evaluate("window.panelFixture.requests.length"), await evaluate("window.panelRequestCount"), "view actions cannot send/resume a task");
    await click(".extension-dock-hide-action"); assert.equal((await geometry()).panel, null);
    await click(".wsd-header>button"); for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('.extension-dock')"))break;await pause(20);}await settled(); parallel(await geometry());
    if (width === 1100 && theme === "light") { await click(".extension-dock-mode-action"); await capture(`${locale}-maximized`); await click(".extension-dock-mode-action");
      const oldWidth = (await geometry()).panel.width;
      await evaluate("document.querySelector('.extension-dock-resizer').focus()");
      await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Home",code:"Home"});await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Home",code:"Home"});await settled();
      assert.equal(await evaluate("localStorage.getItem('hara.extensionDock.width.v1')"),"36");
      parallel(await geometry()); assert((await geometry()).panel.width < oldWidth, "keyboard resizing controls parent layout");
      const handle=await evaluate("(() => {const r=document.querySelector('.extension-dock-resizer').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+100};})()");
      await send("Input.dispatchMouseEvent",{type:"mousePressed",x:handle.x,y:handle.y,button:"left",clickCount:1});
      await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:handle.x-65,y:handle.y,button:"left",buttons:1});
      await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:handle.x-65,y:handle.y,button:"left",clickCount:1}); await settled();
      parallel(await geometry());assert(Number(await evaluate("localStorage.getItem('hara.extensionDock.width.v1')"))>36,"pointer resize controls parent layout");
      await input(".wsd-browser-address input", "https://example.com/"); await click(".wsd-browser-address button"); assert(await evaluate("!!document.querySelector('.wsd-browser-extension [role=alert]')"), "still denies non-loopback"); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "result.json"), JSON.stringify({ status: baseline ? "baseline-recorded" : "passed", syntheticOnly: true, paidRequests: 0, receipts }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: baseline ? "baseline-recorded" : "passed", scenarios: receipts.length, output }));
} catch (error) {
  process.exitCode = 1; console.error(error.message);
  try { await capture("failure"); writeFileSync(join(output, "failure.json"), JSON.stringify({ error: error.message, geometry: await geometry(), errors }, null, 2), { mode: 0o600 }); } catch {}
} finally {
  if(socket?.readyState===WebSocket.OPEN)try{await send("Browser.close",{},false);}catch{}
  socket?.close(); for(const request of pending.values())clearTimeout(request.timer);
  if(chrome.exitCode===null&&chrome.signalCode===null)chrome.kill("SIGTERM");
  await Promise.race([chrome.exitCode===null&&chrome.signalCode===null ? once(chrome,"close") : Promise.resolve(), pause(2000)]);
  if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill("SIGKILL");await pause(500);}
  await new Promise(resolve=>server.close(resolve));
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  writeFileSync(join(output,"cleanup.json"),JSON.stringify({ownedChromeStopped:true,ownedProfileRemoved:!existsSync(profile),fixturePortReleased:port}),{mode:0o600});
}
