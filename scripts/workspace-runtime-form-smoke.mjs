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
assert(outputArg && scratchArg && !mode);
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
const http = createHttpServer(vite.middlewares), profile = mkdtempSync(join(scratch, "runtime-form-chrome-"));
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
  await send("Input.dispatchKeyEvent", { ...params, type: "keyDown", ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) }); await send("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
};

const setSelect = (label, value) => evaluate(`(()=>{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');if(!e)throw Error('missing select ${label}');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`);
const value = label => evaluate(`document.querySelector('select[aria-label=${JSON.stringify(label)}]')?.value ?? null`);
const options = label => evaluate(`Array.from(document.querySelector('select[aria-label=${JSON.stringify(label)}]')?.options ?? []).map(o=>o.value)`);
const text = selector => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
let base = "";
const dialog = `document.querySelector('dialog.vg-rf-dialog[open]')`;
const open = async (query) => { await send("Page.navigate", { url: `${base}/test/fixtures/runtime-form-preview.html?${query}` }); };
const L = { zh: { engine: "引擎", model: "模型", effort: "思考强度" }, en: { engine: "Engine", model: "Model", effort: "Thinking effort" } };
try {
  await new Promise((done, fail) => { http.once("error", fail); http.listen(0, "127.0.0.1", done); });
  const address = http.address(); base = `http://127.0.0.1:${address.port}`;
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

  // 1. Saved state (zh-Hans, dark): one form, one Apply, nothing unsaved; shared setting is named.
  step = "zh-saved"; await open("locale=zh-Hans&theme=dark");
  await wait(`window.runtimeFormFixture && document.querySelector('select[aria-label="模型"]')?.value`);
  assert.equal(await value(L.zh.engine), "codex"); assert.equal(await value(L.zh.model), "gpt-6.1-sol"); assert.equal(await value(L.zh.effort), "medium");
  assert.deepEqual((await options(L.zh.effort)).slice(0, 2), ["auto", "engine-default"], "Auto then Engine default come first");
  assert((await text(".vg-rf-foot")).includes("已保存")); assert(await evaluate(`document.querySelector('.vg-rf-apply').disabled`));
  assert.equal(await evaluate(`document.querySelectorAll('.vg-rf button.vg-rf-apply').length`), 1, "one Apply");
  assert((await text("[data-shared-setting]")).includes("小周"));
  samples.push({ step }); await screenshot("01-zh-saved");
  // 2. Switch engine: models, default, effort and version follow immediately; Apply is the only save.
  step = "zh-switch"; await setSelect(L.zh.engine, "claude");
  await wait(`document.querySelector('select[aria-label="模型"]')?.value === "sonnet"`);
  assert.deepEqual(await options(L.zh.model), ["sonnet", "opus", "haiku"]);
  assert.equal(await value(L.zh.effort), "medium", "a level the new model declares is kept");
  const meta = await text(".vg-rf-card .vg-rf-meta");
  assert(meta.includes("2.3.1") && meta.includes("/Users/fixture/.local/bin/claude") && meta.includes("第一次用时确认"), meta);
  assert(!meta.includes("0.163.0"), "the version row follows the draft engine");
  assert((await text(".vg-rf-foot")).includes("未保存：引擎"));
  assert.deepEqual(await evaluate("window.runtimeFormFixture.applies"), [], "nothing saved before Apply");
  samples.push({ step, meta }); await screenshot("02-zh-switch-claude");
  // 3. A model without effort levels hides the control and says the level was dropped.
  step = "zh-no-effort"; await setSelect(L.zh.model, "haiku");
  await wait(`document.querySelector('[data-effort-hidden]')`);
  assert.equal(await evaluate(`document.querySelector('select[aria-label="思考强度"]')`), null);
  assert((await text(".vg-rf-warn")).includes("中"));
  await setSelect(L.zh.model, "opus"); await wait(`document.querySelector('select[aria-label="思考强度"]')`);
  assert.equal(await value(L.zh.effort), "auto", "Q4: the dropped level falls back to Auto");
  await setSelect(L.zh.effort, "engine-default");
  samples.push({ step }); await screenshot("03-zh-effort-engine-default");
  // 4. Apply asks once: focus on the primary action, Esc cancels with nothing saved, confirm sends the fingerprint.
  step = "zh-confirm"; await click(`document.querySelector('.vg-rf-apply')`); await wait(`!!${dialog}`);
  const proof = await evaluate(`(()=>{const d=${dialog};return {focused:document.activeElement?.classList.contains('wsd-primary'),text:d.textContent}})()`);
  assert.equal(proof.focused, true);
  assert(proof.text.includes("2.3.1") && proof.text.includes("Hara 不保存密码") && proof.text.includes("接着聊当前对话"), proof.text);
  await screenshot("04-zh-first-use-confirm");
  await key("Escape", 27); await wait(`!${dialog}`);
  assert.deepEqual(await evaluate("window.runtimeFormFixture.applies"), []);
  await click(`document.querySelector('.vg-rf-apply')`); await wait(`!!${dialog}`);
  await click(`${dialog}.querySelector('button.wsd-primary')`); await wait(`!${dialog}`);
  const applied = await evaluate("window.runtimeFormFixture.applies");
  assert.deepEqual(applied, [{ agentId: "lin", restart: "keep", input: { runtimeId: "claude", confirm: { fingerprint: "fixture-claude", loginSource: "host" },
    model: { modelId: "opus", expectedRevision: 0, effort: "engine-default" } } }], JSON.stringify(applied));
  await wait(`document.querySelector('.vg-rf-foot')?.textContent.includes('已保存')`);
  samples.push({ step, applied }); await screenshot("05-zh-applied");
  // 5. Updated engine: confirm once without changing anything else.
  step = "zh-updated"; await open("locale=zh-Hans&theme=dark&scenario=updated");
  await wait(`document.querySelector('.vg-rf-card .vg-rf-meta')?.textContent.includes('已更新')`);
  assert.deepEqual(await options(L.zh.model), [""], "Codex before confirmation: engine default only");
  assert(!await evaluate(`document.querySelector('.vg-rf-apply').disabled`), "an update can be confirmed without other changes");
  await screenshot("06-zh-updated");
  await click(`document.querySelector('.vg-rf-apply')`); await wait(`!!${dialog}`);
  assert((await evaluate(`${dialog}.textContent`)).includes("已更新"));
  await click(`${dialog}.querySelector('button.wsd-primary')`); await wait(`!${dialog}`);
  assert.deepEqual(await evaluate("window.runtimeFormFixture.applies[0].input"), { runtimeId: "codex", confirm: { fingerprint: "fixture-codex", loginSource: "host" } });
  await wait(`document.querySelector('select[aria-label="模型"]')?.value === "gpt-6.2-sol"`);
  samples.push({ step }); await screenshot("07-zh-updated-confirmed");
  // 6. English, light: a model without effort levels; unavailable engine has a reason and recheck.
  step = "en-light"; await open("locale=en&theme=light&scenario=gemini");
  await wait(`document.querySelector('[data-effort-hidden]')`);
  assert((await text(".vg-rf-card")).includes("This model has no effort levels"));
  await setSelect(L.en.engine, "codex"); await wait(`document.querySelector('select[aria-label="Model"]')?.value === "gpt-6.1-sol"`);
  assert.equal(await value(L.en.effort), "auto", "Gemini's Auto carries over to Codex");
  await screenshot("08-en-light-switch");
  assert(await evaluate(`Array.from(document.querySelector('select[aria-label="Engine"]').options).find(o=>o.value==='opencode').disabled`), "an unavailable engine cannot be chosen");
  samples.push({ step });
  // 7. Pi keeps its connection model and offers no Engine default.
  step = "pi"; await open("locale=zh-Hans&theme=dark&scenario=pi");
  await wait(`document.querySelector('select[aria-label="模型"]')?.value === "glm-5"`);
  assert(!(await options(L.zh.effort)).includes("engine-default"));
  await screenshot("09-zh-pi"); samples.push({ step });
  // 8. Settings engine list: read-only status, no registration button, last check shown.
  step = "settings"; await open("locale=zh-Hans&theme=dark&scenario=settings");
  await wait(`document.querySelector('[data-first-use]')`);
  const rows = await evaluate(`Array.from(document.querySelectorAll('.wsd-runtime-row')).map(r=>({name:r.querySelector('strong')?.textContent,status:r.querySelector('[data-runtime-use]')?.textContent??'',primary:r.querySelectorAll('button.wsd-primary').length,users:r.querySelector('[data-runtime-users]')?.textContent??''}))`);
  const claude = rows.find(row => row.name === "Claude Code");
  assert(claude && claude.status.includes("第一次用时确认") && claude.primary === 0, JSON.stringify(rows));
  assert(rows.find(row => row.name === "Codex")?.users.includes("小周"));
  assert(rows.find(row => row.name === "OpenCode")?.status.includes("未安装"));
  assert((await text(".wsd-runtime-checked")).includes("上次检查"));
  await evaluate(`Array.from(document.querySelectorAll('.wsd-runtime-row')).find(r=>r.querySelector('strong')?.textContent==='Claude Code').scrollIntoView({block:'center',behavior:'instant'})`);
  await new Promise(done => setTimeout(done, 100));
  samples.push({ step, rows }); await screenshot("10-zh-settings");
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "result.json"), JSON.stringify({ passed: true, samples, errors, realModelCalls: 0, realRuntimeOperations: 0 }, null, 2) + "\n");
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
