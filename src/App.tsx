// Hara Desktop — Tauri shell over `hara serve` (WS JSON-RPC). IA per the 2026-07-11 decision doc:
// a left icon RAIL switches three PHYSICAL views — 💬 global assistant (chat temperament, WeChat-synced
// workspace + collapsed automation timeline) · 📁 projects (IDE temperament, workspace groups) · ⚙
// settings. The two minds never share a list; each has a permanent target anchor.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HaraClient, type Discovery, type SessionInfo, type ServerEvent, type PluginInfo, type SkillInfo, type PanelSpec, type CronJobInfo } from "./client";
import { detectLocale, saveLocale, makeT, type Locale } from "./i18n";
import "./App.css";

type Item =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; name: string; preview: string }
  | { kind: "notice"; text: string }
  | { kind: "diff"; text: string }
  | { kind: "end"; usage: { input: number; output: number } }
  // in-flow approval card (IA ruling I: approvals live IN the transcript, not a modal)
  | { kind: "approval"; approvalId: string; question: string; answered?: "allow" | "always" | "deny" };

type Phase = "boot" | "no-server" | "connecting" | "ready" | "lost";
type Zone = "chat" | "projects" | "settings";

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");
const isAssistantCwd = (cwd: string): boolean => /[/\\]\.hara[/\\]workspace$/.test(cwd);
const basename = (p: string): string => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
const isAutomated = (s: SessionInfo): boolean => s.source === "cron" || s.source === "gateway";
/** gateway idle-rotation forks share an id prefix (`wechat-<chat>-<tag>[-N]`) — fold to one thread */
const forkBase = (id: string): string => id.replace(/-\d+$/, "");

/** Project groups (manual sessions only): opened-but-empty projects first, then by latest activity. */
function projectGroups(sessions: SessionInfo[], opened: string[]): [string, SessionInfo[]][] {
  const map = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    if (isAssistantCwd(s.cwd) || isAutomated(s)) continue;
    map.set(s.cwd, [...(map.get(s.cwd) ?? []), s]);
  }
  const latest = (list: SessionInfo[]): string => list.reduce((m, s) => (s.updatedAt > m ? s.updatedAt : m), "");
  const withSessions = [...map.entries()].sort((a, b) => latest(b[1]).localeCompare(latest(a[1])));
  const empty: [string, SessionInfo[]][] = [...opened].reverse().filter((w) => !map.has(w) && !isAssistantCwd(w)).map((w) => [w, []]);
  return [...empty, ...withSessions];
}

/** Assistant threads: manual sessions in the workspace cwd + gateway sessions, forks folded. */
function assistantThreads(sessions: SessionInfo[]): SessionInfo[] {
  const pool = sessions.filter((s) => isAssistantCwd(s.cwd) || s.source === "gateway");
  const folded = new Map<string, SessionInfo>();
  for (const s of pool) {
    const key = s.source === "gateway" ? forkBase(s.id) : s.id;
    const prev = folded.get(key);
    if (!prev || s.updatedAt > prev.updatedAt) folded.set(key, s);
  }
  return [...folded.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export default function App() {
  const clientRef = useRef<HaraClient | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [server, setServer] = useState<{ version: string; provider: string; model: string; cwd: string } | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, Item[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [modelInfo, setModelInfo] = useState<{ models: string[]; current: string; effortLevels: string[] } | null>(null);
  const [sessEffort, setSessEffort] = useState<Record<string, string>>({});
  const [defaultApproval, setDefaultApproval] = useState<string>(() => localStorage.getItem("hara.approval") || "");
  const [err, setErr] = useState("");
  const [zone, setZoneRaw] = useState<Zone>(() => (localStorage.getItem("hara.zone") as Zone) || "chat");
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [panel, setPanel] = useState<{ title: string; url: string } | null>(null);
  const [panelBusy, setPanelBusy] = useState("");
  const [home, setHome] = useState("");
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [autoUnread, setAutoUnread] = useState(0); // ambient counter — never mixes with manual unread
  const [autoOpen, setAutoOpen] = useState(false);
  const [auto, setAuto] = useState<{ jobs: CronJobInfo[]; sessions: SessionInfo[] } | null | "old-server">(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.collapsed") ?? "{}");
    } catch {
      return {};
    }
  });
  const [openedProjects, setOpenedProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.workspaces") ?? "[]");
    } catch {
      return [];
    }
  });
  const [locale, setLocale] = useState<Locale>(detectLocale());
  const t = makeT(locale);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    void invoke<string>("get_home").then(setHome).catch(() => {});
  }, []);

  const setZone = (z: Zone) => {
    setZoneRaw(z);
    setPanel(null);
    localStorage.setItem("hara.zone", z);
    if (z === "settings" && clientRef.current) {
      void Promise.all([clientRef.current.listPlugins(), clientRef.current.listSkills()]).then(([pl, sk]) => {
        setPlugins(pl.plugins);
        setSkills(sk.skills);
      });
    }
    if (z === "chat" && clientRef.current) {
      void clientRef.current.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
    }
  };

  const push = useCallback((sessionId: string, mut: (items: Item[]) => Item[]) => {
    setTranscripts((tr) => ({ ...tr, [sessionId]: mut(tr[sessionId] ?? []) }));
  }, []);

  const handleEvent = useCallback(
    (e: ServerEvent) => {
      switch (e.method) {
        case "event.text":
          push(e.sessionId, (items) => {
            const last = items[items.length - 1];
            if (last?.kind === "text") return [...items.slice(0, -1), { kind: "text", text: last.text + e.delta }];
            return [...items, { kind: "text", text: e.delta }];
          });
          break;
        case "event.reasoning":
          push(e.sessionId, (items) => {
            const last = items[items.length - 1];
            if (last?.kind === "reasoning") return [...items.slice(0, -1), { kind: "reasoning", text: last.text + e.delta }];
            return [...items, { kind: "reasoning", text: e.delta }];
          });
          break;
        case "event.tool":
          push(e.sessionId, (items) => [...items, { kind: "tool", name: e.name, preview: plain(e.preview) }]);
          break;
        case "event.notice":
          push(e.sessionId, (items) => [...items, { kind: "notice", text: plain(e.text) }]);
          break;
        case "event.diff":
          push(e.sessionId, (items) => [...items, { kind: "diff", text: plain(e.text) }]);
          break;
        case "event.turn_end":
          push(e.sessionId, (items) => [...items, { kind: "end", usage: e.usage }]);
          setBusy((b) => ({ ...b, [e.sessionId]: false }));
          if (e.sessionId !== activeRef.current) setUnread((u) => ({ ...u, [e.sessionId]: true }));
          break;
        case "approval.request":
          push(e.sessionId, (items) => [...items, { kind: "approval", approvalId: e.approvalId, question: plain(e.question) }]);
          if (e.sessionId !== activeRef.current) setUnread((u) => ({ ...u, [e.sessionId]: true }));
          break;
      }
    },
    [push],
  );

  const connect = useCallback(async () => {
    setPhase("connecting");
    setErr("");
    try {
      const raw = await invoke<string | null>("read_discovery");
      if (!raw) {
        setPhase("no-server");
        return;
      }
      const d: Discovery = JSON.parse(raw);
      const c = new HaraClient();
      c.onEvent = handleEvent;
      c.onClose = () => setPhase("lost");
      await c.connect(d.host, d.port);
      const info = await c.initialize(d.token);
      clientRef.current = c;
      setServer({ version: info.version, provider: info.provider, model: info.model, cwd: info.cwd });
      const list = await c.listSessions();
      setSessions(list.sessions);
      // cold start: returning users land on their last zone; brand-new (no manual sessions, no
      // opened projects) land on the assistant — the soft first touch.
      const manual = list.sessions.filter((s) => !isAutomated(s) && !isAssistantCwd(s.cwd));
      if (manual.length === 0 && openedProjects.length === 0) setZoneRaw("chat");
      void c.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
      void c.listModels().then(setModelInfo).catch(() => {});
      setPhase("ready");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleEvent]);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, active]);

  // ambient automation counter: automated sessions updated since last seen marker
  useEffect(() => {
    if (!auto || auto === "old-server") return;
    const seen = localStorage.getItem("hara.autoSeen") ?? "";
    setAutoUnread(auto.sessions.filter((s) => s.updatedAt > seen).length);
  }, [auto]);
  const markAutoSeen = () => {
    localStorage.setItem("hara.autoSeen", new Date().toISOString());
    setAutoUnread(0);
  };

  const startServer = async () => {
    setErr("");
    try {
      await invoke("start_serve");
      setPhase("connecting");
      let up = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const raw = await invoke<string | null>("read_discovery");
        if (raw) {
          up = true;
          break;
        }
      }
      if (!up) {
        const log = await invoke<string>("read_serve_log").catch(() => "");
        setErr(log ? `hara serve did not come up. Log tail:\n${log}` : "hara serve did not come up (no log)");
        setPhase("no-server");
        return;
      }
      await connect();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
  };

  const refreshSessions = async () => {
    const c = clientRef.current;
    if (!c) return;
    const list = await c.listSessions();
    setSessions(list.sessions);
  };

  const newSession = async (cwd?: string) => {
    const c = clientRef.current;
    if (!c) return;
    const r = await c.createSession({ ...(cwd ? { cwd } : {}), ...(defaultApproval ? { approval: defaultApproval } : {}) });
    setActive(r.sessionId);
    setTranscripts((tr) => ({ ...tr, [r.sessionId]: [] }));
    await refreshSessions();
  };

  const openSession = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    setUnread((u) => ({ ...u, [id]: false }));
    if (transcripts[id]) {
      setActive(id);
      return;
    }
    try {
      const r = await c.resumeSession(id);
      setTranscripts((tr) => ({
        ...tr,
        [id]: r.history.map((m): Item => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "text", text: m.text })),
      }));
      setActive(id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const rememberProject = (dir: string, remove = false) => {
    setOpenedProjects((list) => {
      const next = remove ? list.filter((w) => w !== dir) : [...list.filter((w) => w !== dir), dir];
      localStorage.setItem("hara.workspaces", JSON.stringify(next));
      return next;
    });
  };

  const openProject = async () => {
    const dir = await openDialog({ directory: true, title: t("openProject") });
    if (typeof dir !== "string" || !dir) return;
    rememberProject(dir);
    setZone("projects");
    await newSession(dir);
  };

  const openAssistant = async () => {
    setZone("chat");
    const latest = assistantThreads(sessions)[0];
    if (latest) return openSession(latest.id);
    if (home) return newSession(`${home}/.hara/workspace`);
  };

  const toggleGroup = (cwd: string) => {
    setCollapsed((c) => {
      const next = { ...c, [cwd]: !c[cwd] };
      localStorage.setItem("hara.collapsed", JSON.stringify(next));
      return next;
    });
  };

  const sendMsg = async () => {
    const c = clientRef.current;
    const text = input.trim();
    if (!c || !active || !text || busy[active]) return;
    setInput("");
    push(active, (items) => [...items, { kind: "user", text }]);
    setBusy((b) => ({ ...b, [active]: true }));
    try {
      await c.send(active, text);
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `error: ${e?.message ?? e}` }]);
      setBusy((b) => ({ ...b, [active]: false }));
    }
  };

  const answer = async (sessionId: string, approvalId: string, verdict: "allow" | "always" | "deny") => {
    const c = clientRef.current;
    if (!c) return;
    await c.approvalReply(approvalId, verdict !== "deny", verdict === "always");
    push(sessionId, (items) => items.map((it) => (it.kind === "approval" && it.approvalId === approvalId ? { ...it, answered: verdict } : it)));
  };

  const changeModel = async (model?: string, effort?: string) => {
    const c = clientRef.current;
    if (!c || !active) return;
    try {
      const r = await c.setSessionModel(active, model, effort);
      setSessions((list) => list.map((s) => (s.id === active ? { ...s, model: r.model } : s)));
      if (effort) setSessEffort((m) => ({ ...m, [active]: effort }));
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `model switch: ${e?.message ?? e}` }]);
    }
  };

  const openPanel = async (spec: PanelSpec) => {
    setPanelBusy(spec.id);
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [] });
      setPanel({ title: spec.title, url });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPanelBusy("");
    }
  };

  const togglePlugin = async (name: string, enabled: boolean) => {
    const c = clientRef.current;
    if (!c) return;
    await c.setPlugin(name, enabled);
    const pl = await c.listPlugins();
    setPlugins(pl.plugins);
  };

  const flipLocale = () => {
    const next: Locale = locale === "en" ? "zh" : "en";
    saveLocale(next);
    setLocale(next);
  };

  // ── boot / error screen ────────────────────────────────────────────────────
  if (phase !== "ready") {
    return (
      <div className="center">
        <div className="brand">hara</div>
        <div className="herotag dim">{t("heroTag")}</div>
        {phase === "boot" || phase === "connecting" ? (
          <div className="dim">{phase === "connecting" ? t("starting") : t("connecting")}</div>
        ) : (
          <>
            <div className="cards">
              <div className="card">
                <div className="card-t">{t("cardChatTitle")}</div>
                <div className="card-b dim">{t("cardChatBody")}</div>
                <button onClick={startServer}>{t("cardChatBtn")}</button>
              </div>
              <div className="card">
                <div className="card-t">{t("cardProjTitle")}</div>
                <div className="card-b dim">{t("cardProjBody")}</div>
                <button className="ghost" onClick={startServer}>
                  {t("cardProjBtn")}
                </button>
              </div>
            </div>
            {err && (
              <details className="errbox">
                <summary className="dim">{t("showDetails")}</summary>
                <div className="err">{err}</div>
              </details>
            )}
            <button className="linky" onClick={connect}>
              {t("retry")}
            </button>
          </>
        )}
      </div>
    );
  }

  const manualUnreadIn = (list: SessionInfo[]): boolean => list.some((s) => unread[s.id]);
  const threads = assistantThreads(sessions);
  const groups = projectGroups(sessions, openedProjects);
  const activeSession = sessions.find((s) => s.id === active);
  const items = active ? (transcripts[active] ?? []) : [];

  const sessRow = (s: SessionInfo) => (
    <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openSession(s.id)}>
      <div className="title">
        {busy[s.id] && <span className="live">●</span>}
        {unread[s.id] && <span className="dot" />}
        {s.title || t("untitled")}
      </div>
      <div className="meta">
        {s.model} · {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : t("newLabel")}
      </div>
    </div>
  );

  const conversation = (temperament: "im" | "ide") => (
    <main className={`chat ${temperament}`}>
      {/* the permanent target anchor — you always know where this message lands */}
      <div className="anchor">
        {temperament === "im" ? (
          <span>{t("anchorAssistant")}</span>
        ) : (
          <span>
            {t("anchorRepo")}
            <b>{activeSession ? basename(activeSession.cwd) : "—"}</b> <span className="dim">{activeSession?.cwd}</span>
          </span>
        )}
      </div>
      {!active ? (
        <div className="center dim">{t("pickSession")}</div>
      ) : (
        <>
          <div className="scroll">
            {items.map((it, i) => {
              switch (it.kind) {
                case "user":
                  return (
                    <div key={i} className="msg user">
                      {it.text}
                    </div>
                  );
                case "text":
                  return (
                    <div key={i} className="msg assistant">
                      {it.text}
                    </div>
                  );
                case "reasoning":
                  return (
                    <details key={i} className="reasoning" open={temperament === "ide"}>
                      <summary>{t("thinking")}</summary>
                      {it.text}
                    </details>
                  );
                case "tool":
                  return (
                    <div key={i} className="tool">
                      ⚙ {it.name} <span className="dim">{it.preview}</span>
                    </div>
                  );
                case "notice":
                  return (
                    <div key={i} className="notice">
                      {it.text}
                    </div>
                  );
                case "diff":
                  return (
                    <pre key={i} className="diff">
                      {it.text}
                    </pre>
                  );
                case "end":
                  return (
                    <div key={i} className="usage dim">
                      · {it.usage.input}→{it.usage.output} {t("tokens")} ·
                    </div>
                  );
                case "approval":
                  return (
                    <div key={i} className={`appr ${it.answered ? "done" : ""}`}>
                      <div className="modal-title">{t("approvalTitle")}</div>
                      <div className="question">{it.question}</div>
                      {it.answered ? (
                        <div className="dim">{t(it.answered)}</div>
                      ) : (
                        <div className="row">
                          <button onClick={() => void answer(active!, it.approvalId, "allow")}>{t("allow")}</button>
                          <button className="ghost" onClick={() => void answer(active!, it.approvalId, "always")}>
                            {t("always")}
                          </button>
                          <button className="deny" onClick={() => void answer(active!, it.approvalId, "deny")}>
                            {t("deny")}
                          </button>
                        </div>
                      )}
                    </div>
                  );
              }
            })}
            {active && busy[active] && <div className="busy">{t("working")}</div>}
            <div ref={bottomRef} />
          </div>
          <div className="inputbar">
            {activeSession && (
              <div className="picker">
                {modelInfo && modelInfo.models.length > 0 ? (
                  <select value={activeSession.model} onChange={(e) => void changeModel(e.target.value, undefined)} disabled={!!busy[active!]}>
                    {[...new Set([activeSession.model, ...modelInfo.models])].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="dim">{activeSession.model}</span>
                )}
                {modelInfo && modelInfo.effortLevels.length > 0 && (
                  <select value={sessEffort[active!] ?? ""} onChange={(e) => void changeModel(undefined, e.target.value || undefined)} disabled={!!busy[active!]}>
                    <option value="">thinking·auto</option>
                    {modelInfo.effortLevels.map((l) => (
                      <option key={l} value={l}>
                        thinking·{l}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <textarea
              value={input}
              placeholder={t("placeholder")}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMsg();
                }
              }}
            />
            {active && busy[active] ? (
              <button className="stop" onClick={() => void clientRef.current?.interrupt(active)}>
                {t("stop")}
              </button>
            ) : (
              <button onClick={() => void sendMsg()} disabled={!input.trim()}>
                {t("send")}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );

  return (
    <div className="app">
      {/* ── rail: the mode anchor. hairlines split the global cluster from the work cluster ── */}
      <nav className="rail">
        <button className={`rl ${zone === "chat" ? "on" : ""}`} title={t("zoneChat")} onClick={() => setZone("chat")}>
          💬{(autoUnread > 0 || manualUnreadIn(threads)) && <span className="rdot" />}
        </button>
        <div className="rline" />
        <button className={`rl ${zone === "projects" ? "on" : ""}`} title={t("zoneProjects")} onClick={() => setZone("projects")}>
          📁{manualUnreadIn(sessions.filter((s) => !isAssistantCwd(s.cwd) && !isAutomated(s))) && <span className="rdot" />}
        </button>
        <div className="rspace" />
        <div className="rline" />
        <button className={`rl ${zone === "settings" ? "on" : ""}`} title={t("zoneSettings")} onClick={() => setZone("settings")}>
          ⚙
        </button>
      </nav>

      {/* ── context list (switches with the rail) ── */}
      {zone === "chat" && (
        <aside className="sidebar">
          <div className="brand">
            {t("zoneChat")} <span className="ver">{server?.version}</span>
          </div>
          <button className="new" onClick={() => void openAssistant()}>
            ⌂ {t("assistant")}
          </button>
          <div className="sessions">
            {threads.map(sessRow)}
            {/* automation timeline — collapsed, ambient counter, never mixed with manual threads */}
            <div className="group-h" onClick={() => (setAutoOpen((o) => !o), !autoOpen && markAutoSeen())}>
              <span className="caret">{autoOpen ? "▾" : "▸"}</span> 🤖 {t("automations")}
              {autoUnread > 0 && <span className="count accent">{autoUnread}</span>}
            </div>
            {autoOpen &&
              (auto === "old-server" ? (
                <div className="autohint dim">{t("autoNeedsUpdate")}</div>
              ) : !auto || (auto.sessions.length === 0 && auto.jobs.length === 0) ? (
                <div className="autohint dim">{t("autoNone")}</div>
              ) : (
                <div className="timeline">
                  {auto.jobs.map((j) => (
                    <div key={j.id} className="trow">
                      <span className={`tstat ${j.lastStatus ?? ""}`}>{j.lastStatus === "ok" ? "✓" : j.lastStatus === "error" ? "✗" : "○"}</span>
                      <span className="tname">{j.name}</span>
                      <span className="ttime dim">{j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "—"}</span>
                    </div>
                  ))}
                  {auto.sessions.slice(0, 20).map((s) => (
                    <div key={s.id} className="trow click" onClick={() => void openSession(s.id)}>
                      <span className="tstat">·</span>
                      <span className="tname">{s.title || s.sourceName || s.source}</span>
                      <span className="ttime dim">{s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString() : ""}</span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <div className="foot">
            <span className="dim">
              {server?.provider}:{server?.model}
            </span>
          </div>
        </aside>
      )}

      {zone === "projects" && (
        <aside className="sidebar">
          <div className="brand">
            {t("zoneProjects")} <span className="ver">{server?.version}</span>
          </div>
          <button className="new" onClick={() => void openProject()}>
            {t("openProject")}
          </button>
          <div className="sessions">
            {groups.map(([cwd, list]) => (
              <div key={cwd}>
                <div className="group-h" title={cwd} onClick={() => toggleGroup(cwd)}>
                  <span className="caret">{collapsed[cwd] ? "▸" : "▾"}</span> {basename(cwd)}
                  <span className="count">{list.length}</span>
                  {collapsed[cwd] && manualUnreadIn(list) && <span className="dot" />}
                  {list.length === 0 && (
                    <span
                      className="rm"
                      title={t("removeProject")}
                      onClick={(e) => {
                        e.stopPropagation();
                        rememberProject(cwd, true);
                      }}
                    >
                      ✕
                    </span>
                  )}
                </div>
                {!collapsed[cwd] && (
                  <>
                    {list.map(sessRow)}
                    <div className="newhere" onClick={() => void newSession(cwd)}>
                      {t("newHere")}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="foot">
            <span className="dim">
              {server?.provider}:{server?.model}
            </span>
          </div>
        </aside>
      )}

      {zone === "settings" && (
        <aside className="sidebar">
          <div className="brand">{t("zoneSettings")}</div>
          <div className="sessions setlist">
            <div className="group-h">{t("setServer")}</div>
            <div className="setrow dim">
              hara {server?.version} · {server?.provider}:{server?.model}
            </div>
            <div className="group-h">{t("setSecurity")}</div>
            <div className="setrow" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <select
                value={defaultApproval}
                onChange={(e) => {
                  setDefaultApproval(e.target.value);
                  localStorage.setItem("hara.approval", e.target.value);
                }}
              >
                <option value="">auto-edit</option>
                <option value="suggest">suggest</option>
                <option value="auto-edit">auto-edit</option>
                <option value="full-auto">full-auto</option>
              </select>
              <span className="dim" style={{ fontSize: 11 }}>
                {t("apprHint")}
              </span>
            </div>
            <div className="group-h">{t("setLang")}</div>
            <div className="setrow">
              <button className={locale === "zh" ? "" : "ghost"} onClick={() => locale !== "zh" && flipLocale()}>
                中文
              </button>
              <button className={locale === "en" ? "" : "ghost"} onClick={() => locale !== "en" && flipLocale()}>
                EN
              </button>
            </div>
            <div className="group-h">{t("setPlugins")}</div>
            {!plugins ? (
              <div className="setrow dim">{t("loading")}</div>
            ) : plugins.length === 0 ? (
              <div className="setrow dim">{t("noPlugins")}</div>
            ) : (
              plugins.map((p) => (
                <div key={p.name} className="plug">
                  <div className="plug-main">
                    <div className="plug-name">
                      {p.name} <span className="dim">v{p.version}</span>
                    </div>
                    <div className="plug-meta dim">
                      {p.skills} skills · {p.agents} agents · {p.mcpServers} MCP
                    </div>
                  </div>
                  <span className="row" style={{ marginTop: 0 }}>
                    {(p.panels ?? []).map((sp) => (
                      <button key={sp.id} disabled={panelBusy === sp.id} onClick={() => void openPanel(sp)}>
                        {panelBusy === sp.id ? "…" : sp.title}
                      </button>
                    ))}
                    <button className={p.enabled ? "" : "ghost"} onClick={() => void togglePlugin(p.name, !p.enabled)}>
                      {p.enabled ? t("enabled") : t("disabled")}
                    </button>
                  </span>
                </div>
              ))
            )}
            <div className="group-h">{t("skills")}</div>
            {(skills ?? []).map((s) => (
              <div key={s.id} className="skill">
                <span className="skill-id">{s.id}</span> <span className="dim">[{s.source}]</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* ── main area ── */}
      {panel ? (
        <main className="chat">
          <div className="panelbar">
            <button className="ghost" onClick={() => setPanel(null)}>
              ‹
            </button>
            <span className="dim">{panel.title}</span>
            <span className="dim" style={{ fontSize: 11 }}>
              {panel.url}
            </span>
          </div>
          <iframe className="panelframe" src={panel.url} title={panel.title} />
        </main>
      ) : zone === "settings" ? (
        <main className="chat">
          <div className="center dim">⚙</div>
        </main>
      ) : (
        conversation(zone === "chat" ? "im" : "ide")
      )}

    </div>
  );
}
