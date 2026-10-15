// Synthetic, isolated visual acceptance only. No Account, Core, network, model, or external send.
import { createRoot } from "react-dom/client";
import WorkspaceCollaboration from "../../src/WorkspaceCollaboration";
import type { WorkspaceCollaborationTransport } from "../../src/workspace-collaboration-state";
import "../../src/App.css";
const A = "ws_11111111-1111-4111-8111-111111111111";
const B = "ws_22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const acceptance = { sends: [] as unknown[], mentionOutcome: "success" as "success" | "unknown" | "target-unavailable" };
(window as typeof window & { __workspaceAcceptance: typeof acceptance }).__workspaceAcceptance = acceptance;
const client: WorkspaceCollaborationTransport = {
  supportsCollaborationMentions() { return true; },
  async sendCollaborationMentionedMessage(input) {
    acceptance.sends.push(structuredClone(input));
    if (acceptance.mentionOutcome !== "success") return { ok: false, error: { code: acceptance.mentionOutcome === "unknown" ? "OUTCOME_UNKNOWN" : "MENTION_TARGET_UNAVAILABLE" } };
    return { ok: true, value: { workspaceId: input.workspaceId, channelId: input.channelId, messageId: "synthetic-sent-" + acceptance.sends.length,
      senderPrincipalId: "synthetic-me", createdAt: "2026-10-16T02:02:00Z", sequence: String(103 + acceptance.sends.length), mentions: input.mentions } };
  },
  supportsCollaborationMembers() { return true; },
  async listCollaborationMembers(input) {
    return { ok: true, value: { workspaceId: input.workspaceId, members: input.cursor
      ? [{ principalId: "synthetic-later", kind: "human", displayName: "另一位合成成員", role: "MEMBER" }]
      : [{ principalId: "synthetic-me", kind: "human", displayName: "合成使用者", role: input.workspaceId === A ? "OWNER" : "MEMBER" },
        { principalId: "synthetic-teammate", kind: "human", displayName: input.workspaceId === A ? "合成同事 A" : "合成同事 B", role: "MEMBER" },
        { principalId: "synthetic-manager", kind: "human", displayName: "合成管理員", role: "ADMIN" }],
      nextCursor: input.cursor ? null : "synthetic-members-page-2" } };
  },
  supportsCollaborationHistory() { return true; },
  async readCollaborationHistory(input) {
    const high = input.before ? Number(input.before) - 1 : 100, low = Math.max(1, high - 49);
    return { ok: true, value: { workspaceId: input.workspaceId, channelId: input.channelId, nextBefore: low > 1 ? String(low) : null,
      messages: Array.from({ length: high - low + 1 }, (_, offset) => ({ id: "synthetic-history-" + (low + offset),
        sequence: String(low + offset), channelId: input.channelId, senderPrincipalId: offset % 3 ? "synthetic-teammate" : "synthetic-me",
        body: "合成驗收訊息 " + (low + offset) + "：歷史與即時訊息使用同一個聊天時間線。", createdAt: "2026-10-15T02:00:00Z" })) } };
  },
  async listCollaborationWorkspaces() { return { ok: true, value: { schemaVersion: 1, accountScope: "synthetic", accountRegion: "CN", nextCursor: null,
    workspaces: [A, B].map(workspaceId => ({ workspaceId, membership: { role: workspaceId === A ? "OWNER" : "MEMBER", membershipVersion: 1, policyVersion: 1 } })) } }; },
  async bootstrapCollaborationWorkspace(workspaceId) { return { ok: true, value: { workspaceId, displayName: workspaceId === A ? "Nanhara · 合成驗收 A" : "合成驗收 B",
    cursor: "initial", membership: { principalId: "synthetic-me", role: workspaceId === A ? "OWNER" : "MEMBER", epoch: 1 },
    channels: [{ id: C, slug: "development", displayName: "產品研發" }, { id: "other", slug: "general", displayName: "一般討論" }] } }; },
  async syncCollaborationWorkspace(workspaceId, cursor) { return { ok: true, value: { workspaceId, cursor: "received", hasMore: false, events: cursor !== "initial" ? [] : [
    { id: "event-1", type: "message.created", message: { id: "message-1", sequence: "101", channelId: C, senderPrincipalId: "synthetic-teammate", body: "這是隔離的畫面驗收資料，不是真實群聊。\n切換工作空間時，舊訊息不應留在畫面上。", createdAt: "2026-10-15T02:00:00Z" } },
    { id: "event-2", type: "message.created", message: { id: "message-2", sequence: "102", channelId: C, senderPrincipalId: "synthetic-me", body: "收到。先把頻道協作驗證好，再接上 Agent 執行。", createdAt: "2026-10-15T02:01:00Z" } },
  ] } }; },
  async sendCollaborationMessage(input) { acceptance.sends.push(structuredClone(input)); return { ok: false, error: { code: "OUTCOME_UNKNOWN" } }; },
  async createCollaborationChannel() { return { ok: false, error: { code: "OUTCOME_UNKNOWN" } }; },
};
createRoot(document.getElementById("root")!).render(<WorkspaceCollaboration client={client} locale="zh"
  onClose={() => { document.title = "Synthetic local return selected"; }}
  onSignIn={() => { document.title = "Synthetic authorization selected"; }} />);
