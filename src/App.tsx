// Hara Desktop — Tauri shell over `hara serve` (WS JSON-RPC). IA per the 2026-07-11 decision doc:
// a left icon RAIL switches three PHYSICAL views — 💬 global assistant (chat temperament, WeChat-synced
// workspace + collapsed automation timeline) · 📁 projects (IDE temperament, workspace groups) · ⚙
// settings. The two minds never share a list; each has a permanent target anchor.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import { HaraClient, type Discovery, type SessionInfo, type ServerEvent, type PluginInfo, type SkillInfo, type PanelSpec, type ProjectPanel, type CronJobInfo, type CtxInfo } from "./client";
import { detectLocale, saveLocale, makeT, type Locale } from "./i18n";
import { IconChat, IconFolder, IconCog, IconBot, IconHome, IconEdit, IconArchive, IconStar, IconTrash, IconFork } from "./icons";
import { Md } from "./markdown";
import HaraLogo from "./mark";
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
// the four PLACES (顾雅 2026-07-11 four-places ruling): talk / work / orchestrate / configure
type Zone = "chat" | "projects" | "auto" | "settings";

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");
/** Junk cwd guard: sessions left behind by tests/one-offs in OS temp dirs are NOT projects. */
const isJunkCwd = (cwd: string): boolean =>
  /^\/(private\/)?(tmp|var\/folders)\//.test(cwd) || /[/\\]tmp\.[A-Za-z0-9]+([/\\]|$)/.test(cwd) || /[/\\]hara-(test|dbg|serve)-[^/\\]*([/\\]|$)/.test(cwd);

const isAssistantCwd = (cwd: string): boolean => /[/\\]\.hara[/\\]workspace$/.test(cwd);
const basename = (p: string): string => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
/** Compact "MM-DD HH:mm" (year only when it differs) — locale toLocaleString is too chatty for a sidebar. */
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yr = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}-`;
  return `${yr}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Automated titles are "sourceName · time" — next to the origin chip that prefix is noise. */
const botTitle = (s: SessionInfo): string => {
  const t = s.title || "";
  return s.sourceName && t.startsWith(`${s.sourceName} · `) ? t.slice(s.sourceName.length + 3) : t;
};
const isAutomated = (s: SessionInfo): boolean => s.source === "cron" || s.source === "gateway";
/** gateway idle-rotation forks share an id prefix (`wechat-<chat>-<tag>[-N]`) — fold to one thread */
const forkBase = (id: string): string => id.replace(/-\d+$/, "");

/** Project groups (manual sessions only): opened-but-empty projects first, then by latest activity. */
function projectGroups(sessions: SessionInfo[], opened: string[]): [string, SessionInfo[]][] {
  const map = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    if (isAssistantCwd(s.cwd) || isAutomated(s) || isJunkCwd(s.cwd)) continue;
    map.set(s.cwd, [...(map.get(s.cwd) ?? []), s]);
  }
  const latest = (list: SessionInfo[]): string => list.reduce((m, s) => (s.updatedAt > m ? s.updatedAt : m), "");
  const withSessions = [...map.entries()].sort((a, b) => latest(b[1]).localeCompare(latest(a[1])));
  const empty: [string, SessionInfo[]][] = [...opened].reverse().filter((w) => !map.has(w) && !isAssistantCwd(w)).map((w) => [w, []]);
  return [...empty, ...withSessions];
}

/** The assistant zone (experts' ruling: SINGLE persistent desktop conversation + one thread per
 *  external origin — the origin IS the dispatch key):
 *  - `current`: THE desktop assistant session (latest interactive one in the workspace cwd)
 *  - `bots`: gateway threads, one per platform+peer (forks folded) — WeChat etc., each its own lane
 *  - `history`: older desktop assistant sessions, folded away so duplicates never clutter the zone */
function assistantZone(sessions: SessionInfo[]): { current: SessionInfo | null; bots: SessionInfo[]; history: SessionInfo[] } {
  const mine = sessions
    .filter((s) => isAssistantCwd(s.cwd) && s.source !== "gateway" && s.source !== "cron")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const folded = new Map<string, SessionInfo>();
  for (const s of sessions.filter((x) => x.source === "gateway")) {
    const key = forkBase(s.id);
    const prev = folded.get(key);
    if (!prev || s.updatedAt > prev.updatedAt) folded.set(key, s);
  }
  const bots = [...folded.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { current: mine[0] ?? null, bots, history: mine.slice(1) };
}

export default function App() {
  const clientRef = useRef<HaraClient | null>(null);
  const connectGenerationRef = useRef(0);
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
  const [panelBusy, setPanelBusy] = useState("");
  // settings place: context column = group anchors, stage = the selected group's forms
  const [setSec, setSetSec] = useState<"engine" | "security" | "lang" | "plugins" | "skills">("engine");
  // chat ↔ live-preview split (project panels via manifest detect markers) — the design/video loop
  const [projPanels, setProjPanels] = useState<Record<string, ProjectPanel[]>>({});
  const [split, setSplit] = useState<{ id: string; title: string; url: string } | null>(null);
  const [home, setHome] = useState("");
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const [autoUnread, setAutoUnread] = useState(0); // ambient counter — never mixes with manual unread
  const [jobForm, setJobForm] = useState<{ open: boolean; name: string; schedule: string; task: string }>({ open: false, name: "", schedule: "", task: "" });
  const refreshAuto = () => clientRef.current && void clientRef.current.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
  const submitJob = async () => {
    const c = clientRef.current;
    if (!c || !jobForm.name.trim() || !jobForm.schedule.trim() || !jobForm.task.trim()) return;
    try {
      await c.addAutomation(jobForm.name.trim(), jobForm.schedule.trim(), jobForm.task.trim(), home ? `${home}/.hara/workspace` : undefined);
      setJobForm({ open: false, name: "", schedule: "", task: "" });
      refreshAuto();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  const [auto, setAuto] = useState<{ jobs: CronJobInfo[]; sessions: SessionInfo[] } | null | "old-server">(null);
  // 🤖 place: read-only replay of an automated run (never a live conversation — fork to continue)
  const [autoReplay, setAutoReplay] = useState<{ id: string; title: string; sourceName?: string; cwd: string; items: { role: string; text: string }[] } | null>(null);
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
    void (async () => {
      if (!(await isPermissionGranted().catch(() => false))) await requestPermission().catch(() => {});
    })();
  }, []);
  // dock badge = manual unread count (interruption-grade only; ambient automation never badges)
  useEffect(() => {
    const n = Object.values(unread).filter(Boolean).length;
    void invoke("set_badge", { count: n > 0 ? n : null }).catch(() => {});
  }, [unread]);
  const sessionsRef = useRef<SessionInfo[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const [q, setQ] = useState("");
  const [upd, setUpd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // first-run onboarding (serve refused to start: no credentials)
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setup, setSetup] = useState({ provider: "anthropic", apiKey: "", model: "", baseURL: "" });
  const [setupBusy, setSetupBusy] = useState(false);
  const [updAvail, setUpdAvail] = useState("");
  const pendingRef = useRef<"assistant" | "project" | null>(null);
  const apiRef = useRef<{ setZone: (z: Zone) => void; openAssistant: () => void; openProject: () => void }>({ setZone: () => {}, openAssistant: () => {}, openProject: () => {} });
  // steer queue (codex composer pattern): messages typed while a turn runs are queued and auto-sent
  const [queue, setQueue] = useState<Record<string, string[]>>({});
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const [pins, setPins] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("hara.pins") ?? "[]");
    } catch {
      return [];
    }
  });
  // context watermark per session (rides on every turn_end; codex thread/tokenUsage pattern)
  const [ctxMap, setCtxMap] = useState<Record<string, CtxInfo>>({});
  // composer autocomplete — "file" while the caret sits on an @token (codex fuzzyFileSearch),
  // "skill" while the input is a bare /command (codex slash popup)
  const [ac, setAc] = useState<{ open: boolean; items: { v: string; hint?: string }[]; sel: number; mode: "file" | "skill" }>({ open: false, items: [], sel: 0, mode: "file" });
  const acTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const skillsRef = useRef<SkillInfo[] | null>(null); // lazy-loaded on the first "/" keystroke
  const togglePin = (id: string) => {
    setPins((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      localStorage.setItem("hara.pins", JSON.stringify(next));
      return next;
    });
  };

  const setZone = (z: Zone) => {
    setZoneRaw(z);
    setSplit(null);
    setAutoReplay(null);
    localStorage.setItem("hara.zone", z);
    if (z === "settings" && clientRef.current) {
      void Promise.all([clientRef.current.listPlugins(), clientRef.current.listSkills()]).then(([pl, sk]) => {
        setPlugins(pl.plugins);
        setSkills(sk.skills);
      });
    }
    if (z === "auto" && clientRef.current) {
      void clientRef.current.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
      markAutoSeen();
    }
  };

  const push = useCallback((sessionId: string, mut: (items: Item[]) => Item[]) => {
    setTranscripts((tr) => ({ ...tr, [sessionId]: mut(tr[sessionId] ?? []) }));
  }, []);

  const sendText = useCallback(
    async (sessionId: string, text: string, images?: { path: string }[]) => {
      const c = clientRef.current;
      if (!c) return;
      push(sessionId, (items) => [...items, { kind: "user", text: images?.length ? `${text}  🖼×${images.length}` : text }]);
      setBusy((b) => ({ ...b, [sessionId]: true }));
      try {
        await c.send(sessionId, text, images);
        // the first turn sets the server-side derived title — refresh so the sidebar shows it now
        void c.listSessions().then((l) => setSessions(l.sessions)).catch(() => {});
      } catch (e: any) {
        push(sessionId, (items) => [...items, { kind: "notice", text: `error: ${e?.message ?? e}` }]);
        setBusy((b) => ({ ...b, [sessionId]: false }));
      }
    },
    [push],
  );

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
        case "event.turn_end": {
          push(e.sessionId, (items) => [...items, { kind: "end", usage: e.usage }]);
          setBusy((b) => ({ ...b, [e.sessionId]: false }));
          if (e.ctx) setCtxMap((m) => ({ ...m, [e.sessionId]: e.ctx! }));
          // steer queue: auto-dispatch the next queued message for this session
          const pending = queueRef.current[e.sessionId];
          if (pending && pending.length > 0) {
            const [next, ...rest] = pending;
            setQueue((qs) => ({ ...qs, [e.sessionId]: rest }));
            setTimeout(() => void sendText(e.sessionId, next), 50);
          }
          if (e.sessionId !== activeRef.current) {
            setUnread((u) => ({ ...u, [e.sessionId]: true }));
            const s = sessionsRef.current.find((x) => x.id === e.sessionId);
            if (!s || !isAutomated(s)) {
              // interruption-grade: a manual session finished while you were elsewhere
              void isPermissionGranted()
                .then((ok) => ok && sendNotification({ title: s?.title || "hara", body: (e.reply || "").slice(0, 120) }))
                .catch(() => {});
            }
          }
          break;
        }
        case "approval.request":
          push(e.sessionId, (items) => [...items, { kind: "approval", approvalId: e.approvalId, question: plain(e.question) }]);
          if (e.sessionId !== activeRef.current) setUnread((u) => ({ ...u, [e.sessionId]: true }));
          break;
      }
    },
    [push, sendText],
  );

  const connect = useCallback(async () => {
    const generation = ++connectGenerationRef.current;
    const stale = () => generation !== connectGenerationRef.current;
    const previous = clientRef.current;
    clientRef.current = null;
    previous?.close();
    setPhase("connecting");
    setErr("");
    let c: HaraClient | null = null;
    try {
      const raw = await invoke<string | null>("read_discovery");
      if (stale()) return;
      if (!raw) {
        setPhase("no-server");
        return;
      }
      const d: Discovery = JSON.parse(raw);
      c = new HaraClient();
      c.onEvent = handleEvent;
      c.onClose = () => {
        if (clientRef.current !== c) return;
        clientRef.current = null;
        setPhase("lost");
      };
      await c.connect(d.host, d.port);
      const info = await c.initialize(d.token);
      const list = await c.listSessions();
      if (stale()) {
        c.close();
        return;
      }
      clientRef.current = c;
      setServer({ version: info.version, provider: info.provider, model: info.model, cwd: info.cwd });
      setSessions(list.sessions);
      // cold start: returning users land on their last zone; brand-new (no manual sessions, no
      // opened projects) land on the assistant — the soft first touch.
      const manual = list.sessions.filter((s) => !isAutomated(s) && !isAssistantCwd(s.cwd));
      if (manual.length === 0 && openedProjects.length === 0) setZoneRaw("chat");
      void c.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
      void c.listModels().then(setModelInfo).catch(() => {});
      setPhase("ready");
    } catch (e: any) {
      c?.close();
      if (stale()) return;
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleEvent]);

  useEffect(() => {
    void connect();
    return () => {
      connectGenerationRef.current += 1;
      const c = clientRef.current;
      clientRef.current = null;
      c?.close();
    };
  }, [connect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "1") (e.preventDefault(), apiRef.current.setZone("chat"));
      else if (e.key === "2") (e.preventDefault(), apiRef.current.setZone("projects"));
      else if (e.key === "3") (e.preventDefault(), apiRef.current.setZone("auto"));
      else if (e.key === ",") (e.preventDefault(), apiRef.current.setZone("settings"));
      else if (e.key === "n") (e.preventDefault(), apiRef.current.openProject());
      else if (e.key === "f") {
        e.preventDefault();
        (document.getElementById("haraSearch") as HTMLInputElement | null)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // pending empty-state card action fires once we're connected
  useEffect(() => {
    if (phase !== "ready" || !pendingRef.current) return;
    const act = pendingRef.current;
    pendingRef.current = null;
    if (act === "assistant") void apiRef.current.openAssistant();
    else void apiRef.current.openProject();
  }, [phase]);

  // project panels for the active project (cached per cwd; empty array caches the miss)
  const activeCwd = sessions.find((s) => s.id === active)?.cwd;
  useEffect(() => {
    const c = clientRef.current;
    if (!c || zone !== "projects" || !active || !activeCwd || projPanels[activeCwd] !== undefined) return;
    void c
      .projectPanels({ sessionId: active })
      .then((r) => setProjPanels((m) => ({ ...m, [activeCwd]: r?.panels ?? [] })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, active, activeCwd]);

  // silent update probe at launch — a dot on the settings gear, never a popup
  useEffect(() => {
    void checkForUpdate()
      .then((u) => u && setUpdAvail(u.version))
      .catch(() => {});
  }, []);

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
        // "Not authenticated" → onboarding form, not a log dump
        if (/not authenticated/i.test(log)) {
          setSetupNeeded(true);
          setPhase("no-server");
          return;
        }
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

  const creatingRef = useRef(false); // double-click guard — the assistant is ONE session, never two
  const openAssistant = async () => {
    setZone("chat");
    const cur = assistantZone(sessions).current;
    if (cur) return openSession(cur.id);
    if (!home || creatingRef.current) return;
    creatingRef.current = true;
    try {
      await newSession(`${home}/.hara/workspace`);
    } finally {
      creatingRef.current = false;
    }
  };

  const toggleGroup = (cwd: string) => {
    setCollapsed((c) => {
      const next = { ...c, [cwd]: !c[cwd] };
      localStorage.setItem("hara.collapsed", JSON.stringify(next));
      return next;
    });
  };

  const [pendImgs, setPendImgs] = useState<string[]>([]);
  const pasteImages = async (e: React.ClipboardEvent) => {
    const files = [...(e.clipboardData?.items ?? [])].filter((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    for (const it of files) {
      const f = it.getAsFile();
      if (!f) continue;
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      try {
        const path = await invoke<string>("write_temp_image", { dataBase64: b64 });
        setPendImgs((l) => [...l, path]);
      } catch (err: any) {
        setErr(String(err?.message ?? err));
      }
    }
  };

  /** Replace a session's transcript from a serve-returned history (compact / rewind). */
  const loadHistory = (sessionId: string, history: { role: string; text: string }[], tailNotice?: string) => {
    setTranscripts((tr) => ({
      ...tr,
      [sessionId]: [
        ...history.map((m): Item => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "text", text: m.text })),
        ...(tailNotice ? [{ kind: "notice", text: tailNotice } as Item] : []),
      ],
    }));
  };

  const compactNow = async () => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    setBusy((b) => ({ ...b, [active]: true }));
    try {
      const r = await c.compactSession(active);
      loadHistory(active, r.history, t("compacted"));
      setCtxMap((m) => ({ ...m, [active]: r.ctx }));
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `compact: ${e?.message ?? e}` }]);
    } finally {
      setBusy((b) => ({ ...b, [active!]: false }));
    }
  };

  /** Rewind to before the user message at transcript index i (codex thread/rollback). */
  const rewindHere = async (i: number) => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    if (!window.confirm(t("rewindConfirm"))) return;
    const items = transcripts[active] ?? [];
    const n = items.slice(i).filter((x) => x.kind === "user").length; // n-th-most-recent user turn
    try {
      const r = await c.rewindSession(active, n);
      loadHistory(active, r.history);
    } catch (e: any) {
      push(active, (list) => [...list, { kind: "notice", text: `rewind: ${e?.message ?? e}` }]);
    }
  };

  /** Composer autocomplete tracking: a bare leading /command opens the skill popup; an @token under
   *  the caret opens the fuzzy file popup; anything else closes whatever is open. */
  const trackComposer = (val: string, caret: number) => {
    const slash = /^\/([\w-]{0,40})$/.exec(val);
    if (slash && active) {
      const token = slash[1].toLowerCase();
      const show = (skills: SkillInfo[]) => {
        const items = skills
          .filter((s) => s.id.toLowerCase().startsWith(token))
          .slice(0, 8)
          .map((s) => ({ v: s.id, hint: s.description }));
        setAc({ open: items.length > 0, items, sel: 0, mode: "skill" });
      };
      if (skillsRef.current) show(skillsRef.current);
      else
        void clientRef.current
          ?.listSkills(sessionsRef.current.find((s) => s.id === active)?.cwd)
          .then((r) => {
            skillsRef.current = r.skills;
            show(r.skills);
          })
          .catch(() => {});
      return;
    }
    const m = /(^|[\s(])@([\w./-]{0,60})$/.exec(val.slice(0, caret));
    if (!m || !active) {
      if (ac.open) setAc((a) => ({ ...a, open: false }));
      return;
    }
    const token = m[2];
    if (acTimer.current) window.clearTimeout(acTimer.current);
    acTimer.current = window.setTimeout(() => {
      void clientRef.current
        ?.filesSearch(token, { sessionId: active, limit: 8 })
        .then((r) => r && setAc({ open: r.files.length > 0, items: r.files.map((f) => ({ v: f })), sel: 0, mode: "file" }))
        .catch(() => {});
    }, 120);
  };

  /** Insert the picked item: file mode replaces the @token before the caret; skill mode replaces the
   *  whole input with "/skill-id ". */
  const pickMention = (v: string) => {
    const el = inputRef.current;
    let head: string;
    let next: string;
    if (ac.mode === "skill") {
      head = `/${v} `;
      next = head;
    } else {
      const caret = el?.selectionStart ?? input.length;
      head = input.slice(0, caret).replace(/@[\w./-]{0,60}$/, `@${v} `);
      next = head + input.slice(caret);
    }
    setInput(next);
    setAc((a) => ({ ...a, open: false }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  };

  const sendMsg = async () => {
    const text = input.trim();
    if (!active || (!text && pendImgs.length === 0)) return;
    setInput("");
    setAc((a) => ({ ...a, open: false }));
    if (busy[active]) {
      // steer: queue it; auto-dispatched when the running turn ends (pasted images stay pending
      // and go with the next immediate send — queued steers are text-only)
      if (text) setQueue((qs) => ({ ...qs, [active]: [...(qs[active] ?? []), text] }));
      return;
    }
    const imgs = pendImgs.map((p) => ({ path: p }));
    setPendImgs([]);
    await sendText(active, text || "(image)", imgs.length ? imgs : undefined);
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

  /** Launch a plugin panel from settings — it opens WHERE WORK HAPPENS (顾雅 ruling: a panel is a
   *  work stage, not a settings artifact): jump to the projects place with the panel as the split.
   *  No more full-screen hijack overlay. */
  const openPanel = async (spec: PanelSpec) => {
    setPanelBusy(spec.id);
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [], cwd: null, portHint: spec.port ?? null });
      setZoneRaw("projects");
      localStorage.setItem("hara.zone", "projects");
      setSplitLoading(true);
      setSplit({ id: spec.id, title: spec.title, url });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPanelBusy("");
    }
  };

  /** Toggle the chat ↔ preview split for a project panel (runs the panel command IN the project). */
  const [splitLoading, setSplitLoading] = useState(false);
  const toggleSplit = async (spec: ProjectPanel, cwd: string) => {
    if (split?.id === spec.id) return setSplit(null);
    setPanelBusy(spec.id);
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [], cwd, portHint: spec.port ?? null });
      setSplitLoading(true);
      setSplit({ id: spec.id, title: spec.title, url });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setPanelBusy("");
    }
  };

  /** Pop the split panel into its own window (big-screen mode); the split closes. */
  const popOutSplit = () => {
    if (!split) return;
    try {
      new WebviewWindow(`panel-${split.id}-${Date.now() % 100000}`, { url: split.url, title: `Hara — ${split.title}`, width: 1100, height: 780 });
      setSplit(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
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

  // keep latest handlers reachable from the once-registered shortcut listener + pending-card effect
  apiRef.current = { setZone, openAssistant, openProject };

  const submitSetup = async () => {
    if (!setup.apiKey.trim() || !setup.model.trim()) return;
    setSetupBusy(true);
    try {
      await invoke("write_config", { provider: setup.provider, apiKey: setup.apiKey.trim(), model: setup.model.trim(), baseUrl: setup.baseURL.trim() || null });
      setSetupNeeded(false);
      await startServer();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSetupBusy(false);
    }
  };

  // ── boot / error screen ────────────────────────────────────────────────────
  if (phase !== "ready") {
    return (
      <div className="center">
        <HaraLogo size={72} className="bootmark" />
        <div className="brand big">
          <span className="wordmark">Hara</span>
        </div>
        <div className="herotag dim">{t("heroTag")}</div>
        {phase === "boot" || phase === "connecting" ? (
          <div className="dim">{phase === "connecting" ? t("starting") : t("connecting")}</div>
        ) : setupNeeded ? (
          <div className="setup">
            <div className="card-t">{t("setupTitle")}</div>
            <div className="card-b dim">{t("setupHint")}</div>
            <select value={setup.provider} onChange={(e) => setSetup((s) => ({ ...s, provider: e.target.value }))}>
              {["anthropic", "openai", "deepseek", "qwen", "glm", "ollama", "openrouter"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input type="password" placeholder={t("apiKeyLbl")} value={setup.apiKey} onChange={(e) => setSetup((s) => ({ ...s, apiKey: e.target.value }))} spellCheck={false} />
            <input placeholder={t("modelLbl")} value={setup.model} onChange={(e) => setSetup((s) => ({ ...s, model: e.target.value }))} spellCheck={false} />
            <input placeholder={t("baseUrlLbl")} value={setup.baseURL} onChange={(e) => setSetup((s) => ({ ...s, baseURL: e.target.value }))} spellCheck={false} />
            <button disabled={setupBusy || !setup.apiKey.trim() || !setup.model.trim()} onClick={() => void submitSetup()}>
              {setupBusy ? "…" : t("saveAndStart")}
            </button>
          </div>
        ) : (
          <>
            <div className="cards">
              <div className="card">
                <div className="card-t">{t("cardChatTitle")}</div>
                <div className="card-b dim">{t("cardChatBody")}</div>
                <button
                  onClick={() => {
                    pendingRef.current = "assistant";
                    void startServer();
                  }}
                >
                  {t("cardChatBtn")}
                </button>
              </div>
              <div className="card">
                <div className="card-t">{t("cardProjTitle")}</div>
                <div className="card-b dim">{t("cardProjBody")}</div>
                <button
                  className="ghost"
                  onClick={() => {
                    pendingRef.current = "project";
                    void startServer();
                  }}
                >
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
  const hit = (text: string): boolean => !q || text.toLowerCase().includes(q.toLowerCase());
  const az = assistantZone(sessions);
  const azBots = az.bots.filter((s) => hit(s.title) || hit(s.sourceName ?? ""));
  const azAll = [...(az.current ? [az.current] : []), ...az.bots, ...az.history];
  const groups = projectGroups(sessions, openedProjects)
    .map(([cwd, list]): [string, SessionInfo[]] => [cwd, hit(basename(cwd)) ? list : list.filter((s) => hit(s.title))])
    .filter(([cwd, list]) => hit(basename(cwd)) || list.length > 0);
  const searchBox = (
    <input id="haraSearch" className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} spellCheck={false} />
  );
  const activeSession = sessions.find((s) => s.id === active);
  const items = active ? (transcripts[active] ?? []) : [];

  const sortPinned = (l: SessionInfo[]): SessionInfo[] => [...l].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  const commitRename = async () => {
    const c = clientRef.current;
    if (editingId && c && editTitle.trim()) {
      await c.renameSession(editingId, editTitle.trim()).catch(() => {});
      await refreshSessions();
    }
    setEditingId(null);
  };
  const archiveIt = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    await c.archiveSession(id, true).catch(() => {});
    if (active === id) setActive(null);
    await refreshSessions();
  };
  const deleteIt = async (id: string) => {
    const c = clientRef.current;
    if (!c || !window.confirm(t("deleteConfirm"))) return;
    try {
      await c.deleteSession(id);
      if (active === id) setActive(null);
      setTranscripts(({ [id]: _gone, ...rest }) => rest);
      await refreshSessions();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  /** Open an automated run as a READ-ONLY replay in the 🤖 stage (fork to continue it manually). */
  const openReplay = async (s: { id: string; title: string; sourceName?: string; cwd: string }) => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const r = await c.resumeSession(s.id);
      setAutoReplay({ id: s.id, title: s.title, sourceName: s.sourceName, cwd: s.cwd, items: r.history });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  /** The replay's escape hatch: fork the automated run into an interactive session and jump there. */
  const continueManually = async () => {
    const c = clientRef.current;
    if (!c || !autoReplay) return;
    const home = isAssistantCwd(autoReplay.cwd);
    try {
      const r = await c.forkSession(autoReplay.id);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): Item => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "text", text: m.text })),
      }));
      setActive(r.sessionId);
      await refreshSessions();
      setZone(home ? "chat" : "projects");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const forkIt = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const r = await c.forkSession(id);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): Item => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "text", text: m.text })),
      }));
      setActive(r.sessionId);
      await refreshSessions();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  const sessRow = (s: SessionInfo) => (
    <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openSession(s.id)}>
      <div className="title">
        {busy[s.id] && <span className="live">●</span>}
        {unread[s.id] && <span className="dot" />}
        {editingId === s.id ? (
          <input
            className="renamein"
            autoFocus
            value={editTitle}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setEditingId(null);
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <span className="ttext">{s.title || t("untitled")}</span>
        )}
        <span
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            setEditingId(s.id);
            setEditTitle(s.title);
          }}
        >
          <IconEdit />
        </span>
        <span
          className={`act pin ${pins.includes(s.id) ? "pinned" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(s.id);
          }}
        >
          <IconStar filled={pins.includes(s.id)} />
        </span>
        <span
          className="act"
          title={t("forkSess")}
          onClick={(e) => {
            e.stopPropagation();
            void forkIt(s.id);
          }}
        >
          <IconFork />
        </span>
        <span
          className="act"
          onClick={(e) => {
            e.stopPropagation();
            void archiveIt(s.id);
          }}
        >
          <IconArchive />
        </span>
        <span
          className="act danger"
          title={t("deleteSess")}
          onClick={(e) => {
            e.stopPropagation();
            void deleteIt(s.id);
          }}
        >
          <IconTrash />
        </span>
      </div>
      <div className="meta">
        {s.model} · {s.updatedAt ? fmtTime(s.updatedAt) : t("newLabel")}
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
        {temperament === "ide" &&
          activeSession &&
          (projPanels[activeSession.cwd] ?? []).map((sp) => (
            <button key={sp.id} className={`paneltab ${split?.id === sp.id ? "on" : ""}`} disabled={panelBusy === sp.id} onClick={() => void toggleSplit(sp, activeSession.cwd)}>
              {panelBusy === sp.id ? "…" : `◧ ${sp.title}`}
            </button>
          ))}
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
                      {!busy[active!] && (
                        <span className="rew" title={t("rewindHere")} onClick={() => void rewindHere(i)}>
                          ↺
                        </span>
                      )}
                    </div>
                  );
                case "text":
                  return (
                    <div key={i} className="msg assistant">
                      <Md text={it.text} />
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
            {active &&
              busy[active] &&
              (() => {
                const lastUser = items.map((x) => x.kind).lastIndexOf("user");
                const tail = items.slice(lastUser + 1);
                const nt = tail.filter((x) => x.kind === "tool").length;
                const nd = tail.filter((x) => x.kind === "diff").length;
                return (
                  <div className="busy">
                    {t("working")}
                    {nt > 0 && ` · ⚙${nt}`}
                    {nd > 0 && ` · ±${nd}`}
                  </div>
                );
              })()}
            <div ref={bottomRef} />
          </div>
          {(queue[active!] ?? []).length > 0 && (
            <div className="steerq">
              {(queue[active!] ?? []).map((m, i) => (
                <div key={i} className="steer-item">
                  <span className="steer-txt">{m}</span>
                  <button className="linky" onClick={() => setQueue((qs) => ({ ...qs, [active!]: qs[active!].filter((_, j) => j !== i) }))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendImgs.length > 0 && (
            <div className="steerq">
              {pendImgs.map((p, i) => (
                <div key={p} className="steer-item">
                  <span className="steer-txt">🖼 {p.split("/").pop()}</span>
                  <button className="linky" onClick={() => setPendImgs((l) => l.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
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
                {(() => {
                  const cx = active ? ctxMap[active] : undefined;
                  if (!cx || cx.pct <= 0) return null;
                  const heat = cx.pct >= 80 ? "hot" : cx.pct >= 60 ? "warm" : "";
                  return (
                    <span className={`ctxm ${heat}`} title={`${t("ctxTip")} — ${cx.lastInput.toLocaleString()} / ${cx.window.toLocaleString()} tokens`}>
                      <span className="ctxbar">
                        <span style={{ width: `${Math.min(cx.pct, 100)}%` }} />
                      </span>
                      {cx.pct}%
                      {cx.pct >= 50 && (
                        <button className="linky" disabled={!!busy[active!]} onClick={() => void compactNow()}>
                          {t("compact")}
                        </button>
                      )}
                    </span>
                  );
                })()}
              </div>
            )}
            {ac.open && (
              <div className="fileac">
                {ac.items.map((it, i) => (
                  <div key={it.v} className={`fitem ${i === ac.sel ? "on" : ""}`} onMouseDown={(e) => (e.preventDefault(), pickMention(it.v))}>
                    {ac.mode === "skill" ? `/${it.v}` : it.v}
                    {it.hint && <span className="fhint"> — {it.hint}</span>}
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              placeholder={t("placeholder")}
              onPaste={(e) => void pasteImages(e)}
              onChange={(e) => {
                setInput(e.target.value);
                trackComposer(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                // Enter commits an active CJK IME composition. Treating that key as a composer
                // command either sends an unfinished message or selects an autocomplete result.
                if (e.nativeEvent.isComposing) return;
                if (ac.open && ac.items.length > 0) {
                  if (e.key === "ArrowDown") return (e.preventDefault(), setAc((a) => ({ ...a, sel: (a.sel + 1) % a.items.length })));
                  if (e.key === "ArrowUp") return (e.preventDefault(), setAc((a) => ({ ...a, sel: (a.sel - 1 + a.items.length) % a.items.length })));
                  if (e.key === "Tab" || e.key === "Enter") return (e.preventDefault(), pickMention(ac.items[ac.sel].v));
                  if (e.key === "Escape") return (e.preventDefault(), setAc((a) => ({ ...a, open: false })));
                }
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

  // icon rail — four PLACES (顾雅 four-places ruling: 4+ peer places each with its own context
  // column and density → a rail IS the right control now; the 2-mode segmented era ended when
  // automations grew into a first-class place). Notification invariant on the rail: interruption
  // (needs a human) → red dot; ambient (ran, left a trace) → count chip.
  const rail = (
    <nav className="rail">
      <button className={zone === "chat" ? "on" : ""} title={`${t("zoneChat")} ⌘1`} onClick={() => setZone("chat")}>
        <IconChat size={19} />
        {manualUnreadIn(azAll) && <span className="rdot" />}
      </button>
      <button className={zone === "projects" ? "on" : ""} title={`${t("zoneProjects")} ⌘2`} onClick={() => setZone("projects")}>
        <IconFolder size={19} />
        {manualUnreadIn(sessions.filter((s) => !isAssistantCwd(s.cwd) && !isAutomated(s) && !isJunkCwd(s.cwd))) && <span className="rdot" />}
      </button>
      <button className={zone === "auto" ? "on" : ""} title={`${t("zoneAuto")} ⌘3`} onClick={() => setZone("auto")}>
        <IconBot size={19} />
        {autoUnread > 0 && <span className="chip">{autoUnread > 9 ? "9+" : autoUnread}</span>}
      </button>
      <div className="railgap" />
      <button className={zone === "settings" ? "on" : ""} title={updAvail ? `${t("updateAvail")}: ${updAvail}` : `${t("zoneSettings")} ⌘,`} onClick={() => setZone("settings")}>
        <IconCog size={18} />
        {updAvail && <span className="rdot" />}
      </button>
    </nav>
  );
  const footBar = (
    <div className="foot">
      <span className="dim">
        {server?.provider}:{server?.model}
      </span>
    </div>
  );
  const brandBar = (
    <div className="brand">
      <HaraLogo size={20} /> <span className="wordmark">Hara</span> <span className="ver">{server?.version}</span>
    </div>
  );

  return (
    <div className="app">
      {rail}

      {/* ── context list (switches with the rail) ── */}
      {zone === "chat" && (
        <aside className="sidebar">
          {brandBar}
          <button className="new withicon" onClick={() => void openAssistant()}>
            <IconHome size={15} /> {t("assistant")}
          </button>
          {searchBox}
          <div className="sessions" key={zone}>
            {/* THE single desktop conversation (experts' ruling) — the ⌂ button above opens it.
                It never shows a derived/"untitled" title: it IS the assistant. */}
            {az.current && sessRow({ ...az.current, title: t("assistant") })}
            {/* one thread per external origin (WeChat bot etc.) — the origin is the dispatch key.
                The divider keeps identities straight: above = YOUR desktop assistant, below = its
                external-channel avatars (顾雅 P2). */}
            {azBots.length > 0 && <div className="chandiv">{t("extChannels")}</div>}
            {azBots.map((s) => (
              <div key={s.id} className={`sess ${s.id === active ? "on" : ""}`} onClick={() => void openSession(s.id)}>
                <div className="title">
                  {busy[s.id] && <span className="live">●</span>}
                  {unread[s.id] && <span className="dot" />}
                  <span className="botlab">{s.sourceName || "bot"}</span> {botTitle(s) || t("untitled")}
                </div>
                <div className="meta">{s.updatedAt ? fmtTime(s.updatedAt) : t("newLabel")}</div>
              </div>
            ))}
            {/* older desktop-assistant sessions, folded away — duplicates never clutter the zone */}
            {az.history.length > 0 && (
              <>
                <div className="group-h" onClick={() => toggleGroup("__history")}>
                  <span className="caret">{collapsed["__history"] === false ? "▾" : "▸"}</span> {t("history")}
                  <span className="count">{az.history.length}</span>
                </div>
                {collapsed["__history"] === false && az.history.filter((s) => hit(s.title)).map(sessRow)}
              </>
            )}
            {/* automations moved to their own 🤖 place (four-places ruling) — nothing of them lives here */}
          </div>
          {footBar}
        </aside>
      )}

      {zone === "projects" && (
        <aside className="sidebar">
          {brandBar}
          <button className="new" onClick={() => void openProject()}>
            {t("openProject")}
          </button>
          {searchBox}
          <div className="sessions" key={zone}>
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
                    {sortPinned(list).map(sessRow)}
                    <div className="newhere" onClick={() => void newSession(cwd)}>
                      {t("newHere")}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {footBar}
        </aside>
      )}

      {zone === "auto" && (
        <aside className="sidebar">
          {brandBar}
          <button className="new" onClick={() => setJobForm((f) => ({ ...f, open: true }))}>
            {t("addJob")}
          </button>
          <div className="sessions" key={zone}>
            {auto === "old-server" ? (
              <div className="autohint dim">{t("autoNeedsUpdate")}</div>
            ) : (
              <>
                <div className="group-h">{t("autoJobs")}</div>
                {(auto ? auto.jobs : []).map((j) => (
                  <div key={j.id} className={`trow ${j.enabled ? "" : "off"}`} title={j.schedule ?? ""}>
                    <span className={`tstat ${j.lastStatus ?? ""}`}>{j.lastStatus === "ok" ? "✓" : j.lastStatus === "error" ? "✗" : "○"}</span>
                    <span className="tname">{j.name}</span>
                  </div>
                ))}
                <div className="group-h" onClick={() => toggleGroup("__runs")}>
                  <span className="caret">{collapsed["__runs"] ? "▸" : "▾"}</span> {t("autoRuns")}
                  <span className="count">{auto ? auto.sessions.length : 0}</span>
                </div>
                {!collapsed["__runs"] &&
                  (auto ? auto.sessions : []).slice(0, 30).map((s) => (
                    <div key={s.id} className={`sess ${autoReplay?.id === s.id ? "on" : ""}`} onClick={() => void openReplay(s)}>
                      <div className="title">
                        <span className="botlab">{s.sourceName || s.source}</span> {botTitle(s) || t("untitled")}
                      </div>
                      <div className="meta">{s.updatedAt ? fmtTime(s.updatedAt) : ""}</div>
                    </div>
                  ))}
              </>
            )}
          </div>
          {footBar}
        </aside>
      )}

      {zone === "settings" && (
        <aside className="sidebar">
          {brandBar}
          <div className="sessions setlist" key={zone}>
            {(
              [
                ["engine", t("setServer")],
                ["security", t("setSecurity")],
                ["lang", t("setLang")],
                ["plugins", t("setPlugins")],
                ["skills", t("skills")],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className={`setnav ${setSec === k ? "on" : ""}`} onClick={() => setSetSec(k)}>
                {label}
              </div>
            ))}
          </div>
          {footBar}
        </aside>
      )}

      {/* ── main area ── */}
      {zone === "settings" ? (
        // ⚙ configure place — context column picked a group, the stage renders its forms
        <main className="chat board">
          <div className="scroll boardpad setstage">
            {setSec === "engine" && (
              <>
                <div className="bandhead">{t("setServer")}</div>
                <div className="setrow dim">
                  hara {server?.version} · {server?.provider}:{server?.model}
                </div>
                <div className="setrow">
                  <button
                    className="ghost"
                    onClick={async () => {
                      setUpd("…");
                      try {
                        const u = await checkForUpdate();
                        if (!u) return setUpd(t("upToDate"));
                        setUpd(`↓ ${u.version}`);
                        await u.downloadAndInstall();
                        setUpd(t("restartToApply"));
                      } catch (e: any) {
                        setUpd(String(e?.message ?? e).slice(0, 80));
                      }
                    }}
                  >
                    {t("checkUpdate")}
                  </button>
                  {upd && <span className="dim">{upd}</span>}
                </div>
              </>
            )}
            {setSec === "security" && (
              <>
                <div className="bandhead">{t("setSecurity")}</div>
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
              </>
            )}
            {setSec === "lang" && (
              <>
                <div className="bandhead">{t("setLang")}</div>
                <div className="setrow">
                  <button className={locale === "zh" ? "" : "ghost"} onClick={() => locale !== "zh" && flipLocale()}>
                    中文
                  </button>
                  <button className={locale === "en" ? "" : "ghost"} onClick={() => locale !== "en" && flipLocale()}>
                    EN
                  </button>
                </div>
              </>
            )}
            {setSec === "plugins" && (
              <>
                <div className="bandhead">{t("setPlugins")}</div>
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
              </>
            )}
            {setSec === "skills" && (
              <>
                <div className="bandhead">{t("skills")}</div>
                {(skills ?? []).map((s) => (
                  <div key={s.id} className="skill">
                    <span className="skill-id">{s.id}</span> <span className="dim">[{s.source}]</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </main>
      ) : zone === "auto" ? (
        // 🤖 the orchestration place — console density: job table on top, run timeline below;
        // a run opens as a READ-ONLY replay (fork is the only way to continue — automated
        // sessions never become live conversations here)
        <main className="chat board">
          {autoReplay ? (
            <>
              <div className="anchor">
                <button className="linky" onClick={() => setAutoReplay(null)}>
                  {t("backToBoard")}
                </button>
                <span className="botlab">{autoReplay.sourceName || "auto"}</span>
                <b className="rotitle">{autoReplay.title}</b>
                <span className="robadge">{t("readonlyAuto")}</span>
                <button className="paneltab" onClick={() => void continueManually()}>
                  ⑂ {t("forkFromHere")}
                </button>
              </div>
              <div className="scroll">
                {autoReplay.items.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="msg user ro">
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="msg assistant">
                      <Md text={m.text} />
                    </div>
                  ),
                )}
              </div>
            </>
          ) : (
            <div className="scroll boardpad">
              {auto === "old-server" ? (
                <div className="autohint dim">{t("autoNeedsUpdate")}</div>
              ) : (
                <>
                  <div className="bandhead">
                    {t("autoJobs")}
                    {!jobForm.open && (
                      <button className="paneltab" onClick={() => setJobForm((f) => ({ ...f, open: true }))}>
                        {t("addJob")}
                      </button>
                    )}
                  </div>
                  {jobForm.open && (
                    <div className="jobform wide">
                      <input placeholder={t("jobName")} value={jobForm.name} onChange={(e) => setJobForm((f) => ({ ...f, name: e.target.value }))} spellCheck={false} />
                      <input placeholder={t("jobSchedule")} value={jobForm.schedule} onChange={(e) => setJobForm((f) => ({ ...f, schedule: e.target.value }))} spellCheck={false} />
                      <input placeholder={t("jobTask")} value={jobForm.task} onChange={(e) => setJobForm((f) => ({ ...f, task: e.target.value }))} spellCheck={false} />
                      <button onClick={() => void submitJob()} disabled={!jobForm.name.trim() || !jobForm.schedule.trim() || !jobForm.task.trim()}>
                        {t("create")}
                      </button>
                      <button className="ghost" onClick={() => setJobForm((f) => ({ ...f, open: false }))}>
                        {t("cancel")}
                      </button>
                    </div>
                  )}
                  <table className="jobtable">
                    <thead>
                      <tr>
                        <th>{t("colStatus")}</th>
                        <th>{t("colName")}</th>
                        <th>{t("colSchedule")}</th>
                        <th>{t("colLast")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(auto ? auto.jobs : []).map((j) => (
                        <tr key={j.id} className={j.enabled ? "" : "off"}>
                          <td>
                            <span className={`tstat ${j.lastStatus ?? ""}`}>{j.lastStatus === "ok" ? "✓" : j.lastStatus === "error" ? "✗" : "○"}</span>
                          </td>
                          <td>{j.name}</td>
                          <td className="dim">{j.schedule ?? "—"}</td>
                          <td className="dim">{j.lastRunAt ? fmtTime(new Date(j.lastRunAt).toISOString()) : "—"}</td>
                          <td className="ops">
                            <span className="act" title={j.enabled ? "pause" : "resume"} onClick={() => void clientRef.current?.toggleAutomation(j.id, !j.enabled).then(refreshAuto)}>
                              {j.enabled ? "⏸" : "▶"}
                            </span>
                            <span className="act" title="delete" onClick={() => void clientRef.current?.deleteAutomation(j.id).then(refreshAuto)}>
                              ✕
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="bandhead">{t("autoRuns")}</div>
                  {(auto ? auto.sessions : []).length === 0 ? (
                    <div className="autohint dim">{t("noRuns")}</div>
                  ) : (
                    (auto ? auto.sessions : []).map((s) => (
                      <div key={s.id} className="trow click wide" onClick={() => void openReplay(s)}>
                        <span className="botlab">{s.sourceName || s.source}</span>
                        <span className="tname">{botTitle(s) || t("untitled")}</span>
                        <span className="ttime dim">{s.updatedAt ? fmtTime(s.updatedAt) : ""}</span>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          )}
        </main>
      ) : split && zone === "projects" ? (
        // the design/video loop: talk to the agent on the left, watch the live preview react on the right
        <div className="work">
          {conversation("ide")}
          <aside className="sidepanel">
            <div className="panelbar">
              <span className="dim">{split.title}</span>
              <span className="dim" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>{split.url}</span>
              <button className="ghost" title={t("openInWindow")} onClick={popOutSplit}>
                ⧉
              </button>
              <button className="ghost" onClick={() => setSplit(null)}>
                ✕
              </button>
            </div>
            <div className="framewrap">
              {splitLoading && <div className="frameload dim">{t("panelStarting")}</div>}
              <iframe className="panelframe" src={split.url} title={split.title} onLoad={() => setSplitLoading(false)} />
            </div>
          </aside>
        </div>
      ) : (
        conversation(zone === "chat" ? "im" : "ide")
      )}

    </div>
  );
}
