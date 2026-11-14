#!/usr/bin/env node
// Real Inspector + C5 card, actual Core C1 WS Host, task-private loopback/profile only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { build } from "esbuild";
import { requestCdp } from "./browser-cdp-request.mjs";
import { navigateCdp } from "./browser-cdp-navigation.mjs";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "./browser-process.mjs";
import { waitForLayout } from "./browser-layout-wait.mjs";
const args = process.argv.slice(2);
if (args.includes("--help")) { console.log("node scripts/work-scope-browser-smoke.mjs --core-repository PATH --core-ref SHA --scratch TASK_SCRATCH --evidence TASK_EVIDENCE (Node 22.23.1; run under the standard private-HOME guard)"); process.exit(0); }
const option = name => { const n = args.indexOf(name); assert(n >= 0 && args[n + 1], name + " required"); return args[n + 1]; };
assert.equal(process.version, "v22.23.1");
const core = realpathSync(option("--core-repository")), coreRef = option("--core-ref");
assert(/^[0-9a-f]{40}$/.test(coreRef));
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" }).trim(), coreRef, "Build and run the exact Core ref");
execFileSync("git", ["diff", "--exit-code", coreRef, "--", "src", "package-lock.json"], { cwd: core });
const scratch = resolve(option("--scratch")), evidence = resolve(option("--evidence"));
for (const folder of [scratch, evidence]) { assert(!existsSync(folder), "Use a fresh task-owned destination"); mkdirSync(folder, { recursive: true, mode: 0o700 }); }
const guardRoot = realpathSync(process.env.HARA_WRAPPER_EVIDENCE_ROOT ?? "");
assert(realpathSync(process.env.HOME).startsWith(guardRoot + "/"), "private HOME required");
assert(realpathSync(scratch).startsWith(guardRoot + "/"), "scratch must be inside guard scope");
const repo = fileURLToPath(new URL("../", import.meta.url));
const { startLocalWorkspaceServe } = await import(pathToFileURL(join(core, "dist/serve/local-workspace.js")).href);
const { WorkspaceColleagueHomes } = await import(pathToFileURL(join(core, "dist/workspace/colleague-homes.js")).href);
const { WorkspaceResourceStorage } = await import(pathToFileURL(join(core, "dist/workspace/resource-storage.js")).href);
const documents = JSON.parse(readFileSync(join(core, "test/fixtures/agent-boundaries-v1.json"), "utf8"));
const root = realpathSync(mkdtempSync(join(scratch, "core-"))), ownerCredential = randomBytes(32).toString("hex");
const counters = { providers: 0, ownerReads: 0, guestDenials: 0, browserReads: 0, writesAfterSetup: 0 };
let handle, http, browser, socket, sessionId, serial = 0, step = "setup", serverError, setupComplete = false;
const clients = [], pending = new Map(), exceptions = [], receipts = [], observedPageOrigins = new Set();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}`), pending = new Map(); let serial = 0;
  ws.addEventListener("error", () => {});
  ws.addEventListener("message", ({ data }) => { const value = JSON.parse(data), row = pending.get(value.id); if (!row) return;
    pending.delete(value.id); clearTimeout(row.timer); value.error ? row.reject(Object.assign(Error("Host request rejected"), { data: value.error.data, rpcCode: value.error.code })) : row.resolve(value.result); });
  await new Promise((done, fail) => { ws.addEventListener("open", done, { once: true }); ws.addEventListener("error", fail, { once: true }); });
  const result = { request(method, params = {}) {
    if (setupComplete && !["initialize", "workspace.boundaries.get", "workspace.snapshot"].includes(method)) counters.writesAfterSetup++;
    return new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error("Private Host RPC deadline")); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); }); },
    async close() { if (ws.readyState === WebSocket.CLOSED) return; const done = new Promise(resolve => ws.addEventListener("close", resolve, { once: true })); ws.close(); await done;
      for (const row of pending.values()) { clearTimeout(row.timer); row.reject(Error("Private Host closed")); } pending.clear(); } };
  clients.push(result); return result;
}
const denied = promise => assert.rejects(promise, error => error.data?.boundary?.code === "AUTHORITY_UNVERIFIED");
let owner, guest, initialized, target, snapshot, agent, connectionId, directoryPath;
async function bootstrap(mode) {
  if (mode !== "owner") return { snapshot, agent, target, capabilities: mode === "guest" ? initialized.capabilities : [], connectionId: "untrusted", view: null };
  const view = await owner.request("workspace.boundaries.get", { workspaceId: target.workspaceId, agentId: target.agentId }); counters.ownerReads++;
  assert.equal(typeof directoryPath, "string");
  const resourceDescriptions = view.policy.resources.map(ref => ({ ...ref, label: "Accounts", path: directoryPath }));
  return { snapshot, agent, target, capabilities: initialized.capabilities, connectionId, view, resourceDescriptions };
}
function send(method, params = {}, scoped = true) { return requestCdp(socket, pending, { id: ++serial, method, params, sessionId: scoped ? sessionId : undefined, step, timeoutMs: method === "Page.navigate" ? 30000 : 15000 }); }
async function evaluate(expression) { const row = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (row.exceptionDetails) throw Error(row.exceptionDetails.exception?.description ?? row.exceptionDetails.text); return row.result?.value; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(expression, label) { for (let n = 0; n < 160; n++) { if (await evaluate(expression)) return; await pause(50); } throw Error(label); }
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); }
async function capture(name) { const clip = await evaluate("(()=>{const r=document.getElementById('root').getBoundingClientRect();return{x:Math.max(0,r.x),y:0,width:Math.min(r.width,innerWidth),height:innerHeight,scale:1}})()");
  const data = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip }); const bytes = Buffer.from(data.data, "base64"); writeFileSync(join(evidence, name + ".png"), bytes, { mode: 0o600 }); return { file: name + ".png", sha256: digest(bytes), bytes: bytes.length }; }
const card = ".hd-work-scope-card";
const loaded = `!!document.querySelector('${card} .hd-work-scope-duty-title')?.textContent.includes('Synthetic work scope')`;
async function mounted(mode = "owner") { await evaluate(`window.__C5.mount(${JSON.stringify(mode)})`); await ready("!!document.querySelector('[role=tab]')", "Inspector mounted"); await click('[role=tab]:nth-child(2)'); }
function contrast(a, b) { const lum = value => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; }; const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function composite(value, background) {
  const channels = value.match(/[\d.]+/g).map(Number), base = background.match(/[\d.]+/g).slice(0, 3).map(Number), alpha = channels[3] ?? 1;
  return `rgb(${channels.slice(0, 3).map((v, i) => v * alpha + base[i] * (1 - alpha)).join(',')})`;
}

try {
  handle = await startLocalWorkspaceServe({ host: "127.0.0.1", port: 0, cwd: root }, { root, version: "C5-private-read-matrix", agentBoundaries: { ownerCredential },
    providerFactory() { counters.providers++; throw Error("No model/provider permitted in C5 read matrix"); } });
  owner = await client(); initialized = await owner.request("initialize", { token: handle.token, boundaryCredential: ownerCredential }); connectionId = randomUUID();
  const created = await owner.request("workspace.create", { label: "C5 synthetic private workspace", expectedRevision: initialized.workspace.revision });
  const params = { workspaceId: created.workspaceId, expectedGeneration: created.resourceGeneration, agentId: created.selectedAgentId };
  const prepared = await owner.request("workspace.boundaries.prepareProject", params);
  // Main Hara has no colleagueHome in its UI snapshot. Read the same actual registered
  // home view used by this C1-only Host, without creating or inferring a fallback folder.
  const homes = new WorkspaceColleagueHomes(new WorkspaceResourceStorage(join(root, "home"), prepared.context.scope), join(root, "project", params.workspaceId));
  const registeredHome = homes.view(params.agentId);
  assert(registeredHome.created && registeredHome.available);
  directoryPath = realpathSync(registeredHome.path);
  const duty = structuredClone(documents.valid.find(row => row.name === "duty").document), boundary = structuredClone(documents.valid.find(row => row.name === "boundary").document);
  for (const document of [duty, boundary]) { document.context = prepared.context; document.agentId = params.agentId; }
  duty.publicProfile = { title: 'Synthetic work scope <img src=x onerror="window.__C5_XSS=1">', description: "整理本人的资料与对话。 Duties describe work; actions still require current checks.", owns: ["梳理资料、整理结论", "Prepare a weekly summary with clearly cited sources"], rejects: ["不发布、不付款，也不修改线上服务"] };
  boundary.resources = [{ resourceId: prepared.resources[0].resourceId, access: ["read"] }]; boundary.tools = { allow: [], deny: [], readOnly: true };
  boundary.approvalRequired = ["write", "execute", "external_send", "paid", "publish", "credentials", "policy_expand"];
  await owner.request("workspace.boundaries.configure", { ...params, expectedRevision: prepared.revision, duty, boundary, rights: { manage: false, invoke: false, privateRead: false, nodeUse: false } });
  const view = await owner.request("workspace.boundaries.get", { workspaceId: params.workspaceId, agentId: params.agentId });
  target = { workspaceId: params.workspaceId, generation: params.expectedGeneration, agentId: params.agentId, agentEpoch: view.agent.agentEpoch, configRevision: view.agent.configRevision };
  snapshot = await owner.request("workspace.snapshot", { workspaceId: params.workspaceId, agentId: params.agentId });
  agent = snapshot.agents.find(row => row.agentId === params.agentId); assert(agent, "actual Core agent metadata");
  guest = await client(); const guestInit = await guest.request("initialize", { token: handle.token, source: "local_human", provenance: view.provenance });
  assert(guestInit.capabilities.includes("workspace.agent-boundaries.authority.v1"), "C1 capability alone is not an authenticated read source");
  await denied(guest.request("workspace.boundaries.get", { workspaceId: params.workspaceId, agentId: params.agentId })); counters.guestDenials++;
  setupComplete = true;
  await build({ entryPoints: [join(repo, "test/fixtures/work-scope-browser.tsx")], bundle: true, format: "iife", platform: "browser", jsx: "automatic", target: "chrome100", outfile: join(scratch, "fixture.js"),
    write: true, loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "file" }, define: { "process.env.NODE_ENV": '"production"' } });
  http = createServer(async (request, response) => { try {
    const url = new URL(request.url, "http://127.0.0.1"); response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:");
    let value;
    if (request.method === "GET" && url.pathname === "/bootstrap") value = await bootstrap(url.searchParams.get("mode"));
    else if (request.method === "POST" && url.pathname === "/read") {
      let body = ""; for await (const chunk of request) { body += chunk; assert(body.length < 4000); }
      const asked = JSON.parse(body); assert.deepEqual(asked, target); counters.browserReads++;
      value = await owner.request("workspace.boundaries.get", { workspaceId: target.workspaceId, agentId: target.agentId }); counters.ownerReads++;
    } else if (request.method === "POST" && url.pathname === "/reconnect") {
      await owner.close(); owner = await client(); initialized = await owner.request("initialize", { token: handle.token, boundaryCredential: ownerCredential }); connectionId = randomUUID(); value = await bootstrap("owner");
    } else if (request.method === "POST" && url.pathname === "/revoke") {
      await denied(owner.request("initialize", { token: handle.token, boundaryCredential: randomBytes(32).toString("hex") }));
      await assert.rejects(owner.request("workspace.boundaries.get", { workspaceId: target.workspaceId, agentId: target.agentId }), error => error.rpcCode === -32001); counters.guestDenials += 2; value = { revoked: true };
    } else if (url.pathname === "/fixture.js" || url.pathname === "/fixture.css") {
      response.setHeader("Content-Type", url.pathname.endsWith("css") ? "text/css" : "text/javascript"); response.end(readFileSync(join(scratch, url.pathname.slice(1)))); return;
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html data-theme="dark" data-visual-theme="violet"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:var(--hara-bg-base);color:var(--hara-text-primary);font-family:var(--hara-font-ui)}#root{width:min(360px,100%);margin-left:auto}.vg-inspector{position:static!important;width:100%!important;max-height:100vh;overflow:auto}.hd-work-scope-card{margin:12px}.hico{width:18px;height:18px}button{min-height:36px}</style><body><div class="hs hd-redesign vg-app"><div id="root"></div></div><script src="/fixture.js"></script></body></html>'); return;
    } else { response.statusCode = 404; response.end(); return; }
    const text = JSON.stringify(value); assert(!text.includes(ownerCredential)); response.setHeader("Content-Type", "application/json"); response.end(text);
  } catch (error) { serverError = error.message; response.statusCode = 403; response.end('{"error":"private fixture request denied"}'); } });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve)); const endpoint = `http://127.0.0.1:${http.address().port}/`;
  const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(value => value && existsSync(value)); assert(chromePath, "Chrome required");
  const profile = mkdtempSync(join(scratch, "chrome-"));
  browser = spawn(chromePath, ["--headless=new", "--no-proxy-server", "--use-mock-keychain", "--password-store=basic", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const cdp = await new Promise((resolve, reject) => { let tail = ""; const timer = setTimeout(() => reject(Error("Private Chrome startup deadline")), 15000);
    browser.stderr.on("data", chunk => { const value = readDevToolsAnnouncement(tail, chunk); tail = value.tail; if (value.url) { clearTimeout(timer); resolve(value.url); } });
    browser.once("error", error => { clearTimeout(timer); reject(error); }); browser.once("exit", () => { clearTimeout(timer); reject(Error("Private Chrome exited")); }); });
  socket = new WebSocket(cdp); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => { const value = JSON.parse(data);
    if (value.method === "Network.requestWillBeSent") {
      const url = new URL(value.params.request.url); if (["http:", "https:"].includes(url.protocol)) observedPageOrigins.add(url.origin);
    }
    if (value.method === "Runtime.exceptionThrown") exceptions.push(value.params.exceptionDetails.text);
    const row = pending.get(value.id); if (row) { pending.delete(value.id); clearTimeout(row.timer); value.error ? row.fail(Error(value.error.message)) : row.done(value.result); } });
  const page = await send("Target.createTarget", { url: "about:blank" }, false); sessionId = (await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }, false)).sessionId;
  await send("Target.activateTarget", { targetId: page.targetId }, false); await send("Page.bringToFront");
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.setLifecycleEventsEnabled", { enabled: true }); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1280, deviceScaleFactor: 1, mobile: false });
  await navigateCdp(send, socket, { url: endpoint, sessionId, step, timeoutMs: 30000 }); await ready("window.__C5_READY", "Fixture ready");
  step = "missing-source";
  for (const mode of ["none", "guest"]) { const before = counters.browserReads; await mounted(mode); await waitForLayout(evaluate, { label: mode });
    assert.equal(await evaluate(`document.querySelector('${card}')`), null); assert.equal(counters.browserReads, before); receipts.push({ mode, cardDOM: 0, boundaryReads: 0 }); }
  step = "current-real-policy"; await mounted(); await ready(loaded, "Actual current C1 policy rendered");
  assert.equal(await evaluate(`document.querySelectorAll('${card} .hd-work-scope-section').length`), 4);
  assert.equal(await evaluate(`!!document.querySelector('${card} img') || !!window.__C5_XSS`), false);
  assert.equal(await evaluate(`document.querySelector('${card} details').open`), false);
  assert.equal(await evaluate(`document.querySelector('${card} .hd-work-scope-directories strong').textContent`), "Accounts");
  assert.equal(await evaluate(`document.querySelector('${card} .hd-work-scope-directories').textContent.includes(${JSON.stringify(directoryPath)})`), false);
  assert.equal(await evaluate(`document.querySelector('${card}').innerText.includes(${JSON.stringify(directoryPath)})`), false, "The collapsed default card must not disclose the full path");
  assert.equal(await evaluate(`document.querySelector('${card} .hd-work-scope-advanced .hd-work-scope-path').textContent`), directoryPath, "The exact Host path stays under Advanced");
  receipts.push({ directoryDisclosure: "default", friendlyName: "Accounts", fullPathVisible: false });
  const noLeak = async () => { assert.equal(await evaluate(`!!document.querySelector('${card}')`), false); assert.equal(await evaluate(`document.getElementById('root').outerHTML.includes('Synthetic work scope')`), false); };
  step = "scope-fences";
  for (const patch of [{ workspaceId: "other-private-space" }, { generation: "replaced-generation" }, { agentId: "other-colleague" }, { agentEpoch: target.agentEpoch + 1 }, { configRevision: target.configRevision + 1 }]) {
    await evaluate(`window.__C5.target(${JSON.stringify(patch)})`); await ready(`!document.querySelector('${card}')`, "Scope change removes entire card"); await noLeak();
    await evaluate("window.__C5.target({})"); await ready(loaded, "Restored exact current target"); }
  step = "settle-latest-real-read";
  await ready(`(${loaded}) && window.__C5.stats().lastCompleted===window.__C5.stats().reads`, "Latest scope read completes before the cache-return probe");
  await waitForLayout(evaluate, { label: step });
  step = "returning-target-has-no-old-cache";
  await evaluate("window.__C5.target({workspaceId:'outside-current-view'})"); await ready(`!document.querySelector('${card}')`, "Unavailable target clears state");
  await evaluate(`window.__C5_WATCH_RETURN__=true;window.__C5_STALE_COMMITS__=0;window.__C5_STALE_PAINTS__=0;window.__C5_WATCHER__=new MutationObserver(()=>{if(${loaded})window.__C5_STALE_PAINTS__++});window.__C5_WATCHER__.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});window.__C5.defer(false);window.__C5.target({})`);
  await ready(`!!document.querySelector('${card} [role=status]')`, "Return waits for a fresh read");
  assert.equal(await evaluate(loaded), false, "Returning to the old target cannot resurrect its saved UI before the new read");
  assert.equal(await evaluate("window.__C5_STALE_PAINTS__"), 0, "No stale private title is inserted into the DOM while the fresh read is pending");
  assert.equal(await evaluate("window.__C5_STALE_COMMITS__"), 0, "No prior private profile in the committed DOM before passive effects");
  receipts.push({ state: "loading", capture: await capture("loading-current-read") });
  await evaluate("window.__C5_WATCH_RETURN__=false;window.__C5_WATCHER__.disconnect();window.__C5.release()"); await ready(loaded, "Current target revalidated");
  step = "late-reply"; const readBefore = await evaluate("window.__C5.stats().received"); await evaluate("window.__C5.defer()");
  await ready(`window.__C5.stats().received>${readBefore}`, "Deferred read started"); await evaluate("window.__C5.withdraw()"); await ready(`!document.querySelector('${card}')`, "Known revocation clears immediately");
  await evaluate("window.__C5.release()"); await pause(100); await noLeak();
  step = "connection-replacement"; await evaluate("window.__C5.reconnect()"); await ready(loaded, "New real Host socket independently authenticates");
  step = "malformed-and-retry"; await evaluate("window.__C5.fault(true)"); await ready(`!!document.querySelector('${card} [role=alert]')`, "Invalid current view visible error");
  assert.equal(await evaluate(`document.querySelector('${card}').textContent.includes('Synthetic work scope')`), false);
  const errorColors = await evaluate(`(()=>{const card=document.querySelector('${card}'),alert=card.querySelector('[role=alert]'),button=alert.querySelector('button');return{base:getComputedStyle(card).backgroundColor,background:getComputedStyle(alert).backgroundColor,color:getComputedStyle(alert).color,buttonColor:getComputedStyle(button).color,buttonBg:getComputedStyle(button).backgroundColor}})()`);
  const warningContrast = contrast(errorColors.color, composite(errorColors.background,errorColors.base));
  assert(warningContrast >= 4.5); assert(contrast(errorColors.buttonColor,errorColors.buttonBg) >= 4.5);
  receipts.push({ state: "error", warningContrast, noRawPrivateProfile: true, capture: await capture("malformed-current-read") });
  await evaluate(`document.querySelector('${card} [role=alert] button').focus()`);
  await evaluate("window.__C5.fault(false,false)"); await click(`${card} [role=alert] button`); await ready(loaded, "Retry restores current view");
  assert.equal(await evaluate(`document.activeElement===document.querySelector('${card} h3')`), true, "Retry focus retained on heading");
  await evaluate("document.activeElement?.blur()");
  const stableReads = await evaluate("window.__C5.stats().reads");
  step = "themes-locales-layout";
  for (const theme of ["violet", "obsidian", "daylight"]) for (const locale of ["en", "zh-Hans", "zh-Hant"]) {
    await evaluate(`document.documentElement.dataset.visualTheme=${JSON.stringify(theme)};document.documentElement.dataset.theme=${JSON.stringify(theme === "daylight" ? "light" : "dark")};window.__C5.locale(${JSON.stringify(locale)})`);
    await waitForLayout(evaluate, { label: theme + locale });
    const geometry = await evaluate(`(()=>{const card=document.querySelector('${card}'),box=card.getBoundingClientRect(),css=getComputedStyle(card),heading=getComputedStyle(card.querySelector('h4')),badge=getComputedStyle(card.querySelector('.hd-work-scope-badge'));return{width:box.width,scroll:card.scrollWidth,client:card.clientWidth,color:css.color,bg:css.backgroundColor,secondary:heading.color,badge:badge.color,badgeBg:badge.backgroundColor,radius:css.borderRadius}})()`);
    assert(geometry.scroll <= geometry.client + 1); assert.equal(geometry.radius, "14px"); assert(contrast(geometry.color, geometry.bg) >= 4.5); assert(contrast(geometry.secondary, geometry.bg) >= 4.5); assert(contrast(geometry.badge, composite(geometry.badgeBg, geometry.bg)) >= 4.5);
    receipts.push({ theme, locale, geometry, textContrast: contrast(geometry.color, geometry.bg), secondaryContrast: contrast(geometry.secondary, geometry.bg), capture: await capture(`${theme}-${locale}`) });
  }
  assert.equal(await evaluate("window.__C5.stats().reads"), stableReads, "Locale/theme renders do not re-read private metadata");
  for (const width of [1100, 1000, 900, 520, 320]) { await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitForLayout(evaluate, { label: "width-" + width }); assert.equal(await evaluate(`document.querySelector('${card}').scrollWidth<=document.querySelector('${card}').clientWidth+1`), true); receipts.push({ width, noHorizontalOverflow: true }); }
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-reduced-transparency", value: "reduce" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 500, deviceScaleFactor: 2, mobile: false });
  await evaluate("document.documentElement.style.zoom='2'"); await waitForLayout(evaluate, { label: "zoom-200" });
  assert.equal(await evaluate(`document.querySelector('${card}').scrollWidth<=document.querySelector('${card}').clientWidth+1`), true); receipts.push({ zoom: "200%", reducedMotion: true, reducedTransparency: true, capture: await capture("zoom-200") });
  await evaluate("document.documentElement.style.zoom='1'");
  step = "keyboard-and-withdrawal"; await evaluate(`document.querySelector('${card} summary').scrollIntoView({block:"center"});document.querySelector('${card} summary').focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ready(`document.querySelector('${card} details').open`, "Keyboard Enter opens Advanced");
  assert.equal(await evaluate(`document.querySelector('${card}').innerText.includes(${JSON.stringify(directoryPath)})`), true, "Keyboard disclosure reveals the exact registered path");
  assert.equal(await evaluate(`document.querySelector('${card}').scrollWidth<=document.querySelector('${card}').clientWidth+1`), true);
  receipts.push({ directoryDisclosure: "advanced", fullPathVisible: true, keyboard: "Enter", capture: await capture("directory-details-expanded") });
  await evaluate("window.__C5.withdraw()"); await ready(`!document.querySelector('${card}')`, "Withdrawal removes focused card");
  assert.equal(await evaluate("document.activeElement.getAttribute('role')"), "tabpanel");
  step = "real-Host-revocation"; await evaluate("window.__C5.reconnect()"); await ready(loaded, "Read after fresh real socket"); await evaluate("window.__C5.revoke()"); await ready(`!document.querySelector('${card}')`, "Actual revoked Host is withdrawn");
  const final = await guest.request("workspace.snapshot", { workspaceId: target.workspaceId, agentId: target.agentId });
  assert.equal(final.conversation.usage.modelCalls, 0); assert.deepEqual(final.conversation.history, []); assert.deepEqual(final.approvals, []); assert.equal(counters.providers, 0); assert.equal(counters.writesAfterSetup, 0); assert.equal(serverError, undefined); assert.deepEqual(exceptions, []);
  assert.deepEqual([...observedPageOrigins], [new URL(endpoint).origin], "CSP and observed page requests stay on this task loopback");
  const browserVersion = await send("Browser.getVersion", {}, false);
  const report = { ok: true, browserVersion, coreRef, coreHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" }).trim(), actualCoreHost: true, productionBootstrap: false, allRightsFalse: true,
    noOwnerCredentialInBrowser: true, pageRequestsLoopbackOnly: true, contentSecurityPolicy: "self only; data images/fonts and inline styles", observedPageOrigins: [...observedPageOrigins], counters, receipts, browserStats: await evaluate("window.__C5.stats()"), exceptions, inspectorIntegration: true };
  writeFileSync(join(evidence, "browser-report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify({ ok: true, evidence, cases: receipts.length, counters }));
} catch (error) {
  const page = socket?.readyState === WebSocket.OPEN ? await evaluate("({text:document.body.innerText.slice(0,4000),active:document.activeElement?.outerHTML.slice(0,500),stats:window.__C5?.stats()})").catch(() => null) : null;
  writeFileSync(join(evidence, "failure.json"), JSON.stringify({ step, error: String(error), serverError, page, counters, exceptions }, null, 2) + "\n", { mode: 0o600 }); if (socket) await capture("failure").catch(() => {}); throw error;
} finally {
  socket?.close(); for (const row of pending.values()) { clearTimeout(row.timer); row.fail(Error("Browser matrix closed")); } pending.clear();
  if (browser) await stopOwnedBrowser(browser);
  if (http) { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); }
  await Promise.allSettled(clients.map(client => client.close())); if (handle) await handle.close();
  writeFileSync(join(evidence, "cleanup.json"), JSON.stringify({ browserExited: !browser || browser.exitCode !== null || browser.signalCode !== null, httpClosed: !http?.listening, sourceScratchRetainedForCloseout: scratch }) + "\n", { mode: 0o600 });
}
