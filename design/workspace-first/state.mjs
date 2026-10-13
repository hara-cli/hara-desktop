// Design-only reference model. This is NOT the production authorization or storage layer.
export const EXECUTORS = ["OpenCode", "Pi", "Codex", "Claude Code"];
const DEMO_ACTOR = "human-demo";

function createWorkspace(id, name, plan, populated = false) {
  const hara = { id: `${id}-hara`, workspaceId: id, name: "Hara", title: "你的協作伙伴", type: "agent", main: true, bindings: [] };
  const developer = { id: `${id}-developer`, workspaceId: id, name: "開發同事", title: "開發與驗證", type: "agent", bindings: ["OpenCode", "Pi"] };
  const people = [{ id: DEMO_ACTOR, workspaceId: id, name: "你", type: "human", role: "owner" }, hara];
  if (populated) people.push(developer, { id: `${id}-human`, workspaceId: id, name: "小林", type: "human", role: "member" });
  const conversations = [{ id: `${id}-main`, workspaceId: id, name: "Hara", kind: "dm", memberIds: [DEMO_ACTOR, hara.id], messages: [{ id: `${id}-welcome`, workspaceId: id, authorId: hara.id, text: populated ? "我們先在這裡把需求說清楚。我會安排合適的同事，結果和需要你決定的事，也會回到這段對話。" : "嗨，這是我們的工作空間。你可以直接跟我聊，也可以讓我幫你建立一位同事。", time: "09:40" }], draft: "" }];
  if (populated) conversations.push({ id: `${id}-development`, workspaceId: id, name: "產品研發", kind: "channel", private: false, memberIds: people.map((member) => member.id), draft: "", messages: [
    { id: `${id}-m1`, workspaceId: id, authorId: `${id}-human`, text: "新版的入口，能不能只保留聊天和任務？模型連接就跟著工作空間走。", time: "09:41" },
    { id: `${id}-m2`, workspaceId: id, authorId: DEMO_ACTOR, text: "@Hara 可以。也讓開發同事一起看，先給我一個方案。", time: "09:42" },
    { id: `${id}-m3`, workspaceId: id, authorId: hara.id, text: "好，我把這一段交給開發同事。你不用切去另一個編程窗口；需要確認時，我們就在這裡說。", time: "09:42", handoff: developer.name },
    { id: `${id}-m4`, workspaceId: id, authorId: developer.id, text: "我會先整理空間與連接的綁定，再處理介面。切到另一個空間，不應改變這項任務的模型或目標目錄。", time: "09:43", evidence: ["Workspace 與模型連接是一對多", "任務固定原空間、連接和執行會話", "批准與結果回到原消息"] },
  ] });
  if (populated) for (const person of people.filter((item) => item.id !== DEMO_ACTOR && !item.main)) conversations.push({ id: `${id}-dm-${person.id}`, workspaceId: id, name: person.name, kind: "dm", memberIds: [DEMO_ACTOR, person.id], draft: "", messages: [{ id: `${id}-greeting-${person.id}`, workspaceId: id, authorId: person.id, text: person.type === "agent" ? "我在這裡。你希望我先看哪一部分？" : "這裡也可以和人類同事直接聊天，沒有 AI 參與時不會喚醒模型。", time: "09:40" }] });
  const connections = [
    { id: `${id}-primary`, workspaceId: id, label: populated ? "共用模型服務" : "我的模型連接", kind: populated ? "managed" : "direct", provider: "相容接口", model: "工作模型", revision: 1, enabled: true, credentialRef: `mock-vault:${id}:primary` },
    { id: `${id}-research`, workspaceId: id, label: "研究用連接", kind: "direct", provider: "相容接口", model: "分析模型", revision: 1, enabled: true, credentialRef: `mock-vault:${id}:research` },
  ];
  return { id, name, plan, schemaVersion: 1, location: populated ? "hosted" : "local", membershipRevision: 1, policyRevision: 1, people, conversations, connections, defaultConnectionId: connections[0].id, tasks: [], approvals: [], page: "chat", selectedConversationId: populated ? `${id}-development` : conversations[0].id };
}

export function createDemoState() {
  return { activeWorkspaceId: "ws-studio", viewerId: DEMO_ACTOR, nextId: 1, menuOpen: false, mobileNavOpen: false, detailsOpen: false, modal: null, toast: "", workspaces: [createWorkspace("ws-studio", "Nanhara", "Pro", true), createWorkspace("ws-mine", "我的空間", "Basic"), createWorkspace("ws-lab", "研究室", "Basic")] };
}

export function workspaceById(state, workspaceId) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace || !workspace.people.some((person) => person.id === state.viewerId && person.type === "human")) throw new Error("無權訪問這個工作空間。");
  return workspace;
}

export function resourceIn(workspace, collection, id) {
  const item = workspace[collection].find((candidate) => candidate.id === id && candidate.workspaceId === workspace.id);
  if (!item) throw new Error("目標不屬於這個工作空間。");
  return item;
}

function ownerRequired(state, workspace) {
  const actor = workspace.people.find((person) => person.id === state.viewerId && person.type === "human");
  if (actor?.role !== "owner") throw new Error("這項設定需要本空間管理員批准，版本高低不會授予權限。");
}

export function canReadConversation(state, workspace, conversation) {
  return conversation.workspaceId === workspace.id && conversation.memberIds.includes(state.viewerId);
}

export function connectionForRun(state, workspaceId, connectionId) {
  const workspace = workspaceById(state, workspaceId);
  const connection = resourceIn(workspace, "connections", connectionId);
  if (!connection.enabled) throw new Error("這個連接已撤銷；不會借用其他空間的連接。");
  return connection;
}

export function visibleModel(state) {
  const workspace = workspaceById(state, state.activeWorkspaceId);
  const conversations = workspace.conversations.filter((item) => canReadConversation(state, workspace, item)).map((item) => ({ ...item, messages: item.messages.filter((message) => message.workspaceId === workspace.id) }));
  const selected = conversations.find((item) => item.id === workspace.selectedConversationId) ?? conversations[0];
  const visibleIds = new Set(conversations.map((item) => item.id));
  return {
    workspace: { ...workspace, conversations, connections: workspace.connections.map(({ credentialRef, ...connection }) => connection), tasks: workspace.tasks.filter((task) => task.workspaceId === workspace.id && visibleIds.has(task.conversationId)), approvals: workspace.approvals.filter((approval) => approval.workspaceId === workspace.id && visibleIds.has(approval.conversationId)) },
    selected,
    workspaces: state.workspaces.filter((item) => item.people.some((person) => person.id === state.viewerId && person.type === "human")).map(({ id, name, plan }) => ({ id, name, plan })),
  };
}

function cleanLabel(value, limit = 60) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit || /[\u0000-\u001f]/.test(value)) throw new Error("請填寫有效名稱。");
  return value.trim();
}

export function reduceDesign(state, action, { now = Date.now() } = {}) {
  const next = structuredClone(state);
  next.toast = "";
  const unique = (workspaceId) => `${workspaceId}-item-${next.nextId++}`;
  if (action.type === "switch-workspace") {
    workspaceById(next, action.workspaceId);
    next.activeWorkspaceId = action.workspaceId;
    next.menuOpen = false;
    next.mobileNavOpen = false;
    next.modal = null;
    next.detailsOpen = false;
    return next;
  }
  if (action.type === "toggle-menu") { next.menuOpen = !next.menuOpen; return next; }
  if (action.type === "toggle-navigation") { next.mobileNavOpen = !next.mobileNavOpen; return next; }
  if (action.type === "toggle-details") { next.detailsOpen = !next.detailsOpen; return next; }
  if (action.type === "close-modal") { next.modal = null; return next; }
  if (action.type === "create-workspace") {
    const name = cleanLabel(action.name, 40);
    const id = `ws-created-${next.nextId++}`;
    const workspace = createWorkspace(id, name, "Basic");
    workspace.connections = [];
    workspace.defaultConnectionId = null;
    workspace.conversations[0].messages[0].text = "這是一個獨立的新空間。先在空間設定加入自己的模型連接，再開始協作；不會沿用其他空間的 Key。";
    next.workspaces.push(workspace);
    next.activeWorkspaceId = id;
    next.modal = null;
    next.menuOpen = false;
    return next;
  }
  const workspace = workspaceById(next, action.workspaceId);
  if (workspace.id !== next.activeWorkspaceId) throw new Error("畫面已切換；請返回操作原本的工作空間。");
  const selected = resourceIn(workspace, "conversations", workspace.selectedConversationId);
  if (!canReadConversation(next, workspace, selected)) throw new Error("無權訪問這段對話。");
  let assistantId = selected.kind === "dm" ? selected.memberIds.find((id) => workspace.people.some((person) => person.id === id && person.type === "agent")) : `${workspace.id}-hara`;
  const say = (text, extra = {}) => selected.messages.push({ id: unique(workspace.id), workspaceId: workspace.id, authorId: assistantId, text, time: "剛剛", ...extra });
  switch (action.type) {
    case "navigate":
      if (!["chat", "tasks", "settings"].includes(action.page)) throw new Error("未知頁面。");
      workspace.page = action.page;
      break;
    case "open-modal":
      if (!["workspace", "channel", "connection"].includes(action.modal)) throw new Error("未知操作。");
      if (action.modal !== "workspace") ownerRequired(next, workspace);
      next.menuOpen = false;
      next.modal = { type: action.modal, workspaceId: workspace.id };
      break;
    case "select-conversation": {
      const conversation = resourceIn(workspace, "conversations", action.conversationId);
      if (!canReadConversation(next, workspace, conversation)) throw new Error("無權訪問這段對話。");
      workspace.selectedConversationId = conversation.id;
      workspace.page = "chat";
      next.mobileNavOpen = false;
      break;
    }
    case "draft":
      selected.draft = String(action.text).slice(0, 2000);
      break;
    case "send": {
      const text = cleanLabel(action.text, 2000);
      selected.messages.push({ id: unique(workspace.id), workspaceId: workspace.id, authorId: next.viewerId, text, time: "剛剛" });
      selected.draft = "";
      if (selected.kind === "channel") {
        const mentions = workspace.people.filter((person) => person.type === "agent" && selected.memberIds.includes(person.id) && text.includes(`@${person.name}`));
        if (!mentions.length) break;
        if (mentions.length > 1) { say("這次希望由哪位同事負責？我先不重複派單。"); break; }
        assistantId = mentions[0].id;
      }
      if (!assistantId) break;
      if (!workspace.defaultConnectionId) { say("這個空間還沒有模型連接。請先到空間設定新增連接；我不會借用其他空間的 Key。"); break; }
      const createAgent = /(?:建立|新建|建一|创建|新增).*(?:同事|agent|bot)/i.test(text);
      if (createAgent && assistantId !== `${workspace.id}-hara`) throw new Error("建立同事請交由本空間的主 Hara 協調，再由你確認。");
      if (createAgent && workspace.people.some((person) => person.type === "agent" && person.name === "開發同事")) { say("這個空間已經有一位開發同事，可以直接找他聊。我不會重複建立另一個身份。"); break; }
      if (!createAgent && !/(?:任務|任务|代碼|代码|開發|开发|安排|修復|修复|修改|檢查|检查)/.test(text)) { say("收到，我在。你可以先說想法，不需要每一句話都變成任務。"); break; }
      const connection = connectionForRun(next, workspace.id, workspace.defaultConnectionId);
      const approval = { id: unique(workspace.id), workspaceId: workspace.id, conversationId: selected.id, agentId: assistantId, kind: createAgent ? "agent-create" : "task-start", state: "pending", membershipRevision: workspace.membershipRevision, policyRevision: workspace.policyRevision, expiresAt: now + 5 * 60_000, connectionId: connection.id, connectionRevision: connection.revision, title: createAgent ? "開發同事" : text.slice(0, 80), executor: "OpenCode" };
      workspace.approvals.push(approval);
      say(createAgent ? "可以，我先準備一位開發同事。名字、職責與邊界給你確認；建立不會附帶電腦或密鑰權限。" : "好，我先把它整理成一項任務。這次使用哪個空間、模型與執行能力，都在下面；你確認後我再安排。", { approvalId: approval.id });
      break;
    }
    case "answer": {
      const approval = resourceIn(workspace, "approvals", action.approvalId);
      if (approval.state !== "pending") throw new Error("這張卡片已處理，不會重複建立或執行。");
      if (approval.conversationId !== selected.id || approval.expiresAt <= now || approval.membershipRevision !== workspace.membershipRevision || approval.policyRevision !== workspace.policyRevision) throw new Error("這張確認卡已失效，請重新確認。");
      ownerRequired(next, workspace);
      if (action.decision === "deny") { approval.state = "denied"; say("好，這次不執行，原有資料和設定不變。"); break; }
      if (action.decision !== "allow") throw new Error("請明確批准或取消。");
      if (approval.kind === "agent-create") {
        const colleague = { id: unique(workspace.id), workspaceId: workspace.id, name: approval.title, title: "開發與驗證", type: "agent", bindings: [] };
        workspace.people.push(colleague);
        workspace.conversations.push({ id: unique(workspace.id), workspaceId: workspace.id, name: colleague.name, kind: "dm", memberIds: [next.viewerId, colleague.id], draft: "", messages: [] });
        say("開發同事已加入這個演示空間。你可以直接找他聊天；執行權限仍需另行確認。");
      } else {
        const connection = connectionForRun(next, workspace.id, approval.connectionId);
        if (connection.revision !== approval.connectionRevision) throw new Error("連接授權已變更，請重新確認。");
        const executor = action.executor ?? approval.executor;
        if (!EXECUTORS.includes(executor)) throw new Error("未知執行引擎，不會自動替換。");
        resourceIn(workspace, "people", approval.agentId);
        const task = { id: unique(workspace.id), workspaceId: workspace.id, conversationId: selected.id, title: approval.title, state: "simulated", assignedAgentId: approval.agentId, run: { workspaceId: workspace.id, connectionId: connection.id, connectionRevision: connection.revision, model: connection.model, executor, state: "simulated" } };
        workspace.tasks.push(task);
        say("任務已建立，進入演示執行。你可以繼續聊天；切換工作空間不會改變它的原綁定。", { taskId: task.id });
      }
      approval.state = "allowed";
      break;
    }
    case "set-default":
      ownerRequired(next, workspace);
      connectionForRun(next, workspace.id, action.connectionId);
      workspace.defaultConnectionId = action.connectionId;
      next.toast = "已改為本空間的新任務預設；既有任務和確認卡仍維持原綁定。";
      break;
    case "add-connection": {
      ownerRequired(next, workspace);
      if (Object.keys(action).some((key) => !["type", "workspaceId", "label", "kind"].includes(key))) throw new Error("演示原型不接收 API Key 或其他憑據。");
      if (!["direct", "managed"].includes(action.kind)) throw new Error("未知連接方式。");
      const id = unique(workspace.id);
      workspace.connections.push({ id, workspaceId: workspace.id, label: cleanLabel(action.label), kind: action.kind, provider: "相容接口", model: "演示模型", enabled: true, revision: 1, credentialRef: `mock-vault:${workspace.id}:${id}` });
      if (workspace.defaultConnectionId === null) workspace.defaultConnectionId = id;
      next.modal = null;
      next.toast = "已建立演示連接，沒有保存或使用任何真實 Key。";
      break;
    }
    case "revoke-connection": {
      ownerRequired(next, workspace);
      const connection = resourceIn(workspace, "connections", action.connectionId);
      connection.enabled = false;
      connection.revision++;
      for (const task of workspace.tasks) if (task.run.connectionId === connection.id && task.state === "simulated") { task.state = "blocked"; task.run.state = "blocked"; }
      next.toast = "連接已撤銷，相關演示執行已停止；沒有自動借用其他連接。";
      break;
    }
    case "create-channel": {
      ownerRequired(next, workspace);
      const conversation = { id: unique(workspace.id), workspaceId: workspace.id, name: cleanLabel(action.name, 40), kind: "channel", private: action.private === true, memberIds: action.private === true ? [next.viewerId, `${workspace.id}-hara`] : workspace.people.map((person) => person.id), messages: [], draft: "" };
      workspace.conversations.push(conversation);
      workspace.selectedConversationId = conversation.id;
      workspace.page = "chat";
      next.modal = null;
      break;
    }
    case "submit-result": {
      const task = resourceIn(workspace, "tasks", action.taskId);
      if (task.state !== "simulated") throw new Error("只有演示執行中的任務可以提交結果。");
      task.state = "review";
      task.run.state = "finished";
      const conversation = resourceIn(workspace, "conversations", task.conversationId);
      conversation.messages.push({ id: unique(workspace.id), workspaceId: workspace.id, authorId: task.assignedAgentId, text: "這份演示結果已提交，現在等你驗收。引擎結束不代表任務已經核銷。", time: "剛剛", taskId: task.id });
      break;
    }
    case "accept-result": {
      ownerRequired(next, workspace);
      const task = resourceIn(workspace, "tasks", action.taskId);
      if (task.state !== "review") throw new Error("任務必須先提交結果，再獨立驗收。");
      task.state = "done";
      const conversation = resourceIn(workspace, "conversations", task.conversationId);
      conversation.messages.push({ id: unique(workspace.id), workspaceId: workspace.id, authorId: task.assignedAgentId, text: "收到，你已驗收這項演示任務。結果和過程保留在原對話，需要時可以再查看。", time: "剛剛", taskId: task.id });
      break;
    }
    default: throw new Error("未知操作。");
  }
  return next;
}
