import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDemoState, reduceDesign, visibleModel, workspaceById, connectionForRun } from "../design/workspace-first/state.mjs";
import { escapeHTML, renderLayout } from "../design/workspace-first/view.mjs";

const NOW = 1_000_000;
const step = (state, action) => reduceDesign(state, action, { now: NOW });
const local = (state) => step(state, { type: "switch-workspace", workspaceId: "ws-mine" });
const actionFor = (state, type, fields = {}) => ({ type, workspaceId: state.activeWorkspaceId, ...fields });
function proposedTask(state = local(createDemoState())) {
  return step(state, actionFor(state, "send", { text: "請安排一項代碼檢查任務" }));
}
function startedTask(state = proposedTask()) {
  const approval = workspaceById(state, state.activeWorkspaceId).approvals.at(-1);
  return step(state, actionFor(state, "answer", { approvalId: approval.id, decision: "allow" }));
}

test("all peer Workspaces use the same schema and each has its own main Hara", () => {
  const state = createDemoState();
  const [pro, basic] = state.workspaces;
  assert.deepEqual(Object.keys(pro).sort(), Object.keys(basic).sort());
  assert.equal(pro.schemaVersion, basic.schemaVersion);
  for (const workspace of state.workspaces) {
    assert.equal(workspace.people.filter((person) => person.main).length, 1);
    assert.equal(workspace.parentId, undefined);
    assert.equal(workspace.kind, undefined, "direct/managed is a connection property, not Workspace hierarchy");
    assert.equal(workspace.people.find((person) => person.main).workspaceId, workspace.id);
  }
});

test("multiple model connections belong to each Workspace, and secret references stay out of views", () => {
  const state = createDemoState();
  for (const workspace of state.workspaces) {
    assert.equal(workspace.connections.length, 2);
    for (const connection of workspace.connections) assert.equal(connection.workspaceId, workspace.id);
    const model = visibleModel(step(state, { type: "switch-workspace", workspaceId: workspace.id }));
    assert.doesNotMatch(JSON.stringify(model), /mock-vault|credentialRef/);
  }
});

test("switching Workspaces preserves isolated drafts and never edits model configuration", () => {
  let state = local(createDemoState());
  const originalConnections = structuredClone(state.workspaces.map((workspace) => workspace.connections));
  state = step(state, actionFor(state, "draft", { text: "只在我的空間的草稿" }));
  state = step(state, { type: "switch-workspace", workspaceId: "ws-studio" });
  assert.notEqual(visibleModel(state).selected.draft, "只在我的空間的草稿");
  state = step(state, actionFor(state, "draft", { text: "工作室的另一份草稿" }));
  state = step(state, { type: "switch-workspace", workspaceId: "ws-mine" });
  assert.equal(visibleModel(state).selected.draft, "只在我的空間的草稿");
  assert.deepEqual(state.workspaces.map((workspace) => workspace.connections), originalConnections);
});

test("foreign connection IDs and stale foreground mutations fail instead of falling back", () => {
  const state = local(createDemoState());
  assert.throws(() => connectionForRun(state, "ws-mine", "ws-studio-primary"), /不屬於/);
  assert.throws(() => step(state, actionFor(state, "set-default", { connectionId: "ws-studio-primary" })), /不屬於/);
  assert.throws(() => step(state, { type: "draft", workspaceId: "ws-studio", text: "late response" }), /畫面已切換/);
});

test("changing defaults only affects new proposals, not existing pending cards or runs", () => {
  let state = startedTask();
  const firstTask = structuredClone(workspaceById(state, "ws-mine").tasks[0]);
  state = proposedTask(state);
  const originalApproval = structuredClone(workspaceById(state, "ws-mine").approvals.at(-1));
  state = step(state, actionFor(state, "set-default", { connectionId: "ws-mine-research" }));
  assert.deepEqual(workspaceById(state, "ws-mine").tasks[0], firstTask);
  state = step(state, actionFor(state, "answer", { approvalId: originalApproval.id, decision: "allow" }));
  assert.equal(workspaceById(state, "ws-mine").tasks.at(-1).run.connectionId, "ws-mine-primary");
  state = proposedTask(state);
  assert.equal(workspaceById(state, "ws-mine").approvals.at(-1).connectionId, "ws-mine-research");
});

test("a running task stays bound to its original Workspace while the foreground switches", () => {
  let state = startedTask();
  const task = structuredClone(workspaceById(state, "ws-mine").tasks[0]);
  state = step(state, { type: "switch-workspace", workspaceId: "ws-studio" });
  assert.deepEqual(workspaceById(state, "ws-mine").tasks[0], task);
  assert.equal(visibleModel(state).workspace.tasks.length, 0);
  assert.throws(() => step(state, actionFor(state, "submit-result", { taskId: task.id })), /不屬於/);
});

test("old approval clicks cannot authorize work in the newly selected Workspace", () => {
  let state = proposedTask();
  const approvalId = workspaceById(state, "ws-mine").approvals[0].id;
  state = step(state, { type: "switch-workspace", workspaceId: "ws-studio" });
  assert.throws(() => step(state, { type: "answer", workspaceId: "ws-mine", approvalId, decision: "allow" }), /畫面已切換/);
  assert.throws(() => step(state, actionFor(state, "answer", { approvalId, decision: "allow" })), /不屬於/);
  assert.equal(workspaceById(state, "ws-mine").tasks.length, 0);
});

test("approval expiry, membership changes and policy changes each invalidate the original card", () => {
  const state = proposedTask();
  const approvalId = workspaceById(state, "ws-mine").approvals[0].id;
  const action = actionFor(state, "answer", { approvalId, decision: "allow" });
  assert.throws(() => reduceDesign(state, action, { now: NOW + 300_001 }), /失效/);
  for (const revision of ["membershipRevision", "policyRevision"]) {
    const changed = structuredClone(state);
    workspaceById(changed, "ws-mine")[revision]++;
    assert.throws(() => step(changed, action), /失效/);
  }
});

test("revocation stops bound runs and refuses pending approvals without borrowing another Key", () => {
  let state = startedTask();
  state = proposedTask(state);
  const approvalId = workspaceById(state, "ws-mine").approvals.at(-1).id;
  state = step(state, actionFor(state, "revoke-connection", { connectionId: "ws-mine-primary" }));
  assert.equal(workspaceById(state, "ws-mine").tasks[0].state, "blocked");
  assert.equal(workspaceById(state, "ws-mine").defaultConnectionId, "ws-mine-primary");
  assert.throws(() => step(state, actionFor(state, "answer", { approvalId, decision: "allow" })), /已撤銷/);
  assert.throws(() => connectionForRun(state, "ws-mine", "ws-mine-primary"), /已撤銷/);
});

test("edited credential generations invalidate a pending approval even if the connection is enabled", () => {
  const state = proposedTask();
  const workspace = workspaceById(state, "ws-mine");
  workspace.connections[0].revision++;
  assert.throws(() => step(state, actionFor(state, "answer", { approvalId: workspace.approvals[0].id, decision: "allow" })), /授權已變更/);
});

test("single-use approval does not duplicate tasks or run an unrecognized executor", () => {
  let state = proposedTask();
  const approvalId = workspaceById(state, "ws-mine").approvals[0].id;
  assert.throws(() => step(state, actionFor(state, "answer", { approvalId, decision: "allow", executor: "unknown" })), /未知執行引擎/);
  state = step(state, actionFor(state, "answer", { approvalId, decision: "allow", executor: "Pi" }));
  assert.equal(workspaceById(state, "ws-mine").tasks[0].run.executor, "Pi");
  assert.throws(() => step(state, actionFor(state, "answer", { approvalId, decision: "allow" })), /已處理/);
  assert.equal(workspaceById(state, "ws-mine").tasks.length, 1);
});

test("engine completion enters review and does not close the task without acceptance", () => {
  let state = startedTask();
  const taskId = workspaceById(state, "ws-mine").tasks[0].id;
  assert.throws(() => step(state, actionFor(state, "accept-result", { taskId })), /先提交結果/);
  state = step(state, actionFor(state, "submit-result", { taskId }));
  const task = workspaceById(state, "ws-mine").tasks[0];
  assert.equal(task.run.state, "finished");
  assert.equal(task.state, "review");
  state = step(state, actionFor(state, "accept-result", { taskId }));
  assert.equal(workspaceById(state, "ws-mine").tasks[0].state, "done");
});

test("plan labels do not grant administration or disable private channels", () => {
  for (const workspaceId of ["ws-studio", "ws-mine"]) {
    let state = step(createDemoState(), { type: "switch-workspace", workspaceId });
    state = step(state, actionFor(state, "create-channel", { name: "私人討論", private: true }));
    assert.equal(workspaceById(state, workspaceId).conversations.at(-1).private, true);
    workspaceById(state, workspaceId).people.find((person) => person.id === state.viewerId).role = "member";
    assert.throws(() => step(state, actionFor(state, "set-default", { connectionId: `${workspaceId}-research` })), /版本高低不會授予權限/);
  }
});

test("an AI principal cannot substitute for a human account in the prototype context", () => {
  const state = createDemoState();
  state.viewerId = "ws-studio-hara";
  assert.throws(() => visibleModel(state), /無權訪問/);
});

test("private conversations, related tasks and injected foreign messages stay out of the view", () => {
  let state = createDemoState();
  state = step(state, actionFor(state, "create-channel", { name: "PRIVATE-CONTENT-MARKER", private: true }));
  const workspace = workspaceById(state, "ws-studio");
  workspace.tasks.push({ id: "private-task", workspaceId: workspace.id, conversationId: workspace.selectedConversationId, title: "PRIVATE-TASK-MARKER" });
  state.viewerId = "ws-studio-human";
  assert.doesNotMatch(JSON.stringify(visibleModel(state)), /PRIVATE-CONTENT-MARKER|PRIVATE-TASK-MARKER/);
  state = createDemoState();
  workspaceById(state, "ws-studio").conversations[1].messages.push({ workspaceId: "ws-mine", text: "FOREIGN-MESSAGE-MARKER" });
  assert.doesNotMatch(renderLayout(state), /FOREIGN-MESSAGE-MARKER/);
});

test("ordinary chat does not become a task, and unmentioned channel messages do not wake AI", () => {
  let state = createDemoState();
  let workspace = workspaceById(state, "ws-studio");
  const previous = workspace.conversations[1].messages.length;
  state = step(state, actionFor(state, "send", { text: "今天先整理一下想法" }));
  workspace = workspaceById(state, "ws-studio");
  assert.equal(workspace.conversations[1].messages.length, previous + 1);
  assert.equal(workspace.approvals.length, 0);
  state = step(state, actionFor(state, "send", { text: "@Hara 你好" }));
  assert.equal(workspaceById(state, "ws-studio").approvals.length, 0);
  assert.equal(workspaceById(state, "ws-studio").tasks.length, 0);
});

test("human-only DMs do not silently invite Hara or buy an AI turn", () => {
  let state = createDemoState();
  const conversationId = "ws-studio-dm-ws-studio-human";
  state = step(state, actionFor(state, "select-conversation", { conversationId }));
  const before = visibleModel(state).selected.messages.length;
  state = step(state, actionFor(state, "send", { text: "請幫我檢查代碼" }));
  assert.equal(visibleModel(state).selected.messages.length, before + 1);
  assert.equal(workspaceById(state, "ws-studio").approvals.length, 0);
});

test("creating a colleague needs a card, grants no runtime and does not duplicate an existing colleague", () => {
  let state = local(createDemoState());
  state = step(state, actionFor(state, "send", { text: "請幫我建立一位開發同事" }));
  const workspace = workspaceById(state, "ws-mine");
  assert.equal(workspace.people.length, 2);
  state = step(state, actionFor(state, "answer", { approvalId: workspace.approvals[0].id, decision: "allow" }));
  const colleague = workspaceById(state, "ws-mine").people.at(-1);
  assert.deepEqual(colleague.bindings, []);
  assert.equal(colleague.workspaceId, "ws-mine");
  state = step(state, actionFor(state, "send", { text: "請幫我建立一位開發同事" }));
  assert.equal(workspaceById(state, "ws-mine").people.length, 3);
  assert.equal(workspaceById(state, "ws-mine").approvals.length, 1);
});

test("new Workspace is a peer, has independent connections and never copies old data", () => {
  const state = step(startedTask(), { type: "create-workspace", name: "新的平等空間" });
  const workspace = workspaceById(state, state.activeWorkspaceId);
  assert.equal(workspace.plan, "Basic");
  assert.equal(workspace.tasks.length, 0);
  assert.equal(workspace.approvals.length, 0);
  assert.equal(workspace.people.length, 2);
  assert.equal(workspace.parentId, undefined);
  assert.equal(workspace.connections.length, 0);
  assert.equal(workspace.defaultConnectionId, null);
});

test("new empty Workspace asks for its own connection rather than using an existing account", () => {
  let state = step(createDemoState(), { type: "create-workspace", name: "還沒有連接" });
  state = step(state, actionFor(state, "send", { text: "請安排代碼任務" }));
  assert.equal(workspaceById(state, state.activeWorkspaceId).approvals.length, 0);
  assert.match(visibleModel(state).selected.messages.at(-1).text, /沒有模型連接/);
  state = step(state, actionFor(state, "add-connection", { label: "明確加入的新連接", kind: "direct" }));
  const workspace = workspaceById(state, state.activeWorkspaceId);
  assert.equal(workspace.connections.length, 1);
  assert.equal(workspace.defaultConnectionId, workspace.connections[0].id);
});

test("the synthetic connection form rejects real credential fields and supports both connection modes", () => {
  let state = local(createDemoState());
  assert.throws(() => step(state, actionFor(state, "add-connection", { label: "mock", kind: "direct", apiKey: "synthetic-forbidden-field" })), /不接收 API Key/);
  for (const kind of ["direct", "managed"]) state = step(state, actionFor(state, "add-connection", { label: `${kind} connection`, kind }));
  assert.equal(workspaceById(state, "ws-mine").connections.length, 4);
});

test("dynamic text is escaped and the rendered settings never include credential references", () => {
  assert.equal(escapeHTML('<script a="x">&\''), "&lt;script a=&quot;x&quot;&gt;&amp;&#39;");
  let state = local(createDemoState());
  state = step(state, actionFor(state, "add-connection", { label: '<img src=x onerror="alert(1)">', kind: "direct" }));
  state = step(state, actionFor(state, "navigate", { page: "settings" }));
  const html = renderLayout(state);
  assert.doesNotMatch(html, /<img src=x|mock-vault|credentialRef/);
  assert.match(html, /&lt;img src=x/);
});

test("all prototype pages and dialogs have unique IDs, keyboard labels and visible synthetic boundaries", () => {
  for (const workspaceId of ["ws-studio", "ws-mine"]) for (const page of ["chat", "tasks", "settings"]) {
    let state = step(createDemoState(), { type: "switch-workspace", workspaceId });
    state = step(state, actionFor(state, "navigate", { page }));
    for (const modal of [null, "workspace", "channel", "connection"]) {
      const variant = modal ? step(state, actionFor(state, "open-modal", { modal })) : state;
      const html = renderLayout(variant);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(ids.length, new Set(ids).size);
      assert.match(html, /打開工作空間導航/);
      if (page === "chat") assert.match(html, /全部為合成資料/);
      if (modal) assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="modal-title"/);
    }
  }
});

test("CSS keeps message cards unshrunk, wraps long content and supplies responsive navigation", () => {
  const css = readFileSync(new URL("../design/workspace-first/style.css", import.meta.url), "utf8");
  assert.match(css, /\.decision-card\s*\{[^}]*flex:0 0 auto/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /grid-template-columns:264px minmax\(0,1fr\)/);
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /\.nav-expanded \.sidebar/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("prototype sources contain no network, persistent browser storage or external send integration", () => {
  for (const filename of ["app.mjs", "state.mjs", "view.mjs"]) {
    const source = readFileSync(new URL(`../design/workspace-first/${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|sendBeacon)\s*[(.]/);
  }
  const builder = readFileSync(new URL("../design/workspace-first/build.mjs", import.meta.url), "utf8");
  assert.match(builder, /connect-src 'none'/);
  assert.match(builder, /form-action 'none'/);
  assert.match(builder, /script-src 'sha256-/);
});
