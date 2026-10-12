import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { HaraClient, SpaceInfo, DeskSnapshot, BusProject, BusTask, BusTaskDetails, BusIdentity, BusMember, MailConnectionsState, MailConnectionState, MailRuntimeStatus } from "./client";
import type { Locale } from "./i18n";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";
import { MailboxScopeGuard, MailboxRequestKeys } from "./mailbox-state";
import { DeskUsersPanel } from "./DeskUsersPanel";
import { DeskMailComposer } from "./DeskMailComposer";
import "./MailboxSettings.css";

const blankServers = { imapHost: "", imapPort: 993, imapSecurity: "tls" as "tls" | "starttls", smtpHost: "", smtpPort: 465, smtpSecurity: "tls" as "tls" | "starttls" };
const feishuServers = { ...blankServers, imapHost: "imap.feishu.cn", smtpHost: "smtp.feishu.cn" };

export function MailboxSettings({ client, space, locale }: { client: HaraClient | null; space?: SpaceInfo; locale: Locale }) {
  const zh = locale === "zh", l = (cn: string, en: string) => zh ? cn : en;
  const guard = useRef(new MailboxScopeGuard()), keys = useRef(new MailboxRequestKeys());
  const current = useRef<() => boolean>(() => false);
  const [meta, setMeta] = useState<DeskSnapshot | null>(null), [projects, setProjects] = useState<BusProject[]>([]);
  const [identity, setIdentity] = useState<BusIdentity | null>(null), [users, setUsers] = useState<BusMember[]>([]);
  const [offline, setOffline] = useState(false);
  const [mail, setMail] = useState<MailConnectionsState>({ connections: [] });
  const [runtime, setRuntime] = useState<MailRuntimeStatus | null>(null);
  const [projectId, setProjectId] = useState(""), [tasks, setTasks] = useState<BusTask[]>([]), [detail, setDetail] = useState<BusTaskDetails | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [mailbox, setMailbox] = useState(""), [password, setPassword] = useState("");
  const [servers, setServers] = useState({ ...blankServers });
  const [ownership, setOwnership] = useState<"personal" | "company">("personal"), [allowReplies, setAllowReplies] = useState(false);
  const [editId, setEditId] = useState(""), [projectName, setProjectName] = useState(""), [grants, setGrants] = useState<Record<string, string[]>>({});
  const [editRevision, setEditRevision] = useState(0);
  const [memberGrants, setMemberGrants] = useState<Record<string, string[]>>({});
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [workType, setWorkType] = useState("research");
  const [target, setTarget] = useState(""), [reviewer, setReviewer] = useState(""), [parentId, setParentId] = useState("");
  const [note, setNote] = useState(""), [releaseVersion, setReleaseVersion] = useState(""), [verification, setVerification] = useState("");
  const supported = !!client?.supports("mail.connections.list") && client.supports("mail.command")
    && client.supports("mail.runtime.status") && client.supports("desk.taskbus.request");
  const profileId = space?.profileId || "", spaceId = space?.id || "";
  const bus = useCallback(<T,>(operation: string, input: Record<string, unknown> = {}) => {
    if (!client || !profileId || !spaceId) throw new Error("Company Space required");
    return client.taskbusRequest<T>(profileId, spaceId, operation, input);
  }, [client, profileId, spaceId]);
  const refresh = useCallback(async () => {
    if (!client || !supported || space?.kind !== "organization") return;
    const valid = current.current;
    const [directory, projectList, connections, who, people, prerequisites] = await Promise.all([
      bus<Pick<DeskSnapshot, "me" | "agents"> & { offline?: boolean }>("directory"), bus<{ projects: BusProject[]; offline?: boolean }>("projects.list"), client.mailConnections(profileId, spaceId),
      bus<BusIdentity>("identity"), bus<{ members: BusMember[]; offline?: boolean }>("members.list"),
      client.mailRuntimeStatus(profileId, spaceId),
    ]);
    if (!valid()) return;
    setMeta({ ...directory, profileId, fetchedAt: Date.now(), tasks: [], events: [], circles: [], truncated: false });
    setProjects(projectList.projects); setMail(connections); setIdentity(who); setUsers(people.members);
    setRuntime(prerequisites);
    setOffline(!!(directory.offline || projectList.offline || connections.offline || who.offline || people.offline));
    setProjectId(old => projectList.projects.some(p => p.id === old) ? old : projectList.projects[0]?.id || "");
  }, [client, supported, space?.kind, profileId, spaceId, bus]);
  useEffect(() => {
    current.current = guard.current.begin();
    setRuntime(null); setBusy(false);
    setMeta(null); setIdentity(null); setUsers([]); setOffline(false); setProjects([]); setMail({ connections: [] }); setServers({ ...blankServers }); setOwnership("personal"); setAllowReplies(false); setTasks([]); setDetail(null);
    setProjectId(""); setParentId(""); setTarget(""); setReviewer(""); setMailbox(""); setTitle(""); setBody("");
    setEditId(""); setEditRevision(0); setProjectName(""); setGrants({}); setMemberGrants({}); setPassword(""); setError(""); setNotice("");
    const valid = current.current;
    void refresh().catch(e => { if (valid()) setError(String(e.message || e)); });
    return () => guard.current.invalidate();
  }, [refresh]);
  const loadTasks = useCallback(async () => {
    if (!projectId) { setTasks([]); return; }
    const valid = current.current, requestedProject = projectId;
    const result = await bus<{ tasks: BusTask[]; offline?: boolean }>("tasks.list", { projectId });
    if (valid() && requestedProject === projectRef.current) { setTasks(result.tasks); if (result.offline) setOffline(true); }
  }, [bus, projectId]);
  const projectRef = useRef(projectId); projectRef.current = projectId;
  useEffect(() => {
    setTasks([]); setDetail(null); setParentId("");
    const valid = current.current;
    void loadTasks().catch(e => { if (valid()) setError(String(e.message || e)); });
  }, [loadTasks]);
  const busyRef = useRef(busy); busyRef.current = busy;
  const detailRef = useRef(detail); detailRef.current = detail;
  useEffect(() => {
    const valid = current.current;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void Promise.all([refresh(), loadTasks(), detailRef.current ? bus<BusTaskDetails>("tasks.get", { taskId: detailRef.current.task.id }).then(next => {
        if (valid() && detailRef.current?.task.id === next.task.id) setDetail(next);
      }) : Promise.resolve()]).catch(e => { if (valid()) setError(e.message); });
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh, loadTasks, bus]);
  const run = async (action: () => Promise<unknown>, success?: string) => {
    if (offline) { setError(l("当前为离线副本，请恢复 Desk 连接后再修改。", "This is an offline copy. Reconnect to Desk before making changes.")); return false; }
    const valid = current.current; setBusy(true); setError(""); setNotice("");
    try { await action(); if (valid()) { if (success) setNotice(success); await refresh(); await loadTasks(); return true; } return false; }
    catch (e: unknown) { if (valid()) setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { if (valid()) setBusy(false); }
  };
  const command = async (operation: string, input: Record<string, unknown>) => {
    const requestKey = keys.current.get(operation, input);
    const result = await client!.mailCommand(profileId, spaceId, operation, { ...input, requestKey });
    keys.current.complete(operation, input); return result;
  };
  const mutate = async <T,>(operation: string, input: Record<string, unknown>) => {
    const result = await bus<T>(operation, { ...input, requestKey: keys.current.get(operation, input) });
    keys.current.complete(operation, input); return result;
  };
  const viewTask = (task: BusTask) => void (async () => {
    const valid = current.current;
    const result = await bus<BusTaskDetails>("tasks.get", { taskId: task.id });
    if (valid() && projectRef.current === task.projectId) { setDetail(result); setNote(""); setVerification(""); setReleaseVersion(""); }
  })().catch(e => { if (current.current()) setError(e.message); });
  const selected = projects.find(p => p.id === projectId), owner = identity?.admin === true;
  const agents = meta?.agents.filter(a => !a.revoked) || [];
  const agentLabel = (id: string) => agents.find(a => a.id === id)?.name || id;
  const actConnection = (c: MailConnectionState, operation: string) => void run(() => command(operation, { id: c.id, expectedRevision: c.revision }));
  const saveProject = (e: FormEvent) => {
    e.preventDefault();
    const id = editId.trim();
    void run(async () => { await mutate("projects.save", { id, name: projectName, grants, memberGrants, expectedRevision: editRevision }); }, l("项目权限已保存", "Project grants saved"));
  };
  const createTask = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await mutate("tasks.create", { projectId, title, body, workType, targetAgentId: target, reviewerId: reviewer, ...(parentId ? { parentId } : {}) });
      if (current.current()) { setTitle(""); setBody(""); setParentId(""); }
    }, l("任务已派发，等待指定 Agent 领取", "Task dispatched; awaiting its designated Agent"));
  };
  if (space?.kind !== "organization") return <SettingsNotice title={l("先选择公司空间", "Select a company Space")}>
    {l("邮箱归用户管理。请先选择要接入的公司与项目，再授权邮箱内容进入该公司的 Desk。", "Your mailbox belongs to you. Select a company and project before authorizing mail intake into its Desk.")}
  </SettingsNotice>;
  if (!supported) return <SettingsNotice tone="warning" title={l("当前引擎需要升级", "Engine update required")}>
    {l("邮箱连接需要新版 Hara Engine 和 Desk taskbus.v1。升级后可在此授权邮箱。", "Mailbox connections require an updated Hara Engine and Desk taskbus.v1.")}
  </SettingsNotice>;
  return <div className="mailbox-settings">
    <SettingsCard title={l("邮箱与主 Bot", "Mailbox & main Bot")} description={`${space.name} · ${l("用户绑定邮箱，主 Bot 协调多个 Agent", "User-owned mailboxes; main-Bot coordination")}`}
      aside={<button type="button" className="compact" disabled={busy} onClick={() => { const valid = current.current; void Promise.all([refresh(), loadTasks()]).catch(e => { if (valid()) setError(e.message); }); }}>{l("刷新状态", "Refresh")}</button>}>
      <SettingsNotice title={l("后台接收，任务留在 Desk", "Receive in the background; retain work in Desk")}>
        {l("启用后由本机 Hara 引擎接收新邮件。锁屏时引擎仍须运行；休眠或离线后恢复补取。邮件先形成工单，派发和验收分别授权。", "The local Hara Engine receives new mail while running, including during screen lock. After sleep or an outage it catches up. Mail creates feedback tickets; dispatch and acceptance need separate grants.")}
      </SettingsNotice>
      {runtime && !runtime.ready && <SettingsNotice tone="warning" title={l("本机邮件接收组件尚未就绪", "Mail receiver prerequisites need setup")}>
        {runtime.reason === "python-missing"
          ? l("这台电脑没有可用的 Python 3。请在实际接收邮件的主机准备 Python 3 和共享邮件能力后刷新；工单与任务仍可使用。", "Python 3 is unavailable on this host. Prepare Python 3 and the shared mail capability on the receiver, then refresh. Tickets and tasks remain available.")
          : l("本机需要可运行的新版共享 feishu-communicate 邮件能力和 Python 3；Hara 不会自动安装、登录或读取邮箱。准备完成后刷新；工单与任务仍可使用。", "This receiver needs a working, updated shared feishu-communicate mail capability and Python 3. Hara does not install it, sign in or read a mailbox automatically. Refresh after setup; tickets and tasks remain available.")}
      </SettingsNotice>}
      {error && <SettingsNotice tone="error" title={l("需要处理", "Needs attention")}>{error}</SettingsNotice>}
      {notice && <SettingsNotice tone="success" title={notice} />}
      {offline && <SettingsNotice tone="warning" title={l("正在查看本机离线副本", "Viewing a private offline copy")}>{l("暂时只读。恢复连接后自动同步；权限错误不会使用离线副本掩盖。", "Read-only until connectivity recovers. Authorization errors never fall back to a cached copy.")}</SettingsNotice>}
      {!meta && !error && <p role="status">{l("正在连接公司 Desk…", "Connecting to company Desk…")}</p>}
      {meta && <SettingsItem title={l("本机主 Bot", "Main Bot on this host")} description={l("接收身份固定为当前 Desk Agent，不按邮件里的角色名切换。", "The receiver uses this Desk Agent; mail role labels do not switch its identity.")}>
        <span>{meta.me.name} <SettingsBadge>{meta.me.role}</SettingsBadge></span>
      </SettingsItem>}
      <SettingsItem title={l("项目范围", "Project scope")} htmlFor="mail-project">
        <select id="mail-project" value={projectId} disabled={busy} onChange={e => setProjectId(e.target.value)}>
          <option value="">{l("选择项目", "Select project")}</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
        </select>
      </SettingsItem>
      {meta && <form className="mailbox-bind" onSubmit={e => {
        e.preventDefault();
        const old = mail.connections.find(c => c.mailbox === mailbox.trim().toLowerCase()), valid = current.current;
        void run(async () => { try {
          await command("bind", { mailbox, servers, password, ownership, allowReplies, receiverMode: "local", projectId, mainBotId: meta.me.id, expectedRevision: old?.revision || 0 });
        } finally { if (valid()) setPassword(""); } }, l("邮箱身份已核验，接收保持暂停；点击启用开始处理新邮件。", "Mailbox verified and paused. Enable it to receive new mail."));
      }}>
        <label>{l("准确邮箱地址", "Exact mailbox address")}<input type="email" autoComplete="off" required placeholder="agent@company.com" value={mailbox} onChange={e => setMailbox(e.target.value)} disabled={busy} /></label>
        <button type="button" className="compact mailbox-preset" disabled={busy} onClick={() => setServers({ ...feishuServers })}>{l("填入飞书参数", "Use Feishu settings")}</button>
        {(["imap", "smtp"] as const).map(protocol => <div className="mailbox-server" key={protocol}>
          <label>{protocol.toUpperCase() + l(" 服务器", " server")}<input required autoComplete="off" placeholder={protocol + ".company.com"} value={servers[`${protocol}Host`]} disabled={busy} onChange={e => setServers(s => ({ ...s, [`${protocol}Host`]: e.target.value }))} /></label>
          <label>{l("端口", "Port")}<input type="number" min={1} max={65535} required value={servers[`${protocol}Port`]} disabled={busy} onChange={e => setServers(s => ({ ...s, [`${protocol}Port`]: Number(e.target.value) }))} /></label>
          <label>{l("加密", "Encryption")}<select value={servers[`${protocol}Security`]} disabled={busy} onChange={e => setServers(s => ({ ...s, [`${protocol}Security`]: e.target.value as "tls" | "starttls" }))}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label>
        </div>)}
        <label>{l("邮箱归属", "Ownership")}<select value={ownership} disabled={busy} onChange={e => setOwnership(e.target.value as typeof ownership)}><option value="personal">{l("我的用户邮箱", "My mailbox")}</option>{owner && <option value="company">{l("公司共享邮箱", "Company shared mailbox")}</option>}</select></label>
        <label>{l("客户端授权码或专用密码", "Client authorization code or password")}<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={4096} placeholder={l("同一身份和服务器可留空；变更后需重填", "Leave blank only for the same verified identity and servers")} disabled={busy || !runtime?.ready} /></label>
        <label className="mailbox-check"><input type="checkbox" checked={allowReplies} onChange={e => setAllowReplies(e.target.checked)} disabled={busy} />{l("允许逐封确认后发信", "Allow individually confirmed sends")}</label>
        <button type="submit" disabled={busy || offline || !projectId || !runtime?.ready}>{l("在本机核验并绑定", "Verify & bind on this host")}</button>
        <small>{l("普通邮箱采用 IMAP 收信、SMTP 发信。授权码仅留在实际收发的主机；服务器参数、用户归属和任务同步到 Desk。只允许验证证书的 TLS / STARTTLS 连接。", "Standard mail uses IMAP to receive and SMTP to send. The client password stays on the receiving host; server settings, ownership and work sync to Desk. TLS / STARTTLS certificates are always verified.")}</small>
      </form>}
      {mail.connections.map(c => <article className="mailbox-connection" key={c.id}>
        <div><strong>{c.mailbox}</strong> <SettingsBadge tone={c.paused ? "neutral" : c.phase === "connected" ? "success" : "warning"}>{c.paused ? l("已暂停", "Paused") : c.phase === "connected" ? l("最近同步成功", "Last sync succeeded") : l("等待同步 / 需检查", "Waiting / check receiver")}</SettingsBadge>
          <p>{agentLabel(c.mainBotId)} · {projects.find(p => p.id === c.projectId)?.name || c.projectId} · {c.receiverMode === "server" ? l("服务器接收", "Server receiver") : l("本地 Hara 接收", "Hara receiver")} · {l("积压", "Pending")} {c.pendingCount}</p>
          <small>{c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : l("尚未成功同步", "No successful sync yet")}{c.error ? ` · ${c.error}` : ""}</small>
          {c.checks && <p>{l("列表", "List")}: {c.checks.list} · {l("正文", "Body")}: {c.checks.body === "empty-inbox" ? l("收件箱为空，待首封核验", "Empty inbox; pending first body check") : c.checks.body} · SMTP: {c.checks.sending}</p>}
          {c.needsRebind && <p role="alert">{l("公司身份已变更，请重新绑定。", "Company identity changed; bind again.")}</p>}
        </div>
        {(owner || c.ownerMemberId === identity?.memberId) && <div className="mailbox-actions">
          <button type="button" className="compact" disabled={busy || offline} onClick={() => { setMailbox(c.mailbox); setProjectId(c.projectId); setServers(c.servers || (c.provider === "feishu" ? { ...feishuServers } : { ...blankServers })); setOwnership(c.ownership || "personal"); setAllowReplies(c.allowReplies || false); setPassword(""); }}>{l("配置本机接收", "Set up this host")}</button>
          <button type="button" className="compact" disabled={busy || offline || c.needsRebind || (c.paused && c.local && !runtime?.ready)} onClick={() => actConnection(c, c.paused ? "start" : "pause")}>{c.paused ? l("启用接收", "Enable receiving") : l("暂停", "Pause")}</button>
          <button type="button" className="compact" disabled={busy || offline || !c.local || !runtime?.ready || c.paused || c.needsRebind} onClick={() => actConnection(c, "sync")}>{l("同步一次", "Sync once")}</button>
          <button type="button" className="compact" disabled={busy || offline || c.needsRebind} onClick={() => actConnection(c, "remove")}>{l("解绑", "Unbind")}</button>
        </div>}
      </article>)}
      <p className="mailbox-muted">{l("解绑停止新接收并保留工单和审计；提供商授权仍由提供商管理。同一邮箱只有一个有效接收器。发信逐封确认，不自动回复或下载附件。", "Unbinding stops new intake and retains work and audit. Provider consent is managed separately. One receiver owns each mailbox lease. Sends need individual confirmation; no automatic replies or attachment downloads.")}</p>
    </SettingsCard>

    <DeskUsersPanel users={users} identity={identity} zh={zh} disabled={busy || offline} agentName={agentLabel} save={input => run(() => mutate("members.save", input), l("用户已保存", "User saved"))} />

    {owner && <SettingsCard title={l("项目与角色授权", "Project & role grants")} description={l("每个 Agent 使用独立身份。主 Bot 需要 intake 和 dispatch，执行者需要 execute，验收者需要 review。", "Each Agent has its own identity. A main Bot needs intake and dispatch, workers execute, and reviewers review.")}>
      <form onSubmit={saveProject} className="mailbox-project-form">
        <div className="mailbox-form-row">
          <label>{l("项目 ID", "Project ID")}<input required pattern="[A-Za-z0-9._:@-]+" maxLength={160} value={editId} onChange={e => { setEditId(e.target.value); setEditRevision(0); }} placeholder="hara" /></label>
          <label>{l("名称", "Name")}<input required maxLength={200} value={projectName} onChange={e => setProjectName(e.target.value)} /></label>
          <button type="button" disabled={!selected || busy} onClick={() => { setEditId(selected!.id); setProjectName(selected!.name); setGrants(selected!.grants || {}); setMemberGrants(selected!.memberGrants || {}); setEditRevision(selected!.revision); }}>{l("编辑所选项目", "Edit selected")}</button>
        </div>
        <h4>{l("用户权限 · 适用于该用户的 Agent", "User grants · apply to this user’s Agents")}</h4>
        <div className="mailbox-grants" role="group" aria-label={l("用户项目权限", "User project grants")}>{users.map(u => <div key={u.id} className="mailbox-grant-row"><span>{u.name}<small>{u.role}</small></span>
          {["view", "intake", "dispatch", "execute", "review"].map(grant => <label key={grant}><input type="checkbox" checked={memberGrants[u.id]?.includes(grant) || false} disabled={busy || offline} onChange={e => setMemberGrants(old => ({ ...old, [u.id]: e.target.checked ? [...(old[u.id] || []), grant] : (old[u.id] || []).filter(g => g !== grant) }))} />{({ view: l("查看", "View"), intake: l("收件", "Intake"), dispatch: l("派发", "Dispatch"), execute: l("执行", "Execute"), review: l("验收", "Review") })[grant]}</label>)}
        </div>)}</div>
        <h4>{l("指定 Agent 的额外权限", "Additional grants for specific Agents")}</h4>
        <div className="mailbox-grants" role="group" aria-label={l("Agent 项目权限", "Agent project grants")}>{agents.map(a => <div key={a.id} className="mailbox-grant-row"><span>{a.name}<small>{a.owner} · {a.client}</small></span>
          {["view", "intake", "dispatch", "execute", "review"].map(grant => <label key={grant}><input type="checkbox" checked={grants[a.id]?.includes(grant) || false} disabled={busy || offline} onChange={e => setGrants(old => ({ ...old, [a.id]: e.target.checked ? [...(old[a.id] || []), grant] : (old[a.id] || []).filter(g => g !== grant) }))} />{({ view: l("查看", "View"), intake: l("收件", "Intake"), dispatch: l("派发", "Dispatch"), execute: l("执行", "Execute"), review: l("验收", "Review") })[grant]}</label>)}
        </div>)}</div>
        <button type="submit" disabled={busy || offline || !meta}>{l("保存项目授权", "Save project grants")}</button>
      </form>
    </SettingsCard>}

    <SettingsCard title={l("工单与定向任务", "Tickets & directed tasks")} description={l("先读工单，再选择执行者与独立验收者派发任务。提交结果进入待验收；工单在发布验证后关单。", "Read feedback, then dispatch to a worker and independent reviewer. Results enter review; tickets close after release verification.")}>
      {projectId && <form onSubmit={createTask} className="mailbox-task-form">
        <label>{l("任务标题", "Task title")}<input required maxLength={200} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
        <label>{l("工作说明", "Work description")}<textarea maxLength={20000} rows={3} value={body} disabled={busy} onChange={e => setBody(e.target.value)} /></label>
        <div className="mailbox-form-row">
          <label>{l("类型", "Type")}<select value={workType} disabled={busy} onChange={e => setWorkType(e.target.value)}>{["research", "bug", "feature", "docs", "code", "release", "ops"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>{l("执行 Agent", "Worker")}<select required value={target} disabled={busy} onChange={e => setTarget(e.target.value)}><option value="">{l("选择执行者", "Select worker")}</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name} · {a.client}</option>)}</select></label>
          <label>{l("独立验收者", "Reviewer")}<select required value={reviewer} disabled={busy} onChange={e => setReviewer(e.target.value)}><option value="">{l("选择验收者", "Select reviewer")}</option>{agents.filter(a => a.id !== target).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>{l("关联工单 / 父任务", "Parent ticket / task")}<select value={parentId} disabled={busy} onChange={e => setParentId(e.target.value)}><option value="">{l("独立任务", "Standalone")}</option>{tasks.filter(t => !["done", "cancelled", "waiting_verification"].includes(t.state)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
        </div>
        <button type="submit" disabled={busy || offline || !target || !reviewer || target === reviewer}>{l("派发任务", "Dispatch task")}</button>
      </form>}
      <div className="mailbox-board">{tasks.map(task => <button type="button" className={`mailbox-task ${detail?.task.id === task.id ? "selected" : ""}`} key={task.id} disabled={busy} onClick={() => viewTask(task)}>
        <span><SettingsBadge>{task.kind === "feedback" ? l("工单", "Ticket") : l("任务", "Task")}</SettingsBadge> {task.workType}</span><strong>{task.title}</strong>
        <small>{task.state} · {agentLabel(task.targetAgentId)}{task.risk === "high" ? ` · ${l("高风险执行已关闭", "High-risk execution disabled")}` : ""}</small>
      </button>)}</div>
      {projectId && tasks.length === 0 && <p className="mailbox-muted">{l("这个项目还没有你可见的工单或任务。", "No visible tickets or tasks in this project yet.")}</p>}
      {detail && <section className="mailbox-detail" aria-label={l("工单任务详情", "Ticket/task details")}>
        <h3>{detail.task.title}</h3><pre>{detail.task.body}</pre>
        {detail.results.map(r => <div key={r.result_hash}><h4>{l("结果与证据", "Result & evidence")}</h4><p>{r.body.summary}</p><pre>{r.body.evidence}</pre><small className="mailbox-hash">SHA256 {r.result_hash}</small></div>)}
        <label>{l("审核 / 验证说明", "Review / verification note")}<textarea rows={2} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} disabled={busy} /></label>
        {detail.task.state === "review" && detail.results.length > 0 && <div className="mailbox-actions">{["accept", "reject"].map(action => <button type="button" key={action} disabled={busy || (action === "reject" && !note.trim())} onClick={() => void run(async () => {
          const valid = current.current;
          await mutate(`tasks.${action}`, { taskId: detail.task.id, expectedRevision: detail.task.revision, resultHash: detail.results[detail.results.length - 1].result_hash, note });
          if (valid()) setDetail(await bus<BusTaskDetails>("tasks.get", { taskId: detail.task.id }));
        })}>{action === "accept" ? l("验收此结果", "Accept this result") : l("退回重做", "Request changes")}</button>)}</div>}
        {detail.task.kind === "feedback" && detail.task.state === "open" && <div className="mailbox-task-form">
          <label>{l("已发布版本", "Released version")}<input value={releaseVersion} maxLength={64} onChange={e => setReleaseVersion(e.target.value)} disabled={busy} /></label>
          <label>{l("验证步骤", "Verification steps")}<textarea value={verification} maxLength={4000} onChange={e => setVerification(e.target.value)} disabled={busy} /></label>
          <button type="button" disabled={busy || !releaseVersion.trim() || !verification.trim()} onClick={() => void run(async () => { await mutate("tasks.release", { taskId: detail.task.id, expectedRevision: detail.task.revision, releaseVersion, verificationSteps: verification }); if (current.current()) setDetail(null); })}>{l("记录发布，等待验证", "Record release; await verification")}</button>
        </div>}
        {detail.task.kind === "feedback" && detail.task.state === "waiting_verification" && <div><p>{detail.task.releaseVersion} · {detail.task.verificationSteps}</p><button type="button" disabled={busy || !note.trim()} onClick={() => void run(async () => { await mutate("tasks.close", { taskId: detail.task.id, expectedRevision: detail.task.revision, note }); if (current.current()) setDetail(null); })}>{l("记录验证并关单", "Record verification & close")}</button></div>}
        <DeskMailComposer key={`${spaceId}:${detail.task.id}`} client={client!} profileId={profileId} spaceId={spaceId} task={detail.task}
          connections={mail.connections.filter(c => c.ownerMemberId === identity?.memberId || (owner && c.ownership === "company"))} disabled={busy || offline} zh={zh} />
        <details><summary>{l("审计事件", "Audit events")}</summary>{detail.events.map(e => <p key={e.id}>{e.action} · {agentLabel(e.actor)} · {e.detail}</p>)}</details>
      </section>}
      <p className="mailbox-muted">{l("执行 Agent 通过 Desk MCP 或 CLI 领取、续租并提交证据。此页不会把邮件直接变成自动执行，也不会唤醒已关闭的 Codex / Claude 窗口。", "Workers use Desk MCP or CLI to claim, renew and submit evidence. This page does not execute email instructions or wake a closed Codex / Claude window.")}</p>
    </SettingsCard>
  </div>;
}
