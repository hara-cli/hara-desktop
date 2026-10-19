// Presentation only. Core remains the authority for task state and every approval decision.
import type { WorkspaceDevApproval, WorkspaceDevMessage, WorkspaceDevSnapshot } from "./workspace-dev-state.ts";

export type TaskGroup = "needsYou" | "working" | "waiting" | "closed";
export type TaskStatus = "pending" | "reply" | "review" | "blocked" | "accepted" | "running" | "dispatched" | "queued" | "completed" | "cancelled" | "rejected" | "expired" | "paused" | "unknown";
export interface ShellTask { id: string; agentId: string; title: string; status: TaskStatus; group: TaskGroup }
export interface AwaitItem { id: string; agentId: string; kind: "approval" | "reply" | "review" | "blocked"; title: string; highPriority: boolean; approval?: WorkspaceDevApproval }
export type TimelineItem = { kind: "message"; message: WorkspaceDevMessage; index: number } | { kind: "approval"; approval: WorkspaceDevApproval };
const closed = new Set(["completed", "cancelled", "canceled", "withdrawn", "rejected", "expired"]);
export function isClosedTask(state: string | null | undefined): boolean { return closed.has(state ?? ""); }
export function taskStatus(state: string | null | undefined): TaskStatus {
  switch (state) {
    case "awaiting_approval": case "pending_approval": return "pending";
    case "waiting_user": case "waiting_reply": case "needs_input": case "awaiting_reply": return "reply";
    case "awaiting_review": case "pending_review": case "review": return "review";
    case "blocked": case "needs_recovery": case "interrupted": return "blocked";
    case "accepted": return "accepted";
    case "running": case "draining": return "running";
    case "dispatched": case "offline_queued": return "dispatched";
    case "pending": case "queued": return "queued";
    case "completed": return "completed";
    case "cancelled": case "canceled": case "withdrawn": return "cancelled";
    case "rejected": return "rejected";
    case "expired": return "expired";
    case "paused": return "paused";
    default: return "unknown";
  }
}
export function taskGroup(status: TaskStatus): TaskGroup {
  if (["pending", "reply", "review", "blocked"].includes(status)) return "needsYou";
  if (["completed", "cancelled", "rejected", "expired"].includes(status)) return "closed";
  if (["accepted", "running"].includes(status)) return "working";
  return "waiting";
}
export function pendingApprovals(snapshot: WorkspaceDevSnapshot, now: number): WorkspaceDevApproval[] {
  if (isClosedTask(snapshot.conversation.taskState)) return [];
  return snapshot.approvals.filter(card => card.workspaceId === snapshot.workspaceId && card.resourceGeneration === snapshot.resourceGeneration
    && card.agentId === snapshot.selectedAgentId && (!card.status || card.status === "pending") && Date.parse(card.expiresAt) > now);
}
export function highPriorityApproval(card: WorkspaceDevApproval, now: number): boolean {
  return card.risk === "high" || card.paid === true || card.externalSend === true || card.destructive === true
    || Date.parse(card.expiresAt) - now < 30 * 60 * 1000;
}
export function conversationTimeline(snapshots: readonly WorkspaceDevSnapshot[], agentId: string, now: number): TimelineItem[] {
  const snapshot = snapshots.find(row => row.selectedAgentId === agentId);
  if (!snapshot) return [];
  return [...snapshot.conversation.history.map((message, index): TimelineItem => ({ kind: "message", message, index })),
    ...pendingApprovals(snapshot, now).map((approval): TimelineItem => ({ kind: "approval", approval }))];
}
export function buildWorkspaceShell(snapshots: readonly WorkspaceDevSnapshot[], now = Date.now()) {
  const tasks: ShellTask[] = [], waiting: AwaitItem[] = [], seen = new Set<string>();
  for (const snapshot of snapshots) {
    const approvals = pendingApprovals(snapshot, now), conversation = snapshot.conversation;
    let status = taskStatus(conversation.taskState ?? conversation.state);
    if (approvals.length) status = "pending";
    if (conversation.taskId) tasks.push({ id: conversation.taskId, agentId: snapshot.selectedAgentId, title: conversation.objective, status, group: taskGroup(status) });
    for (const approval of approvals) {
      if (seen.has(approval.id)) continue; seen.add(approval.id);
      waiting.push({ id: approval.id, agentId: approval.agentId, kind: "approval", title: approval.draft.displayName,
        highPriority: highPriorityApproval(approval, now), approval });
    }
    if (!approvals.length && conversation.taskId && ["reply", "review", "blocked"].includes(status)) {
      waiting.push({ id: conversation.taskId, agentId: snapshot.selectedAgentId, kind: status as "reply" | "review" | "blocked", title: conversation.objective, highPriority: false });
    }
  }
  waiting.sort((a, b) => Number(b.highPriority) - Number(a.highPriority)
    || (Date.parse(a.approval?.expiresAt ?? "") || Infinity) - (Date.parse(b.approval?.expiresAt ?? "") || Infinity)
    || a.id.localeCompare(b.id));
  const count = waiting.length;
  return { tasks, waiting, navBadge: count, tasksTabBadge: count,
    homeAwaitBar: { count, items: waiting.slice(0, Math.max(3, waiting.filter(item => item.highPriority).length)) } };
}
export function messageContinues(previous: WorkspaceDevMessage | undefined, current: WorkspaceDevMessage): boolean {
  if (!previous || previous.role === "tool" || previous.role !== current.role) return false;
  // Older Core snapshots omit timestamps. Do not guess a five-minute interval from array adjacency.
  const before = Date.parse(previous.createdAt ?? ""), after = Date.parse(current.createdAt ?? "");
  return Number.isFinite(before) && Number.isFinite(after) && after >= before && after - before <= 5 * 60 * 1000;
}
export type SidebarSectionId = "colleagues" | "channels" | "dms";
export type SidebarSections = Record<SidebarSectionId, boolean>;
export const DEFAULT_SECTIONS: SidebarSections = { colleagues: true, channels: true, dms: true };
export function loadSidebarSections(workspaceId: string, read: (key: string) => string | null): SidebarSections {
  try { const value = JSON.parse(read(`hara.sidebar.sections.${workspaceId}`) ?? "null");
    return Object.fromEntries(Object.entries(DEFAULT_SECTIONS).map(([key, fallback]) => [key, typeof value?.[key] === "boolean" ? value[key] : fallback])) as SidebarSections;
  } catch { return { ...DEFAULT_SECTIONS }; }
}
export function normalizeShellRoute(hash: string): { section: "chat" | "colleagues"; tab: "people" | "tasks" } {
  const route = hash.replace(/^#\/?/, "");
  return route === "tasks" || route === "colleagues/tasks" ? { section: "colleagues", tab: "tasks" }
    : { section: route === "colleagues" ? "colleagues" : "chat", tab: "people" };
}
