#!/usr/bin/env node
// Real C5 React + actual C1/C3/C4/C2 in a task-private synthetic root. No production binding.
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { build } from "esbuild";
import { createWorkScopeWriteHost } from "./work-scope-write-host.mjs";
import { requestCdp } from "./browser-cdp-request.mjs";
import { navigateCdp } from "./browser-cdp-navigation.mjs";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "./browser-process.mjs";
import { waitForLayout } from "./browser-layout-wait.mjs";
import { createWorkspaceWorkScopeSource } from "../src/workspace-work-scope.ts";
import { createWorkspaceWorkScopeWriter } from "../src/work-scope-writer.ts";
import { createWorkScopeReferenceStore } from "../src/work-scope-references.ts";
import { createAgentDutyDraft } from "../src/agent-duty-draft.ts";
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); assert(i >= 0 && args[i + 1]); return args[i + 1]; };
assert.equal(process.version, "v22.23.1");
const core = fs.realpathSync(option("--core-repository")), coreRef = option("--core-ref"), repo = fileURLToPath(new URL("../", import.meta.url));
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: core, encoding: "utf8" }).trim(), coreRef);
execFileSync("git", ["diff", "--exit-code", coreRef, "--", "src", "package-lock.json"], { cwd: core });
const scratch = resolve(option("--scratch")), evidence = resolve(option("--evidence")), hostOnly = args.includes("--host-only");
const guardRoot = fs.realpathSync(process.env.HARA_WRAPPER_EVIDENCE_ROOT ?? "");
assert(fs.realpathSync(process.env.HOME).startsWith(guardRoot + "/")); assert(scratch.startsWith(guardRoot + "/"));
for (const folder of [scratch, evidence]) { assert(!fs.existsSync(folder)); fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); }
const english = JSON.parse(fs.readFileSync(join(repo, "src/locales/en/ws.json"), "utf8"));
const root = fs.mkdtempSync(join(scratch, "core-")), digest = bytes => createHash("sha256").update(bytes).digest("hex");
const cases = [], pending = new Map(), errors = [], observedOrigins = new Set(); let host, server, browser, socket, sessionId, serial = 0, step = "setup", endpoint;
let beforeUnloadDialogs = 0;
const httpTrace = [], lifecycleTrace = [], networkTrace = [];
const writeJson = (name, value) => { const bytes = JSON.stringify(value, null, 2) + "\n"; fs.writeFileSync(join(evidence, name + ".json"), bytes, { mode: 0o600 }); return { file: name + ".json", sha256: digest(bytes) }; };
function send(method, params = {}, scoped = true) { return requestCdp(socket, pending, { id: ++serial, method, params, sessionId: scoped ? sessionId : undefined, step, timeoutMs: method === "Page.navigate" ? 30000 : 15000 }); }
async function evaluate(expression) { const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text); return value.result?.value; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(expression, label) { const end = Date.now() + 15000; while (Date.now() < end) { if (await evaluate(expression)) return; await pause(50); } throw Error(label); }
async function click(selector) { assert(await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true})()`), selector); }
async function input(selector, text) { await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select()})()`); await send("Input.insertText", { text }); }
async function screenshot(name) { const value = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }), bytes = Buffer.from(value.data, "base64"); fs.writeFileSync(join(evidence, name + ".png"), bytes, { mode: 0o600 }); return { file: name + ".png", sha256: digest(bytes) }; }
async function mounted(mode = "owner") { await evaluate(`window.__C5W.mount(${JSON.stringify(mode)})`); await ready("!!document.querySelector('[role=tab]')", "Inspector mounted"); await click('[role=tab]:nth-child(2)'); }
const editor = ".hd-work-scope-writer", dialog = ".hd-work-scope-dialog";
async function loaded() { await ready(`!!document.querySelector('${editor} > .hd-work-scope-actions button')`, "Authenticated writer ready"); }
async function openDuty() { await loaded(); await click(`${editor} > .hd-work-scope-actions button:first-child`); await ready(`document.querySelector('${dialog}')?.open`, "Duty dialog open"); }
async function openBoundary() { await loaded(); await click(`${editor} > .hd-work-scope-actions button:last-child`); await ready(`!!document.querySelector('${dialog} input[name="tools-read-only"]')`, "Boundary dialog open"); }
async function review() { await click(`${dialog} form button[type=submit]`); await ready(`!!document.querySelector('${dialog} .hd-work-scope-differences')`, "C3 exact preview ready"); }
async function confirm() { await click(`${dialog} > .hd-work-scope-actions button.pri`); await ready(`!!document.querySelector('${dialog} .hd-work-scope-result')`, "Original C3 outcome visible"); }
async function closeResult() { await click(`${dialog} > .hd-work-scope-actions button:last-child`); await ready(`!document.querySelector('${dialog}')`, "Result closed"); await loaded(); }
function contrast(a, b) { const lum = value => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; }; const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function composite(value, background) { const channels = value.match(/[\d.]+/g).map(Number), base = background.match(/[\d.]+/g).slice(0, 3).map(Number), alpha = channels[3] ?? 1; return `rgb(${channels.slice(0, 3).map((v, i) => v * alpha + base[i] * (1 - alpha)).join(',')})`; }
const boundaryChanges = policy => { const { resources, tools, budget, approvalRequired, runtimeRequirements } = structuredClone(policy.boundary); return { resources, tools, budget, approvalRequired, runtimeRequirements }; };
async function nodeWriter() {
  const boot = await host.bootstrap(), listeners = new Set(), identity = { connectionId: boot.connectionId, connectionEpoch: boot.connectionEpoch, context: boot.view.context, provenance: boot.view.provenance, capabilities: boot.capabilities, assertCurrent() {} };
  const source = createWorkspaceWorkScopeSource({ capture: target => JSON.stringify(target) === JSON.stringify(boot.target) ? identity : null, read: host.read, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
  const memory = new Map(), storage = { get length() { return memory.size; }, key: n => [...memory.keys()][n] ?? null, getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const writer = createWorkspaceWorkScopeWriter(source, { assertCurrent(value) { assert.equal(value.connectionId, boot.connectionId); assert.deepEqual(value.context, boot.view.context); },
    inspect: host.inspect, draft: host.draft, submit: host.submit, receipt: host.receipt, lookupReceipt: host.lookupReceipt, catalog: host.catalog }, createWorkScopeReferenceStore(storage));
  return { writer, capture: () => writer.capture(boot.target), memory };
}
try {
  host = await createWorkScopeWriteHost(core, root);
  if (hostOnly) {
    const { writer, capture, memory } = await nodeWriter(); let session = await writer.load(capture());
    const before = session.policy, preview = await writer.preview(session, { action: "duty.update", draft: createAgentDutyDraft({ ...before.duty.publicProfile, title: "Actual Core confirmed duty" }) });
    const [a, b] = await Promise.all([writer.submit(preview), writer.submit(preview)]); assert.equal(a, b); assert.equal(a.state, "applied"); assert.equal(host.counters.submits, 1); assert.equal(host.counters.providers, 0);
    cases.push({ case: "real-C3-duty-double-confirm", commandId: a.reference.commandId, state: a.state, providers: host.counters.providers });
    session = await writer.load(capture()); const wider = boundaryChanges(session.policy); wider.resources[0].access = ["read", "write"]; wider.tools.readOnly = false;
    const wide = await writer.preview(session, { action: "boundary.update", boundary: wider }); assert(wide.changes.some(row => row.direction === "expand")); assert.equal((await writer.submit(wide)).state, "applied");
    host.dropNext(); session = await writer.load(capture()); const lost = await writer.preview(session, { action: "duty.update", draft: createAgentDutyDraft({ ...session.policy.duty.publicProfile, title: "Applied with lost response" }) });
    const uncertain = await writer.submit(lost); assert.equal(uncertain.state, "unknown"); assert.equal(memory.size, 1);
    assert.equal((await writer.refresh(capture(), uncertain.reference)).state, "applied"); assert.equal(memory.size, 0); assert.equal(host.counters.submits, 3); assert.equal(host.counters.providers, 0);
    cases.push({ case: "real-C3-lost-response-original-receipt", commandId: uncertain.reference.commandId, queries: [...host.counters.receipts], submissions: 3, providers: 0 });
    const probe = await host.startEffects(); const sibling = probe.before.sibling.runs.find(run => run.commandId === probe.sibling.commandId); assert(sibling); assert.equal(sibling.hold, null);
    session = await writer.load(capture()); const narrower = boundaryChanges(session.policy); narrower.resources[0].access = ["read"]; narrower.tools.readOnly = true;
    const cut = await writer.preview(session, { action: "boundary.update", boundary: narrower }); assert.equal((await writer.submit(cut)).state, "applied");
    const after = await host.finishEffects(probe.main), old = after.main.runs.find(run => run.commandId === probe.main.commandId), sameSibling = after.sibling.runs.find(run => run.commandId === probe.sibling.commandId);
    assert.equal(after.beforeFileSha256, probe.before.beforeFileSha256); assert.equal(after.forbiddenExists, false); assert.equal(old.effect, "unknown"); assert.deepEqual(sameSibling, sibling);
    const preserved = structuredClone(old); session = await writer.load(capture()); const next = await writer.preview(session, { action: "duty.update", draft: createAgentDutyDraft({ ...session.policy.duty.publicProfile, title: "Duty after narrowing" }) }); assert.equal((await writer.submit(next)).state, "applied");
    const final = await host.facts(); assert.deepEqual(final.main.runs.find(run => run.commandId === probe.main.commandId), preserved); assert.deepEqual(final.sibling.runs.find(run => run.commandId === probe.sibling.commandId), sibling);
    cases.push({ case: "real-C2-C3-narrowing-UNKNOWN-sibling-preserved", mainCommandId: probe.main.commandId, siblingCommandId: probe.sibling.commandId, fileSha256: after.beforeFileSha256, forbiddenExists: false, effect: old.effect, siblingHold: sameSibling.hold, paidModels: 0, raw: writeJson("host-effects", { before: probe.before, after, final }) });
    const dismissed = await host.dismissMainProbe(); assert.equal(dismissed.status, "rejected"); cases.push({ case: "main-Hara-dismiss-denied", status: dismissed.status });
  } else {
    const bundle = await build({ entryPoints: [join(repo, "test/fixtures/work-scope-write-browser.tsx")], bundle: true, platform: "browser", format: "iife", jsx: "automatic", target: "chrome100", outfile: join(scratch, "fixture.js"), metafile: true,
      loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "file" }, define: { "process.env.NODE_ENV": '"production"' } });
    const assets = new Map(Object.keys(bundle.metafile.outputs).map(name => ["/" + basename(name), resolve(repo, name)]));
    for (const asset of assets.values()) host.assertPublicArtifacts(fs.readFileSync(asset));
    const nonce = randomBytes(32).toString("hex");
    server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, endpoint ?? "http://127.0.0.1"); httpTrace.push({method:req.method,path:url.pathname}); res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
        if (req.method === "GET" && url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); const html = `<!doctype html><html data-visual-theme="violet-glass" data-theme="dark"><head><meta charset="utf-8"><meta name="c5-csrf" content="${nonce}"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:var(--hara-bg-base);color:var(--hara-text-primary);font-family:var(--hara-font-ui)}#root{width:min(360px,100%);margin-left:auto}.vg-inspector{position:static!important;width:100%!important;max-height:100vh;overflow:auto}.hd-work-scope-card{margin:12px}.hico{width:18px;height:18px}</style></head><body><div class="hs hd-redesign vg-app"><div id="root"></div></div><script src="/fixture.js"></script></body></html>`; host.assertPublicArtifacts(Buffer.from(html)); res.end(html); return; }
        if (req.method === "GET" && assets.has(url.pathname)) { res.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : url.pathname.endsWith(".js") ? "text/javascript" : "application/octet-stream"); res.end(fs.readFileSync(assets.get(url.pathname))); return; }
        if (req.method !== "POST" || req.headers.origin !== endpoint || req.headers.host !== new URL(endpoint).host || req.headers["x-c5-nonce"] !== nonce || req.headers["content-type"] !== "application/json") { res.writeHead(403).end(); return; }
        const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 131072) throw Error("Fixture request too large"); chunks.push(chunk); } const data = JSON.parse(Buffer.concat(chunks));
        let value;
        if (url.pathname === "/bootstrap") { assert.deepEqual(Object.keys(data), ["mode"]); assert(["owner","no-cap","read-only"].includes(data.mode)); value = await host.bootstrap(data.mode); }
        else if (url.pathname === "/read") value = await host.read(data.target);
        else if (url.pathname === "/catalog") value = await host.catalog(data.target);
        else if (url.pathname === "/inspect") value = await host.inspect(data.target);
        else if (url.pathname === "/draft") value = await host.draft(data.target, data.input);
        else if (url.pathname === "/submit") value = await host.submit(data.target, data.command, data.proposal);
        else if (url.pathname === "/lookup") value = await host.lookupReceipt(data.target, data.commandId);
        else if (url.pathname === "/receipt") value = await host.receipt(data.target, data.commandId);
        else { res.writeHead(404).end(); return; }
        const body = JSON.stringify(value); host.assertPublicArtifacts(Buffer.from(body)); res.setHeader("Content-Type", "application/json"); res.end(body);
      } catch { res.writeHead(409).end("Private fixture request unavailable"); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); endpoint = `http://127.0.0.1:${server.address().port}`; const localProbe = await fetch(endpoint); assert.equal(localProbe.status,200); await localProbe.text();
    const profile = join(scratch, "chrome-profile"), chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(name => name && fs.existsSync(name)); assert(chrome);
    browser = spawn(chrome, ["--headless=new", "--no-proxy-server", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-pings", "--use-mock-keychain", "--password-store=basic", "--disable-features=MediaRouter", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--no-default-browser-check", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    const cdp = await new Promise((resolve, reject) => { let tail = ""; const timer = setTimeout(() => reject(Error("Private Chrome startup deadline")), 15000); browser.stderr.on("data", chunk => { const parsed = readDevToolsAnnouncement(tail, chunk); tail = parsed.tail; if (parsed.url) { clearTimeout(timer); resolve(parsed.url); } }); browser.once("error", reject); browser.once("exit", () => { clearTimeout(timer); reject(Error("Private Chrome exited")); }); });
    socket = new WebSocket(cdp); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", ({ data }) => { const value = JSON.parse(data);
      if (value.method?.startsWith("Page.") && lifecycleTrace.length < 96) lifecycleTrace.push({method:value.method,frameId:value.params?.frameId,loaderId:value.params?.loaderId,name:value.params?.name});
      if (value.method === "Network.loadingFailed") networkTrace.push({method:value.method,requestId:value.params.requestId,error:value.params.errorText,blocked:value.params.blockedReason});
      if (value.method === "Network.requestWillBeSent") { const url = new URL(value.params.request.url); networkTrace.push({method:value.method,url:url.origin+url.pathname,requestId:value.params.requestId}); if (["http:", "https:"].includes(url.protocol)) observedOrigins.add(url.origin); }
      if (value.method === "Runtime.exceptionThrown") errors.push(value.params.exceptionDetails.text);
      if (value.method === "Page.javascriptDialogOpening") { assert.equal(value.params.type, "beforeunload"); beforeUnloadDialogs++; void send("Page.handleJavaScriptDialog", { accept: true }); }
      const row = pending.get(value.id); if (row) { pending.delete(value.id); clearTimeout(row.timer); value.error ? row.fail(Error(value.error.message)) : row.done(value.result); }
    });
    const page = await send("Target.createTarget", { url: "about:blank" }, false); sessionId = (await send("Target.attachToTarget", { targetId: page.targetId, flatten: true }, false)).sessionId;
    await send("Target.activateTarget", { targetId: page.targetId }, false); await send("Page.bringToFront"); await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Page.setLifecycleEventsEnabled", { enabled: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigateCdp(send, socket, { url: endpoint, sessionId, step, timeoutMs: 30000 }); await ready("window.__C5W_READY", "Fixture ready");
    step = "gates"; const readsBeforeMissing = host.counters.ownerReads; await mounted("no-cap"); await pause(100); assert.equal(await evaluate("!!document.querySelector('.hd-work-scope-card')"), false); assert.equal(host.counters.ownerReads, readsBeforeMissing);
    await mounted("read-only"); await ready("!!document.querySelector('.hd-work-scope-duty-title')", "Read card ready"); assert.equal(await evaluate(`!!document.querySelector('${editor}')`), false); assert.equal(host.counters.drafts, 0); assert.equal(host.counters.submits, 0);
    cases.push({ case: "missing-reader-writer-capabilities-empty-entry", screenshot: await screenshot("read-only-no-write-entry") });
    step = "duty-edit"; await mounted(); await openDuty(); cases.push({case:"duty-form",screenshot:await screenshot("write-duty-form")}); await input('input[name="duty-title"]', "Reviewed real C3 duty");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await ready(`!!document.querySelector('${dialog} [role=alert]')`, "Discard confirmation");
    step = "double-Escape-discard";
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await ready(`document.querySelector('${dialog}')?.open && !!document.querySelector('${dialog} [role=alert] button')`, "Second Escape must preserve the dirty discard confirmation");
    assert.equal(await evaluate(`!!document.activeElement?.closest('${dialog}')`), true);
    cases.push({ case: "native-double-Escape-preserves-discard-confirmation", screenshot: await screenshot("write-double-escape-discard") });
    await click(`${dialog} [role=alert] button:first-child`); assert.equal(host.counters.drafts, 0); assert.equal(host.counters.submits, 0);
    await review(); assert.equal(host.counters.submits, 0); assert.equal(await evaluate(`document.querySelector('${dialog} .hd-work-scope-differences').textContent.includes('Reviewed real C3 duty')`), true);
    for (const theme of ["violet-glass", "obsidian", "daylight"]) for (const locale of ["zh-Hans", "en", "zh-Hant"]) {
      await evaluate(`document.documentElement.dataset.visualTheme=${JSON.stringify(theme)};document.documentElement.dataset.theme=${JSON.stringify(theme === "daylight" ? "light" : "dark")};window.__C5W.locale(${JSON.stringify(locale)})`); await waitForLayout(evaluate, { label: theme + locale });
      const geometry = await evaluate(`(()=>{const el=document.querySelector('${dialog}'), r=el.getBoundingClientRect(), c=getComputedStyle(el);return{left:r.left,right:r.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth,color:c.color,bg:c.backgroundColor,radius:c.borderRadius,secondary:getComputedStyle(el.querySelector("header p")).color,badge:getComputedStyle(el.querySelector(".hd-work-scope-change")).color,badgeBg:getComputedStyle(el.querySelector(".hd-work-scope-change")).backgroundColor}})()`);
      assert(geometry.left >= 0 && geometry.right <= 1281); assert(geometry.scroll <= geometry.client + 1); assert.equal(geometry.radius, "14px"); assert(contrast(geometry.color,geometry.bg)>=4.5); assert(contrast(geometry.secondary,geometry.bg)>=4.5); assert(contrast(geometry.badge,composite(geometry.badgeBg,geometry.bg))>=4.5); cases.push({ case: "dialog-theme-locale", theme, locale, geometry, screenshot: await screenshot(`write-${theme}-${locale}`) });
    }
    await evaluate("window.__C5W.locale('en')");
    for (const width of [1280, 1100, 1000, 900]) { await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await waitForLayout(evaluate, { label: "width" + width }); assert.equal(await evaluate(`(()=>{const el=document.querySelector('${dialog}'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&el.scrollWidth<=el.clientWidth+1})()`), true); cases.push({ case: "dialog-width", width, screenshot: await screenshot("write-width-" + width) }); }
    await evaluate("document.documentElement.style.zoom='2'"); await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await waitForLayout(evaluate, { label: "zoom200" }); assert.equal(await evaluate(`document.querySelector('${dialog}').scrollWidth<=document.querySelector('${dialog}').clientWidth+1`), true); cases.push({ case: "CSS-zoom-200-reduced-motion", screenshot: await screenshot("write-zoom-200") });
    await evaluate("document.documentElement.style.zoom='1'"); await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    const ax = await send("Accessibility.getFullAXTree"); assert(ax.nodes.some(node => node.role?.value === "dialog" && node.name?.value === "Review the changes"));
    await send("Page.bringToFront"); await evaluate(`document.querySelector('${dialog} h3').focus()`);
    const focusTrace = [];
    for (let index = 0; index < 7; index++) { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      const focused = await evaluate(`(()=>{const el=document.activeElement;return{tag:el?.tagName,text:el?.tagName==='BUTTON'?el.textContent:null,inside:!!el?.closest('${dialog}'),documentFocused:document.hasFocus()}})()`); focusTrace.push(focused);
      // The explicit dialog boundary keeps keyboard focus in the form, including at the final action.
      assert(focused.inside, JSON.stringify(focusTrace));
    }
    assert(focusTrace.filter(row=>row.inside&&row.tag==='BUTTON').length>=3,JSON.stringify(focusTrace));
    for (let index=0;index<3;index++) { await send("Input.dispatchKeyEvent", {type:"keyDown",key:"Tab",code:"Tab",windowsVirtualKeyCode:9,modifiers:8}); await send("Input.dispatchKeyEvent", {type:"keyUp",key:"Tab",code:"Tab",windowsVirtualKeyCode:9,modifiers:8}); assert.equal(await evaluate(`!!document.activeElement?.closest('${dialog}')`),true); }
    const primary = await evaluate(`(()=>{const r=document.querySelector('${dialog} button.pri').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...primary });
    const hoverColors=await evaluate(`(()=>{const c=getComputedStyle(document.querySelector('${dialog} button.pri'));return{color:c.color,bg:c.backgroundColor}})()`); assert(contrast(hoverColors.color,hoverColors.bg)>=4.5);
    cases.push({case:"native-dialog-AX-keyboard-order-hover-contrast",focusTrace,hoverContrast:contrast(hoverColors.color,hoverColors.bg)});
    // Actual unchanged 30s Host deadline, no virtual clock or relaxed command budget.
    await ready(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('expired')`,"Unsubmitted review reaches its real deadline").catch(async error=>{
      if (!String(error.message).includes('real deadline')) throw error;
      await pause(16000); await ready(`document.querySelector('${dialog} [role=alert]')?.textContent.includes('expired')`,"Unsubmitted review expired");
    });
    assert.equal(await evaluate(`document.querySelector('${dialog} > .hd-work-scope-actions button.pri').disabled`),true); assert.equal(host.counters.submits,0);
    const namespaceProbe = await evaluate("window.__C5W.probeReleasedNamespace()");
    assert.equal(host.counters.submits, 0); assert(namespaceProbe.commandId);
    cases.push({ case: "expiry-releases-active-without-closing-original-dialog", submissions: 0, probeCommandId: namespaceProbe.commandId });
    const expiredDrafts=host.counters.drafts; await click(`${dialog} > .hd-work-scope-actions button:first-child`); await ready(`!!document.querySelector('${dialog} form')`,"Explicit return reads current state"); await review(); assert.equal(host.counters.drafts,expiredDrafts+1); assert.equal(host.counters.submits,0);
    cases.push({case:"actual-30s-unsubmitted-expiry-requires-explicit-new-review",submissions:0});
    await evaluate("void(window.__C5W_LIVE=document.querySelector('.hd-work-scope-card > [role=status]'))");
    const before = (await host.bootstrap()).view.policy;
    const originalSubmit = host.submit; let responseCommitted = false, releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    host.submit = async (...args) => { const value = await originalSubmit(...args); responseCommitted = true; await responseGate; return value; };
    try {
      await evaluate(`(()=>{const button=document.querySelector('${dialog} > .hd-work-scope-actions button.pri');button.click();button.click()})()`);
      await ready(`document.querySelector('${dialog} > .hd-work-scope-actions button.pri')?.disabled`, "Submitting UI visible");
      const committedDeadline = Date.now() + 15000; while (!responseCommitted && Date.now() < committedDeadline) await pause(20);
      assert(responseCommitted, "The response barrier follows real C3 commit, never a fake receipt");
      for (let n = 0; n < 2; n++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      }
      await ready(`document.querySelector('${dialog}')?.open && !!document.querySelector('${dialog} > .hd-work-scope-actions button.pri')?.disabled`, "Second Escape cannot hide an in-flight submission");
      assert.equal(await evaluate(`!!document.activeElement?.closest('${dialog}')`), true);
      cases.push({ case: "native-double-Escape-preserves-real-C3-submitting", submissions: host.counters.submits });
    } finally { releaseResponse(); host.submit = originalSubmit; }
    await ready(`!!document.querySelector('${dialog} .hd-work-scope-result')`, "Actual C3 result");
    assert.equal(host.counters.submits, 1); const after = (await host.bootstrap()).view.policy; assert.equal(after.duty.publicProfile.title, "Reviewed real C3 duty"); assert.deepEqual(after.boundary, before.boundary); assert.deepEqual(after.rights, before.rights);
    cases.push({ case: "real-DOM-double-confirm-one-C3-submit", operation: host.records().at(-1), models: host.counters.providers, screenshot: await screenshot("write-duty-applied") });
    await evaluate("window.__C5W.deferRead()"); await click(`${dialog} > .hd-work-scope-actions button:last-child`); await ready(`!document.querySelector('${dialog}')&&!!document.querySelector('.hd-work-scope-card > .hd-work-scope-notice')`,"Deferred read loading");
    assert.equal(await evaluate("window.__C5W_LIVE===document.querySelector('.hd-work-scope-card > [role=status]')"),true); await ready(`window.__C5W_LIVE.textContent===${JSON.stringify(english["ws.workScope.loading"])}`,"Persistent live region announces the actual loading copy");
    await evaluate("window.__C5W.releaseRead()"); await loaded(); cases.push({case:"persistent-live-region-through-loading"});
    assert.equal(await evaluate("document.activeElement?.tagName"), "H3");
    step = "boundary-expansion"; await openBoundary(); cases.push({case:"boundary-form",screenshot:await screenshot("write-boundary-form")}); await evaluate(`document.querySelector('${dialog} form button[type=submit]').scrollIntoView({block:'center'})`); cases.push({case:"boundary-form-actions-reachable",screenshot:await screenshot("write-boundary-form-actions")}); await click(`${dialog} input[name$="-write"]`); await click(`${dialog} input[name="tools-read-only"]`); await review();
    assert.equal(await evaluate(`!!document.querySelector('${dialog} .hd-work-scope-change.expand')`), true); assert.equal(await evaluate(`document.querySelector('${dialog} .hd-work-scope-differences').closest('details')===null`), true);
    cases.push({ case: "explicit-expansion-differences", screenshot: await screenshot("write-expansion-review") }); await confirm(); await closeResult(); assert.equal(host.counters.providers, 0);
    step = "lost-response-reload"; host.dropNext(); await openDuty(); await input('input[name="duty-title"]', "Applied before lost response"); await review(); await confirm();
    assert.equal((await evaluate("window.__C5W.stats()")).references.length, 1); const original = host.records().at(-1), submitted = host.counters.submits, drafted = host.counters.drafts;
    const storage = await evaluate("window.__C5W.stats().references"); assert.equal(storage[0].commandId, original.commandId); assert.equal(JSON.stringify(storage).includes("publicProfile"), false); assert.equal(JSON.stringify(storage).includes("proofRef"), false);
    const reconnection = await host.reconnect();
    await navigateCdp(send, socket, { url: endpoint + "/?reload=1", sessionId, step, timeoutMs: 30000 }); await ready("window.__C5W_READY", "New document fixture ready"); await mounted(); await loaded();
    assert.equal(host.counters.submits, submitted); assert.equal(host.counters.drafts, drafted); assert(host.counters.receipts.includes(original.commandId)); assert.equal((await evaluate("window.__C5W.stats()")).references.length, 0);
    cases.push({ case: "real-DOM-reload-original-ID-only", commandId: original.commandId, reconnection, submissions: submitted, queries: [...host.counters.receipts], beforeUnloadDialogs, screenshot: await screenshot("write-reload-original-result") });
    step = "real-effects-narrowing"; const probe = await host.startEffects(); await mounted(); await openBoundary(); await click(`${dialog} input[name$="-write"]`); await click(`${dialog} input[name="tools-read-only"]`); await review(); await confirm(); await closeResult();
    const cut = await host.finishEffects(probe.main), main = cut.main.runs.find(run => run.commandId === probe.main.commandId), sibling = probe.before.sibling.runs.find(run => run.commandId === probe.sibling.commandId);
    assert.equal(cut.beforeFileSha256, probe.before.beforeFileSha256); assert.equal(cut.forbiddenExists, false); assert.equal(main.effect, "unknown"); assert.deepEqual(cut.sibling.runs.find(run => run.commandId === probe.sibling.commandId), sibling);
    await openDuty(); await input('input[name="duty-title"]', "Responsibilities preserve old outcomes"); await review(); await confirm(); await closeResult();
    const final = await host.facts(); assert.deepEqual(final.main.runs.find(run => run.commandId === probe.main.commandId), main); assert.deepEqual(final.sibling.runs.find(run => run.commandId === probe.sibling.commandId), sibling);
    cases.push({ case: "real-DOM-C2-C3-narrowing-retains-UNKNOWN-sibling", fileSha256: cut.beforeFileSha256, forbiddenExists: false, mainEffect: main.effect, siblingHold: sibling.hold, paidModels: 0, raw: writeJson("browser-effects", { before: probe.before, cut, final }) });
    step = "unsent-reference-expiry-reload";
    const beforeUnsentSubmits = host.counters.submits; host.dropBeforeSendNext();
    await openDuty(); await input('input[name="duty-title"]', "Never sent to Core"); await review(); await confirm();
    const unsent = (await evaluate("window.__C5W.stats().references"))[0];
    assert.equal(unsent.schemaVersion, 2); assert(unsent.notAfter); assert.equal(host.counters.submits, beforeUnsentSubmits);
    const draftCount = host.counters.drafts, reconnectUnsent = await host.reconnect();
    await navigateCdp(send, socket, { url: endpoint + "/?reload=unsent", sessionId, step, timeoutMs: 30000 }); await ready("window.__C5W_READY", "Unsent reference document reloaded"); await mounted(); await evaluate("window.__C5W.locale('en')");
    await ready(`!!document.querySelector('${editor} button')`, "Original reference controls ready");
    assert.equal((await evaluate("window.__C5W.stats().references")).length, 1);
    await pause(Math.max(0, Date.parse(unsent.notAfter) + 1100 - Date.now()));
    await evaluate(`(()=>{const button=[...document.querySelectorAll('${editor} button')].find(el=>el.textContent===${JSON.stringify(english["ws.workScope.write.checkOriginal"])});if(!button)throw Error('Original query missing');button.click()})()`);
    await ready("window.__C5W.stats().references.length===0", "Core not-seen expiry proof retires only the original reference"); await loaded();
    assert.equal(host.counters.submits, beforeUnsentSubmits); assert.equal(host.counters.drafts, draftCount); assert(host.counters.receipts.includes(unsent.commandId));
    const newProbe = await evaluate("window.__C5W.probeReleasedNamespace()"); assert.notEqual(newProbe.commandId, unsent.commandId); assert.equal(host.counters.submits, beforeUnsentSubmits);
    cases.push({ case: "real-Core-unsent-expired-reference-reloads-unlocks-without-resubmit", commandId: unsent.commandId, reconnectUnsent, noNewSubmit: true, raw: writeJson("unsent-reference-proof", { reference: unsent, counters: host.counters }) });
    step = "revocation"; await openDuty(); await input('input[name="duty-title"]', "Must not leak after target switch"); const submits = host.counters.submits; await evaluate("window.__C5W.target({agentId:'different-target'})"); await ready(`!document.querySelector('${dialog}')&&!document.querySelector('.hd-work-scope-card')`, "Target switch clears entire private view"); assert.equal(host.counters.submits, submits);
    cases.push({ case: "real-DOM-target-switch-clears-editor-and-card", screenshot: await screenshot("write-target-cleared") });
    assert.deepEqual(errors, []); assert.deepEqual([...observedOrigins], [endpoint]);
  }
  const report = { passed: true, coreRef, deskRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), hostOnly, cases, counters: host.counters, records: host.records(), paidModels: 0, productionEnabled: false, RustChanges: false, browserMode: "headless=new", ownerCredentialInBrowser: false, observedOrigins: [...observedOrigins], errors };
  writeJson("result", report); console.log(JSON.stringify({ passed: true, cases: cases.length, hostOnly, counters: host.counters, result: join(evidence, "result.json") }));
} catch (error) { writeJson("failure", { step, message: String(error.stack ?? error), cases, counters: host?.counters, errors, endpoint, httpTrace, lifecycleTrace, networkTrace }); if (socket?.readyState === WebSocket.OPEN) { try { await screenshot("failure"); } catch {} } throw error; }
finally {
  socket?.close(); for (const row of pending.values()) { clearTimeout(row.timer); row.fail(Error("Fixture closed")); } pending.clear();
  if (browser) await stopOwnedBrowser(browser); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } if (host) await host.close();
  writeJson("cleanup", { browserExited: !browser || browser.exitCode !== null || browser.signalCode !== null, httpClosed: !server?.listening, ownedHostClosed: true, scratchRetainedForCloseout: scratch });
}
