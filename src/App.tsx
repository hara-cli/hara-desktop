// hara desktop — Tauri shell over `hara serve`. Discover → connect → drive sessions; every mutation
// happens server-side, this UI only renders the event stream and answers approvals.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HaraClient, type Discovery, type SessionInfo, type ServerEvent, type PluginInfo, type SkillInfo, type PanelSpec } from "./client";
import { detectLocale, saveLocale, makeT, type Locale } from "./i18n";
import "./App.css";

type Item =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; name: string; preview: string }
  | { kind: "notice"; text: string }
  | { kind: "diff"; text: string }
  | { kind: "end"; usage: { input: number; output: number } };

interface Approval {
  approvalId: string;
  sessionId: string;
  question: string;
}

type Phase = "boot" | "no-server" | "connecting" | "ready" | "lost";

// strip ANSI color codes — serve relays the CLI's colored confirm/notice strings
const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");

// S1 information architecture: workspace (project dir) × session, plus a pinned global assistant.
const isAssistantCwd = (cwd: string): boolean => /[/\\]\.hara[/\\]workspace$/.test(cwd);
const basename = (p: string): string => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;

/** Group sessions by cwd: assistant sessions pinned out, workspaces ordered by latest activity.
 *  `opened` = projects the user explicitly opened (persisted) — they show even with zero sessions,
 *  newest-opened first, so "open folder → project appears" works like codex/VS Code. */
function groupSessions(sessions: SessionInfo[], opened: string[]): { assistant: SessionInfo[]; groups: [string, SessionInfo[]][] } {
  const assistant: SessionInfo[] = [];
  const map = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    if (isAssistantCwd(s.cwd)) assistant.push(s);
    else map.set(s.cwd, [...(map.get(s.cwd) ?? []), s]);
  }
  const latest = (list: SessionInfo[]): string => list.reduce((m, s) => (s.updatedAt > m ? s.updatedAt : m), "");
  const withSessions = [...map.entries()].sort((a, b) => latest(b[1]).localeCompare(latest(a[1])));
  const empty: [string, SessionInfo[]][] = [...opened]
    .reverse() // newest opened first
    .filter((w) => !map.has(w) && !isAssistantCwd(w))
    .map((w) => [w, []]);
  return { assistant, groups: [...empty, ...withSessions] };
}

export default function App() {
  const clientRef = useRef<HaraClient | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [server, setServer] = useState<{ version: string; provider: string; model: string; cwd: string } | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "plugins">("chat");
  const [panel, setPanel] = useState<{ title: string; url: string } | null>(null);
  const [panelBusy, setPanelBusy] = useState("");
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [locale, setLocale] = useState<Locale>(detectLocale());
  const [home, setHome] = useState("");
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.collapsed") ?? "{}");
    } catch {
      return {};
    }
  });
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    void invoke<string>("get_home").then(setHome).catch(() => {});
  }, []);
  const toggleGroup = (cwd: string) => {
    setCollapsed((c) => {
      const next = { ...c, [cwd]: !c[cwd] };
      localStorage.setItem("hara.collapsed", JSON.stringify(next));
      return next;
    });
  };
  const t = makeT(locale);
  const flipLocale = () => {
    const next: Locale = locale === "en" ? "zh" : "en";
    saveLocale(next);
    setLocale(next);
  };
  const [openedProjects, setOpenedProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.workspaces") ?? "[]");
    } catch {
      return [];
    }
  });
  const rememberProject = (dir: string, remove = false) => {
    setOpenedProjects((list) => {
      const next = remove ? list.filter((w) => w !== dir) : [...list.filter((w) => w !== dir), dir];
      localStorage.setItem("hara.workspaces", JSON.stringify(next));
      return next;
    });
  };
  /** codex-style "open folder = new project": pick a directory, pin it as a workspace group, and drop
   *  straight into a fresh session there. */
  const openProject = async () => {
    const dir = await openDialog({ directory: true, title: t("openProject") });
    if (typeof dir !== "string" || !dir) return;
    rememberProject(dir);
    await newSession(dir);
  };
  const [transcripts, setTranscripts] = useState<Record<string, Item[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [approval, setApproval] = useState<Approval | null>(null);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const push = useCallback((sessionId: string, mut: (items: Item[]) => Item[]) => {
    setTranscripts((t) => ({ ...t, [sessionId]: mut(t[sessionId] ?? []) }));
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
          setApproval({ approvalId: e.approvalId, sessionId: e.sessionId, question: plain(e.question) });
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
      setPhase("ready");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
  }, [handleEvent]);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, active]);

  const startServer = async () => {
    setErr("");
    try {
      await invoke("start_serve");
      setPhase("connecting");
      // poll for the discovery file: serve needs a moment to boot (provider build + bind)
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
        // surface the actual serve output instead of a bare failure (cc-haha startup-log pattern)
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

  const newSession = async (cwd?: string) => {
    const c = clientRef.current;
    if (!c) return;
    const r = await c.createSession(cwd ? { cwd } : undefined);
    setActive(r.sessionId);
    setView("chat");
    setTranscripts((t) => ({ ...t, [r.sessionId]: [] }));
    const list = await c.listSessions();
    setSessions(list.sessions);
  };

  /** Global assistant — the pinned, chat-app-like entry (gateway's default workspace). Opens the most
   *  recent assistant session, or starts one. */
  const openAssistant = async () => {
    const latest = groupSessions(sessions, openedProjects).assistant.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) return openSession(latest.id);
    if (home) return newSession(`${home}/.hara/workspace`);
  };

  const openPlugins = async () => {
    const c = clientRef.current;
    if (!c) return;
    setView("plugins");
    const [pl, sk] = await Promise.all([c.listPlugins(), c.listSkills()]);
    setPlugins(pl.plugins);
    setSkills(sk.skills);
  };

  const togglePlugin = async (name: string, enabled: boolean) => {
    const c = clientRef.current;
    if (!c) return;
    await c.setPlugin(name, enabled);
    const pl = await c.listPlugins();
    setPlugins(pl.plugins);
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
      setTranscripts((t) => ({
        ...t,
        [id]: r.history.map((m): Item => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "text", text: m.text })),
      }));
      setActive(id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const sendMsg = async () => {
    const c = clientRef.current;
    const text = input.trim();
    if (!c || !active || !text || busy[active]) return;
    setInput("");
    push(active, (items) => [...items, { kind: "user", text }]);
    setBusy((b) => ({ ...b, [active]: true }));
    try {
      await c.send(active, text); // events render the stream; turn_end clears busy
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `error: ${e?.message ?? e}` }]);
      setBusy((b) => ({ ...b, [active]: false }));
    }
  };

  const answer = async (allow: boolean, always = false) => {
    const c = clientRef.current;
    if (!c || !approval) return;
    await c.approvalReply(approval.approvalId, allow, always);
    setApproval(null);
  };

  if (phase !== "ready") {
    return (
      <div className="center">
        <div className="brand">hara</div>
        {phase === "boot" || phase === "connecting" ? (
          <div className="dim">{t("connecting")}</div>
        ) : (
          <>
            <div className="dim">{phase === "lost" ? t("lost") : t("noServer")}</div>
            {err && <div className="err">{err}</div>}
            <div className="row">
              <button onClick={startServer}>{t("startServe")}</button>
              <button className="ghost" onClick={connect}>{t("retry")}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const items = active ? (transcripts[active] ?? []) : [];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          hara <span className="ver">{server?.version}</span>
        </div>
        <button className="new" onClick={() => void openProject()}>
          {t("openProject")}
        </button>
        <div className="sessions">
          {(() => {
            const { assistant, groups } = groupSessions(sessions, openedProjects);
            const row = (s: SessionInfo) => (
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
            return (
              <>
                <div className="group-h assistant" onClick={() => void openAssistant()}>
                  ⌂ {t("assistant")}
                  {assistant.some((s) => unread[s.id]) && <span className="dot" />}
                </div>
                {assistant.slice(0, 3).map(row)}
                {groups.map(([cwd, list]) => (
                  <div key={cwd}>
                    <div className="group-h" title={cwd} onClick={() => toggleGroup(cwd)}>
                      <span className="caret">{collapsed[cwd] ? "▸" : "▾"}</span> {basename(cwd)}
                      <span className="count">{list.length}</span>
                      {collapsed[cwd] && list.some((s) => unread[s.id]) && <span className="dot" />}
                    </div>
                    {!collapsed[cwd] && (
                      <>
                        {list.map(row)}
                        <div className="newhere" onClick={() => void newSession(cwd)}>
                          {t("newHere")}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
        </div>
        <div className="foot">
          <span>
            {server?.provider}:{server?.model}
          </span>
          <span>
            <button className="linky" onClick={flipLocale}>{locale === "en" ? "中" : "EN"}</button>
            <button className="linky" onClick={() => (view === "plugins" ? setView("chat") : void openPlugins())}>
              {view === "plugins" ? t("backToChat") : t("plugins")}
            </button>
          </span>
        </div>
      </aside>
      {panel ? (
        <main className="chat">
          <div className="panelbar">
            <button className="ghost" onClick={() => setPanel(null)}>{t("backToChat")}</button>
            <span className="dim">{panel.title}</span>
            <span className="dim" style={{ fontSize: 11 }}>{panel.url}</span>
          </div>
          <iframe className="panelframe" src={panel.url} title={panel.title} />
        </main>
      ) : view === "plugins" ? (
        <main className="chat">
          <div className="scroll panel">
            <h2>{t("plugins")}</h2>
            {!plugins ? (
              <div className="dim">{t("loading")}</div>
            ) : plugins.length === 0 ? (
              <div className="dim">{t("noPlugins")}</div>
            ) : (
              plugins.map((p) => (
                <div key={p.name} className="plug">
                  <div className="plug-main">
                    <div className="plug-name">
                      {p.name} <span className="dim">v{p.version}</span>
                    </div>
                    <div className="plug-desc dim">{p.description || "—"}</div>
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
            <h2>{t("skills")}</h2>
            {!skills ? (
              <div className="dim">{t("loading")}</div>
            ) : (
              skills.map((s) => (
                <div key={s.id} className="skill">
                  <span className="skill-id">{s.id}</span> <span className="dim">[{s.source}]</span>
                  <div className="plug-desc dim">{s.description}</div>
                </div>
              ))
            )}
          </div>
        </main>
      ) : (
      <main className="chat">
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
                      <details key={i} className="reasoning">
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
                }
              })}
              {active && busy[active] && <div className="busy">{t("working")}</div>}
              <div ref={bottomRef} />
            </div>
            <div className="inputbar">
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
      )}
      {approval && (
        <div className="overlay">
          <div className="modal">
            <div className="modal-title">{t("approvalTitle")}</div>
            <div className="question">{approval.question}</div>
            <div className="row">
              <button onClick={() => void answer(true)}>{t("allow")}</button>
              <button className="ghost" onClick={() => void answer(true, true)}>
                {t("always")}
              </button>
              <button className="deny" onClick={() => void answer(false)}>
                {t("deny")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
