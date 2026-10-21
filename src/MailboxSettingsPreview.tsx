import { useMemo } from "react";
import type { HaraClient, DeskSnapshot, BusTask } from "./client";
import type { LegacyLocale as Locale } from "./i18n";
import { MailboxSettings } from "./MailboxSettings";
import { SettingsPage } from "./SettingsUI";

/** Development-only visual fixture. It never opens a provider, reads mail or contacts Desk. */
export function MailboxSettingsPreview({ locale, scenario }: { locale: Locale; scenario?: string | null }) {
  const client = useMemo(() => {
    const me = { id: "a_main", name: "Hara 主 Bot", owner: "owner@example.test", client: "hara", role: "owner" as const, revoked: false, createdAt: 0, lastSeen: 0 };
    const snapshot: DeskSnapshot = { profileId: "demo", fetchedAt: 0, me, agents: [me, { ...me, id: "a_codex", name: "Codex", client: "openai.codex", role: "member" }, { ...me, id: "a_grok", name: "Elon", client: "grokbot", role: "member" }], tasks: [], events: [], circles: [], truncated: false };
    const ticket: BusTask = { id: `t_${"a".repeat(32)}`, projectId: "hara", kind: "feedback", title: "锁屏后任务通道断开，需要可恢复的收件通道", body: "[Untrusted mail]\n共享邮箱收到报告，请主 Bot 判断项目与执行者。", workType: "bug", state: "open", risk: "low", revision: 1, targetAgentId: "a_main", reviewerId: "a_main", parentId: null, claimFence: 0, claimExpiresAt: null };
    const tasks = [ticket, { ...ticket, id: `t_${"b".repeat(32)}`, kind: "dispatch", title: "验证邮箱重启补取与幂等收件", parentId: ticket.id, targetAgentId: "a_codex", state: "review", revision: 3 }];
    return {
      supports: () => scenario !== "old-engine",
      mailRuntimeStatus: async () => scenario === "missing-mail-runtime" ? { ready: false, reason: "helper-missing" } : { ready: true, reason: "ready" },
      deskSnapshot: async () => snapshot,
      mailConnections: async () => ({ connections: scenario === "empty" ? [] : [{ id: "mail-demo", provider: "feishu", mailbox: "agent@example.test", projectId: "hara", mainBotId: "a_main", ownerMemberId: "u_owner", ownership: "personal", transport: "imap-smtp", allowReplies: true, local: true, checks: { list: "verified", body: "verified", sending: "smtp-auth-verified" }, revision: 1, paused: false, receiverRunning: true, phase: "connected", pendingCount: 0, lastSyncAt: Date.now() - 12000 }] }),
      taskbusRequest: async (_profile: string, _space: string, operation: string, input: Record<string, unknown>) => {
        if (operation === "projects.list") return { projects: [{ id: "hara", name: "Hara", revision: 1, grants: { a_main: ["intake", "dispatch", "review"], a_codex: ["execute"], a_grok: ["dispatch", "review"] } }] };
        if (operation === "directory") return snapshot;
        if (operation === "identity") return { memberId: "u_owner", agentId: "a_main", admin: true, session: false, agentIds: ["a_main", "a_codex"] };
        if (operation === "members.list") return { members: [{ id: "u_owner", name: "Jeff", role: "owner", state: "active", revision: 1, agentIds: ["a_main", "a_codex"] }, { id: "u_grok", name: "Grokbot", role: "member", state: "active", revision: 1, agentIds: ["a_grok"] }] };
        if (operation === "outbox.list") return { messages: [{ id: `bm_${"d".repeat(32)}`, bindingId: "mail-demo", taskId: input.taskId, state: "draft", revision: 1, contentHash: "e".repeat(64), body: { from: "agent@example.test", to: ["grok@example.test"], subject: "任务进度通知", body: "邮箱补取与幂等验证已完成，请在 Desk 查看结果。" }, receipt: {} }] };
        if (operation === "tasks.list") return { tasks: scenario === "empty" ? [] : tasks };
        if (operation === "tasks.get") return { task: tasks.find(t => t.id === input.taskId), results: [{ actor: "a_codex", result_hash: "c".repeat(64), body: { summary: "队列恢复验证完成", evidence: "隔离测试通过；同一请求只产生一个工单。" } }], events: [{ id: 1, actor: "a_codex", action: "bus_result", detail: "Evidence submitted" }] };
        throw new Error("Visual preview: no changes are sent to Desk.");
      },
      mailCommand: async () => { throw new Error("Visual preview: no mailbox authorization or changes are performed."); },
    } as unknown as HaraClient;
  }, [scenario]);
  return <div className="app"><main className="chat board"><div className="scroll boardpad setstage" style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
    <SettingsPage id="mailbox-preview" eyebrow={locale === "zh" ? "设置 / 连接" : "Settings / Connections"} title={locale === "zh" ? "邮箱与任务" : "Mailboxes & tasks"} description={locale === "zh" ? "绑定自己的邮箱，选择主 Bot 分发任务，交付与验收同步到 Desk。" : "Connect your mailbox, choose a main Bot, and sync task delivery and review with Desk."}>
      <MailboxSettings client={client} locale={locale} space={{ id: "org-demo", profileId: "demo", name: "Nanhara · Preview", kind: "organization", active: true, authoritative: true, agentProfilePermission: "edit" }} />
    </SettingsPage>
  </div></main></div>;
}
