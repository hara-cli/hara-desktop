// Local-only acceptance: the real packaged window, its auto-started bundled Core, fake loopback HTTP.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createPrivateTestVault } from "./workspace-native-vault.mjs";
const [shell, evidence, hold] = process.argv.slice(2);
const desktop = fileURLToPath(new URL("../", import.meta.url));
assert.equal(process.platform, "darwin");
assert(/^\/private\/tmp\/hara-redesign-native-20261020\/native-(arm64|intel)(-[0-9]+)?$/.test(evidence));
assert.equal(fs.realpathSync(evidence), evidence);
assert.equal(fs.statSync(evidence).mode & 0o777, 0o700);
assert.equal(fs.readFileSync(join(desktop, "src-tauri/binaries/SIDECAR_COMMIT"), "utf8").trim(), "4e507e7f1595e618527e5c95a1890ae9271615e7");
assert.equal(spawnSync("git", ["-C", desktop, "branch", "--show-current"], {encoding:"utf8"}).stdout.trim(), "feat/main-redesign-1.1.0");
const desktopSource = spawnSync("git", ["-C", desktop, "rev-parse", "HEAD"], {encoding:"utf8"}).stdout.trim();

const { WorkspaceDevModel } = await import(pathToFileURL(join(desktop, "src/workspace-dev-state.ts")));
const { WorkspaceDevConnectionClient } = await import(pathToFileURL(join(desktop, "src/workspace-dev-rpc.ts")));
assert.deepEqual(fs.readdirSync(evidence), []);
const root = join(evidence, "window-workspace"), caller = join(evidence, "app-home");
for (const directory of [root, caller, join(evidence,"legacy-source"), join(evidence,"legacy-source/.hara")]) fs.mkdirSync(directory,{mode:0o700});
fs.writeFileSync(join(evidence,"legacy-source/.hara/local-inheritance-fixture-v1.json"), JSON.stringify({schemaVersion:1,kind:"synthetic-source"}), {mode:0o600});
const privateVault = createPrivateTestVault(caller);
fs.writeFileSync(join(evidence,"private-test-vault.json"), JSON.stringify(privateVault.receipt), {mode:0o600});

const discovery = join(root, "home/.hara/workspace-runtime/serve-v2.json");
const hash = path => createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const write = (name, value) => fs.writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
let requests = 0, colleague, fixtureError, app, info, client, model;
const launches = [];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (check, budget = 15000) => { const deadline = Date.now() + budget;
  while (Date.now() < deadline) { if (fixtureError) throw fixtureError; const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("Local native acceptance wait did not settle"); };
const intake = goal => ({ intent: "change", goal, constraints: ["only the synthetic Workspace project"], acceptance: ["verified local receipt"], steps: ["perform", "verify", "report"] });
const checkpoint = (id, artifacts = []) => ({ artifacts, completion: { state: "verified", checks: [{ acceptance_index: 0, evidence: "Observed the actual local tool receipt", tool_call_ids: [id] }], final_answer: "已完成並驗證本機合成任務。" } });
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers.authorization, "Bearer workspace-local-fake-key");
    let raw = ""; for await (const chunk of request) { raw += chunk; assert.ok(Buffer.byteLength(raw) < 200000); }
    const body = JSON.parse(raw); assert.equal(body.model, "local-mock-model"); const n = ++requests; assert.ok(n <= 15);
    if(n===15) await new Promise(resolve=>setTimeout(resolve,1500));
    let name, input;
    switch (n) {
      case 1: break;
      case 2: name = "task_intake"; input = intake("建立 Pi 同事 Coder"); break;
      case 3: name = "agent_create"; input = { username: "coder", displayName: "Coder", title: "Coding colleague", instructions: "只在本機授權空間執行文件任務並驗證。" }; break;
      case 4: name = "task_checkpoint"; input = checkpoint("mock_3"); break;
      case 5: name = "task_intake"; input = intake("委派 Coder 生成 hello.md 並驗證"); break;
      case 6: name = "agent_contact"; input = { agentId: colleague, task: "生成 hello.md，內容為 hello workspace\n並驗證。" }; break;
      case 7: name = "task_intake"; input = intake("生成 hello.md 並驗證"); break;
      case 8: name = "workspace_read"; input = { path: "hello.md" }; break;
      case 9: name = "workspace_write"; input = { path: "hello.md", content: "hello workspace\n" }; break;
      case 10: name = "workspace_verify"; input = { path: "hello.md", expectedContent: "hello workspace\n" }; break;
      case 11: name = "task_checkpoint"; input = checkpoint("mock_10", ["hello.md"]); break;
      case 12: name = "task_checkpoint"; input = checkpoint("mock_6"); break;
    }
    if (name) assert.ok(body.tools.some(tool => tool.function.name === name));
    const delta = name ? { role: "assistant", tool_calls: [{ index: 0, id: `mock_${n}`, type: "function", function: { name, arguments: JSON.stringify(input) } }] }
      : { role: "assistant", content: n > 12 ? `Native UI reply ${n}` : "你好，這是正式 Workspace 入口的本機模擬回覆。" };
    response.writeHead(200, { "content-type": "text/event-stream" });
    const frame = (delta, finish_reason = null, usage) => response.write(`data: ${JSON.stringify({ id: `mock_${n}`, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
    frame(delta); frame({}, name ? "tool_calls" : "stop", { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }); response.end("data: [DONE]\n\n");
  } catch (error) { fixtureError = error; response.writeHead(400); response.end("Local fixture rejected request"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
async function captureWindow(stage) {
  if(process.env.HARA_NATIVE_SKIP_SCREENSHOTS === "1") {
    write(`native-${stage}-window.json`,{stage,candidatePid:app.pid,pixelStatus:"not captured by CLI; native CUA observation is recorded separately"});return;
  }
  await new Promise(resolve => setTimeout(resolve, 800));
  const probe = () => {
    const result=spawnSync(join(dirname(evidence),"workspace-native-probe"),[String(app.pid),shell],{encoding:"utf8",timeout:5000});
    assert.equal(result.status,0,"Owned window probe failed");return JSON.parse(result.stdout);
  };
  const before=probe(), window=before.windows.find(row=>row.onscreen&&row.layer===0&&row.bounds.Width>=720&&row.bounds.Height>=480);
  const result={stage,candidatePid:app.pid,before,screenshot:null,pixelStatus:"pending: locked, authorization prompt, or no visible window"};
  if (before.screenLocked===false && !before.keychainPromptVisible && window) {
    const path=join(evidence,`native-${stage}.png`);
    const capture=spawnSync("/usr/sbin/screencapture",["-x","-l",String(window.windowId),path],{timeout:10000,stdio:"ignore"});
    const after=probe();
    if(capture.status===0&&after.screenLocked===false&&!after.keychainPromptVisible){fs.chmodSync(path,0o600);result.screenshot=path;result.pixelStatus="captured; separate visual inspection required";}
  }
  write(`native-${stage}-window.json`,result);
}

async function start() {
  assert(shell.startsWith("/private/tmp/hara-redesign-native-20261020/cargo-target/") && shell.endsWith("/bundle/macos/Hara Redesign Candidate.app/Contents/MacOS/hara-desktop"));
  assert.equal(fs.realpathSync(shell), shell);
  const marker = JSON.parse(fs.readFileSync(join(evidence, "legacy-source/.hara/local-inheritance-fixture-v1.json")));
  assert.equal(marker.schemaVersion, 1); assert.equal(marker.kind, "synthetic-source");
  const vault = JSON.parse(fs.readFileSync(join(evidence, "private-test-vault.json")));
  assert.equal(vault.path, join(caller, "Library/Keychains/synthetic.keychain-db"));
  assert.equal(vault.onlySyntheticCredentials, true); assert.equal(vault.realUserDefaultAndSearchUnchanged, true);
  app = spawn(shell, [], { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: caller, USERPROFILE: caller, TMPDIR: "/private/tmp",
    HARA_DESKTOP_WORKSPACE_ROOT: root, HARA_DESKTOP_LEGACY_SOURCE_HOME: join(evidence, "legacy-source"), HARA_UPDATE_CHECK: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.openSync(join(evidence, `window-launch-${launches.length + 1}.log`), "a", 0o600);
  for (const stream of [app.stdout, app.stderr]) stream.on("data", chunk => fs.writeSync(log, chunk));
  app.once("exit", () => fs.closeSync(log));
  info = await wait(() => { assert.equal(app.exitCode, null, "native shell must remain alive");
    try { const value = JSON.parse(fs.readFileSync(discovery)); return alive(value.pid) ? value : false; } catch { return false; }
  }, 30000);
  assert.equal(info.capability, "workspace.v1"); assert.equal(info.executionMode, "workspace");
  const ps = spawnSync("/bin/ps", ["-p", String(info.pid), "-o", "ppid=,command="], { encoding: "utf8" }); assert.equal(ps.status, 0);
  const expectedSidecar = join(dirname(shell), "hara");
  assert.ok(ps.stdout.includes(`${expectedSidecar} workspace serve --root ${root} --port 0`), "only the app's exact bundled Core may start");
  assert.equal(Number(ps.stdout.trim().split(/\s+/)[0]), app.pid, "Core must have been auto-started by the actual window host");
  launches.push({ appPid: app.pid, corePid: info.pid, coreParentIsWindowHost: true, protocol: info.capability, coreSha256: hash(expectedSidecar), paidRequests: 0 });
  client = new WorkspaceDevConnectionClient({ ...info, root, syntheticOnly: false, executionMode: "workspace" }, () => {}); await client.initialize(info.token);
  model = new WorkspaceDevModel(client, undefined, false, "workspace"); client.setChangedListener(id => { if (model.getSnapshot().workspaceId === id) void model.refresh(); }); await model.loadDirectory();
}
async function stop() {
  client?.close(); client = undefined;
  if (app && app.exitCode === null && app.signalCode === null) {
    const quit = spawnSync(join(dirname(evidence), "workspace-native-quit"), [String(app.pid), shell], { encoding: "utf8", timeout: 5000 });
    assert.equal(quit.status, 0, "only the exact owned candidate may receive a normal quit request");
    await wait(() => app.exitCode !== null || app.signalCode !== null, 8000);
  }
  if (info && alive(info.pid)) { const ps = spawnSync("/bin/ps", ["-p", String(info.pid), "-o", "command="], { encoding: "utf8" });
    assert.equal(ps.status, 0); assert.ok(ps.stdout.includes(`${join(dirname(shell), "hara")} workspace serve --root ${root}`));
    process.kill(info.pid, "SIGTERM"); await wait(() => !alive(info.pid), 8000);
  }
  app = undefined; info = undefined;
}
try {
  await start(); assert.equal(requests, 0); write("window-ready.json", { stage: "empty formal welcome; ready for read-only visual inspection", launches });
  await captureWindow("welcome");
  await model.createWorkspace("Jeff 本機原生驗收"); const id = model.getSnapshot().workspaceId; assert.ok(id);
  assert.equal(await model.configureConnection({ label: "Local mock only", provider: "openai", baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "workspace-local-fake-key", defaultModel: "local-mock-model" }), true);
  model.setDraft("你好"); await model.send(); await wait(async () => { await model.refresh(); return model.getSnapshot().workspace?.conversation.state === "completed"; }); assert.equal(requests, 1);
  model.setDraft("建立 Pi 同事 Coder"); await model.send(); const card = await wait(async () => { await model.refresh(); return model.getSnapshot().workspace?.approvals[0]; });
  await model.respond(card, true); await wait(async () => { await model.refresh(); return model.getSnapshot().workspace?.conversation.state === "completed"; });
  colleague = model.getSnapshot().workspace.agents.find(row => row.kind === "colleague")?.agentId; assert.ok(colleague); assert.equal(requests, 4);
  model.setDraft("委派 Coder 生成 hello.md 並驗證"); await model.send(); await wait(async () => { await model.refresh(); return model.getSnapshot().workspace?.conversation.state === "completed"; });
  const before = model.getSnapshot().workspace; assert.equal(before.conversation.completion?.state, "verified"); assert.equal(requests, 12);
  const artifact = join(root, "project", id, "hello.md"); assert.equal(fs.readFileSync(artifact, "utf8"), "hello workspace\n"); const inode = fs.statSync(artifact).ino, digest = hash(artifact);
  await model.createWorkspace("Settings isolation workspace"); const secondWorkspaceId=model.getSnapshot().workspaceId; assert(secondWorkspaceId!==id);
  await model.selectWorkspace(id);
  const frozen = JSON.stringify([before.agents, before.connections, before.conversation]);
  await stop(); await start(); await model.selectWorkspace(id); const after = model.getSnapshot().workspace;
  assert.equal(JSON.stringify([after.agents, after.connections, after.conversation]), frozen); assert.equal(requests, 12);
  assert.equal(fs.statSync(artifact).ino, inode); assert.equal(hash(artifact), digest); assert.notEqual(launches[0].corePid, launches[1].corePid);
  write("window-recovered.json", { passed: true, launches, requests, paidRequests: 0, restartExtraRequests: 0, historyAndCredentialGenerationRecovered: true, artifactInodeRecovered: true, artifactSha256: digest, workspaceId: id, colleagueAgentId: colleague,
    sixStepDriver: "actual Desktop Model/RPC Client attached to the packaged window's auto-started Core; not six GUI clicks", devOrViteFlagUsed: false, sourceCore: "4e507e7f1595e618527e5c95a1890ae9271615e7", sourceDesktop: desktopSource });
  await captureWindow("recovered");
  assert.equal(requests, 12);
  const tasks=await model.workspaceRequest("workspace.tasks"); assert(tasks.length>=2); assert(tasks.some(task=>task.status==="completed"));
  write("native-ui-ready.json",{appPid:app.pid,corePid:info.pid,workspaceId:id,secondWorkspaceId,requests,sourceDesktop:desktopSource,taskHistoryRecords:tasks.length});
  if(hold==="--hold-ui") {
    await wait(()=>fs.existsSync(join(evidence,"finish-ui")),600000);
    const dm=await client.request("workspace.snapshot",{workspaceId:id,agentId:colleague});
    const main=await client.request("workspace.snapshot",{workspaceId:id,agentId:after.selectedAgentId});
    const privateChat=dm.conversation.history.some(row=>row.role==="assistant"&&row.text==="Native UI reply 13");
    const mainChat=main.conversation.history.some(row=>row.role==="assistant"&&row.text==="Native UI reply 14");
    write("native-ui-chat-verification.json",{privateChat,mainChat,requests,manualUIEvidence:"separate screenshots and UI state receipts"});
  }
  if(requests===14) {
    await model.refresh();model.setDraft("Interrupt only this synthetic run");await model.send();
    await wait(()=>requests===15);await model.cancel();
    await wait(async()=>{await model.refresh();return model.getSnapshot().workspace.conversation.state==="cancelled";});
    assert(!model.getSnapshot().workspace.conversation.history.some(row=>row.role==="assistant"&&row.text==="Native UI reply 15"));
    write("native-interruption.json",{passed:true,requests,lateAssistantOutputSuppressed:true,artifactSha256:hash(artifact)});
  }
  client.close();client=new WorkspaceDevConnectionClient({...info,root,syntheticOnly:false,executionMode:"workspace"},()=>{});await client.initialize(info.token);
  model=new WorkspaceDevModel(client,undefined,false,"workspace");await model.loadDirectory();await model.selectWorkspace(id);
  assert.equal(hash(artifact),digest);write("native-reconnect.json",{passed:true,requests,artifactPreserved:true,noAutomaticResend:true});
} finally {
  fixtureError = undefined; await stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  write("private-vault-cleanup.json",privateVault.cleanup());
  write("window-cleanup.json", { ownedWindowAndCoreStopped: !app && !info, mockProviderStopped: true, requests, paidRequests: 0, launches });
}
