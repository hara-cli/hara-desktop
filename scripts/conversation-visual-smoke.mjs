#!/usr/bin/env node
// Browser regression of the real React components, with synthetic data only. An isolated headless
// profile never attaches to the user's Chrome. This gate is not an Engine/native-session acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:54988/");
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.pathname !== "/" || base.username || base.password || base.search || base.hash) {
  throw new Error("Use a task-owned localhost Vite root, without credentials or query parameters");
}
const output = resolve(process.argv[3] ?? "");
if (!process.argv[3]) throw new Error("An explicit evidence output directory is required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const baseline = process.argv.includes("--record-extension-baseline");
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((value) => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium is required for the component browser gate");
const profile = mkdtempSync(join(tmpdir(), "hara-conversation-chrome-"));
const chrome = spawn(chromePath, ["--headless=new", "--disable-background-mode", "--disable-background-networking", "--disable-component-update",
  "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--no-default-browser-check", "--no-first-run",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
const pending = new Map();
let requestId = 0;
let sessionId;
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
async function settled() { await evaluate("new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))"); }
async function navigate({ width = 1280, locale = "zh", theme = "light", scenario = "", extension = false } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = new URL(base); url.search = new URLSearchParams({ preview: "conversation", locale, theme, scenario, extension: extension ? "1" : "0" }).toString();
  await send("Page.navigate", { url: url.href });
  let ready = false;
  for (let count = 0; count < 150; count += 1) {
    if (await evaluate(`location.href === ${JSON.stringify(url.href)} && !!document.querySelector('[data-conversation-preview] .composer-input-row textarea')`)) { ready = true; break; }
    await pause(100);
  }
  assert.ok(ready, "Synthetic conversation fixture must mount");
  await settled();
  assert.equal(await evaluate("document.documentElement.dataset.theme"), theme);
  assert.equal(await evaluate("location.hostname"), "127.0.0.1");
}
async function geometry() {
  return evaluate(`(() => {
    const rect = selector => { const node = document.querySelector(selector); if (!node) return null; const box = node.getBoundingClientRect(); return {width:box.width,height:box.height,left:box.left,right:box.right,visible:box.width>0&&box.height>0}; };
    return {viewport:innerWidth, body:document.documentElement.scrollWidth, chat:rect('.chat.im'), scroll:rect('.chat.im .scroll'), composer:rect('.composer-shell'), input:rect('.composer-input-row textarea'), drawer:rect('.extension-dock'), sidebar:rect('.workbench-sidebar'),
      overflow:Array.from(document.querySelectorAll('.inbox-contact,.conversation-person,.composer-send,.decision-card,.approval-card,.assistant-message,.msg.user,.new-chat-popover'))
        .filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left < -1||r.right > innerWidth+1);}).map(node=>node.className)};
  })()`);
}
async function capture(name) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(output, `${name}.png`), Buffer.from(result.data, "base64"), { mode: 0o600 });
}
async function click(selector) {
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), true, `Missing ${selector}`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settled();
}
async function key(key, shift = false) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, modifiers: shift ? 8 : 0 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, modifiers: shift ? 8 : 0 }); await settled();
}
async function input(text) {
  await evaluate(`(() => { const input=document.querySelector('.composer-input-row textarea'); input.focus(); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await settled();
}
const receipts = [];
let successfulResult;
try {
  await connect();
  if (baseline) {
    for (const width of [720, 900, 1100, 1280]) {
      await navigate({ width, extension: true }); const result = await geometry(); receipts.push({ width, ...result }); await capture(`extension-baseline-${width}`);
    }
  } else {
    for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) for (const width of [720, 900, 1100, 1280]) {
      await navigate({ width, locale, theme }); const result = await geometry();
      assert.ok(result.chat.width >= 480, `Chat narrower than 480px at ${width}: ${result.chat.width}`);
      assert.ok(result.input.height <= 42, "An empty composer is compact");
      assert.ok(result.body <= width + 1); assert.deepEqual(result.overflow, []);
      receipts.push({ locale, theme, width, ...result }); await capture(`${locale}-${theme}-${width}`);
    }
    for (const locale of ["zh", "en"]) for (const width of [720, 1280]) {
      await navigate({width, locale, scenario: "roster"});
      if (width === 720) await click(".conversation-directory-button");
      assert.equal(await evaluate("document.querySelectorAll('.inbox-main-coordinator .inbox-contact-shell').length"), 1);
      assert.equal(await evaluate("document.querySelectorAll('.inbox-colleagues .inbox-contact-shell').length"), 26);
      assert.equal(await evaluate("document.querySelectorAll('.inbox-colleagues .is-root').length"), 0);
      const top = await evaluate("document.querySelector('.inbox-main-coordinator').getBoundingClientRect().top");
      await evaluate("(() => {const list=document.querySelector('.workbench-inbox');list.scrollTop=list.scrollHeight;})()");
      await settled();
      const scrolledTop = await evaluate("document.querySelector('.inbox-main-coordinator').getBoundingClientRect().top");
      assert.ok(Math.abs(top - scrolledTop) <= 2, "Main assistant stays pinned while the colleague list scrolls");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.inbox-main-coordinator .agent-portrait-presence')).display"), "none", "Idle is not presented as verified online");
      receipts.push({locale, width, scenario: "pinned-roster", ...await geometry()});
      await capture(`pinned-roster-${locale}-${width}`);
    }
    for (const locale of ["zh", "en"]) {
      await navigate({width: 1280, locale});
      await click(".inbox-main-coordinator .inbox-contact-details");
      await click(".agent-details-rows button:last-child");
      assert.equal(await evaluate("document.querySelectorAll('.agent-profile-dismiss').length"), 0);
      await evaluate(`(() => {const input=document.querySelector('.agent-profile-grid input[maxlength="64"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'My coordinator');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await evaluate(`(async () => {const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff695f';ctx.fillRect(0,0,2,2);const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'synthetic-avatar.png',{type:'image/png'}));const input=document.querySelector('.agent-profile-avatar-field input[type=file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(done=>setTimeout(done,150));})()`);
      await click(".agent-profile-editor footer button:last-child");
      assert.equal(await evaluate("document.querySelector('.inbox-main-coordinator strong').textContent"), "My coordinator");
      assert.equal(await evaluate("document.querySelectorAll('.inbox-main-coordinator .agent-portrait-brand').length"), 0);
      assert.equal(await evaluate("document.querySelectorAll('.inbox-main-coordinator .inbox-agent-root-badge').length"), 1);
      await click(".inbox-main-coordinator .inbox-contact-details");
      await click(".agent-details-rows button:last-child");
      await click(".agent-profile-reset");
      assert.equal(await evaluate("document.querySelector('.inbox-main-coordinator strong').textContent"), "My coordinator", "Loading defaults changes the draft only");
      await click(".agent-profile-editor footer button:last-child");
      assert.equal(await evaluate("document.querySelector('.inbox-main-coordinator strong').textContent"), "Hara");
      assert.equal(await evaluate("document.querySelectorAll('.inbox-main-coordinator .agent-portrait-brand').length"), 1);
      receipts.push({locale, scenario: "main-profile-avatar-and-reset", ...await geometry()});
      await capture(`main-profile-reset-${locale}`);
    }
    await navigate();
    await input("草稿不会因查看名片而消失");
    const compact = (await geometry()).input.height;
    await input(Array.from({ length: 18 }, (_, i) => `line ${i}`).join("\n"));
    assert.ok((await geometry()).input.height > compact);
    assert.ok((await geometry()).input.height <= 160);
    await input("草稿不会因查看名片而消失");
    await evaluate("document.querySelector('.conversation-person').focus()");
    await click(".conversation-person");
    assert.equal(await evaluate("!!document.querySelector('[role=dialog][aria-modal=true]')"), true);
    assert.equal(await evaluate("document.activeElement === document.querySelector('.agent-details-drawer button')"), true);
    assert.equal(await evaluate("document.querySelector('.workbench-sidebar').inert"), true);
    await key("Tab", true);
    assert.equal(await evaluate("document.activeElement === [...document.querySelectorAll('.agent-details-drawer button')].at(-1)"), true);
    await capture("details-zh-light"); await key("Escape");
    assert.equal(await evaluate("!!document.querySelector('.agent-details-drawer')"), false);
    assert.equal(await evaluate("document.activeElement.classList.contains('conversation-person')"), true);
    assert.equal(await evaluate("document.querySelector('.composer-input-row textarea').value"), "草稿不会因查看名片而消失");
    assert.equal(await evaluate("document.querySelector('.workbench-sidebar').inert"), false);
    await click(".new-chat-trigger"); await capture("new-menu-zh-light");
    assert.equal(await evaluate("document.querySelectorAll('[role=menuitem]').length"), 3);
    await key("Escape");
    assert.equal(await evaluate("document.activeElement.classList.contains('new-chat-trigger')"), true);
    await click(".new-chat-trigger"); await click("[role=menuitem]");
    await input("IME draft");
    const before = await evaluate("document.querySelectorAll('.msg.user').length");
    await evaluate("(() => {const input=document.querySelector('.composer-input-row textarea');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));})()");
    await settled();
    assert.equal(await evaluate("document.querySelectorAll('.msg.user').length"), before, "Composition Enter must not submit");
    await click(".composer-send");
    assert.equal(await evaluate("document.querySelectorAll('.msg.user').length"), before + 1);
    assert.equal(await evaluate("document.querySelector('.composer-input-row textarea').value"), "");
    await navigate({ width: 720 });
    await click(".conversation-directory-button");
    assert.equal((await geometry()).chat.visible, false);
    await click(".inbox-colleagues .inbox-contact-shell:first-child .inbox-contact");
    assert.ok((await geometry()).chat.width >= 480);
    assert.equal(await evaluate("document.querySelector('.conversation-person b').textContent"), "Lin");
    for (const locale of ["zh", "en"]) for (const theme of ["light", "dark"]) for (const width of [720, 900, 1100, 1280]) for (const scenario of ["long", "approval", "decision"]) {
      await navigate({ width, locale, theme, scenario });
      const result = await geometry();
      assert.ok(result.body <= width + 1); assert.deepEqual(result.overflow, []);
      receipts.push({ locale, theme, width, scenario, ...result });
      await capture(`${scenario}-${locale}-${theme}-${width}`);
      if (scenario === "approval") {
        assert.equal(await evaluate("document.querySelectorAll('.approval-card button').length"), 2);
        await click(".approval-card button");
        assert.equal(await evaluate("document.querySelectorAll('.approval-card button').length"), 0);
      }
      if (scenario === "decision") {
        assert.equal(await evaluate("document.querySelectorAll('[data-decision-option]').length"), 3);
        await evaluate("document.querySelector('[data-decision-option]').focus()"); await key("ArrowDown");
        assert.equal(await evaluate("document.activeElement === document.querySelectorAll('[data-decision-option]')[1]"), true);
      }
    }
    for (const width of [720, 900, 1100, 1280, 1600]) {
      await navigate({ width, extension: true }); const result = await geometry();
      assert.ok(!result.chat.visible || result.chat.width >= 480, `Extension squeezes chat at ${width}: ${result.chat.width}`);
      await capture(`extension-open-${width}`);
      await click('.extension-dock-actions button:last-child');
      assert.ok((await geometry()).chat.width >= 480, "Hiding side panel restores the chat");
      receipts.push({ extension: true, width, ...result }); await capture(`extension-closed-${width}`);
    }
    for (const width of [720, 900, 1100, 1280]) {
      await navigate({ width, extension: true, scenario: "approval" }); const result = await geometry();
      assert.ok(result.chat.visible && result.chat.width >= 480, "Pending approval keeps a readable chat");
      assert.ok(result.drawer.visible && result.drawer.height > 100, "Pending approval does not discard the artifact panel");
      assert.ok(result.chat.height < 900, "Narrow approvals stack rather than squeeze the chat");
      assert.ok(result.chat.height + result.drawer.height <= 901);
      await evaluate("(() => {const scroll=document.querySelector('.chat.im .scroll');scroll.scrollTop=scroll.scrollHeight;})()");
      await settled();
      assert.equal(await evaluate("(() => {const card=document.querySelector('.approval-card').getBoundingClientRect(), scroll=document.querySelector('.chat.im .scroll').getBoundingClientRect();return card.top>=scroll.top-1 && card.bottom<=scroll.bottom+1;})()"), true, "The complete approval card remains readable above the composer");
      receipts.push({ extension: true, pendingApproval: true, width, ...result }); await capture(`extension-approval-${width}`);
      await click('.extension-dock-actions button:last-child');
      assert.ok((await geometry()).chat.width >= 480, "Returning to chat leaves the approval available");
      assert.equal(await evaluate("document.querySelectorAll('.approval-card button').length"), 2);
    }
    await navigate({ width: 1600, extension: true });
    await evaluate("localStorage.setItem('hara.extensionDock.width.v1', '72')");
    await navigate({ width: 1600, extension: true });
    assert.equal(await evaluate("document.querySelector('.extension-dock').style.getPropertyValue('--extension-dock-width')"), "72%", "The saved-width case must actually load its preference");
    assert.ok((await geometry()).chat.width >= 480, "A saved large dock preference still preserves readable chat");
    await click('.extension-dock-mode-action');
    assert.equal((await geometry()).chat.visible, false);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.extension-dock-return-label')).display !== 'none'"), true);
    await click('.extension-dock-actions button:last-child');
    assert.ok((await geometry()).chat.width >= 480);
  }
  assert.deepEqual(errors, [], "No uncaught renderer exceptions");
  successfulResult = { status: baseline ? "baseline_recorded" : "passed", syntheticOnly: true, engineAcceptance: false, receipts };
} catch (error) {
  console.error(error.message); process.exitCode = 1;
  try { await capture("failure"); writeFileSync(join(output, "failure.json"), JSON.stringify({ error: error.message, geometry: await geometry(), rendererErrors: errors }, null, 2), { mode: 0o600 }); } catch {}
} finally {
  const alive = () => chrome.exitCode === null && chrome.signalCode === null;
  const closed = alive() ? once(chrome, "close") : Promise.resolve();
  if (socket?.readyState === WebSocket.OPEN) { try { await send("Browser.close", {}, false); } catch {} }
  socket?.close(); for (const request of pending.values()) clearTimeout(request.timer);
  if (alive()) chrome.kill("SIGTERM");
  await Promise.race([closed, pause(2000)]);
  if (alive()) { chrome.kill("SIGKILL"); await Promise.race([closed, pause(1000)]); }
  let removed = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { rmSync(profile, { recursive: true, force: true }); removed = true; break; }
    catch (error) {
      if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(error.code) || attempt === 5) break;
      await pause(250 * (attempt + 1));
    }
  }
  if (!removed) {
    process.exitCode = 1;
    console.error(`Owned synthetic Chrome profile cleanup failed: ${profile}`);
  }
  if (successfulResult) {
    successfulResult.cleanup = removed ? "passed" : "failed";
    if (!removed) successfulResult.status = "cleanup_failed";
    writeFileSync(join(output, "result.json"), JSON.stringify(successfulResult, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ status: successfulResult.status, cleanup: successfulResult.cleanup, scenarios: receipts.length, output }));
  }
}
