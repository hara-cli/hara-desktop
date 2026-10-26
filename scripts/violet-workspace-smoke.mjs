#!/usr/bin/env node
// Real Workspace React components, in a task-owned headless Chrome profile with synthetic RPC only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, realpathSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if(base.protocol!=="http:" || base.hostname!=="127.0.0.1" || base.pathname!=="/" || base.username || base.password || base.search || base.hash)throw new Error("Use a task-owned IPv4 loopback Vite root");
if(!process.argv[3])throw new Error("An explicit evidence directory is required");
assert.ok(isAbsolute(process.argv[3]), "Use an absolute evidence directory");
const output=resolve(process.argv[3]);mkdirSync(output,{recursive:true,mode:0o700});
const outputInfo=lstatSync(output);
assert.ok(outputInfo.isDirectory()&&!outputInfo.isSymbolicLink()&&outputInfo.uid===process.getuid()&&(outputInfo.mode&0o077)===0, "Evidence must be private and owned");
assert.equal(realpathSync(output),output,"Evidence aliases are refused");
assert.deepEqual(readdirSync(output),[],"Never overwrite previous browser evidence");
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
// Browser harness prelude is shared with the repository's switch-capsule smoke.
// The generated screen is the production React surface backed only by in-memory RPC.
const checks = [], screenshots = [];
async function ready(expression, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
  throw Error(label);
}
async function click(selector) {
  await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing control');node.click()})()`); await settled();
}
async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(output, `${name}.png`), Buffer.from(result.data, "base64"), { mode: 0o600 }); screenshots.push(`${name}.png`);
}
async function key(key, code, virtual, modifiers = 0) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtual, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtual, modifiers }); await settled();
}
async function nav(label) {
  await evaluate(`(()=>{const node=[...document.querySelectorAll('.wss-nav nav>button')].find(n=>n.textContent.trim()===${JSON.stringify(label)});if(!node)throw Error('Missing settings page');node.click()})()`); await settled();
}
try {
  await connect();
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = new URL("test/fixtures/violet-glass-preview.html?locale=zh-Hans&theme=dark#workspace", base);
  await send("Page.navigate", { url: url.href });
  await ready("!!window.__HARA_VIOLET_DEBUG__ && document.querySelectorAll('.vg-agent-card').length===2", "Workspace overview must load"); await settled();
  const columns = await evaluate("[...document.querySelectorAll('.hs-side,.hs-chat,.vg-inspector')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,width:r.width,height:r.height}})");
  assert.equal(columns.length, 3); assert.ok(columns.every(row => row.width >= 240 && row.height > 800));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.vg-app')).getPropertyValue('--brand').trim().toLowerCase()"), "#7c3aed");
  checks.push("three-column production shell and live overview"); await capture("01-workspace-dark");
  await click('.vg-product-nav button:nth-child(2)');
  await ready("!!document.querySelector('.wsd-composer textarea')", "Actual conversation composer must mount");
  await evaluate("window.__savedShell = document.querySelector('.hs-chat'); window.__savedTrigger=document.querySelector('.wsd-header button[aria-label=设置]');window.__savedTrigger.focus();window.__savedTrigger.click()");
  await ready("!!document.querySelector('.wss-scope')", "Isolated settings session must load"); await settled();
  assert.equal(await evaluate("window.__savedShell===document.querySelector('.hs-chat') && document.querySelector('.hs-chat').inert && document.querySelector('.hs-side').inert && document.querySelector('.vg-inspector').inert"), true);
  const dialog = await evaluate("(()=>{const r=document.querySelector('.wss-dialog').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
  assert.ok(Math.abs(dialog.x - (1440 - dialog.width) / 2) < 2 && dialog.y > 30 && dialog.height < 900);
  checks.push("centered modal preserves mounted, inert three-column shell");
  await nav("外观与语言"); await capture("02-settings-dark");
  await click('.vg-theme-card.daylight');
  await ready("document.documentElement.dataset.theme==='light'", "Daylight must persist through model preferences");
  assert.equal(await evaluate("document.querySelector('.vg-theme-card.daylight').getAttribute('aria-pressed')"), "true");
  await capture("03-settings-light");
  assert.equal(await evaluate("document.querySelector('.wss-dialog').getBoundingClientRect().width"), dialog.width);
  await click('.vg-theme-card.obsidian');
  await ready("document.documentElement.dataset.theme==='dark'&&document.documentElement.dataset.visualTheme==='obsidian'", "Obsidian must resolve dark palette");
  await capture("04-settings-obsidian");
  await click('.vg-theme-card.violet-glass');
  await click('.vg-material-pref:first-of-type button:first-child').catch(async () => {
    await evaluate("document.querySelector('.vg-material-pref button').click()");
  });
  await ready("document.documentElement.dataset.transparency==='off'", "Transparency preference must apply");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.wss-dialog')).backdropFilter"), "blur(0px)");
  checks.push("Violet Glass, Daylight, Obsidian and transparency preferences without layout shift");
  await nav("定时任务"); await ready("!!document.querySelector('.wsd-feature-panel [role=switch]')", "Schedules must load in Settings Workspace");
  assert.equal(await evaluate("!!document.querySelector('.wss-main .wsd-feature-panel') && !document.querySelector('.hs-chat .wsd-feature-panel') && !document.querySelector('.wsd-settings')"), true);
  await capture("05-schedules-dark");
  await click('.wss-main [role=switch]');
  await nav("技能"); await ready("!!document.querySelector('.wss-main [role=switch]')", "Skills must load in Settings Workspace");
  await click('.wss-main [role=switch]');
  const featureWrites = await evaluate("window.__HARA_VIOLET_DEBUG__.calls.filter(c=>c.method==='workspace.features.update')");
  assert.equal(featureWrites.length, 2); assert.ok(featureWrites.every(row => row.params.workspaceId === "11111111-1111-4111-8111-111111111111"));
  assert.deepEqual(new Set(featureWrites.map(row => row.params.kind)), new Set(["skill", "schedule"]));
  checks.push("schedule and skill toggles retain scoped model RPC");
  await nav("连接");
  await ready("!!document.querySelector('.wsd-connection')", "Connections must load");
  await evaluate("[...document.querySelectorAll('.wss-main button')].find(n=>n.textContent.trim()==='编辑').click()");
  await ready("!!document.querySelector('.wsd-connection-form')", "Connection draft must open");
  await key("Escape", "Escape", 27);
  await ready("!!document.querySelector('[role=alertdialog]')", "Escape must invoke dirty guard");
  await capture("06-dirty-leave-guard");
  await key("Escape", "Escape", 27); assert.equal(await evaluate("!!document.querySelector('.wsd-connection-form')"), true);
  await key("Escape", "Escape", 27);
  await click('.wss-discard-dialog button:last-child');
  await ready("!document.querySelector('.wss-dialog')", "Discard should close settings");
  assert.equal(await evaluate("document.activeElement===window.__savedTrigger && window.__savedShell===document.querySelector('.hs-chat') && !window.__savedShell.inert"), true);
  checks.push("dirty-draft Escape/keep/discard, shell continuity and restored focus");
  await click('.wsd-header button[aria-label="设置"]'); await ready("!!document.querySelector('.wss-scope')", "Settings reopen");
  await nav("外观与语言"); await click('.vg-theme-card.daylight');
  await evaluate("(()=>{const controls=[...document.querySelectorAll('.wss-dialog button:not(:disabled),.wss-dialog input:not(:disabled),.wss-dialog select:not(:disabled)')].filter(n=>n.getClientRects().length); controls.at(-1).focus()})()");
  await key("Tab", "Tab", 9); assert.equal(await evaluate("document.activeElement.classList.contains('wss-close')"), true);
  await key("Escape", "Escape", 27); await capture("07-conversation-light");
  await click('.wsd-header button[aria-controls="workspace-inspector"]'); assert.equal(await evaluate("!!document.querySelector('.vg-inspector')"), false);
  await click('.wsd-header button[aria-controls="workspace-inspector"]');
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 760, deviceScaleFactor: 1, mobile: false });
  await click('.wsd-header button[aria-label="设置"]'); await ready("!!document.querySelector('.wss-scope')", "Compact settings"); await settled();
  const fit = await evaluate("(()=>{const r=document.querySelector('.wss-dialog').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()"); assert.equal(fit, true); await capture("08-compact-settings");
  checks.push("keyboard focus loop, inspector close/reopen and compact modal fit");
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "receipt.json"), JSON.stringify({ passed: true, fixture: "production WorkspaceScreen + in-memory RPC", nativeHostAcceptance: false, realModelCalls: 0, externalWrites: 0, browserUserAgent, checks, screenshots, columns, dialog }, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify({ passed: true, checks: checks.length, screenshots: screenshots.length, output }) + "\n");
} catch (error) {
  await capture("failure").catch(() => {});
  const diagnostic = await evaluate("document.body.innerText.slice(0,5000)").catch(() => "unavailable");
  writeFileSync(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, diagnostic }, null, 2) + "\n", { mode: 0o600 });
  throw error;
} finally {
  if (socket) socket.close(); chrome.kill("SIGTERM");
  await Promise.race([once(chrome, "exit"), pause(3000)]); if (chrome.exitCode === null) chrome.kill("SIGKILL");
  rmSync(profile, { recursive: true, force: true });
}
