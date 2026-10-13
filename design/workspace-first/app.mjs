import { createDemoState, reduceDesign } from "./state.mjs";
import { renderLayout } from "./view.mjs";

let state = createDemoState();
const root = document.getElementById("workspace-prototype");
let restoreFocus = null;
let toastTimer;

function paint({ bottom = false, modalFocus = false } = {}) {
  const previousScroll = document.getElementById("chat-scroll")?.scrollTop ?? 0;
  root.innerHTML = renderLayout(state);
  const scroll = document.getElementById("chat-scroll");
  if (scroll) scroll.scrollTop = bottom ? scroll.scrollHeight : previousScroll;
  if (modalFocus) document.getElementById("new-name")?.focus();
  if (state.toast) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = ""; paint(); }, 6000);
  }
}

function dispatch(action, options) {
  try {
    state = reduceDesign(state, action);
    paint(options);
    return true;
  } catch (error) {
    state = { ...state, toast: error instanceof Error ? error.message : "這項操作無法完成。" };
    paint({ modalFocus: state.modal !== null });
    return false;
  }
}

root.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const data = button.dataset;
  const action = { type: data.action, workspaceId: data.workspaceId };
  for (const field of ["conversationId", "approvalId", "connectionId", "taskId", "page", "decision", "modal"]) if (data[field]) action[field] = data[field];
  if (data.action === "quick-send") {
    const workspaceId = state.activeWorkspaceId;
    if (!dispatch({ type: "select-conversation", workspaceId, conversationId: `${workspaceId}-main` })) return;
    dispatch({ type: "send", workspaceId, text: data.text }, { bottom: true });
    return;
  }
  if (data.action === "answer") {
    const selector = [...root.querySelectorAll("select[data-approval-id]")].find((item) => item.dataset.approvalId === data.approvalId);
    if (selector) action.executor = selector.value;
  }
  if (data.action === "open-modal") restoreFocus = data.modal;
  dispatch(action, { bottom: data.action === "answer" || data.action === "select-conversation", modalFocus: data.action === "open-modal" });
  if (data.action === "close-modal") focusAfterModal();
});

function focusAfterModal() {
  const trigger = [...root.querySelectorAll("button[data-modal]")].find((button) => button.dataset.modal === restoreFocus);
  (trigger ?? root.querySelector(".workspace-trigger"))?.focus();
}

root.addEventListener("input", (event) => {
  if (event.target.id !== "message-input") return;
  try { state = reduceDesign(state, { type: "draft", workspaceId: event.target.form.dataset.workspaceId, text: event.target.value }); } catch { /* A detached old field cannot change the selected Workspace. */ }
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const workspaceId = form.dataset.workspaceId;
  const kind = form.dataset.form;
  const action = kind === "message" ? { type: "send", workspaceId, text: data.get("message") }
    : kind === "workspace" ? { type: "create-workspace", name: data.get("name") }
    : kind === "channel" ? { type: "create-channel", workspaceId, name: data.get("name"), private: data.get("private") === "on" }
    : { type: "add-connection", workspaceId, label: data.get("name"), kind: data.get("kind") };
  if (dispatch(action, { bottom: true }) && kind === "message") document.getElementById("message-input")?.focus();
  else if (kind !== "message") focusAfterModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.modal) { dispatch({ type: "close-modal" }); focusAfterModal(); }
    else if (state.menuOpen) { dispatch({ type: "toggle-menu" }); root.querySelector(".workspace-trigger")?.focus(); }
    else if (state.detailsOpen) dispatch({ type: "toggle-details" });
    else if (state.mobileNavOpen) dispatch({ type: "toggle-navigation" });
  }
  if (event.target.id === "message-input" && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
  const dialog = root.querySelector('[role="dialog"]');
  if (event.key === "Tab" && dialog) {
    const elements = [...dialog.querySelectorAll("button:not([disabled]),input,select,textarea")];
    const first = elements[0];
    const last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

paint({ bottom: true });
