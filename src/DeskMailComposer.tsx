import { useCallback, useEffect, useRef, useState } from "react";
import type { HaraClient, BusTask, BusMailOutgoing, MailConnectionState } from "./client";
import { MailboxRequestKeys } from "./mailbox-state";
import { SettingsBadge, SettingsNotice } from "./SettingsUI";

export function DeskMailComposer({ client, profileId, spaceId, task, connections, disabled, zh }: {
  client: HaraClient; profileId: string; spaceId: string; task: BusTask; connections: MailConnectionState[]; disabled: boolean; zh: boolean;
}) {
  const keys = useRef(new MailboxRequestKeys()), alive = useRef(false);
  const [messages, setMessages] = useState<BusMailOutgoing[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [bindingId, setBindingId] = useState(""), [to, setTo] = useState(""), [subject, setSubject] = useState(`Re: ${task.title}`), [body, setBody] = useState("");
  const [evidence, setEvidence] = useState("");
  const l = (cn: string, en: string) => zh ? cn : en;
  const load = useCallback(async () => {
    const result = await client.taskbusRequest<{ messages: BusMailOutgoing[] }>(profileId, spaceId, "outbox.list", { taskId: task.id });
    if (alive.current) setMessages(result.messages);
  }, [client, profileId, spaceId, task.id]);
  useEffect(() => {
    alive.current = true;
    void load().catch(e => { if (alive.current) setError(e.message); });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 5000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  const send = async (operation: string, input: Record<string, unknown>) => {
    if (disabled || busy) return;
    setBusy(true); setError("");
    try {
      await client.taskbusRequest(profileId, spaceId, operation, { ...input, requestKey: keys.current.get(operation, input) });
      keys.current.complete(operation, input);
      await load();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (alive.current) setBusy(false); }
  };
  const senders = connections.filter(c => c.projectId === task.projectId && c.allowReplies && c.transport === "imap-smtp" && !c.paused);
  return <section className="mailbox-outbox">
    <h4>{l("邮件往来与通知", "Email & notifications")}</h4>
    {error && <SettingsNotice tone="error" title={l("发信需要处理", "Mail needs attention")}>{error}</SettingsNotice>}
    {senders.length > 0 && <form className="mailbox-task-form" onSubmit={e => { e.preventDefault(); void send("outbox.draft", { bindingId: bindingId || senders[0].id, taskId: task.id, to: to.split(",").map(x => x.trim()).filter(Boolean), subject, body }); }}>
      <label>{l("发件邮箱", "From")}<select value={bindingId || senders[0].id} onChange={e => setBindingId(e.target.value)} disabled={disabled || busy}>{senders.map(c => <option key={c.id} value={c.id}>{c.mailbox}</option>)}</select></label>
      <label>{l("收件人（多个用逗号分隔）", "To (comma-separated)")}<input type="email" multiple required value={to} onChange={e => setTo(e.target.value)} disabled={disabled || busy} /></label>
      <label>{l("主题", "Subject")}<input required maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} disabled={disabled || busy} /></label>
      <label>{l("正文", "Body")}<textarea required rows={4} maxLength={20000} value={body} onChange={e => setBody(e.target.value)} disabled={disabled || busy} /></label>
      <button type="submit" disabled={disabled || busy}>{l("生成草稿，下一步确认", "Create draft for review")}</button>
    </form>}
    {messages.map(m => <article className="mailbox-mail-preview" key={m.id}>
      <strong>{m.body.subject}</strong> <SettingsBadge>{({ draft: l("待确认", "Draft"), queued: l("待发送", "Queued"), sending: l("发送中", "Sending"), sent: l("服务器已接受", "SMTP accepted"), unknown: l("结果待核实", "Outcome unknown"), cancelled: l("已撤销", "Cancelled"), failed: l("已核实失败", "Verified failure") })[m.state] || m.state}</SettingsBadge>
      <p>{l("发件人", "From")}: {m.body.from}<br />{l("收件人", "To")}: {m.body.to.join(", ")}</p><pre>{m.body.body}</pre>
      <small className="mailbox-hash">SHA256 {m.contentHash}</small>
      <div className="mailbox-actions">{m.state === "draft" && <button disabled={disabled || busy} onClick={() => void send("outbox.confirm", { messageId: m.id, expectedRevision: m.revision, contentHash: m.contentHash })}>{l("确认以上内容并发送", "Confirm this message & send")}</button>}
        {["draft", "queued"].includes(m.state) && <button className="compact" disabled={disabled || busy} onClick={() => void send("outbox.cancel", { messageId: m.id, expectedRevision: m.revision })}>{l("撤销", "Cancel")}</button>}
      </div>
      {m.state === "unknown" && <div className="mailbox-task-form"><label>{l("人工核实证据", "Manual verification evidence")}<textarea maxLength={1000} value={evidence} onChange={e => setEvidence(e.target.value)} disabled={disabled || busy} /></label><div className="mailbox-actions">{["sent", "failed"].map(outcome => <button className="compact" key={outcome} disabled={disabled || busy || !evidence.trim()} onClick={() => void send("outbox.resolve", { messageId: m.id, expectedRevision: m.revision, outcome, evidence })}>{outcome === "sent" ? l("已核实发出", "Verified sent") : l("已核实未发出", "Verified not sent")}</button>)}</div></div>}
      {m.receipt.evidence && <p>{m.receipt.evidence}</p>}
    </article>)}
    <p className="mailbox-muted">{l("内部协作直接用 Desk。邮件经确认后由接收主机发送；服务器接受不等于对方已收到。结果未知时不自动重发。", "Use Desk directly for internal work. The receiver sends only confirmed mail. SMTP acceptance does not prove delivery; unknown outcomes are never automatically retried.")}</p>
  </section>;
}
