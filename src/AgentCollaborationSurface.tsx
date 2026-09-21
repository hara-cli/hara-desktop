import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  AgentInfo,
  AgentRoomDetails,
  AgentTeamMember,
  AgentTeamRuntime,
  HaraClient,
  SessionAgentTeam,
} from "./client";
import type { WorkbenchToolExtension } from "./extension-dock-state";
import "./AgentCollaborationSurface.css";

interface Props {
  item: WorkbenchToolExtension;
  client: HaraClient | null;
  agents: AgentInfo[];
  locale: "en" | "zh";
}

const COPY = {
  en: {
    title: "Agent collaboration",
    hint: "One session owns the members, rooms, permissions, budget, and code review boundary.",
    refresh: "Refresh",
    rooms: "Rooms",
    members: "Members",
    newRoom: "New room",
    addAgent: "Add Agent",
    emptyRooms: "No room yet. Start at least one Agent, then create a focused room.",
    emptyMembers: "No delegated Agent in this session yet.",
    roomName: "Room name",
    chooseMembers: "Choose 1–7 members",
    createRoom: "Create room",
    cancel: "Cancel",
    closeRoom: "Close room",
    closed: "Closed",
    noMessages: "This room has no messages yet.",
    messageRoom: "Message the group…",
    send: "Send",
    you: "You",
    direct: "Direct instruction",
    directHint: "A working Agent receives it at the next boundary; an idle Agent continues in a new bounded generation.",
    messageAgent: "Message this Agent…",
    stop: "Stop",
    runtime: "Member execution",
    identity: "Agent identity",
    grants: "Coding delegation",
    grantsHint: "This is a standing grant for bounded launches. Coding runs use isolated Worktrees; only the main session can review and apply their Diffs.",
    grantCodex: "Can delegate to Codex",
    grantClaude: "Can delegate to Claude Code",
    directRuntimeHint: "A direct coding worker runs the assignment in an isolated Worktree; it is not a persistent Hara persona.",
    assignment: "Initial assignment",
    assignmentHint: "Give this member a concrete first responsibility…",
    taskName: "Member ID",
    start: "Start Agent",
    native: "Hara Agent · collaboration and delegation",
    codex: "Codex coding worker · isolated Worktree",
    claude: "Claude Code worker · isolated Worktree",
    readOnly: "Read only",
    isolated: "Isolated write",
    unsupported: "Update Hara CLI to use Agent rooms in Desktop.",
    failed: "Could not update Agent collaboration",
    working: "Working",
    queued: "Queued",
    completed: "Done",
    stopped: "Stopped",
    changes: "Diff ready",
    budgetExhausted: "Team execution budget reached",
    roomLimit: "A focused room keeps up to 32 ordered messages. Start another room when it is full.",
  },
  zh: {
    title: "Agent 协作",
    hint: "一个主会话统一管理成员、群聊、权限、预算与代码审核边界。",
    refresh: "刷新",
    rooms: "群聊",
    members: "成员",
    newRoom: "新建群聊",
    addAgent: "添加 Agent",
    emptyRooms: "还没有群聊。先启动至少一个 Agent，再创建一个聚焦的群聊。",
    emptyMembers: "当前会话还没有已委派的 Agent。",
    roomName: "群聊名称",
    chooseMembers: "选择 1–7 个成员",
    createRoom: "创建群聊",
    cancel: "取消",
    closeRoom: "结束群聊",
    closed: "已结束",
    noMessages: "这个群聊还没有消息。",
    messageRoom: "给群里的 Agent 发消息…",
    send: "发送",
    you: "你",
    direct: "单独指令",
    directHint: "运行中的 Agent 会在下一个边界收到；空闲 Agent 会在新的有界回合中继续。",
    messageAgent: "给这个 Agent 发消息…",
    stop: "停止",
    runtime: "成员运行方式",
    identity: "Agent 身份",
    grants: "编码能力授权",
    grantsHint: "这是持续有效的有界授权。编码任务始终在隔离 Worktree 中运行，只有主会话可以审核并合并 Diff。",
    grantCodex: "可委派给 Codex",
    grantClaude: "可委派给 Claude Code",
    directRuntimeHint: "直接编码成员会在隔离 Worktree 中执行任务；它不是持久的 Hara 人设。",
    assignment: "初始任务",
    assignmentHint: "给这个成员一个明确的首要职责…",
    taskName: "成员 ID",
    start: "启动 Agent",
    native: "Hara Agent · 协作与委派",
    codex: "Codex 编码成员 · 隔离 Worktree",
    claude: "Claude Code 编码成员 · 隔离 Worktree",
    readOnly: "只读",
    isolated: "隔离写入",
    unsupported: "请更新 Hara CLI 后再在 Desktop 使用 Agent 群聊。",
    failed: "更新 Agent 协作失败",
    working: "工作中",
    queued: "排队中",
    completed: "已完成",
    stopped: "已停止",
    changes: "Diff 待审核",
    budgetExhausted: "团队执行预算已用尽",
    roomLimit: "每个聚焦群聊保留最多 32 条有序消息；满后请新建群聊继续。",
  },
} as const;

function slug(value: string): string {
  const normalized = value.toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(normalized) ? normalized : `agent_${normalized || "member"}`;
}

function memberTone(member: AgentTeamMember): string {
  if (member.status === "working" || member.status === "queued" || member.status === "stopping") return "is-active";
  if (member.status === "completed") return "is-complete";
  return "is-stopped";
}

function shortTime(value: string, locale: "en" | "zh"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AgentCollaborationSurface({ item, client, agents, locale }: Props) {
  const copy = COPY[locale];
  const sessionId = item.owner.sessionId;
  const supported = Boolean(
    client?.supports("session.agents.list")
    && client.supports("session.agent-rooms.read"),
  );
  const [team, setTeam] = useState<SessionAgentTeam | null>(null);
  const [room, setRoom] = useState<AgentRoomDetails | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomMembers, setRoomMembers] = useState<string[]>([]);
  const [roomMessage, setRoomMessage] = useState("");
  const [directMessage, setDirectMessage] = useState("");
  const [agentRef, setAgentRef] = useState("main");
  const [runtime, setRuntime] = useState<AgentTeamRuntime>("hara");
  const [runtimeGrants, setRuntimeGrants] = useState<Array<"codex" | "claude">>([]);
  const [workspace, setWorkspace] = useState<"read-only" | "isolated-write">("read-only");
  const [taskName, setTaskName] = useState("agent_member");
  const [assignment, setAssignment] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const refreshTimer = useRef<number | null>(null);
  const requestVersion = useRef(0);

  const eligibleAgents = useMemo(() => agents.filter((agent) => (
    agent.ref === "main" || agent.home === item.owner.cwd
  )), [agents, item.owner.cwd]);

  const refreshTeam = useCallback(async () => {
    if (!client || !supported) return;
    const version = ++requestVersion.current;
    try {
      const next = await client.listSessionAgentTeam(sessionId);
      if (version !== requestVersion.current || !next) return;
      setTeam(next);
      setSelectedRoomId((current) => {
        if (current && next.rooms.some((candidate) => candidate.id === current)) return current;
        return next.rooms.find((candidate) => !candidate.closedAt)?.id ?? next.rooms[0]?.id ?? null;
      });
      setSelectedMemberId((current) => (
        current && next.agents.some((candidate) => candidate.id === current)
          ? current
          : next.agents[0]?.id ?? null
      ));
      setError("");
    } catch (cause: any) {
      if (version === requestVersion.current) setError(String(cause?.message ?? cause));
    }
  }, [client, sessionId, supported]);

  const refreshRoom = useCallback(async (roomId: string) => {
    if (!client || !supported) return;
    try {
      const result = await client.readAgentRoom(sessionId, roomId, 50);
      if (result.room.id === roomId) setRoom(result.room);
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    }
  }, [client, sessionId, supported]);

  useEffect(() => {
    void refreshTeam();
    if (!client || !supported) return;
    const unsubscribe = client.onServerEvent((event) => {
      if (event.method !== "event.agent_state" || event.sessionId !== sessionId) return;
      setTeam((current) => current ? {
        ...current,
        agents: current.agents.some((agent) => agent.id === event.agent.id)
          ? current.agents.map((agent) => agent.id === event.agent.id ? event.agent : agent)
          : [...current.agents, event.agent],
      } : current);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => void refreshTeam(), 300);
    });
    const interval = window.setInterval(() => void refreshTeam(), 8_000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, [client, refreshTeam, sessionId, supported]);

  useEffect(() => {
    if (!selectedRoomId) {
      setRoom(null);
      return;
    }
    void refreshRoom(selectedRoomId);
  }, [refreshRoom, selectedRoomId, team?.rooms]);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (cause: any) {
      setError(String(cause?.message ?? cause));
    } finally {
      setBusy("");
    }
  }, []);

  const createRoom = (event: FormEvent) => {
    event.preventDefault();
    const name = slug(roomName);
    if (!client || !name || roomMembers.length === 0) return;
    void run("create-room", async () => {
      const result = await client.createAgentRoom({ sessionId, name, members: roomMembers });
      setRoomName("");
      setRoomMembers([]);
      setShowRoomForm(false);
      await refreshTeam();
      setSelectedRoomId(result.room.id);
    });
  };

  const addAgent = (event: FormEvent) => {
    event.preventDefault();
    if (!client || !assignment.trim()) return;
    const uniqueBase = slug(taskName);
    const existing = new Set(team?.agents.map((agent) => agent.name) ?? []);
    let uniqueName = uniqueBase;
    for (let suffix = 2; existing.has(uniqueName); suffix += 1) uniqueName = `${uniqueBase.slice(0, 44)}_${suffix}`;
    void run("add-agent", async () => {
      const result = await client.spawnSessionAgent({
        sessionId,
        taskName: uniqueName,
        message: assignment.trim(),
        ...(runtime === "hara" && agentRef !== "main" ? { agentRef } : {}),
        runtime,
        ...(runtime === "hara" && runtimeGrants.length > 0 ? { runtimeGrants } : {}),
        workspace: runtime === "hara" ? workspace : "isolated-write",
      });
      setAssignment("");
      setTaskName("agent_member");
      setShowAgentForm(false);
      setSelectedMemberId(result.agent.id);
      setRoomMembers((current) => current.includes(result.agent.id) ? current : [...current, result.agent.id]);
      await refreshTeam();
    });
  };

  const sendRoomMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!client || !room || !roomMessage.trim() || room.closedAt) return;
    const message = roomMessage.trim();
    void run("room-message", async () => {
      const result = await client.postAgentRoom({ sessionId, room: room.id, message, wake: true });
      setRoomMessage("");
      setRoom(result.room);
      await refreshTeam();
    });
  };

  const selectedMember = team?.agents.find((member) => member.id === selectedMemberId) ?? null;
  const sendDirectMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!client || !selectedMember || !directMessage.trim()) return;
    const message = directMessage.trim();
    void run("direct-message", async () => {
      await client.messageSessionAgent({ sessionId, target: selectedMember.id, message, wake: true });
      setDirectMessage("");
      await refreshTeam();
    });
  };

  const memberLabel = useCallback((path: string): string => {
    if (path === "/root") return copy.you;
    const member = team?.agents.find((candidate) => candidate.path === path);
    const identity = member?.role
      ? agents.find((candidate) => candidate.ref === member.role)
      : undefined;
    const segments = path.split("/");
    return identity?.identity?.displayName || identity?.name || member?.name || segments[segments.length - 1] || path;
  }, [agents, copy.you, team?.agents]);

  if (!supported) {
    return <section className="agent-collab is-unsupported"><p>{copy.unsupported}</p></section>;
  }

  return (
    <section className="agent-collab">
      <header className="agent-collab-intro">
        <div>
          <span className="agent-collab-eyebrow">Hara Team</span>
          <h2>{copy.title}</h2>
          <p>{copy.hint}</p>
        </div>
        <button type="button" className="agent-collab-refresh" onClick={() => void refreshTeam()}>{copy.refresh}</button>
      </header>

      {error ? <div className="agent-collab-error" role="alert"><strong>{copy.failed}</strong><span>{error}</span></div> : null}
      {team?.budget?.exhausted ? <div className="agent-collab-budget" role="status">{copy.budgetExhausted}</div> : null}

      <div className="agent-collab-body">
        <aside className="agent-collab-sidebar">
          <div className="agent-collab-section-heading">
            <strong>{copy.rooms}</strong>
            <button type="button" onClick={() => setShowRoomForm((value) => !value)}>+ {copy.newRoom}</button>
          </div>
          {showRoomForm ? (
            <form className="agent-collab-form" onSubmit={createRoom}>
              <label>{copy.roomName}<input value={roomName} onChange={(event) => setRoomName(event.currentTarget.value)} maxLength={48} autoFocus /></label>
              <fieldset>
                <legend>{copy.chooseMembers}</legend>
                {(team?.agents ?? []).map((member) => (
                  <label className="agent-collab-check" key={member.id}>
                    <input
                      type="checkbox"
                      checked={roomMembers.includes(member.id)}
                      onChange={(event) => setRoomMembers((current) => event.currentTarget.checked
                        ? [...current, member.id].slice(0, 7)
                        : current.filter((id) => id !== member.id))}
                    />
                    <span>{memberLabel(member.path)}</span>
                    <small>{member.runtime}</small>
                  </label>
                ))}
              </fieldset>
              <div className="agent-collab-form-actions">
                <button type="button" onClick={() => setShowRoomForm(false)}>{copy.cancel}</button>
                <button type="submit" disabled={!roomName.trim() || roomMembers.length === 0 || busy === "create-room"}>{copy.createRoom}</button>
              </div>
            </form>
          ) : null}
          <div className="agent-collab-room-list">
            {(team?.rooms ?? []).length ? team!.rooms.map((candidate) => (
              <button
                type="button"
                className={candidate.id === selectedRoomId ? "is-selected" : ""}
                key={candidate.id}
                onClick={() => setSelectedRoomId(candidate.id)}
              >
                <span>#</span>
                <strong>{candidate.name.replace(/_/g, " ")}</strong>
                <small>{candidate.closedAt ? copy.closed : candidate.messageCount}</small>
              </button>
            )) : <p className="agent-collab-empty">{copy.emptyRooms}</p>}
          </div>

          <div className="agent-collab-section-heading is-members">
            <strong>{copy.members}</strong>
            <button type="button" onClick={() => setShowAgentForm((value) => !value)}>+ {copy.addAgent}</button>
          </div>
          {showAgentForm ? (
            <form className="agent-collab-form" onSubmit={addAgent}>
              <label>{copy.runtime}
                <select value={runtime} onChange={(event) => setRuntime(event.currentTarget.value as AgentTeamRuntime)}>
                  <option value="hara">{copy.native}</option>
                  <option value="codex">{copy.codex}</option>
                  <option value="claude">{copy.claude}</option>
                </select>
              </label>
              {runtime === "hara" ? (
                <>
                  <label>{copy.identity}
                    <select value={agentRef} onChange={(event) => {
                      const ref = event.currentTarget.value;
                      setAgentRef(ref);
                      const selected = eligibleAgents.find((agent) => agent.ref === ref);
                      setTaskName(slug(selected?.name ?? "agent_member"));
                    }}>
                      <option value="main">Hara</option>
                      {eligibleAgents.filter((agent) => agent.ref !== "main").map((agent) => (
                        <option value={agent.ref} key={agent.ref}>{agent.identity?.displayName || agent.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="agent-collab-segmented" role="group" aria-label={copy.runtime}>
                    <button type="button" className={workspace === "read-only" ? "is-on" : ""} onClick={() => setWorkspace("read-only")}>{copy.readOnly}</button>
                    <button type="button" className={workspace === "isolated-write" ? "is-on" : ""} onClick={() => setWorkspace("isolated-write")}>{copy.isolated}</button>
                  </div>
                  <fieldset className="agent-collab-grants">
                    <legend>{copy.grants}</legend>
                    <label className="agent-collab-check">
                      <input
                        type="checkbox"
                        checked={runtimeGrants.includes("codex")}
                        onChange={(event) => setRuntimeGrants((current) => event.currentTarget.checked
                          ? [...current.filter((grant) => grant !== "codex"), "codex"]
                          : current.filter((grant) => grant !== "codex"))}
                      />
                      <span>{copy.grantCodex}</span>
                    </label>
                    <label className="agent-collab-check">
                      <input
                        type="checkbox"
                        checked={runtimeGrants.includes("claude")}
                        onChange={(event) => setRuntimeGrants((current) => event.currentTarget.checked
                          ? [...current.filter((grant) => grant !== "claude"), "claude"]
                          : current.filter((grant) => grant !== "claude"))}
                      />
                      <span>{copy.grantClaude}</span>
                    </label>
                    <p>{copy.grantsHint}</p>
                  </fieldset>
                </>
              ) : <p className="agent-collab-runtime-hint">{copy.directRuntimeHint}</p>}
              <label>{copy.taskName}<input value={taskName} onChange={(event) => setTaskName(event.currentTarget.value)} maxLength={48} /></label>
              <label>{copy.assignment}<textarea value={assignment} onChange={(event) => setAssignment(event.currentTarget.value)} placeholder={copy.assignmentHint} maxLength={32_000} /></label>
              <div className="agent-collab-form-actions">
                <button type="button" onClick={() => setShowAgentForm(false)}>{copy.cancel}</button>
                <button type="submit" disabled={!assignment.trim() || busy === "add-agent"}>{copy.start}</button>
              </div>
            </form>
          ) : null}
          <div className="agent-collab-member-list">
            {(team?.agents ?? []).length ? team!.agents.map((member) => (
              <button
                type="button"
                className={member.id === selectedMemberId ? "is-selected" : ""}
                key={member.id}
                onClick={() => setSelectedMemberId(member.id)}
              >
                <i className={memberTone(member)} />
                <span>
                  <strong>{memberLabel(member.path)}</strong>
                  <small>
                    {member.runtime} · {member.status}
                    {member.runtimeGrants.length ? ` · → ${member.runtimeGrants.join(" + ")}` : ""}
                  </small>
                </span>
                {member.pendingMessages > 0 ? <b>{member.pendingMessages}</b> : null}
              </button>
            )) : <p className="agent-collab-empty">{copy.emptyMembers}</p>}
          </div>
        </aside>

        <div className="agent-collab-main">
          {room ? (
            <>
              <header className="agent-room-header">
                <div><span>#</span><h3>{room.name.replace(/_/g, " ")}</h3><small>{room.participantPaths.length} {copy.members}</small></div>
                {!room.closedAt ? <button type="button" onClick={() => {
                  if (!client || !window.confirm(`${copy.closeRoom}?`)) return;
                  void run("close-room", async () => {
                    await client.closeAgentRoom(sessionId, room.id);
                    await refreshTeam();
                    await refreshRoom(room.id);
                  });
                }}>{copy.closeRoom}</button> : <span className="agent-room-closed">{copy.closed}</span>}
              </header>
              <div className="agent-room-transcript" aria-live="polite">
                {room.messages.length ? room.messages.map((message) => (
                  <article className={message.sourcePath === "/root" ? "is-user" : "is-agent"} key={message.id}>
                    <header><strong>{memberLabel(message.sourcePath)}</strong><time>{shortTime(message.createdAt, locale)}</time></header>
                    <p>{message.content}</p>
                  </article>
                )) : <p className="agent-collab-empty is-room">{copy.noMessages}</p>}
              </div>
              {!room.closedAt ? (
                <form className="agent-room-composer" onSubmit={sendRoomMessage}>
                  <textarea value={roomMessage} onChange={(event) => setRoomMessage(event.currentTarget.value)} placeholder={copy.messageRoom} maxLength={4_000} />
                  <button type="submit" disabled={!roomMessage.trim() || busy === "room-message"}>{copy.send}</button>
                </form>
              ) : null}
              <p className="agent-room-limit">{copy.roomLimit}</p>
            </>
          ) : (
            <div className="agent-collab-blank"><span>↗</span><strong>{copy.emptyRooms}</strong></div>
          )}

          {selectedMember ? (
            <section className="agent-direct-panel">
              <header>
                <div><i className={memberTone(selectedMember)} /><span><strong>{memberLabel(selectedMember.path)}</strong><small>
                  {selectedMember.runtime} · {selectedMember.status}
                  {selectedMember.runtimeGrants.length ? ` · → ${selectedMember.runtimeGrants.join(" + ")}` : ""}
                </small></span></div>
                {(selectedMember.status === "working" || selectedMember.status === "queued" || selectedMember.status === "stopping") ? (
                  <button type="button" onClick={() => client && void run("interrupt", async () => {
                    await client.interruptSessionAgent(sessionId, selectedMember.id);
                    await refreshTeam();
                  })}>{copy.stop}</button>
                ) : null}
              </header>
              <p>{copy.directHint}</p>
              {selectedMember.workspace?.state === "changes" ? <span className="agent-direct-diff">{copy.changes}</span> : null}
              <form onSubmit={sendDirectMessage}>
                <input value={directMessage} onChange={(event) => setDirectMessage(event.currentTarget.value)} placeholder={copy.messageAgent} maxLength={16_000} />
                <button type="submit" disabled={!directMessage.trim() || busy === "direct-message"}>{copy.send}</button>
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
