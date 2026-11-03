#!/usr/bin/env node
// Focused real-component fixture capture. This is never real-Core/native acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createServer } from "vite";
import { createServer as createPortProbe } from "node:net";
import { makeT } from "../src/i18n.ts";
import { readDevToolsAnnouncement, stopOwnedBrowser } from "./browser-process.mjs";
import { requestCdp } from "./browser-cdp-request.mjs";
import { navigateCdp } from "./browser-cdp-navigation.mjs";
import { waitForLayout } from "./browser-layout-wait.mjs";
import { buildReport, loadCases, repoRoot, reportMarkdown, saveEvidence, sourceIdentity } from "./visual-case-registry.mjs";

if (!process.argv[2] || !process.argv[3]) throw new Error("Explicit evidence and task scratch directories required");
const output = resolve(process.argv[2]), scratch = resolve(process.argv[3]);
const contains = (parent, child) => { const rel = relative(parent, child); return !rel || rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel); };
assert.ok(!contains(output, scratch) && !contains(scratch, output), "Evidence and scratch must not overlap");
const cases = loadCases(), identity = sourceIdentity(repoRoot, true);
for (const row of cases) assert.equal(existsSync(join(output, row.id)), false, "Use a fresh evidence directory");
mkdirSync(output, { recursive: true, mode: 0o700 }); mkdirSync(scratch, { recursive: true, mode: 0o700 });
const working = mkdtempSync(join(scratch, "visual-cases-"));
for (const directory of ["chrome-profile", "home", "tmp"]) mkdirSync(join(working, directory), { mode: 0o700 });
const chromePath = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(file => file && existsSync(file));
let server, chrome, socket, sessionId, browserVersion, serverPort;
let requestId = 0, currentCase = "startup", exceptionCount = 0;
const pending = new Map(), t = makeT("en");
const pause = ms => new Promise(done => setTimeout(done, ms));
const send = (method, params = {}, scoped = true) => requestCdp(socket, pending, { id: ++requestId, method, params, sessionId: scoped ? sessionId : undefined, step: currentCase });
async function availableLoopbackPort() {
  const probe = createPortProbe();
  await new Promise((done, fail) => { probe.once("error", fail); probe.listen(0, "127.0.0.1", done); });
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close(error => error ? fail(error) : done()));
  return port; // strictPort below rejects a race; it never attaches to another server.
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error("Fixture evaluation failed");
  return result.result?.value;
}
async function ready(expression) {
  const deadline = performance.now() + 12000;
  do { if (await evaluate(expression)) return; await pause(75); } while (performance.now() < deadline);
  throw new Error("Fixture condition did not settle");
}
const click = async selector => {
  await ready(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
};
async function button(label, scope = "body") {
  const expression = `[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(node=>node.textContent.trim()===${JSON.stringify(label)}&&!node.disabled)`;
  await ready(`!!(${expression})`); await evaluate(`(${expression}).click()`);
}
async function value(selector, next, select = false) {
  await ready(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}); const prototype=${select ? "HTMLSelectElement" : "HTMLTextAreaElement"}.prototype; Object.getOwnPropertyDescriptor(prototype,"value").set.call(node,${JSON.stringify(next)});node.dispatchEvent(new Event(${JSON.stringify(select ? "change" : "input")},{bubbles:true}));})()`);
}
async function screenshot(directory, name) {
  await waitForLayout(evaluate, { label: currentCase });
  const captured = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = join(directory, name + ".png");
  writeFileSync(file, Buffer.from(captured.data, "base64"), { mode: 0o600, flag: "wx" });
  return relative(output, file);
}
async function exercise(row, checked, capture) {
  const check = async (expression, label) => { assert.equal(await evaluate(expression), true, label); checked.push(label); };
  if (row.id.startsWith("runtime-expanded-")) {
    const runtime=row.id.slice("runtime-expanded-".length), labels={gemini:"Gemini CLI",kimi:"Kimi CLI",copilot:"GitHub Copilot",cursor:"Cursor",grok:"Grok Build"};
    await ready("document.querySelector('.vg-runtime-model-card select')?.options.length===3");
    await check(`document.querySelector('select[aria-label=Runtime]').value===${JSON.stringify(runtime)}`,"The synthetic registered host runtime is selected");
    await check(`document.querySelector('select[aria-label=Runtime] option:checked').textContent.includes(${JSON.stringify(labels[runtime])})`,"The production runtime label is rendered");
    await check(`Boolean(document.querySelector('[data-personal-extensions=inherited]'))===${runtime!=="gemini"}`,"Only the approved runtime inherits personal extensions");
    await check(`!document.querySelector('select[aria-label=${JSON.stringify(t("ws.runtimeAccess.effort"))}]')`,"No unsupported effort selection is offered");
    await check(`document.body.textContent.includes(${JSON.stringify(t(runtime==="cursor"?"ws.runtimeExpansion.modelsLive":"ws.runtimes.documentedModels"))})`,"Model inventory provenance is visible");
    await capture("registered-host");
    return;
  }
  if (row.id === "error-diagnostic-summary") {
    await ready("!!document.querySelector('[data-runtime-diagnostic=true] summary')");
    await click('[data-runtime-diagnostic=true] summary');
    await check("document.querySelector('[data-runtime-diagnostic=true]').open","The actual diagnostic details expand");
    await check("document.querySelector('[data-runtime-diagnostic=true] pre').textContent.includes('codex') && document.querySelector('[data-runtime-diagnostic=true] pre').textContent.includes('runtime_auth_rejected')","Safe fields match the synthetic receipt");
    await check("!document.body.textContent.includes('PRIVATE_BODY_SHOULD_NEVER_RENDER')","Raw private failure body is absent");
    await check("document.querySelector('output').textContent===''","Inspection triggers no retry, login or model call");
    await capture("diagnostic-summary");return;
  }
  if (row.id === "group-interjection-fold") {
    await ready("!!window.__HARA_SHELL_FIXTURE__");
    await click(`.hs-sec-a[aria-label=${JSON.stringify(t("ws.channels.new"))}]`);
    await ready("document.querySelectorAll('.hs-channel-choices input[type=checkbox]').length===13");
    await evaluate(`(()=>{const n=document.querySelector('.hs-channel-dialog input[aria-label=${JSON.stringify(t("ws.channels.name"))}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Scoped visual thread');n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await button(t("ws.channels.none"),".hs-channel-dialog");
    await evaluate("[...document.querySelectorAll('.hs-channel-choices input[type=checkbox]')].slice(0,3).forEach(n=>n.click())");
    await button(t("ws.channels.new"),".hs-channel-dialog");await ready("!!document.querySelector('[data-local-channel]')");
    await evaluate(`(async()=>{const f=window.__HARA_SHELL_FIXTURE__,id=document.querySelector('[data-local-channel]').dataset.localChannel,turnId='10000000-0000-4000-8000-000000000001',at='2026-11-04T00:00:00Z';
      const replies=[{agentId:'person-0',displayName:'Original speaker',state:'completed'},{agentId:'person-1',displayName:'Passed colleague',state:'passed',passedBy:'prefilter',passReason:'role_unrelated'},{agentId:'person-2',displayName:'Invited colleague',state:'completed',wokenBy:'person-0',depth:1}];
      const messages=[{id:'user',turnId,agentId:null,displayName:'',createdAt:at,message:{role:'user',content:'Original group question'}},{id:'reply',turnId,agentId:'person-0',displayName:'Original speaker',createdAt:at,message:{role:'assistant',text:'Scoped original reply',tools:[]}},{id:'interjection',turnId,agentId:'person-2',displayName:'Invited colleague',createdAt:at,message:{role:'assistant',text:'Scoped interjection reply',tools:[]}}];
      await f.channelHistory(id,[{id:turnId,state:'completed',replies}],messages);})()`);
    await ready("!!document.querySelector('details[data-channel-passed]')");
    await check("!document.querySelector('details[data-channel-passed]').open","Unrelated decisions start folded");
    await check("document.querySelector('[data-channel-woken=started]')!==null && document.querySelectorAll('.hs-channel-turn').length===1","The invited reply stays in the original turn");
    await capture("folded");await click('details[data-channel-passed] summary');
    await check("document.querySelector('details[data-channel-passed]').open && document.querySelector('details[data-channel-passed]').textContent.includes('Passed colleague')","Expansion preserves the colleague identity");
    await check("window.__HARA_SHELL_FIXTURE__.calls.filter(x=>x.method==='workspace.channels.send'||x.method==='workspace.channels.speakPassed').length===0","Toggle does not send or invite again");
    await check("!document.querySelector('.hs-channel-thread').textContent.includes('Please check the redesigned workspace shell.')","DM content does not enter the group transcript");
    await capture("expanded");await click('details[data-channel-passed] summary');
    await check("!document.querySelector('details[data-channel-passed]').open && document.querySelectorAll('[data-channel-speaker=user]').length===1","Collapsing preserves the original user turn");return;
  }
  if (row.id.startsWith("runtime-") || row.id === "error-model-inventory") {
    await ready("!!document.querySelector('.vg-runtime-access select[aria-label=Runtime]')");
    if (row.id === "runtime-selection") {
      await ready("document.querySelector('.vg-runtime-model-card select')?.options.length===3");
      await check("document.querySelector('select[aria-label=Runtime]').value==='codex'", "Original runtime is Codex");
      await capture("bound");
      await value("select[aria-label=Runtime]", "pi", true); await button("Apply Runtime");
      await ready("!!document.querySelector('[role=dialog]')");
      await check("document.querySelector('[role=dialog]').textContent.includes('keep') && !document.querySelector('pre').textContent.includes('setRuntime(')", "Confirmation opens before any binding mutation");
      await capture("confirmation");
      await button(t("ws.cancel"), "[role=dialog]");
      await check("!document.querySelector('[role=dialog]') && document.querySelector('select[aria-label=Runtime]').value==='pi' && !document.querySelector('pre').textContent.includes('setRuntime(')", "Cancel preserves original binding and the uncommitted draft");
    } else if (row.id === "runtime-missing") {
      await check("document.querySelector('select[aria-label=Runtime] option[value=codex]').disabled", "Missing runtime is disabled");
      await capture("missing");
      await click(".vg-runtime-rescan");
      await button(t("ws.runtimeAccess.register"));
      await ready("!!document.querySelector('[role=dialog] input[name=inspector-login-source]')");
      await check("document.querySelector('input[name=inspector-login-source]').checked && !document.querySelector('pre').textContent.includes('registerLocal(')", "Registration proposes explicit host login without executing registration");
      await capture("registration-confirmation");
      await button(t("ws.cancel"), "[role=dialog]");
    } else {
      await ready("document.querySelector('.vg-runtime-model-card [role=alert]')?.textContent.includes('Model list unavailable')");
      checked.push("Inventory failure is visible"); await capture("inventory-error");
      await click(".vg-runtime-rescan");
      await ready("document.querySelector('.vg-runtime-model-card select')?.options.length===3");
      await check("!document.querySelector('.vg-runtime-model-card [role=alert]')", "Explicit rescan restores the synthetic catalog");
      await capture("inventory-recovered");
    }
  } else if (row.id.startsWith("login-") || row.id === "error-runtime-unavailable") {
    await ready("!!document.querySelector('.wsd-resume[data-recovery=runtime]')");
    await check("document.querySelector('output').textContent===''", "Mount performs no login, retry or rescan");
    if (row.id === "error-runtime-unavailable") {
      await check("document.querySelector('.wsd-resume').dataset.failureKind==='runtime_unavailable'", "Runtime unavailable has the expected failure kind");
      await capture("unavailable"); await button(t("ws.runtimeAccess.rescan"), ".wsd-resume");
      await check("document.querySelector('output').textContent==='explicit rescan'", "Only explicit rescan is recorded");
    } else {
      const count = row.id === "login-host-recovery" ? 1 : 2;
      await check(`document.querySelectorAll('.wsd-resume-actions button').length===${count}`, "Login actions match the explicit login source");
      await capture("authentication-recovery");
      if (row.id === "login-host-recovery") {
        await click("[data-recovery-retry=true]");
        await check("document.querySelector('output').textContent==='workspace.session.resume · original-task · codex'", "Explicit retry keeps the original task and runtime");
      }
    }
  } else if (row.id === "group-conversation") {
    await ready("!!window.__HARA_SHELL_FIXTURE__ && !!document.querySelector('.hs-field textarea')");
    await click(`.hs-sec-a[aria-label=${JSON.stringify(t("ws.channels.new"))}]`);
    await ready("document.querySelectorAll('.hs-channel-choices input[type=checkbox]').length===13");
    // The actual creation dialog owns the draft; this only supplies synthetic local text.
    await evaluate(`(()=>{const node=document.querySelector('.hs-channel-dialog input[aria-label=${JSON.stringify(t("ws.channels.name"))}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'Visual fixture group');node.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await button(t("ws.channels.none"), ".hs-channel-dialog");
    await evaluate("[...document.querySelectorAll('.hs-channel-choices input[type=checkbox]')].slice(0,2).forEach(node=>node.click())");
    await button(t("ws.channels.new"), ".hs-channel-dialog");
    await ready("!!document.querySelector('.hs-channel-compose textarea')");
    await value(".hs-channel-compose textarea", "Synthetic group case"); await click(".hs-channel-compose .hs-send");
    await ready("document.querySelectorAll('[data-channel-speaker]:not([data-channel-speaker=user])').length===2&&!document.querySelector('.hs-channel-thread .wsd-typing')");
    await check("document.querySelectorAll('[data-channel-speaker=user]').length===1", "One user message and two selected replies render");
    await check("window.__HARA_SHELL_FIXTURE__.calls.filter(row=>row.method==='workspace.channels.send').length===1 && window.__HARA_SHELL_FIXTURE__.calls.find(row=>row.method==='workspace.channels.send').params.recipientIds.length===2", "One synthetic group send has exactly two recipients");
    await check("!document.querySelector('.hs-channel-thread').textContent.includes('Please check the redesigned workspace shell.')", "Existing DM content stays outside the group");
    await capture("group-replies");
  } else throw new Error("Runnable case has no focused driver");
}
try {
  // The host and browser are owned by this run; no existing service is attached.
  server = await createServer({ configFile: false, root: repoRoot, cacheDir: join(working, "vite-cache"), appType: "mpa",
    server: { host: "127.0.0.1", port: await availableLoopbackPort(), strictPort: true }, logLevel: "error" });
  await server.listen();
  serverPort = server.httpServer.address().port;
  const base = new URL(`http://127.0.0.1:${serverPort}/`);
  if (!chromePath) throw new Error("Chrome unavailable");
  chrome = spawn(chromePath, ["--headless=new", "--use-mock-keychain", "--password-store=basic", "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions", "--disable-gpu", "--disable-sync", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--user-data-dir=" + join(working, "chrome-profile"), "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH, HOME: join(working, "home"), TMPDIR: join(working, "tmp"), LANG: "en_US.UTF-8" } });
  const endpoint = await new Promise((done, fail) => {
    let tail = "";
    const timer = setTimeout(() => fail(new Error("Owned browser did not start")), 15000);
    chrome.stderr.on("data", chunk => { const item = readDevToolsAnnouncement(tail, chunk); tail = item.tail; if (item.url) { clearTimeout(timer); done(item.url); } });
    chrome.once("error", () => { clearTimeout(timer); fail(new Error("Owned browser launch failed")); });
    chrome.once("exit", () => { clearTimeout(timer); fail(new Error("Owned browser exited")); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Owned browser connection timed out")), 15000);
    socket.addEventListener("open", () => { clearTimeout(timer); done(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); fail(new Error("Owned browser connection failed")); }, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") exceptionCount++;
    if (message.method === "Fetch.requestPaused") {
      const requestUrl = new URL(message.params.request.url);
      const allowed = requestUrl.origin === base.origin || ["data:", "blob:"].includes(requestUrl.protocol);
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: message.params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }).catch(() => {});
    }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.fail(new Error("Browser protocol request failed")); else request.done(message.result);
  });
  browserVersion = (await send("Browser.getVersion", {}, false)).product;
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable"); await send("Page.setLifecycleEventsEnabled", { enabled: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const row of cases) {
    currentCase = row.id;
    if (!row.fixture) {
      saveEvidence(row, { sourceSha: identity.sourceSha, captureMethod: "fixture-browser", checks: "pending", reason: row.pendingReason }, output);
      console.log(row.id + ": pending"); continue;
    }
    const directory = join(output, row.id, "fixture-browser"); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const assertions = [], screenshots = [], exceptionsBefore = exceptionCount;
    let outcome = "passed", failure = null;
    try {
      const url = new URL("test/fixtures/" + row.fixture.entry + ".html", base); url.search = new URLSearchParams(row.fixture.query).toString();
      await navigateCdp(send, socket, { url: url.href, sessionId, step: row.id });
      await exercise(row, assertions, async name => screenshots.push(await screenshot(directory, name)));
      assert.equal(exceptionCount, exceptionsBefore, "No uncaught component exception");
      assertions.push("No uncaught component exception");
    } catch (error) {
      failure = { kind: error.name, message: String(error.message).slice(0, 500) };
      console.error(row.id + ": " + failure.message);
      outcome = "failed"; process.exitCode = 1; assertions.push("Focused case execution failed");
      try { screenshots.push(await screenshot(directory, "failure")); } catch {}
    }
    assert.deepEqual(sourceIdentity(repoRoot, true), identity, "Source changed during capture");
    if (!screenshots.length) {
      saveEvidence(row, { sourceSha: identity.sourceSha, captureMethod: "fixture-browser", checks: "pending", reason: "Capture unavailable; focused assertions did not complete." }, output);
    } else {
      const checks = { schemaVersion: 1, caseId: row.id, sourceSha: identity.sourceSha, captureMethod: "fixture-browser", synthetic: true, status: outcome,
        browserVersion, fixture: row.fixture, viewport: { width: 1280, height: 900 }, assertions, failure };
      const file = join(directory, "checks.json"); writeFileSync(file, JSON.stringify(checks, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      saveEvidence(row, { sourceSha: identity.sourceSha, captureMethod: "fixture-browser", checks: outcome, screenshots, checkArtifact: relative(output, file) }, output);
    }
    console.log(row.id + ": " + outcome);
  }
} catch {
  process.exitCode = 1;
  console.error("Visual capture did not complete at " + currentCase + "; unrecorded cases remain pending.");
  for (const row of cases) if (!existsSync(join(output, row.id, "fixture-browser", "receipt.json"))) {
    saveEvidence(row, { sourceSha: identity.sourceSha, captureMethod: "fixture-browser", checks: "pending", reason: "Capture unavailable before completion at " + currentCase + "." }, output);
  }
} finally {
  let browserStopped = true, serverStopped = true;
  try { socket?.close(); if (chrome) await stopOwnedBrowser(chrome); } catch { browserStopped = false; process.exitCode = 1; }
  try { await server?.close(); if (server?.httpServer?.listening) throw new Error("Owned server is still listening"); } catch { serverStopped = false; process.exitCode = 1; }
  const report = buildReport(cases, output, sourceIdentity());
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(output, "report.md"), reportMarkdown(report), { mode: 0o600 });
  writeFileSync(join(output, "cleanup.json"), JSON.stringify({ browserStopped, serverStopped, serverPort: serverPort ?? null, ownerPid: process.pid, browserPid: chrome?.pid ?? null, scratch: working, systemKeychainUsed: false, realCoreStarted: false, nativeAcceptance: "pending" }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ report: join(output, "report.md"), browserStopped, serverStopped }));
}
