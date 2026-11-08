#!/usr/bin/env node
/**
 * B1 language screenshots.
 *
 * Real React surfaces from `test/fixtures/*`, driven in a task-owned headless Chrome,
 * backed only by in-memory fixtures. No Tauri, no model call, no credentials.
 *
 * This release accepts English and Simplified only (Jeff 2026-11-08 revision), so the
 * matrix is 6 surfaces x 2 locales x 2 themes. Traditional stays in the locale JSON and
 * is covered by `test/i18n-contract.test.mjs`, not by screenshots.
 *
 * Usage: node scripts/i18n-b1-screenshots.mjs <base-url> <absolute-evidence-dir>
 *   <base-url> must be an IPv4 loopback Vite root, e.g. http://127.0.0.1:54991/
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, lstatSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:54991/");
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1") throw new Error("Use the task-owned IPv4 loopback Vite root");
const output = resolve(process.argv[3] ?? "");
assert.ok(isAbsolute(output), "absolute evidence directory required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const info = lstatSync(output);
assert.ok(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0, "evidence must be private");
assert.equal(realpathSync(output), output);
assert.deepEqual(readdirSync(output), [], "never overwrite earlier evidence");

const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find(value => value && existsSync(value));
if (!chromePath) throw new Error("Chrome/Chromium required");

const profile = mkdtempSync(join(tmpdir(), "hara-i18n-shot-"));
const chrome = spawn(chromePath, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-background-mode",
  "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-gpu",
  "--disable-sync", "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });

let socket, sessionId;
const pending = new Map();
let requestId = 0;
const errors = [];
const pause = ms => new Promise(done => setTimeout(done, ms));

async function connect() {
  const url = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("headless Chrome start timed out")), 15000);
    chrome.stderr.on("data", chunk => {
      text = (text + chunk.toString()).slice(-4000);
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match) { clearTimeout(timer); done(match[1]); }
    });
  });
  socket = new WebSocket(url);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error(`${request.method}: ${message.error.message}`)); else request.done(message.result);
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable");
  const version = await send("Browser.getVersion", {}, false);
  await send("Emulation.setUserAgentOverride", { userAgent: version.userAgent, platform: "MacIntel" });
}
async function send(method, params = {}, scoped = true) {
  const id = ++requestId;
  const result = new Promise((done, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`${method} timed out`)); }, 20000);
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
async function settled() {
  await evaluate(`(async()=>{for(let f=0;f<4;f++){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const a=document.getAnimations().filter(x=>x.playState==='running'&&Number.isFinite(x.effect?.getComputedTiming().endTime));
    if(!a.length)return;await Promise.all(a.map(x=>x.finished.catch(()=>{})));}})()`);
}
async function ready(expression, label) {
  for (let attempt = 0; attempt < 160; attempt++) { if (await evaluate(expression)) return; await pause(75); }
  const diagnostic = await evaluate("({url:location.href,text:document.body.innerText.slice(0,1200)})");
  throw new Error(`${label}: ${JSON.stringify(diagnostic).slice(0, 400)}`);
}

const SCREENS = [
  // Real WorkspaceScreen (in-memory RPC): sidebar, management drawer and settings live here.
  { name: "sidebar", page: "violet-glass-preview.html", settle: "!!document.querySelector('.hs-side .hs-row, .hs-side')" },
  // Opening the drawer needs the roster menu → Manage, so this screen uses a key step.
  { name: "manage-drawer", page: "violet-glass-preview.html", settle: "!!document.querySelector('[data-roster-id]')",
    clickIfClosed: "[aria-controls=workspace-inspector][aria-expanded=false]", waitFor: ".vg-colleague-manage" },
  { name: "engine-form", page: "runtime-form-preview.html", settle: "!!document.querySelector('.vg-rf')" },
  { name: "settings", page: "violet-glass-preview.html", settle: "!!document.querySelector('.hd-sidebar-tools')",
    clickByLabel: ["Settings", "设置"], waitFor: ".wss-main, .wss-nav" },
  { name: "recovery-error", page: "renderer-recovery-preview.html", settle: "!!document.querySelector('.renderer-recovery')" },
  { name: "runtime-failure", page: "runtime-failure-preview.html", settle: "!!document.body" },
];
const THEMES = ["light", "dark"];
const LOCALES = ["en", "zh-Hans"];

const captures = [];
let screenshots = 0;
async function shot(screen, locale, theme) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 2, mobile: false });
  const query = [screen.query ?? "", `locale=${locale}`, `theme=${theme}`].filter(Boolean).join("&");
  const url = new URL(`test/fixtures/${screen.page}?${query}`, base).href;
  await send("Page.navigate", { url });
  // Theme/locale are written after navigation: about:blank has no storage access.
  await pause(120);
  await evaluate("try{localStorage.setItem('hara.theme', '" + theme + "'); localStorage.setItem('hara.locale', '" + locale + "');}catch{}");
  await ready(screen.settle, `${screen.name} did not settle (${locale}/${theme})`);
  await settled();
  if (screen.clickByLabel) {
    const labels = screen.clickByLabel;
    const clicked = await evaluate(`(()=>{const labels=${JSON.stringify(labels)};
      const n=[...document.querySelectorAll('button[aria-label]')].find(b=>labels.some(l=>b.getAttribute('aria-label')===l));
      if(!n) return false; n.click(); return true;})()`);
    if (!clicked) throw new Error(`${screen.name}: no button labelled ${labels.join("/")}`);
    await settled(); await pause(300);
  }
  if (screen.click) {
    const clicked = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(screen.click)}); if(!n) return false; n.click(); return true;})()`);
    if (!clicked) throw new Error(`${screen.name}: click target ${screen.click} missing`);
    await settled(); await pause(250);
  }
  if (screen.clickIfClosed) {
    const toggled = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(screen.clickIfClosed)}); if(!n) return false; n.click(); return true;})()`);
    if (!toggled) {
      // Inspector may already be open; select the colleague row instead.
      await evaluate(`(()=>{const n=document.querySelector('[data-roster-id]:not([data-roster-id=main])'); if(n) n.click(); return !!n;})()`);
    }
    await settled(); await pause(300);
  }
  if (screen.thenMenu) {
    // Keyboard Menu (Shift+F10 / F10) opens the same roster menu as right-click.
    await evaluate(`(()=>{const n=document.querySelector('[data-roster-id]:not([data-roster-id=main])'); if(!n) return false; n.focus();
      n.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',code:'F10',keyCode:121,bubbles:true})); return true;})()`);
    await settled(); await pause(200);
    await evaluate(`(()=>{const b=[...document.querySelectorAll('.vg-roster-menu button, .hd-roster-menu button')].find(x=>/Manage|管理/.test(x.textContent||'')); if(b) b.click(); return !!b;})()`);
    await settled(); await pause(250);
  }
  if (screen.waitFor) await ready(`!!document.querySelector(${JSON.stringify(screen.waitFor)})`, `${screen.name}: ${screen.waitFor} never appeared`);
  await pause(150);
  // `<html lang>` must follow the chosen locale (B0 behaviour, visible in the DOM).
  const lang = await evaluate("document.documentElement.lang");
  const text = await evaluate("document.body.innerText.replace(/\\s+/g,' ').slice(0,400)");
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = `${screen.name}-${locale}-${theme}.png`;
  writeFileSync(join(output, file), Buffer.from(result.data, "base64"), { mode: 0o600 });
  screenshots++;
  captures.push({ screen: screen.name, locale, theme, lang, text, file });
  return { lang, text };
}

try {
  await connect();
  await send("DOM.enable");
  for (const theme of THEMES) for (const locale of LOCALES) for (const screen of SCREENS) await shot(screen, locale, theme);
  // Language picker: this release must offer exactly system + English + Simplified.
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: new URL("test/fixtures/violet-glass-preview.html?locale=zh-Hans&theme=light", base).href });
  await pause(120);
  await evaluate("try{localStorage.setItem('hara.locale','zh-Hans');}catch{}");
  await ready("!!document.querySelector('.hd-sidebar-tools')", "sidebar missing for picker check");
  await evaluate(`(()=>{const n=[...document.querySelectorAll('button[aria-label]')].find(b=>["Settings","设置"].includes(b.getAttribute('aria-label'))); if(n) n.click(); return !!n;})()`);
  await ready("!!document.querySelector('.wss-main, .wss-nav')", "settings surface missing for picker check");
  // Jump to the appearance page, where the language picker lives.
  await evaluate(`(()=>{const n=[...document.querySelectorAll('.wss-nav button')].find(b=>/外观|Appearance/i.test(b.textContent||'')); if(n) n.click(); return !!n;})()`);
  await settled(); await pause(250);
  await ready("!!document.querySelector('select')", "appearance picker missing");
  const options = await evaluate("[...document.querySelectorAll('option')].map(o=>o.value)");
  assert.deepEqual(options.filter(v => v === "en" || v === "zh-Hans").length >= 2, true, "English and Simplified must be offered");
  assert.equal(options.includes("zh-Hant"), false, "beta zh-Hant must not be offered");
  writeFileSync(join(output, "language-picker.json"), JSON.stringify({ options, locales: options }, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(output, "captures.json"), JSON.stringify({ base: base.href, screenshots, captures, errors }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, screenshots, output }));
} catch (error) {
  writeFileSync(join(output, "failure.json"), JSON.stringify({ error: String(error?.stack ?? error), errors }, null, 2) + "\n", { mode: 0o600 });
  throw error;
} finally {
  try { chrome.kill(); } catch { /* already gone */ }
}
