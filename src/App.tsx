// Hara Desktop — Tauri shell over `hara serve` (WS JSON-RPC). IA per the 2026-07-11 decision doc:
// a left icon RAIL switches four PHYSICAL places — 💬 global assistant (chat temperament,
// WeChat-synced workspace) · 📁 projects (IDE temperament, workspace groups) · 🤖 automations ·
// ⚙ settings. Places never share an active session; each has a permanent target anchor.
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import {
  HaraClient,
  type Discovery,
  type SessionInfo,
  type ServerEvent,
  type PluginInfo,
  type SkillInfo,
  type PanelSpec,
  type ProjectPanel,
  type CronJobInfo,
  type CtxInfo,
  type ProviderSettingsState,
  type TaskLifecycleEvent,
} from "./client";
import { detectLocale, saveLocale, makeT, type Locale } from "./i18n";
import { ProviderSettings } from "./ProviderSettings";
import { classifyEngineVersion } from "./engine-version.js";
import {
  isAssistantWorkspace as isAssistantCwd,
  sessionActivationAllowed,
  sessionPlace,
  type SessionPlace,
  type SessionPlaceInput,
} from "./session-place";
import { WorkStarter } from "./WorkStarter";
import {
  SettingsBadge,
  SettingsCard,
  SettingsItem,
  SettingsNotice,
  SettingsPage,
} from "./SettingsUI";
import { AppRail, type AppPlace } from "./AppRail";
import {
  ConversationTimeline,
  type ApprovalVerdict,
  type ConversationItem,
} from "./ConversationTimeline";
import {
  persistedUserTurnsFrom,
  resolveOptimisticUser,
  restoreAuthoritativeConversation,
} from "./conversation-state";
import { DesktopCompanionSettings } from "./companion/DesktopCompanionSettings";
import { useDesktopCompanion } from "./companion/useDesktopCompanion";
import { IconHome, IconEdit, IconArchive, IconStar, IconTrash, IconFork } from "./icons";
import { Md } from "./markdown";
import HaraLogo from "./mark";
import type {
  PetChatApproval,
  PetChatState,
  PetChatSubmit,
} from "./pets";
import {
  restoredTaskLifecycle,
  taskStateIsLive,
  taskStatePetStatus,
  taskStateTitle,
  type ResumedTaskSnapshot,
} from "./task-lifecycle";
import bundledEngineVersionText from "../src-tauri/binaries/SIDECAR_VERSION?raw";
import "./App.css";

type Phase = "boot" | "no-server" | "connecting" | "ready" | "lost";
// the four PLACES (顾雅 2026-07-11 four-places ruling): talk / work / orchestrate / configure
type Zone = AppPlace;

const plain = (s: string): string => s.replace(/\[[0-9;]*m/g, "");
/** Junk cwd guard: sessions left behind by tests/one-offs in OS temp dirs are NOT projects. */
const isJunkCwd = (cwd: string): boolean =>
  /^\/(private\/)?(tmp|var\/folders)\//.test(cwd) || /[/\\]tmp\.[A-Za-z0-9]+([/\\]|$)/.test(cwd) || /[/\\]hara-(test|dbg|serve)-[^/\\]*([/\\]|$)/.test(cwd);

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
const BUNDLED_ENGINE_VERSION = bundledEngineVersionText.trim();
const SERVER_BUSY = -32002;
const BUSY_SEND_RETRIES = 4;
const STEERING_HISTORY_PREFIX = "[Sent while you were working on the above — TRIAGE before continuing:";

interface QueuedInput {
  id: string;
  text: string;
  images?: { path: string }[];
  /** The optimistic transcript entry already exists; a later retry must not duplicate it. */
  recorded?: boolean;
}

const recentPetMessages = (items: ConversationItem[]): PetChatState["messages"] =>
  items
    .flatMap((item): PetChatState["messages"] => {
      if (item.kind === "user") return [{ role: "user", text: item.text.slice(0, 900) }];
      if (item.kind === "text") return [{ role: "assistant", text: plain(item.text).slice(0, 1_200) }];
      if (item.kind === "notice") return [{ role: "notice", text: plain(item.text).slice(0, 500) }];
      return [];
    })
    .slice(-6);

/** Serve persists steering with an internal triage wrapper for the model. Render only the user's text. */
const displayHistoryText = (text: string): string => {
  if (!text.startsWith(STEERING_HISTORY_PREFIX)) return text;
  const boundary = text.indexOf("]\n\n");
  return boundary >= 0 ? text.slice(boundary + 3) : text;
};

const conversationHistory = (
  history: { role: string; text: string }[],
): ConversationItem[] =>
  history.map((message): ConversationItem =>
    message.role === "user"
      ? { kind: "user", text: displayHistoryText(message.text) }
      : { kind: "text", text: message.text },
  );

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
  const bootstrapStartedRef = useRef(false);
  const plannedUpdateRestartRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("boot");
  const [server, setServer] = useState<{ pid: number; version: string; provider: string; model: string; cwd: string } | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, ConversationItem[]>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [taskStates, setTaskStates] = useState<Record<string, TaskLifecycleEvent>>({});
  const transcriptsRef = useRef(transcripts);
  const busyRef = useRef(busy);
  const taskStatesRef = useRef(taskStates);
  const activeTurnsRef = useRef<Record<string, string>>({});
  const pendingSendDispatchesRef = useRef<Record<string, {
    pendingId: string;
    turnId?: string;
    completed?: boolean;
  }>>({});
  const attachedSessionsRef = useRef(new Set<string>());
  transcriptsRef.current = transcripts;
  busyRef.current = busy;
  taskStatesRef.current = taskStates;
  const setSessionBusy = useCallback((sessionId: string, value: boolean) => {
    const next = { ...busyRef.current, [sessionId]: value };
    busyRef.current = next;
    setBusy(next);
  }, []);
  const [input, setInput] = useState("");
  const [modelInfo, setModelInfo] = useState<{ models: string[]; current: string; effortLevels: string[] } | null>(null);
  const [sessEffort, setSessEffort] = useState<Record<string, string>>({});
  const [defaultApproval, setDefaultApproval] = useState<string>(() => localStorage.getItem("hara.approval") || "");
  const [err, setErr] = useState("");
  const [zone, setZoneRaw] = useState<Zone>(() => (localStorage.getItem("hara.zone") as Zone) || "chat");
  const zoneRef = useRef<Zone>(zone);
  const sessionOpenRequestRef = useRef(0);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const pluginsRef = useRef<PluginInfo[] | null>(null);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [panelBusy, setPanelBusy] = useState("");
  const [starterBusy, setStarterBusy] = useState(false);
  const [engineRestarting, setEngineRestarting] = useState(false);
  // settings place: context column = group anchors, stage = the selected group's forms
  const [setSec, setSetSec] = useState<"providers" | "engine" | "security" | "lang" | "pets" | "plugins" | "skills">("providers");
  // chat ↔ live-preview split (project panels via manifest detect markers) — the design/video loop
  const [projPanels, setProjPanels] = useState<Record<string, ProjectPanel[]>>({});
  const [split, setSplit] = useState<{ plugin: string; id: string; title: string; url: string } | null>(null);
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
  const activeByZoneRef = useRef<Record<Extract<SessionPlace, "chat" | "projects">, string | null>>({
    chat: null,
    projects: null,
  });
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  useEffect(() => {
    pluginsRef.current = plugins;
  }, [plugins]);
  const rememberSession = (id: string, session: SessionPlaceInput) => {
    const place = sessionPlace(session);
    if (place === "chat" || place === "projects") activeByZoneRef.current[place] = id;
  };
  const activateSession = (id: string, hint?: SessionPlaceInput) => {
    const session = hint ?? sessionsRef.current.find((candidate) => candidate.id === id);
    if (session) rememberSession(id, session);
    setActive(id);
  };
  const clearActiveSession = (id: string) => {
    if (activeByZoneRef.current.chat === id) activeByZoneRef.current.chat = null;
    if (activeByZoneRef.current.projects === id) activeByZoneRef.current.projects = null;
    if (active === id) setActive(null);
  };
  const interruptedSessionsRef = useRef(new Set<string>());
  const openPetSessionRef = useRef<(sessionId: string) => Promise<void>>(async () => {});
  const petChatSubmitRef = useRef<(request: PetChatSubmit) => Promise<string | undefined>>(async () => undefined);
  const petChatApprovalRef = useRef<(request: PetChatApproval) => Promise<void>>(async () => {});
  const {
    awake: petAwake,
    setAwake: setPetAwake,
    selector: petSelector,
    setSelector: setPetSelector,
    catalog: petCatalog,
    catalogError: petCatalogError,
    refreshCatalog: refreshPets,
    note: notePet,
    acknowledge: acknowledgePet,
    clear: removePet,
    refreshChat: refreshPetChat,
  } = useDesktopCompanion({
    getActivityTitle: (sessionId) =>
      sessionsRef.current.find((session) => session.id === sessionId)?.title || "Hara task",
    onOpenActivity: (sessionId) => openPetSessionRef.current(sessionId),
    resolveChatSession: (requestedSessionId) => {
      if (requestedSessionId !== undefined) return requestedSessionId;
      return assistantZone(sessionsRef.current).current?.id;
    },
    getChatState: (sessionId, petStatus): PetChatState => {
      const target = sessionId;
      const session = target
        ? sessionsRef.current.find((candidate) => candidate.id === sessionId)
        : undefined;
      const unavailable = !!target && !session;
      const task = target ? taskStatesRef.current[target] : undefined;
      const transcript = target ? transcriptsRef.current[target] ?? [] : [];
      const pendingApproval = target && busyRef.current[target]
        ? [...transcript]
            .reverse()
            .find((item) => item.kind === "approval" && !item.answered)
        : undefined;
      const legacyState = pendingApproval
        ? "waiting"
        : petStatus === "idle"
          ? undefined
          : petStatus === "ready"
            ? "completed"
            : petStatus;
      const projectedTask: PetChatState["task"] = task
        ? {
            state: task.state,
            phase: task.phase,
            objective: task.objective,
            checkpoint: task.checkpoint,
            ...(task.approval ? { approval: task.approval } : {}),
          }
        : legacyState
          ? {
              state: legacyState,
              phase: pendingApproval ? "approval" : legacyState === "completed" ? "finished" : "legacy",
              objective: session?.title || (locale === "zh" ? "个人助理" : "Personal assistant"),
              checkpoint: { done: 0, total: 0 },
              ...(pendingApproval?.kind === "approval"
                ? { approval: { id: pendingApproval.approvalId, question: pendingApproval.question } }
                : {}),
            }
          : undefined;
      const connected = !!clientRef.current?.connected && phase === "ready";
      return {
        connected,
        canSubmit: connected && !unavailable && (!session || !isAutomated(session)),
        ...(unavailable ? { unavailable: true } : {}),
        locale,
        ...(target ? { sessionId: target } : {}),
        title: session?.title || (
          unavailable
            ? locale === "zh" ? "会话不可用" : "Conversation unavailable"
            : locale === "zh" ? "个人助理" : "Personal assistant"
        ),
        petStatus,
        ...(projectedTask ? { task: projectedTask } : {}),
        messages: recentPetMessages(transcript),
      };
    },
    onChatSubmit: (request) => petChatSubmitRef.current(request),
    onChatApproval: (request) => petChatApprovalRef.current(request),
  });
  const hydrateLegacyTaskState = useCallback((
    client: HaraClient,
    sessionId: string,
    task?: ResumedTaskSnapshot,
  ) => {
    if (!task || client.supportsEvent("event.task_state")) return;
    const event = restoredTaskLifecycle(sessionId, task);
    const nextTaskStates = { ...taskStatesRef.current, [sessionId]: event };
    taskStatesRef.current = nextTaskStates;
    setTaskStates(nextTaskStates);
    const live = taskStateIsLive(event.state);
    if (live) activeTurnsRef.current[sessionId] = event.turnId;
    else delete activeTurnsRef.current[sessionId];
    setSessionBusy(sessionId, live);
    if (event.state === "completed") removePet(sessionId);
    else notePet(sessionId, taskStatePetStatus(event.state), taskStateTitle(event));
  }, [notePet, removePet, setSessionBusy]);
  useEffect(() => {
    refreshPetChat();
  }, [active, locale, phase, refreshPetChat, sessions, taskStates, transcripts]);
  const [q, setQ] = useState("");
  const [upd, setUpd] = useState("");
  const [updateTone, setUpdateTone] = useState<"neutral" | "success" | "warning" | "error">("neutral");
  const [updating, setUpdating] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [desktopVersion, setDesktopVersion] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [updAvail, setUpdAvail] = useState("");
  const pendingRef = useRef<"assistant" | "project" | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const apiRef = useRef<{ setZone: (z: Zone) => void; openAssistant: () => void; openProject: () => void }>({ setZone: () => {}, openAssistant: () => {}, openProject: () => {} });
  // steer queue (codex composer pattern): inputs typed while a turn runs are queued and auto-sent.
  // Attachments stay with their text as one fresh turn because session.steer is deliberately text-only.
  const [queue, setQueue] = useState<Record<string, QueuedInput[]>>({});
  const queueRef = useRef(queue);
  const pendingInputSequenceRef = useRef(0);
  const retryingQueuedInputsRef = useRef(new Set<string>());
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
    if ((zone === "chat" || zone === "projects") && active) {
      const current = sessionsRef.current.find((candidate) => candidate.id === active);
      if (current && sessionPlace(current) === zone) activeByZoneRef.current[zone] = active;
    }
    zoneRef.current = z;
    sessionOpenRequestRef.current += 1;
    setZoneRaw(z);
    setSplit(null);
    setAutoReplay(null);
    localStorage.setItem("hara.zone", z);
    if (z === "chat" || z === "projects") {
      const candidateId = activeByZoneRef.current[z];
      const candidate = candidateId ? sessionsRef.current.find((session) => session.id === candidateId) : undefined;
      setActive(candidate && sessionPlace(candidate) === z ? candidate.id : null);
    } else {
      setActive(null);
    }
    if (z === "settings" && clientRef.current) {
      void Promise.all([clientRef.current.listPlugins(), clientRef.current.listSkills()]).then(([pl, sk]) => {
        setPlugins(pl.plugins);
        setSkills(sk.skills);
      });
      void refreshPets();
    }
    if (z === "auto" && clientRef.current) {
      void clientRef.current.listAutomation().then((a) => setAuto(a ?? "old-server")).catch(() => {});
      markAutoSeen();
    }
  };

  const push = useCallback(
    (sessionId: string, mut: (items: ConversationItem[]) => ConversationItem[]) => {
      setTranscripts((tr) => {
        const next = { ...tr, [sessionId]: mut(tr[sessionId] ?? []) };
        transcriptsRef.current = next;
        return next;
      });
    },
    [],
  );

  const nextPendingInputId = useCallback(
    () => `pending-${Date.now()}-${++pendingInputSequenceRef.current}`,
    [],
  );

  const resolvePendingUser = useCallback((
    sessionId: string,
    pendingId: string,
    accepted: boolean,
  ) => {
    push(sessionId, (items) => resolveOptimisticUser(items, pendingId, accepted));
  }, [push]);

  const enqueueInput = useCallback((
    sessionId: string,
    input: QueuedInput,
    position: "front" | "back" = "back",
  ) => {
    setQueue((queues) => {
      const current = queues[sessionId] ?? [];
      const next = {
        ...queues,
        [sessionId]: position === "front" ? [input, ...current] : [...current, input],
      };
      queueRef.current = next;
      return next;
    });
  }, []);

  const cancelQueuedInput = useCallback((sessionId: string, index: number) => {
    const current = queueRef.current[sessionId] ?? [];
    const removed = current[index];
    if (!removed) return;
    const next = {
      ...queueRef.current,
      [sessionId]: current.filter((_, queuedIndex) => queuedIndex !== index),
    };
    queueRef.current = next;
    setQueue(next);
    if (removed.recorded) {
      push(sessionId, (items) => [...resolveOptimisticUser(items, removed.id, false), {
        kind: "notice",
        text: locale === "zh" ? "已取消尚未执行的补充消息。" : "Canceled the queued follow-up before it ran.",
      }]);
    }
  }, [locale, push]);

  const sendText = useCallback(
    async (
      sessionId: string,
      text: string,
      images?: { path: string }[],
      options?: {
        recordUser?: boolean;
        requeueFrontOnBusy?: boolean;
        pendingId?: string;
      },
    ) => {
      const c = clientRef.current;
      if (!c?.connected) throw new Error("Hara engine is not connected");
      const pendingId = options?.pendingId ?? nextPendingInputId();
      if (options?.recordUser !== false) {
        push(sessionId, (items) => [...items, {
          kind: "user",
          text: images?.length ? `${text}  🖼×${images.length}` : text,
          pendingId,
        }]);
      }
      setSessionBusy(sessionId, true);
      notePet(sessionId, "running");
      let busyAttempt = 0;
      const clearPendingDispatch = () => {
        if (pendingSendDispatchesRef.current[sessionId]?.pendingId === pendingId) {
          delete pendingSendDispatchesRef.current[sessionId];
        }
      };
      while (true) {
        pendingSendDispatchesRef.current[sessionId] = { pendingId };
        try {
          await c.send(sessionId, text, images);
          clearPendingDispatch();
          resolvePendingUser(sessionId, pendingId, true);
          if (interruptedSessionsRef.current.delete(sessionId)) removePet(sessionId);
          // the first turn sets the server-side derived title — refresh so the sidebar shows it now
          void c.listSessions().then((l) => setSessions(l.sessions)).catch(() => {});
          return;
        } catch (e: any) {
          const interrupted = interruptedSessionsRef.current.delete(sessionId);
          if (e?.code === SERVER_BUSY && !interrupted) {
            let turnId = activeTurnsRef.current[sessionId];
            let taskState = taskStatesRef.current[sessionId];
            let live = !!turnId || (taskState ? taskStateIsLive(taskState.state) : false);
            if (!live && busyAttempt < BUSY_SEND_RETRIES) {
              // Provider reconfiguration and turn-start delivery can briefly set BUSY before a lifecycle
              // identity is observable. Retry only within this hard bound; never leave the UI spinning forever.
              busyAttempt += 1;
              await new Promise<void>((resolve) => window.setTimeout(resolve, busyAttempt * 120));
              turnId = activeTurnsRef.current[sessionId];
              taskState = taskStatesRef.current[sessionId];
              live = !!turnId || (taskState ? taskStateIsLive(taskState.state) : false);
              if (!live) continue;
            }
            if (!images?.length && turnId && c.supports("session.steer")) {
              // The attempted session.send did not start a turn. A following turn_end belongs to the
              // existing turn and must never acknowledge this optimistic message.
              clearPendingDispatch();
              try {
                await c.steer(sessionId, text, turnId);
                resolvePendingUser(sessionId, pendingId, true);
                notePet(sessionId, "running");
                return;
              } catch (steerError: any) {
                if (steerError?.code !== SERVER_BUSY) {
                  push(sessionId, (items) => [...items, {
                    kind: "notice",
                    text: `error: ${steerError?.message ?? steerError}`,
                  }]);
                  setSessionBusy(sessionId, false);
                  notePet(sessionId, "blocked");
                  return;
                }
                const currentTurnId = activeTurnsRef.current[sessionId];
                const currentState = taskStatesRef.current[sessionId];
                live = !!currentTurnId || (
                  currentState ? taskStateIsLive(currentState.state) : false
                );
                if (!live) {
                  busyAttempt = 0;
                  continue;
                }
              }
            }
            // A real live turn will auto-dispatch on turn_end. If BUSY had no observable task after the
            // bounded retries, keep the exact input visible but release the false busy state so Retry works.
            clearPendingDispatch();
            enqueueInput(
              sessionId,
              { id: pendingId, text, ...(images?.length ? { images } : {}), recorded: true },
              options?.requeueFrontOnBusy ? "front" : "back",
            );
            if (!live) {
              setSessionBusy(sessionId, false);
              notePet(sessionId, "paused", "Message queued — engine is still preparing");
            }
            return;
          }
          const dispatch = pendingSendDispatchesRef.current[sessionId];
          const persisted = dispatch?.pendingId === pendingId && dispatch.completed === true;
          clearPendingDispatch();
          if (persisted) resolvePendingUser(sessionId, pendingId, true);
          push(sessionId, (items) => [...items, { kind: "notice", text: `error: ${e?.message ?? e}` }]);
          setSessionBusy(sessionId, false);
          if (c.supportsEvent("event.task_state")) {
            const state = taskStatesRef.current[sessionId];
            if (!state || taskStateIsLive(state.state)) {
              if (interrupted) removePet(sessionId);
              else notePet(sessionId, "blocked");
            }
          } else if (!interrupted) notePet(sessionId, "blocked");
          else removePet(sessionId);
          return;
        }
      }
    },
    [enqueueInput, nextPendingInputId, notePet, push, removePet, resolvePendingUser, setSessionBusy],
  );

  const retryQueuedInput = useCallback(async (sessionId: string, index: number) => {
    if (busyRef.current[sessionId]) return;
    const current = queueRef.current[sessionId] ?? [];
    const retry = current[index];
    if (!retry) return;
    const retryKey = `${sessionId}:${retry.id}`;
    if (retryingQueuedInputsRef.current.has(retryKey)) return;
    retryingQueuedInputsRef.current.add(retryKey);
    const c = clientRef.current;
    try {
      if (!c) throw new Error("Hara engine is not connected");
      if (!attachedSessionsRef.current.has(sessionId)) {
        // A reconnect invalidates every live serve attachment. Keep the queue item until resume has
        // succeeded so NO_SESSION can never turn a visible retry into dropped work.
        const resumed = await c.resumeSession(sessionId);
        if (clientRef.current !== c) throw new Error("Hara engine reconnected; retry the message again");
        attachedSessionsRef.current.add(sessionId);
        const currentTranscripts = transcriptsRef.current;
        const nextTranscripts = {
          ...currentTranscripts,
          [sessionId]: restoreAuthoritativeConversation(
            conversationHistory(resumed.history),
            currentTranscripts[sessionId] ?? [],
          ),
        };
        transcriptsRef.current = nextTranscripts;
        setTranscripts(nextTranscripts);
        hydrateLegacyTaskState(c, sessionId, resumed.task);
      }
      const latest = queueRef.current[sessionId] ?? [];
      const retryIndex = latest.findIndex((item) => item.id === retry.id);
      if (retryIndex < 0) return;
      const next = {
        ...queueRef.current,
        [sessionId]: latest.filter((_, queuedIndex) => queuedIndex !== retryIndex),
      };
      queueRef.current = next;
      setQueue(next);
      await sendText(
        sessionId,
        retry.text,
        retry.images,
        {
          recordUser: retry.recorded !== true,
          pendingId: retry.id,
        },
      );
    } catch (error: any) {
      push(sessionId, (items) => [...items, {
        kind: "notice",
        text: `retry: ${error?.message ?? error}`,
      }]);
      notePet(sessionId, "paused");
    } finally {
      retryingQueuedInputsRef.current.delete(retryKey);
    }
  }, [hydrateLegacyTaskState, notePet, push, sendText]);

  /** Submit against the authoritative execution plane. A live turn receives real `session.steer`;
   * only the end-of-turn race falls back to the visible queue, so user input is never rejected or lost. */
  const submitSessionText = useCallback(
    async (sessionId: string, text: string): Promise<"sent" | "steered" | "queued"> => {
      const c = clientRef.current;
      if (!c) throw new Error("Hara engine is not connected");
      const state = taskStatesRef.current[sessionId];
      const turnId = state?.taskStatus === "running"
        ? state.turnId
        : activeTurnsRef.current[sessionId];
      let live = busyRef.current[sessionId] || (
        state ? taskStateIsLive(state.state) : false
      );
      if (live && turnId && c.supports("session.steer")) {
        try {
          await c.steer(sessionId, text, turnId);
          push(sessionId, (items) => [...items, { kind: "user", text }]);
          notePet(sessionId, "running");
          return "steered";
        } catch (error: any) {
          if (error?.code !== SERVER_BUSY) throw error;
          // The turn may have ended and emitted its sole queue-drain event before this rejection arrived.
          // Re-read the synchronous execution refs: a finished turn must receive a fresh send now.
          const currentTurnId = activeTurnsRef.current[sessionId];
          const currentState = taskStatesRef.current[sessionId];
          live = !!currentTurnId || (currentState ? taskStateIsLive(currentState.state) : false);
          if (!live) {
            await sendText(sessionId, text);
            return "sent";
          }
        }
      }
      if (live) {
        const pendingId = nextPendingInputId();
        push(sessionId, (items) => [...items, { kind: "user", text, pendingId }]);
        enqueueInput(sessionId, { id: pendingId, text, recorded: true });
        notePet(sessionId, "running");
        return "queued";
      }
      await sendText(sessionId, text);
      return "sent";
    },
    [enqueueInput, nextPendingInputId, notePet, push, sendText],
  );

  const handleEvent = useCallback(
    (e: ServerEvent) => {
      switch (e.method) {
        case "event.turn_start":
          if (e.turnId) {
            activeTurnsRef.current[e.sessionId] = e.turnId;
            const dispatch = pendingSendDispatchesRef.current[e.sessionId];
            if (dispatch && !dispatch.turnId) dispatch.turnId = e.turnId;
          }
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          setSessionBusy(e.sessionId, true);
          break;
        case "event.task_state": {
          const nextTaskStates = { ...taskStatesRef.current, [e.sessionId]: e };
          taskStatesRef.current = nextTaskStates;
          setTaskStates(nextTaskStates);
          const live = taskStateIsLive(e.state);
          if (live) activeTurnsRef.current[e.sessionId] = e.turnId;
          else delete activeTurnsRef.current[e.sessionId];
          setSessionBusy(e.sessionId, live);
          const title = taskStateTitle(e);
          if (e.phase === "restored" && e.state === "completed") {
            // A restored terminal snapshot hydrates state; it is not a new completion notification.
            // Clear any stale disconnect/blocked activity left by the previous transport.
            removePet(e.sessionId);
          } else if (e.state === "completed" && e.sessionId === activeRef.current && document.hasFocus()) {
            removePet(e.sessionId);
          } else {
            notePet(e.sessionId, taskStatePetStatus(e.state), title);
          }
          break;
        }
        case "event.text":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => {
            const last = items[items.length - 1];
            if (last?.kind === "text") return [...items.slice(0, -1), { kind: "text", text: last.text + e.delta }];
            return [...items, { kind: "text", text: e.delta }];
          });
          break;
        case "event.reasoning":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => {
            const last = items[items.length - 1];
            if (last?.kind === "reasoning") return [...items.slice(0, -1), { kind: "reasoning", text: last.text + e.delta }];
            return [...items, { kind: "reasoning", text: e.delta }];
          });
          break;
        case "event.tool":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => [...items, { kind: "tool", name: e.name, preview: plain(e.preview) }]);
          break;
        case "event.notice":
          push(e.sessionId, (items) => [...items, { kind: "notice", text: plain(e.text) }]);
          break;
        case "event.diff":
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "running");
          push(e.sessionId, (items) => [...items, { kind: "diff", text: plain(e.text) }]);
          break;
        case "event.turn_end": {
          const dispatch = pendingSendDispatchesRef.current[e.sessionId];
          if (dispatch?.turnId && e.turnId === dispatch.turnId) {
            dispatch.completed = true;
            resolvePendingUser(e.sessionId, dispatch.pendingId, true);
          }
          delete activeTurnsRef.current[e.sessionId];
          push(e.sessionId, (items) => [
            ...items.map((item): ConversationItem =>
              item.kind === "approval" && !item.answered
                ? { ...item, answered: "expired" }
                : item,
            ),
            { kind: "end", usage: e.usage },
          ]);
          setSessionBusy(e.sessionId, false);
          if (e.ctx) setCtxMap((m) => ({ ...m, [e.sessionId]: e.ctx! }));
          const interrupted = interruptedSessionsRef.current.has(e.sessionId);
          const failed = !!e.error || (!!e.status && e.status !== "completed");
          if (clientRef.current?.supportsEvent("event.task_state")) {
            interruptedSessionsRef.current.delete(e.sessionId);
          } else if (interrupted) removePet(e.sessionId);
          else if (failed) notePet(e.sessionId, "blocked");
          else if (e.sessionId === activeRef.current && document.hasFocus()) removePet(e.sessionId);
          else notePet(e.sessionId, "ready");
          // steer queue: auto-dispatch the next queued message for this session
          const pending = queueRef.current[e.sessionId];
          if (pending && pending.length > 0) {
            const [next, ...rest] = pending;
            // Hold the session locally across the short drain handoff. A composer submit that lands
            // in this window must queue behind `next`, never overtake it as a fresh session.send.
            setSessionBusy(e.sessionId, true);
            setQueue((queues) => {
              const updated = { ...queues, [e.sessionId]: rest };
              queueRef.current = updated;
              return updated;
            });
            setTimeout(
              () => void sendText(
                  e.sessionId,
                  next.text,
                  next.images,
                  {
                    recordUser: next.recorded !== true,
                    requeueFrontOnBusy: true,
                    pendingId: next.id,
                  },
                )
                .catch((error) => {
                  enqueueInput(e.sessionId, next, "front");
                  setSessionBusy(e.sessionId, false);
                  notePet(e.sessionId, "paused");
                  push(e.sessionId, (items) => [...items, {
                    kind: "notice",
                    text: `retry: ${error instanceof Error ? error.message : String(error)}`,
                  }]);
                }),
              50,
            );
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
          if (!clientRef.current?.supportsEvent("event.task_state")) notePet(e.sessionId, "waiting");
          push(e.sessionId, (items) => [...items, { kind: "approval", approvalId: e.approvalId, question: plain(e.question) }]);
          if (e.sessionId !== activeRef.current) setUnread((u) => ({ ...u, [e.sessionId]: true }));
          break;
      }
    },
    [enqueueInput, notePet, push, removePet, resolvePendingUser, sendText, setSessionBusy],
  );

  const connect = useCallback(async (expectedPid: number | null = null) => {
    const generation = ++connectGenerationRef.current;
    const stale = () => generation !== connectGenerationRef.current;
    const previous = clientRef.current;
    clientRef.current = null;
    attachedSessionsRef.current.clear();
    pendingSendDispatchesRef.current = {};
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
      // A start request may race a stale discovery file left by an earlier Windows process. Only
      // the child we just spawned is allowed to satisfy that startup handshake.
      if (expectedPid !== null && d.pid !== expectedPid) {
        setPhase("no-server");
        return;
      }
      c = new HaraClient();
      c.onEvent = handleEvent;
      c.onClose = () => {
        if (clientRef.current !== c) return;
        clientRef.current = null;
        if (plannedUpdateRestartRef.current) return;
        for (const [sessionId, running] of Object.entries(busyRef.current)) {
          if (running) notePet(sessionId, "blocked", "Hara engine disconnected");
        }
        activeTurnsRef.current = {};
        attachedSessionsRef.current.clear();
        pendingSendDispatchesRef.current = {};
        taskStatesRef.current = {};
        setTaskStates({});
        busyRef.current = {};
        setBusy({});
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
      setServer({ pid: d.pid, version: info.version, provider: info.provider, model: info.model, cwd: info.cwd });
      sessionsRef.current = list.sessions;
      setSessions(list.sessions);
      const needsCredentials = info.setupState === "needs-credentials";
      setSetupRequired(needsCredentials);
      if (needsCredentials) {
        zoneRef.current = "settings";
        sessionOpenRequestRef.current += 1;
        setZoneRaw("settings");
        setSetSec("providers");
      }
      // cold start: returning users land on their last zone; brand-new (no manual sessions, no
      // opened projects) land on the assistant — the soft first touch.
      const manual = list.sessions.filter((s) => !isAutomated(s) && !isAssistantCwd(s.cwd));
      if (info.setupState !== "needs-credentials" && manual.length === 0 && openedProjects.length === 0) {
        zoneRef.current = "chat";
        sessionOpenRequestRef.current += 1;
        setZoneRaw("chat");
      }
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
    if (phase !== "ready" || setupRequired || !pendingRef.current) return;
    const act = pendingRef.current;
    pendingRef.current = null;
    if (act === "assistant") void apiRef.current.openAssistant();
    else void apiRef.current.openProject();
  }, [phase, setupRequired]);

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
    void getVersion().then(setDesktopVersion).catch(() => {});
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
      const pid = await invoke<number>("start_serve");
      setPhase("connecting");
      let up = false;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const raw = await invoke<string | null>("read_discovery");
        if (raw) {
          try {
            const discovery: Discovery = JSON.parse(raw);
            if (discovery.pid === pid) {
              up = true;
              break;
            }
          } catch {
            // Serve writes discovery atomically, but tolerate a malformed/stale local file while
            // the new child is still starting and keep polling for its authenticated endpoint.
          }
        }
      }
      if (!up) {
        const log = await invoke<string>("read_serve_log").catch(() => "");
        // Old serves exited before exposing the secure provider-settings RPC. Do not fall back to a
        // second config writer in Rust; the user explicitly gets an upgrade path instead.
        if (/not authenticated/i.test(log)) {
          setErr("This Hara Desktop includes an engine that is too old for model settings. Update Hara Desktop and restart it.");
          setPhase("no-server");
          return;
        }
        setErr(log ? `hara serve did not come up. Log tail:\n${log}` : "hara serve did not come up (no log)");
        setPhase("no-server");
        return;
      }
      await connect(pid);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setPhase("no-server");
    }
  };

  useEffect(() => {
    // React StrictMode runs effects twice in development. Consume the native one-shot marker and
    // choose the launch path once per renderer lifetime: ordinary launches only discover; an
    // updater relaunch starts the newly bundled sidecar before reconnecting.
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    void invoke<boolean>("take_update_restart_marker")
      .then((updateRestart) => (updateRestart ? startServer() : connect()))
      .catch(() => connect());
    // `startServer` intentionally participates only in this one-shot bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  useEffect(
    () => () => {
      connectGenerationRef.current += 1;
      const client = clientRef.current;
      clientRef.current = null;
      client?.close();
    },
    [],
  );

  const refreshSessions = async () => {
    const c = clientRef.current;
    if (!c) return;
    const list = await c.listSessions();
    // Keep imperative routing in sync before React commits the state update. Fork → refresh → setZone
    // happens in one async continuation and must be able to select the newly returned session.
    sessionsRef.current = list.sessions;
    setSessions(list.sessions);
  };

  const newSession = async (cwd?: string): Promise<string | null> => {
    const c = clientRef.current;
    if (!c) return null;
    const sessionHint = { cwd: cwd ?? server?.cwd ?? "", source: "interactive" };
    const requestId = ++sessionOpenRequestRef.current;
    const r = await c.createSession({ ...(cwd ? { cwd } : {}), ...(defaultApproval ? { approval: defaultApproval } : {}) });
    attachedSessionsRef.current.add(r.sessionId);
    rememberSession(r.sessionId, sessionHint);
    if (sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, sessionHint)) {
      setActive(r.sessionId);
    }
    setTranscripts((tr) => ({ ...tr, [r.sessionId]: [] }));
    await refreshSessions();
    return r.sessionId;
  };

  const openSession = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    const session = sessionsRef.current.find((candidate) => candidate.id === id);
    const expected = session ?? {
      cwd: zoneRef.current === "chat" && home ? `${home}/.hara/workspace` : server?.cwd ?? "",
      source: "interactive",
    };
    const requestId = ++sessionOpenRequestRef.current;
    const mayActivate = () =>
      sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, expected);
    setUnread((u) => ({ ...u, [id]: false }));
    acknowledgePet(id);
    if (transcriptsRef.current[id] && attachedSessionsRef.current.has(id)) {
      if (mayActivate()) activateSession(id, expected);
      return;
    }
    try {
      const r = await c.resumeSession(id);
      attachedSessionsRef.current.add(id);
      hydrateLegacyTaskState(c, id, r.task);
      setTranscripts((tr) => ({
        ...tr,
        [id]: r.history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
      }));
      if (mayActivate()) {
        activateSession(id, expected);
        acknowledgePet(id);
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  /** Open an automated run as a READ-ONLY replay in the automation place. */
  const openReplay = async (session: {
    id: string;
    title: string;
    sourceName?: string;
    cwd: string;
  }) => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const result = await c.resumeSession(session.id);
      attachedSessionsRef.current.add(session.id);
      setAutoReplay({
        id: session.id,
        title: session.title,
        sourceName: session.sourceName,
        cwd: session.cwd,
        items: result.history.map((message) => ({
          ...message,
          text: message.role === "user"
            ? displayHistoryText(message.text)
            : message.text,
        })),
      });
    } catch (error: any) {
      setErr(String(error?.message ?? error));
    }
  };

  openPetSessionRef.current = async (sessionId: string) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
    if (session) {
      const place = sessionPlace(session);
      if (place === "auto") {
        acknowledgePet(sessionId);
        setZone("auto");
        await openReplay(session);
        return;
      }
      setZone(place);
    }
    await openSession(sessionId);
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
  const openAssistant = async (): Promise<string | null> => {
    setZone("chat");
    const cur = assistantZone(sessionsRef.current).current;
    if (cur) {
      await openSession(cur.id);
      return cur.id;
    }
    if (!home || creatingRef.current) return null;
    creatingRef.current = true;
    try {
      return await newSession(`${home}/.hara/workspace`);
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
    setTranscripts((tr) => {
      const next = {
        ...tr,
        [sessionId]: [
        ...history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
        ...(tailNotice
          ? [{ kind: "notice", text: tailNotice } as ConversationItem]
          : []),
        ],
      };
      transcriptsRef.current = next;
      return next;
    });
  };

  const compactNow = async () => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    setSessionBusy(active, true);
    try {
      const r = await c.compactSession(active);
      loadHistory(active, r.history, t("compacted"));
      setCtxMap((m) => ({ ...m, [active]: r.ctx }));
    } catch (e: any) {
      push(active, (items) => [...items, { kind: "notice", text: `compact: ${e?.message ?? e}` }]);
    } finally {
      setSessionBusy(active, false);
    }
  };

  /** Rewind to before the user message at transcript index i (codex thread/rollback). */
  const rewindHere = async (i: number) => {
    const c = clientRef.current;
    if (!c || !active || busy[active]) return;
    if (!window.confirm(t("rewindConfirm"))) return;
    const items = transcripts[active] ?? [];
    const n = persistedUserTurnsFrom(items, i); // n-th-most-recent server-persisted user turn
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
    const sessionId = active;
    const imagePaths = pendImgs;
    setInput("");
    setAc((a) => ({ ...a, open: false }));
    if (busy[sessionId] && imagePaths.length > 0) {
      const images = imagePaths.map((path) => ({ path }));
      setPendImgs([]);
      enqueueInput(sessionId, {
        id: nextPendingInputId(),
        text: text || "(image)",
        images,
      });
      return;
    }
    const imgs = imagePaths.map((path) => ({ path }));
    setPendImgs([]);
    try {
      if (imgs.length) await sendText(sessionId, text || "(image)", imgs);
      else await submitSessionText(sessionId, text);
    } catch (error: any) {
      if (text) setInput((draft) => draft ? `${text}\n${draft}` : text);
      if (imagePaths.length) {
        setPendImgs((current) => [
          ...imagePaths.filter((path) => !current.includes(path)),
          ...current,
        ]);
      }
      setErr(String(error?.message ?? error));
    }
  };

  const startFromWorkbench = async (prompt: string) => {
    if (starterBusy) return;
    setStarterBusy(true);
    setErr("");
    try {
      const sessionId = await openAssistant();
      if (!sessionId) throw new Error(locale === "zh" ? "工作助理尚未准备好，请稍后重试。" : "The work assistant is not ready yet. Please try again.");
      await sendText(sessionId, prompt);
    } catch (error: any) {
      setErr(String(error?.message ?? error));
    } finally {
      setStarterBusy(false);
    }
  };

  const answer = async (
    sessionId: string,
    approvalId: string,
    verdict: ApprovalVerdict,
  ) => {
    const c = clientRef.current;
    if (!c?.connected) {
      throw new Error(
        locale === "zh"
          ? "Hara 引擎已断开，审批未提交。重新连接后请重新确认。"
          : "The Hara engine disconnected, so the approval was not submitted. Reconnect and review it again.",
      );
    }
    await c.approvalReply(approvalId, verdict !== "deny", verdict === "always");
    if (!c.supportsEvent("event.task_state")) notePet(sessionId, "running");
    push(sessionId, (items) => items.map((it) => (it.kind === "approval" && it.approvalId === approvalId ? { ...it, answered: verdict } : it)));
  };

  petChatSubmitRef.current = async (request: PetChatSubmit): Promise<string | undefined> => {
    const text = request.text.trim();
    if (!text) return request.sessionId;
    const c = clientRef.current;
    if (!c) throw new Error(locale === "zh" ? "Hara 引擎尚未连接。" : "The Hara engine is not connected.");
    let sessionId = request.sessionId;
    const requestedSession = sessionId
      ? sessionsRef.current.find((session) => session.id === sessionId)
      : undefined;
    if (sessionId && !requestedSession) {
      throw new Error(locale === "zh" ? "原会话已不可用，请关闭聊天后重新打开。" : "The original conversation is unavailable. Close and reopen the chat.");
    }
    if (requestedSession && isAutomated(requestedSession)) {
      throw new Error(locale === "zh" ? "自动任务记录是只读的，请在主窗口创建分支后继续。" : "Automated runs are read-only. Fork one in the main window to continue.");
    }
    if (!sessionId) sessionId = await openAssistant() || undefined;
    if (!sessionId) throw new Error(locale === "zh" ? "个人助理尚未准备好。" : "The personal assistant is not ready yet.");

    const task = taskStatesRef.current[sessionId];
    const live = busyRef.current[sessionId] || (
      task ? taskStateIsLive(task.state) : false
    );
    if (!live && !attachedSessionsRef.current.has(sessionId)) {
      // session.list contains persisted metadata, not a live serve attachment. Resume before the
      // companion dispatches so a cold Desktop start cannot acknowledge a doomed NO_SESSION send.
      const resumed = await c.resumeSession(sessionId);
      attachedSessionsRef.current.add(sessionId);
      hydrateLegacyTaskState(c, sessionId, resumed.task);
      loadHistory(sessionId, resumed.history);
    }
    if (live) {
      await submitSessionText(sessionId, text);
    } else {
      // Starting a normal turn can take minutes. The companion acknowledges local dispatch immediately;
      // transcript/task events stream the real progress and any later failure back into the same window.
      void submitSessionText(sessionId, text).catch((error) => setErr(String(error)));
    }
    return sessionId;
  };

  petChatApprovalRef.current = async (request: PetChatApproval): Promise<void> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === request.sessionId);
    if (!session || isAutomated(session)) {
      throw new Error(locale === "zh" ? "该会话不能从桌面伙伴确认。" : "This conversation cannot be approved from the companion.");
    }
    const typedApproval = taskStatesRef.current[request.sessionId]?.approval?.id;
    const legacyApproval = [...(transcriptsRef.current[request.sessionId] ?? [])]
      .reverse()
      .find((item) => item.kind === "approval" && !item.answered);
    const expectedApprovalId = typedApproval || (
      legacyApproval?.kind === "approval" ? legacyApproval.approvalId : undefined
    );
    if (!expectedApprovalId || expectedApprovalId !== request.approvalId) {
      throw new Error(locale === "zh" ? "这条确认已过期，请刷新状态。" : "This approval is stale. Refresh the conversation state.");
    }
    await answer(request.sessionId, request.approvalId, request.allow ? "allow" : "deny");
  };

  const stopTurn = async (sessionId: string) => {
    const c = clientRef.current;
    if (!c) return;
    interruptedSessionsRef.current.add(sessionId);
    try {
      await c.interrupt(sessionId);
    } catch (error) {
      interruptedSessionsRef.current.delete(sessionId);
      setErr(String(error));
    }
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
  const openPanel = async (pluginName: string, spec: PanelSpec) => {
    if (pluginsRef.current?.find((plugin) => plugin.name === pluginName)?.enabled !== true) {
      setErr(locale === "zh" ? "该能力已停用，不能启动它的工作面板。" : "This capability is disabled, so its work panel cannot be started.");
      return;
    }
    setPanelBusy(spec.id);
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [], cwd: null, portHint: spec.port ?? null });
      zoneRef.current = "projects";
      sessionOpenRequestRef.current += 1;
      setZoneRaw("projects");
      localStorage.setItem("hara.zone", "projects");
      setSplitLoading(true);
      setSplit({ plugin: pluginName, id: spec.id, title: spec.title, url });
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
    const plugin = pluginsRef.current?.find((candidate) => candidate.name === spec.plugin);
    if (plugin && !plugin.enabled) {
      setErr(locale === "zh" ? "该能力已停用，不能启动它的工作面板。" : "This capability is disabled, so its work panel cannot be started.");
      return;
    }
    setPanelBusy(spec.id);
    try {
      const url = await invoke<string>("start_panel", { command: spec.command, args: spec.args ?? [], cwd, portHint: spec.port ?? null });
      setSplitLoading(true);
      setSplit({ plugin: spec.plugin, id: spec.id, title: spec.title, url });
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
    const previous = pluginsRef.current;
    const optimistic = previous?.map((plugin) =>
      plugin.name === name ? { ...plugin, enabled } : plugin,
    ) ?? null;
    pluginsRef.current = optimistic;
    setPlugins(optimistic);
    if (!enabled && split?.plugin === name) setSplit(null);
    if (!enabled) {
      setProjPanels((current) =>
        Object.fromEntries(
          Object.entries(current).map(([cwd, panels]) => [
            cwd,
            panels.filter((panel) => panel.plugin !== name),
          ]),
        ),
      );
    } else {
      // Enabling a capability can add a project panel; discard cached misses so the server is asked again.
      setProjPanels({});
    }
    try {
      await c.setPlugin(name, enabled);
      const pl = await c.listPlugins();
      pluginsRef.current = pl.plugins;
      setPlugins(pl.plugins);
      if (!enabled) {
        setProjPanels((current) =>
          Object.fromEntries(
            Object.entries(current).map(([cwd, panels]) => [
              cwd,
              panels.filter((panel) => panel.plugin !== name),
            ]),
          ),
        );
      }
    } catch (error: any) {
      pluginsRef.current = previous;
      setPlugins(previous);
      setProjPanels({});
      setErr(String(error?.message ?? error));
    }
  };

  const waitForDiscoveryRetirement = async () => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      if (!(await invoke<string | null>("read_discovery"))) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(t("restartShutdownTimeout"));
  };

  const restartBundledEngine = async () => {
    if (engineRestarting || !server) return;
    if (Object.values(busy).some(Boolean)) {
      setErr(t("engineRestartBusy"));
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setErr(t("engineRestartReconnect"));
      return;
    }

    setErr("");
    setEngineRestarting(true);
    plannedUpdateRestartRef.current = true;
    try {
      if (client.supports("server.shutdown")) {
        await client.shutdownServer();
      } else {
        // Engines before 0.126 cannot shut themselves down through RPC. Close the authenticated renderer
        // transport first, then let native code independently re-open the private discovery record, match
        // the pid and Hara executable path, and send the one-time legacy termination.
        clientRef.current = null;
        client.close();
        await invoke("terminate_legacy_serve", { expectedPid: server.pid });
      }
      await waitForDiscoveryRetirement();
      await startServer();
    } catch (error: any) {
      setErr(String(error?.message ?? error).slice(0, 220));
    } finally {
      plannedUpdateRestartRef.current = false;
      setEngineRestarting(false);
    }
  };

  const downloadDesktopUpdate = async () => {
    if (updating || updateReady) return;
    setUpdating(true);
    setUpd("");
    setUpdateTone("neutral");
    try {
      const update = await checkForUpdate();
      if (!update) {
        setUpdAvail("");
        setUpd(t("upToDate"));
        setUpdateTone("success");
        return;
      }
      setUpdAvail(update.version);
      setUpd(`${t("downloadingUpdate")} ${update.version}`);
      await update.downloadAndInstall();
      setUpdAvail("");
      setUpdateReady(true);
      setUpd(t("restartToApply"));
      setUpdateTone("success");
    } catch (error: any) {
      setUpd(String(error?.message ?? error).slice(0, 160));
      setUpdateTone("error");
    } finally {
      setUpdating(false);
    }
  };

  const restartForUpdate = async () => {
    if (Object.values(busy).some(Boolean)) {
      setUpd(t("restartBusy"));
      setUpdateTone("warning");
      return;
    }
    const client = clientRef.current;
    setUpdating(true);
    setUpd(t("restarting"));
    setUpdateTone("neutral");
    plannedUpdateRestartRef.current = true;
    try {
      if (client) {
        if (client.supports("server.shutdown")) {
          await client.shutdownServer();
        } else {
          if (!server) throw new Error(t("engineRestartReconnect"));
          clientRef.current = null;
          client.close();
          await invoke("terminate_legacy_serve", { expectedPid: server.pid });
        }
        await waitForDiscoveryRetirement();
      }
      await invoke("restart_after_update");
    } catch (error: any) {
      plannedUpdateRestartRef.current = false;
      const serverBusy = error?.code === SERVER_BUSY;
      const message = serverBusy
        ? t("restartServerBusy")
        : String(error?.message ?? error).slice(0, 160);
      setUpd(message);
      setUpdateTone(serverBusy ? "warning" : "error");
      setUpdating(false);
      if (client && !client.connected) {
        setErr(message);
        setPhase("no-server");
      }
    }
  };

  const flipLocale = () => {
    const next: Locale = locale === "en" ? "zh" : "en";
    saveLocale(next);
    setLocale(next);
  };

  // keep latest handlers reachable from the once-registered shortcut listener + pending-card effect
  apiRef.current = { setZone, openAssistant, openProject };

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
            <button className="linky" onClick={() => void connect()}>
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
  const engineVersionState = classifyEngineVersion(server?.version ?? "", BUNDLED_ENGINE_VERSION);
  const engineVersionNeedsAttention =
    engineVersionState === "older" || engineVersionState === "incompatible";
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
    clearActiveSession(id);
    removePet(id);
    delete activeTurnsRef.current[id];
    setTaskStates((states) => {
      const { [id]: _gone, ...rest } = states;
      taskStatesRef.current = rest;
      return rest;
    });
    await refreshSessions();
  };
  const deleteIt = async (id: string) => {
    const c = clientRef.current;
    if (!c || !window.confirm(t("deleteConfirm"))) return;
    try {
      await c.deleteSession(id);
      attachedSessionsRef.current.delete(id);
      clearActiveSession(id);
      removePet(id);
      delete activeTurnsRef.current[id];
      setTaskStates((states) => {
        const { [id]: _goneTask, ...rest } = states;
        taskStatesRef.current = rest;
        return rest;
      });
      setTranscripts(({ [id]: _gone, ...rest }) => rest);
      await refreshSessions();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };
  /** The replay's escape hatch: fork the automated run into an interactive session and jump there. */
  const continueManually = async () => {
    const c = clientRef.current;
    if (!c || !autoReplay) return;
    const home = isAssistantCwd(autoReplay.cwd);
    const requestId = ++sessionOpenRequestRef.current;
    try {
      const r = await c.forkSession(autoReplay.id);
      attachedSessionsRef.current.add(r.sessionId);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
      }));
      rememberSession(r.sessionId, { cwd: autoReplay.cwd, source: "interactive" });
      await refreshSessions();
      if (requestId === sessionOpenRequestRef.current && zoneRef.current === "auto") {
        setZone(home ? "chat" : "projects");
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  const forkIt = async (id: string) => {
    const c = clientRef.current;
    if (!c) return;
    const source = sessionsRef.current.find((session) => session.id === id);
    const sessionHint = { cwd: source?.cwd ?? server?.cwd ?? "", source: "interactive" };
    const requestId = ++sessionOpenRequestRef.current;
    try {
      const r = await c.forkSession(id);
      attachedSessionsRef.current.add(r.sessionId);
      setTranscripts((tr) => ({
        ...tr,
        [r.sessionId]: r.history.map((m): ConversationItem =>
          m.role === "user"
            ? { kind: "user", text: displayHistoryText(m.text) }
            : { kind: "text", text: m.text },
        ),
      }));
      rememberSession(r.sessionId, sessionHint);
      if (sessionActivationAllowed(requestId, sessionOpenRequestRef.current, zoneRef.current, sessionHint)) {
        setActive(r.sessionId);
      }
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
          (projPanels[activeSession.cwd] ?? [])
            .filter((sp) => plugins?.find((plugin) => plugin.name === sp.plugin)?.enabled !== false)
            .map((sp) => (
              <button key={sp.id} className={`paneltab ${split?.id === sp.id ? "on" : ""}`} disabled={panelBusy === sp.id} onClick={() => void toggleSplit(sp, activeSession.cwd)}>
                {panelBusy === sp.id ? "…" : `◧ ${sp.title}`}
              </button>
            ))}
      </div>
      {!active ? (
        temperament === "im" ? (
          <div className="workstarter-scroll">
            <WorkStarter
              locale={locale}
              busy={starterBusy}
              onStart={startFromWorkbench}
              onOpenProject={() => void openProject()}
            />
          </div>
        ) : (
          <div className="center dim">{t("pickSession")}</div>
        )
      ) : (
        <>
          <ConversationTimeline
            items={items}
            busy={!!busy[active]}
            temperament={temperament}
            bottomRef={bottomRef}
            t={t}
            onRewind={(index) => void rewindHere(index)}
            onApproval={(approvalId, verdict) =>
              void answer(active, approvalId, verdict).catch((error) =>
                setErr(String(error?.message ?? error)),
              )
            }
          />
          {(queue[active!] ?? []).length > 0 && (
            <div className="steerq">
              {(queue[active!] ?? []).map((queued, i) => (
                <div key={i} className="steer-item">
                  <span className="steer-txt">
                    {queued.text}
                    {!!queued.images?.length && `  🖼×${queued.images.length}`}
                  </span>
                  {!busy[active!] && (
                    <button
                      className="linky"
                      aria-label={locale === "zh" ? "重试这条排队消息" : "Retry this queued message"}
                      title={locale === "zh" ? "重试" : "Retry"}
                      onClick={() => retryQueuedInput(active!, i)}
                    >
                      ↻
                    </button>
                  )}
                  <button
                    className="linky"
                    aria-label={locale === "zh" ? "取消这条排队消息" : "Cancel this queued message"}
                    title={locale === "zh" ? "取消排队" : "Cancel queued input"}
                    onClick={() => cancelQueuedInput(active!, i)}
                  >
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
              <button className="stop" onClick={() => void stopTurn(active)}>
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
    <AppRail
      activePlace={zone}
      labels={{
        mainNavigation: t("mainNavigation"),
        chat: t("zoneChat"),
        projects: t("zoneProjects"),
        automations: t("zoneAuto"),
        settings: t("zoneSettings"),
        updateAvailable: t("updateAvail"),
      }}
      assistantUnread={manualUnreadIn(azAll)}
      projectsUnread={manualUnreadIn(
        sessions.filter(
          (session) =>
            !isAssistantCwd(session.cwd) &&
            !isAutomated(session) &&
            !isJunkCwd(session.cwd),
        ),
      )}
      automationUnread={autoUnread}
      updateAvailable={updAvail}
      onSelect={setZone}
    />
  );
  const footBar = (
    <div className="foot">
      <span className="dim" title={`${t("engineVersion")} ${server?.version ?? "—"}`}>
        {t("engineShort")} {server?.version ?? "—"}
      </span>
      <span className="dim foot-route" title={`${server?.provider ?? ""}:${server?.model ?? ""}`}>
        {server?.provider}:{server?.model}
      </span>
    </div>
  );
  const brandBar = (
    <div className="brand">
      <HaraLogo size={20} /> <span className="wordmark">Hara</span>{" "}
      <span className="ver" title={t("desktopVersion")}>
        {desktopVersion || "…"}
      </span>
    </div>
  );

  return (
    <div className="app">
      {rail}
      {err && (
        <div className="ready-error" role="alert">
          <span>{err}</span>
          <button
            className="ghost"
            aria-label={locale === "zh" ? "关闭错误提示" : "Dismiss error"}
            onClick={() => setErr("")}
          >
            ×
          </button>
        </div>
      )}

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
          <nav className="sessions setlist" key={zone} aria-label={t("settingsNavigation")}>
            {(
              [
                {
                  label: t("settingsGroupGeneral"),
                  items: [
                    ["providers", t("setProviders")],
                    ["engine", t("setServer")],
                    ["security", t("setSecurity")],
                    ["lang", t("setLang")],
                  ],
                },
                {
                  label: t("settingsGroupCapabilities"),
                  items: [
                    ["pets", t("setPets")],
                    ["plugins", t("setPlugins")],
                    ["skills", t("setSkills")],
                  ],
                },
              ] as const
            ).map((group, groupIndex) => (
              <div
                className="setnav-group"
                role="group"
                aria-labelledby={`settings-nav-group-${groupIndex}`}
                key={group.label}
              >
                <div className="setnav-label" id={`settings-nav-group-${groupIndex}`}>
                  {group.label}
                </div>
                {group.items.map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    className={`setnav ${setSec === k ? "on" : ""}`}
                    aria-current={setSec === k ? "page" : undefined}
                    onClick={() => setSetSec(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {footBar}
        </aside>
      )}

      {/* ── main area ── */}
      {zone === "settings" ? (
        // ⚙ configure place — context column picked a group, the stage renders its forms
        <main className="chat board">
          <div className="scroll boardpad setstage">
            {setSec === "providers" && (
              <SettingsPage
                id="settings-provider-title"
                eyebrow={t("settingsSystem")}
                title={t("setProviders")}
                description={t("providerSettingsDescription")}
              >
                <ProviderSettings
                  embedded
                  client={clientRef.current}
                  cwd={server?.cwd}
                  locale={locale}
                  onSaved={(next: ProviderSettingsState) => {
                    setSetupRequired(!next.current.authenticated);
                    setServer((current) => current
                      ? { ...current, provider: next.current.provider, model: next.current.model }
                      : current);
                    void clientRef.current?.listModels({ cwd: server?.cwd }).then(setModelInfo).catch(() => {});
                  }}
                />
              </SettingsPage>
            )}
            {setSec === "engine" && (
              <SettingsPage
                id="settings-engine-title"
                eyebrow={t("settingsSystem")}
                title={t("setServer")}
                description={t("engineDescription")}
              >
                <SettingsCard
                  title={t("versionTitle")}
                  description={t("versionDescription")}
                >
                  <SettingsItem
                    title={t("desktopVersion")}
                    description={t("desktopVersionHint")}
                  >
                    <SettingsBadge>{desktopVersion || "…"}</SettingsBadge>
                  </SettingsItem>
                  <SettingsItem
                    title={t("engineVersion")}
                    description={t("engineVersionHint")}
                  >
                    <SettingsBadge
                      tone={
                        engineVersionState === "matching"
                          ? "success"
                          : engineVersionNeedsAttention
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {server?.version || "…"}
                    </SettingsBadge>
                  </SettingsItem>
                  <SettingsItem title={t("activeModel")} description={t("activeModelHint")}>
                    <span className="settings-mono">{server?.provider}:{server?.model}</span>
                  </SettingsItem>
                  {server?.version && engineVersionNeedsAttention && (
                    <SettingsNotice
                      tone="warning"
                      title={t("engineMismatchTitle")}
                      actions={
                        <button
                          type="button"
                          className="compact"
                          disabled={engineRestarting || Object.values(busy).some(Boolean)}
                          onClick={() => void restartBundledEngine()}
                        >
                          {engineRestarting ? t("engineRestarting") : t("engineRestartNow")}
                        </button>
                      }
                    >
                      {t("engineMismatchHint")} {BUNDLED_ENGINE_VERSION}
                    </SettingsNotice>
                  )}
                  {server?.version && engineVersionState === "newer" && (
                    <SettingsNotice tone="neutral" title={t("engineNewerTitle")}>
                      {t("engineNewerHint")} {BUNDLED_ENGINE_VERSION}
                    </SettingsNotice>
                  )}
                </SettingsCard>

                <SettingsCard
                  title={t("updatesTitle")}
                  description={t("updatesDescription")}
                  aside={
                    updAvail
                      ? <SettingsBadge tone="warning">{t("updateAvail")} · {updAvail}</SettingsBadge>
                      : undefined
                  }
                >
                  <SettingsItem title={t("automaticCheck")} description={t("automaticCheckHint")}>
                    <button
                      type="button"
                      className="ghost"
                      disabled={updating || updateReady}
                      onClick={() => void downloadDesktopUpdate()}
                    >
                      {updating ? t("workingUpdate") : t("checkUpdate")}
                    </button>
                  </SettingsItem>
                  {updateReady ? (
                    <SettingsNotice
                      tone={updateTone}
                      title={
                        updateTone === "warning" || updateTone === "error"
                          ? t("restartBlockedTitle")
                          : t("updateReadyTitle")
                      }
                      actions={
                        <button type="button" disabled={updating} onClick={() => void restartForUpdate()}>
                          {t("restartNow")}
                        </button>
                      }
                    >
                      {upd || t("restartToApply")}
                    </SettingsNotice>
                  ) : upd ? (
                    <SettingsNotice tone={updateTone} title={upd} />
                  ) : null}
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "security" && (
              <SettingsPage
                id="settings-security-title"
                eyebrow={t("settingsSystem")}
                title={t("setSecurity")}
                description={t("securityDescription")}
              >
                <SettingsCard title={t("approvalTitleSetting")} description={t("approvalDescription")}>
                  <SettingsItem
                    title={t("defaultApprovalTitle")}
                    description={t("apprHint")}
                    htmlFor="hara-default-approval"
                  >
                  <select
                    id="hara-default-approval"
                    value={defaultApproval}
                    onChange={(e) => {
                      setDefaultApproval(e.target.value);
                      localStorage.setItem("hara.approval", e.target.value);
                    }}
                  >
                    <option value="">{t("approvalDefault")}</option>
                    <option value="suggest">{t("approvalSuggest")}</option>
                    <option value="auto-edit">{t("approvalAutoEdit")}</option>
                    <option value="full-auto">{t("approvalFullAuto")}</option>
                  </select>
                  </SettingsItem>
                  <SettingsNotice
                    tone={defaultApproval === "full-auto" ? "warning" : "neutral"}
                    title={defaultApproval === "full-auto" ? t("fullAutoWarning") : t("boundaryTitle")}
                  >
                    {defaultApproval === "full-auto" ? t("fullAutoWarningHint") : t("boundaryHint")}
                  </SettingsNotice>
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "lang" && (
              <SettingsPage
                id="settings-language-title"
                eyebrow={t("settingsSystem")}
                title={t("setLang")}
                description={t("languageDescription")}
              >
                <SettingsCard title={t("displayLanguage")} description={t("displayLanguageHint")}>
                  <SettingsItem title={t("languageChoice")}>
                    <div className="settings-choice">
                      <button className={locale === "zh" ? "" : "ghost"} aria-pressed={locale === "zh"} onClick={() => locale !== "zh" && flipLocale()}>
                        中文
                      </button>
                      <button className={locale === "en" ? "" : "ghost"} aria-pressed={locale === "en"} onClick={() => locale !== "en" && flipLocale()}>
                        English
                      </button>
                    </div>
                  </SettingsItem>
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "pets" && (
              <DesktopCompanionSettings
                t={t}
                awake={petAwake}
                selector={petSelector}
                catalog={petCatalog}
                error={petCatalogError}
                onToggleAwake={() => setPetAwake((awake) => !awake)}
                onRefresh={() => void refreshPets()}
                onSelect={setPetSelector}
              />
            )}
            {setSec === "plugins" && (
              <SettingsPage
                id="settings-capabilities-title"
                eyebrow={t("settingsCapabilities")}
                title={t("setPlugins")}
                description={t("capabilitiesDescription")}
              >
                <SettingsCard title={t("installedCapabilities")} description={t("installedCapabilitiesHint")}>
                  {!plugins ? (
                    <div className="settings-empty">{t("loading")}</div>
                  ) : plugins.length === 0 ? (
                    <div className="settings-empty">
                      <strong>{t("noCapabilities")}</strong>
                      <span>{t("capabilityInstallHint")}</span>
                    </div>
                  ) : (
                    <div className="settings-capability-list">
                      {plugins.map((p) => (
                        <div key={p.name} className="plug">
                          <div className="plug-main">
                            <div className="plug-name">
                              {p.name} <span className="dim">v{p.version}</span>
                            </div>
                            <div className="plug-description">{p.description}</div>
                            <div className="plug-meta dim">
                              {p.skills} {t("capabilityRecipes")} · {p.agents} {t("capabilitySpecialists")} · {p.mcpServers} {t("capabilityConnections")}
                            </div>
                          </div>
                          <span className="settings-capability-actions">
                            {p.enabled && (p.panels ?? []).map((sp) => (
                              <button type="button" key={sp.id} disabled={panelBusy === sp.id} onClick={() => void openPanel(p.name, sp)}>
                                {panelBusy === sp.id ? "…" : sp.title}
                              </button>
                            ))}
                            <button
                              type="button"
                              className={p.enabled ? "" : "ghost"}
                              aria-pressed={p.enabled}
                              aria-label={`${p.name}: ${p.enabled ? t("disableCapability") : t("enableCapability")}`}
                              onClick={() => void togglePlugin(p.name, !p.enabled)}
                            >
                              {p.enabled ? t("enabled") : t("disabled")}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </SettingsCard>
              </SettingsPage>
            )}
            {setSec === "skills" && (
              <SettingsPage
                id="settings-skills-title"
                eyebrow={t("settingsAdvanced")}
                title={t("setSkills")}
                description={t("skillsDescription")}
              >
                <SettingsCard title={t("availableSkills")} description={t("availableSkillsHint")}>
                  {(skills ?? []).length === 0 ? (
                    <div className="settings-empty">{t("noSkills")}</div>
                  ) : (
                    <div className="settings-skill-list">
                      {(skills ?? []).map((s) => (
                        <div key={s.id} className="skill">
                          <span>
                            <strong className="skill-id">{s.id}</strong>
                            <small>{s.description}</small>
                          </span>
                          <SettingsBadge>{s.source}</SettingsBadge>
                        </div>
                      ))}
                    </div>
                  )}
                </SettingsCard>
              </SettingsPage>
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
