#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { requestCdp } from "./browser-cdp-request.mjs";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "./browser-process.mjs";

assert(loadavg()[0] < 30, "Run the component browser fixture only below load1 30");
const [outputArg, scratchArg, mode] = process.argv.slice(2);
assert(outputArg && scratchArg && (!mode || mode === "--baseline"));
for (const value of [outputArg, scratchArg]) assert(isAbsolute(value));
const output = resolve(outputArg), scratch = resolve(scratchArg);
assert(!existsSync(output), "Keep previous browser evidence");
mkdirSync(output, { mode: 0o700 });
for (const value of [output, scratch]) {
  const info = lstatSync(value);
  assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
  assert.equal(realpathSync(value), value);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = await createServer({ root, configFile: false, plugins: [react()], server: { middlewareMode: true, hmr: false, watch: { ignored: ["**/src-tauri/**"] } } });
const http = createHttpServer(vite.middlewares), profile = mkdtempSync(join(scratch, "runtime-register-chrome-"));
const pending = new Map(), errors = [], samples = [];
let chrome, socket, sessionId, requestId = 0, step = "start";
const send = (method, params = {}, browser = false) => requestCdp(socket, pending, { id: ++requestId, method, params, sessionId: browser ? undefined : sessionId, step });
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text);
  return result.result.value;
};
const wait = async expression => {
  for (let count = 0; count < 150; count++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(done => setTimeout(done, 100)); }
  throw new Error("Component wait timed out at " + step);
};
const screenshot = async name => { const png = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(output, name + ".png"), Buffer.from(png.data, "base64")); };
const click = async expression => {
  const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error('Missing click target');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
};
const key = async (key, code, shift = false) => {
  const params = { key, code: key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
  await send("Input.dispatchKeyEvent", { ...params, type: "keyDown" }); await send("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
};
const row = id => `Array.from(document.querySelectorAll('.wsd-runtime-row')).find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(id)})`;
const opener = id => `${row(id)}?.querySelector('button')`;
const dialog = `document.querySelector('dialog.wsd-runtime-setup-dialog[open]')`;
try {
  await new Promise((done, fail) => { http.once("error", fail); http.listen(0, "127.0.0.1", done); });
  const address = http.address(), base = `http://127.0.0.1:${address.port}`;
  const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert(chromePath, "Headless Chrome is required");
  chrome = spawn(chromePath, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((done, fail) => {
    let tail = ""; const timer = setTimeout(() => fail(new Error("Owned headless browser did not start")), 20000);
    chrome.stderr.on("data", chunk => { const next = readDevToolsAnnouncement(tail, chunk); tail = next.tail; if (next.url) { clearTimeout(timer); done(next.url); } });
    chrome.once("error", error => { clearTimeout(timer); fail(error); });
    chrome.once("exit", () => { clearTimeout(timer); fail(new Error("Owned browser exited")); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const request = message.params;
      const allowed = new URL(request.request.url).origin === base;
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: request.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }).catch(error => errors.push(String(error)));
    }
    const waiting = pending.get(message.id); if (!waiting) return;
    pending.delete(message.id); clearTimeout(waiting.timer);
    message.error ? waiting.fail(new Error(message.error.message)) : waiting.done(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, true);
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, true)).sessionId;
  await send("Runtime.enable"); await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const [locale, theme, runtime] of mode === "--baseline" ? [["en", "light", "Codex"]]
    : [["en", "light", "Codex"], ["zh-Hans", "dark", "Codex"], ["zh-Hant", "light", "Antigravity"]]) {
    step = `${locale}-${theme}-${runtime}`;
    await send("Page.navigate", { url: `${base}/test/fixtures/workspace-runtime-register-preview.html?locale=${locale}&theme=${theme}` });
    await wait(`window.runtimeRegisterFixture && ${opener(runtime)} && !${opener(runtime)}.disabled`);
    await evaluate(`${row(runtime)}.scrollIntoView({block:'center',behavior:'instant'})`);
    await new Promise(done => setTimeout(done, 100));
    const before = await evaluate(`document.querySelector('.wss-main').scrollTop`);
    await click(opener(runtime));
    if (mode === "--baseline") {
      await wait(`document.querySelector('.wsd-runtime-bind-dialog')`);
      const geometry = await evaluate(`(()=>{const e=document.querySelector('.wsd-runtime-bind-dialog');return {top:e.getBoundingClientRect().top,viewport:innerHeight,scroll:document.querySelector('.wss-main').scrollTop,focused:document.activeElement===${opener(runtime)},modal:!!${dialog}}})()`);
      assert(geometry.top > geometry.viewport, "Baseline binding section is below the visible viewport");
      assert.equal(geometry.scroll, before); assert.equal(geometry.focused, true); assert.equal(geometry.modal, false);
      samples.push({ step, before, geometry }); await screenshot("before-click-binding-below-fold"); continue;
    }
    await wait(`!!${dialog}`);
    const proof = await evaluate(`(()=>{const d=${dialog},r=d.getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,focused:d.contains(document.activeElement)&&document.activeElement.matches('input:checked:not(:disabled)'),scroll:document.querySelector('.wss-main').scrollTop,text:d.textContent}})()`);
    assert.equal(proof.visible, true); assert.equal(proof.focused, true); assert.equal(proof.scroll, before);
    assert(proof.text.includes("1.2.3") && proof.text.includes("/fixture/bin/"));
    await screenshot(step + "-dialog");
    for (let count = 0; count < 6; count++) { await key("Tab", 9); assert(await evaluate(`${dialog}.contains(document.activeElement)`)); }
    await key("Tab", 9, true); assert(await evaluate(`${dialog}.contains(document.activeElement)`));
    await key("Escape", 27); await wait(`!${dialog}`);
    assert.equal(await evaluate("window.runtimeRegisterFixture.closeCount"), 0);
    assert(await evaluate(`document.activeElement===${opener(runtime)}`));
    await click(opener(runtime)); await wait(`!!${dialog}`);
    await click(`${dialog}.querySelector('.wsd-card-actions button')`); await wait(`!${dialog}`);
    assert(await evaluate(`document.activeElement===${opener(runtime)}`));
    assert.equal(await evaluate("window.runtimeRegisterFixture.registrations.length"), 0);
    await click(opener(runtime)); await wait(`!!${dialog}`);
    await click(`${dialog}.querySelector('.wsd-card-actions button.wsd-primary')`); await wait(`!${dialog}`);
    const result = await evaluate(`({registrations:window.runtimeRegisterFixture.registrations,returned:document.activeElement===${row(runtime)},text:${row(runtime)}.textContent})`);
    const id = runtime === "Codex" ? "codex" : "agy";
    assert.deepEqual(result.registrations, [[id, `fixture-${id}`, "fixture", "generation-1", id === "agy" ? "isolated" : "host"]]);
    assert.equal(result.returned, true); assert(!await evaluate(`!!${opener(runtime)}`), "Registered row no longer offers registration");
    samples.push({ step, before, proof, result }); await screenshot(step + "-registered");
  }
  if (mode !== "--baseline") {
    for (const scenario of ["pending", "install", "scope"]) {
      step = scenario;
      await send("Page.navigate", { url: `${base}/test/fixtures/workspace-runtime-register-preview.html?locale=en&theme=light&scenario=${scenario}` });
      await wait(`window.runtimeRegisterFixture && ${opener("Codex")} && !${opener("Codex")}.disabled`);
      await evaluate(`${row("Codex")}.scrollIntoView({block:'center',behavior:'instant'})`);
      await click(opener("Codex")); await wait(`!!${dialog}`);
      if (scenario === "pending") {
        await click(`${dialog}.querySelector('.wsd-card-actions button.wsd-primary')`);
        await wait(`window.runtimeRegisterFixture.registrations.length===1`);
        await key("Escape", 27); assert(await evaluate(`!!${dialog}`), "Escape cannot dismiss a submitted registration");
        await key("Tab", 9); assert(await evaluate(`${dialog}.contains(document.activeElement)`));
        await evaluate("window.runtimeRegisterFixture.finishRegistration()"); await wait(`!${dialog}`);
        assert.equal(await evaluate("window.runtimeRegisterFixture.registrations.length"), 1);
      } else if (scenario === "install") {
        assert(await evaluate(`${dialog}.contains(document.activeElement)`));
        await key("Escape", 27); await wait(`!${dialog}`);
        assert.deepEqual(await evaluate("window.runtimeRegisterFixture.approvals.map(args=>[args[0].id,args[1],args[2]])"), [["fixture-card", false, "host"]]);
      } else {
        await evaluate("window.runtimeRegisterFixture.changeScope()"); await wait(`!${dialog}`);
        assert.equal(await evaluate("window.runtimeRegisterFixture.registrations.length"), 0);
      }
      assert.equal(await evaluate("window.runtimeRegisterFixture.closeCount"), 0);
      samples.push({ step, passed: true });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "result.json"), JSON.stringify({ passed: true, mode: mode ?? "modal", samples, errors, realModelCalls: 0, realRuntimeOperations: 0 }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, samples: samples.length, output }));
} catch (error) {
  writeFileSync(join(output, "failure.json"), JSON.stringify({ step, error: String(error), errors, samples }, null, 2));
  if (sessionId) await screenshot("failure").catch(() => {});
  throw error;
} finally {
  socket?.close();
  for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error("Fixture closed")); } pending.clear();
  if (chrome) await stopOwnedBrowser(chrome);
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) rmSync(profile, { recursive: true, force: true });
  if (http.listening) await new Promise(done => http.close(done)); await vite.close();
}
