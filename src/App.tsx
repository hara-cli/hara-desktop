// hara desktop — Tauri shell over `hara serve`. Discover → connect → drive sessions; every mutation
// happens server-side, this UI only renders the event stream and answers approvals.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HaraClient, type Discovery, type SessionInfo, type ServerEvent, type PluginInfo, type SkillInfo } from "./client";
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

export default function App() {
  const clientRef = useRef<HaraClient | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [server, setServer] = useState<{ version: string; provider: string; model: string; cwd: string } | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "plugins">("chat");
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newCwd, setNewCwd] = useState("");
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
      setNewCwd(info.cwd);
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
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const raw = await invoke<string | null>("read_discovery");
        if (raw) break;
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
    setNewOpen(false);
    setTranscripts((t) => ({ ...t, [r.sessionId]: [] }));
    const list = await c.listSessions();
    setSessions(list.sessions);
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

  const openSession = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
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
          <div className="dim">connecting to hara serve…</div>
        ) : (
          <>
            <div className="dim">{phase === "lost" ? "connection lost — is `hara serve` still running?" : "no running `hara serve` found"}</div>
            {err && <div className="err">{err}</div>}
            <div className="row">
              <button onClick={startServer}>start hara serve</button>
              <button className="ghost" onClick={connect}>retry</button>
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
        {newOpen ? (
          <div className="newform">
            <input
              value={newCwd}
              onChange={(e) => setNewCwd(e.target.value)}
              placeholder="working directory"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") void newSession(newCwd.trim() || undefined);
                if (e.key === "Escape") setNewOpen(false);
              }}
            />
            <div className="row">
              <button onClick={() => void newSession(newCwd.trim() || undefined)}>create</button>
              <button className="ghost" onClick={() => setNewOpen(false)}>cancel</button>
            </div>
          </div>
        ) : (
          <button className="new" onClick={() => setNewOpen(true)}>
            + new session
          </button>
        )}
        <div className="sessions">
          {sessions.map((s) => (
            <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openSession(s.id)}>
              <div className="title">{s.title || "(untitled)"}</div>
              <div className="meta">
                {s.model} · {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "new"}
              </div>
            </div>
          ))}
        </div>
        <div className="foot">
          <span>
            {server?.provider}:{server?.model}
          </span>
          <button className="linky" onClick={() => (view === "plugins" ? setView("chat") : void openPlugins())}>
            {view === "plugins" ? "‹ chat" : "plugins"}
          </button>
        </div>
      </aside>
      {view === "plugins" ? (
        <main className="chat">
          <div className="scroll panel">
            <h2>plugins</h2>
            {!plugins ? (
              <div className="dim">loading…</div>
            ) : plugins.length === 0 ? (
              <div className="dim">no plugins installed — `hara plugin install &lt;source&gt;`</div>
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
                  <button className={p.enabled ? "" : "ghost"} onClick={() => void togglePlugin(p.name, !p.enabled)}>
                    {p.enabled ? "enabled" : "disabled"}
                  </button>
                </div>
              ))
            )}
            <h2>skills</h2>
            {!skills ? (
              <div className="dim">loading…</div>
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
          <div className="center dim">pick a session or start a new one</div>
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
                        <summary>thinking…</summary>
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
                        · {it.usage.input}→{it.usage.output} tokens ·
                      </div>
                    );
                }
              })}
              {active && busy[active] && <div className="busy">▍working…</div>}
              <div ref={bottomRef} />
            </div>
            <div className="inputbar">
              <textarea
                value={input}
                placeholder="message hara… (Enter to send, Shift+Enter for newline)"
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
                  stop
                </button>
              ) : (
                <button onClick={() => void sendMsg()} disabled={!input.trim()}>
                  send
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
            <div className="modal-title">approval needed</div>
            <div className="question">{approval.question}</div>
            <div className="row">
              <button onClick={() => void answer(true)}>allow</button>
              <button className="ghost" onClick={() => void answer(true, true)}>
                always allow
              </button>
              <button className="deny" onClick={() => void answer(false)}>
                deny
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
