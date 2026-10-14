#!/usr/bin/env node
// Real Desktop + Engine dev instance. Only the model is synthetic; no operator credentials/history
// are copied. Keep the private receipt/data after shutdown so the user can inspect their dev work.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as reservePort } from "node:net";
import { chmodSync, closeSync, openSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error("Provide the exact absolute candidate Engine binary path.");
const engine = realpathSync.native(binary);
const desktop = fileURLToPath(new URL("../", import.meta.url));
const directory = realpathSync.native(mkdtempSync(join(tmpdir(), "hara-local-runtime-dev-")));
const home = join(directory, "home"), workspace = join(home, "workspace");
mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
const base = { PATH: `${dirname(engine)}:${process.env.PATH ?? ""}`, NO_COLOR: "1", HARA_UPDATE_CHECK: "0" };
const env = { ...base, HOME: home, USERPROFILE: home };
const model = "hara-dev-synthetic";
const syntheticKey = "synthetic-local-dev-only-not-a-real-credential";
let requests = 0, stopped = false, ui, serve;
const logs = [];
const log = (name) => { const fd = openSync(join(directory, name), "wx", 0o600); logs.push(fd); return fd; };
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, "/v1/chat/completions"); assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, `Bearer ${syntheticKey}`);
    assert.ok(++requests <= 128);
    let raw = ""; for await (const part of request) { raw += part; assert.ok(Buffer.byteLength(raw) <= 2 * 1024 * 1024); }
    const body = JSON.parse(raw); assert.equal(body.model, model);
    const users = body.messages.map((item, index) => ({ item, index })).filter(({ item }) => item.role === "user"
      && typeof item.content === "string" && !item.content.startsWith("<system-reminder>"));
    const latest = users.at(-1);
    const tail = body.messages.slice((latest?.index ?? -1) + 1);
    const answered = tail.some(item => item.role === "tool");
    const ask = !answered && /测试选项|測試選項|test choices/i.test(latest?.item.content ?? "")
      && body.tools?.some(item => item.function.name === "ask_user");
    const text = answered
      ? "已收到本機測試選項的回答。這條訊息由真正的 Pi Runtime 與聊天卡片鏈路返回；模型仍是零額度模擬服務。"
      : "這是獨立的 Hara 本地 dev，使用零額度模擬模型，不是真實 AI 回答。你可以查看主 Hara、新建 Agent（預設 Pi）、編輯 Runtime；輸入「測試選項」可檢查聊天選項卡。正式版的歷史、Key 和任務沒有被帶入。";
    const calls = ask ? [{ id: `dev_choice_${requests}`, type: "function", function: { name: "ask_user",
      arguments: JSON.stringify({ question: "這個聊天選項卡看起來如何？", options: ["清楚，可以繼續", "需要再調整"] }) } }] : undefined;
    const message = { role: "assistant", content: calls ? null : text, ...(calls ? { tool_calls: calls } : {}) };
    const finish = calls ? "tool_calls" : "stop";
    const usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };
    const envelope = { id: `dev-${requests}`, model, created: 1 };
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0,
        delta: calls ? { role: "assistant", tool_calls: calls.map((call, index) => ({ index, ...call })) } : { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ...envelope, choices: [{ index: 0, message, finish_reason: finish }], usage }));
    }
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "local synthetic fixture rejected request" } }));
  }
});
const delay = (ms) => new Promise(done => setTimeout(done, ms));
const stop = async () => {
  if (stopped) return; stopped = true;
  if (ui && ui.exitCode === null && ui.signalCode === null) {
    if (process.platform !== "win32") { try { process.kill(-ui.pid, "SIGTERM"); } catch {} }
    else ui.kill("SIGTERM");
  }
  if (serve && serve.exitCode === null && serve.signalCode === null) serve.kill("SIGTERM");
  server.closeAllConnections(); await new Promise(done => server.close(done));
  for (const fd of logs) closeSync(fd);
};
process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  for (const args of [["profile", "add", "local-dev", "--byok", "--provider", "openai-compatible", "--no-key-prompt",
    "--key", syntheticKey, "--base-url", endpoint, "--model", model], ["profile", "use", "local-dev"]]) {
    assert.equal(spawnSync(engine, args, { cwd: workspace, env, encoding: "utf8", timeout: 15000 }).status, 0, "synthetic dev profile setup failed");
  }
  const engineLog = log("engine.log");
  const port = await new Promise((done, reject) => {
    const reservation = reservePort(); reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => { const selected = reservation.address().port;
      reservation.close(error => error ? reject(error) : done(selected)); });
  });
  serve = spawn(engine, ["serve", "--host", "127.0.0.1", "--port", String(port), "--cwd", workspace, "--approval", "suggest"],
    { cwd: workspace, env, stdio: ["ignore", engineLog, engineLog] });
  const discovery = join(home, ".hara", "serve.json");
  const deadline = Date.now() + 20000;
  while (!existsSync(discovery) && Date.now() < deadline && serve.exitCode === null) await delay(50);
  assert.ok(existsSync(discovery), "isolated dev engine did not become ready");
  const record = JSON.parse(readFileSync(discovery, "utf8")); assert.equal(record.pid, serve.pid);
  const socket = new WebSocket(`ws://127.0.0.1:${record.port}`); const pending = new Map(); let next = 0;
  socket.addEventListener("message", event => { const result = JSON.parse(String(event.data)); pending.get(result.id)?.(result); pending.delete(result.id); });
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const rpc = (method, params = {}) => new Promise((done, reject) => { const id = ++next; const timer = setTimeout(() => reject(new Error("dev initialization RPC timed out")), 10000);
    pending.set(id, result => { clearTimeout(timer); done(result); }); socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); });
  assert.equal((await rpc("initialize", { token: record.token })).error, undefined);
  const catalog = await rpc("agents.list"); const main = catalog.result.agents.find(item => item.ref === "main");
  assert.equal((await rpc("agents.set-runtime", { ref: "main", runtimeId: "pi", expectedRevision: main.runtime.revision, expectedAgentRevision: main.revision })).error, undefined);
  socket.close();
  const receipt = join(directory, "receipt.json");
  writeFileSync(receipt, JSON.stringify({ mode: "synthetic-model-real-desktop-engine", engine, home, workspace, enginePid: serve.pid,
    engineVersion: record.version, mainRuntime: "pi", realCredentialsCopied: false, realModelCalls: false }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(receipt, 0o600);
  console.log(JSON.stringify({ developmentHome: home, receipt, model: "synthetic; no real model quota", mainRuntime: "pi" }));
  const uiLog = log("desktop.log");
  ui = spawn("npm", ["run", "tauri", "--", "dev", "--config", JSON.stringify({ productName: "Hara Dev", identifier: "com.nanhara.hara.dev", bundle: { active: false, externalBin: [] } })],
    { cwd: desktop, env: { ...base, HOME: process.env.HOME, HARA_DESKTOP_DEV_HOME: home },
      detached: process.platform !== "win32", stdio: ["ignore", uiLog, uiLog] });
  await new Promise((done, reject) => { ui.once("error", reject); ui.once("exit", code => { if (code && !stopped) reject(new Error("native dev shell exited; inspect its private desktop.log")); else done(); }); });
} finally { await stop(); }
