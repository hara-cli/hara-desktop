// Executes our built prototype with a tiny synthetic DOM adapter, not a browser/layout engine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const filename = process.argv[2] ?? fileURLToPath(new URL("../../.design-preview/workspace-preview.html", import.meta.url));
const html = readFileSync(filename, "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
assert.ok(script && style);
for (const content of [script, style]) assert.ok(html.includes(`'sha256-${createHash("sha256").update(content).digest("base64")}'`));
assert.match(html, /connect-src 'none'/);

function fixture() {
  const listeners = new Map();
  const keys = new Map();
  let focusCount = 0;
  const scroll = { scrollTop: 0, scrollHeight: 400 };
  const root = {
    innerHTML: "",
    addEventListener: (name, handler) => listeners.set(name, handler),
    querySelectorAll: () => [],
    querySelector: (selector) => selector === ".workspace-trigger" ? { focus() { focusCount++; } } : null,
  };
  const document = {
    getElementById: (id) => id === "workspace-prototype" ? root : id === "chat-scroll" && root.innerHTML.includes('id="chat-scroll"') ? scroll : null,
    addEventListener: (name, handler) => keys.set(name, handler),
    activeElement: null,
  };
  class SyntheticFormData { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? null; } }
  vm.runInNewContext(script, { document, FormData: SyntheticFormData, structuredClone, Date, setTimeout: () => 1, clearTimeout() {}, console }, { timeout: 2000 });
  const click = (action, workspaceId, extra = {}) => {
    const button = { dataset: { action, workspaceId, ...extra }, closest() { return this; }, disabled: false };
    listeners.get("click")({ target: button });
  };
  const submit = (kind, workspaceId, values) => {
    const form = { dataset: { form: kind, workspaceId }, values, closest() { return this; } };
    listeners.get("submit")({ target: form, preventDefault() {} });
  };
  return { root, click, submit, keys, listeners, focusCount: () => focusCount };
}

const passed = [];
function check(name, run) { run(); passed.push(name); }

check("built script boots, opens the peer Workspace picker and switches without old content", () => {
  const app = fixture();
  assert.match(app.root.innerHTML, /產品研發/);
  app.click("toggle-menu", "ws-studio");
  assert.match(app.root.innerHTML, /workspace-option selected/);
  assert.match(app.root.innerHTML, /我的空間/);
  app.click("switch-workspace", "ws-mine");
  assert.doesNotMatch(app.root.innerHTML, /新版的入口/);
  assert.match(app.root.innerHTML, /全部為合成資料/);
});

check("native event wiring opens and cancels a dialog with Escape and focus restoration", () => {
  const app = fixture();
  app.click("open-modal", "ws-studio", { modal: "connection" });
  assert.match(app.root.innerHTML, /role="dialog"/);
  assert.match(app.root.innerHTML, /不收集 API Key/);
  app.keys.get("keydown")({ key: "Escape", target: {} });
  assert.doesNotMatch(app.root.innerHTML, /role="dialog"/);
  assert.equal(app.focusCount(), 1);
});

check("form submission creates an independent Basic Workspace instead of copying the current one", () => {
  const app = fixture();
  app.click("open-modal", "ws-studio", { modal: "workspace" });
  app.submit("workspace", "ws-studio", { name: "獨立的新空間" });
  assert.match(app.root.innerHTML, /獨立的新空間/);
  assert.match(app.root.innerHTML, /Basic/);
  assert.doesNotMatch(app.root.innerHTML, /新版的入口|小林|role="dialog"/);
});

check("chat creates an approval, execution submits a result and acceptance closes the loop", () => {
  const app = fixture();
  app.click("switch-workspace", "ws-mine");
  app.submit("message", "ws-mine", { message: "請安排代碼檢查任務" });
  const approvalId = /data-approval-id="([^"]+)"/.exec(app.root.innerHTML)?.[1];
  assert.ok(approvalId);
  app.click("answer", "ws-mine", { approvalId, decision: "allow" });
  assert.match(app.root.innerHTML, /演示執行中/);
  const taskId = /data-task-id="([^"]+)"/.exec(app.root.innerHTML)?.[1];
  assert.ok(taskId);
  app.click("submit-result", "ws-mine", { taskId });
  assert.match(app.root.innerHTML, /待你驗收/);
  app.click("accept-result", "ws-mine", { taskId });
  assert.match(app.root.innerHTML, /已驗收/);
});

check("ordinary chat has no task proposal, but channel creation and settings controls are wired", () => {
  const app = fixture();
  app.click("switch-workspace", "ws-mine");
  app.submit("message", "ws-mine", { message: "你好" });
  assert.doesNotMatch(app.root.innerHTML, /class="decision-card"/);
  app.click("open-modal", "ws-mine", { modal: "channel" });
  app.submit("channel", "ws-mine", { name: "私人試驗", private: "on" });
  assert.match(app.root.innerHTML, /私人試驗/);
  app.click("navigate", "ws-mine", { page: "settings" });
  assert.match(app.root.innerHTML, /一個空間，可以有多個 Key/);
  app.click("set-default", "ws-mine", { connectionId: "ws-mine-research" });
  assert.match(app.root.innerHTML, /既有任務和確認卡仍維持原綁定/);
});

check("a stale button from another Workspace fails rather than mutating the newly active one", () => {
  const app = fixture();
  app.click("switch-workspace", "ws-mine");
  app.click("set-default", "ws-studio", { connectionId: "ws-studio-research" });
  assert.match(app.root.innerHTML, /畫面已切換/);
  app.click("navigate", "ws-mine", { page: "settings" });
  assert.match(app.root.innerHTML, /我的模型連接 <span class="default-tag">新任務預設/);
});

process.stdout.write(JSON.stringify({ file: filename, eventChecksPassed: passed.length, checks: passed, cspHashes: "verified", browserVisualQA: "not performed", hostAuthorization: "not implemented", networkCalls: 0 }, null, 2) + "\n");
