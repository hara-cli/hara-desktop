import { useEffect, useMemo, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type {
  PetChatApproval,
  PetChatResult,
  PetChatState,
  PetChatSubmit,
} from "./pets";
import "./PetChat.css";

const EMPTY_STATE: PetChatState = {
  connected: false,
  canSubmit: false,
  locale: "zh",
  title: "Hara",
  petStatus: "idle",
  messages: [],
};

function requestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function restoreFailedDraft(failed: string, current: string): string {
  if (!failed) return current;
  return current ? `${failed}\n${current}` : failed;
}

function stateCopy(state: PetChatState): string {
  const zh = state.locale === "zh";
  if (!state.connected) return zh ? "正在连接 Hara" : "Connecting to Hara";
  if (state.unavailable) return zh ? "原会话已不可用" : "The original conversation is unavailable";
  const value = state.task?.state;
  if (value === "waiting") return zh ? "等你确认" : "Needs your input";
  if (value === "running") return zh ? "正在处理" : "Working";
  if (value === "paused") return zh ? "已安全暂停" : "Paused safely";
  if (value === "blocked") return zh ? "需要调整方案" : "Needs a new approach";
  if (value === "completed") return zh ? "已经完成" : "Completed";
  return zh ? "随时可以开始" : "Ready when you are";
}

export default function PetChat() {
  const [state, setState] = useState<PetChatState>(EMPTY_STATE);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const locale = useRef(state.locale);
  const pendingDraft = useRef("");
  const stateTarget = useRef<string | undefined>(undefined);
  const stateTargetInitialized = useRef(false);
  locale.current = state.locale;
  const zh = state.locale === "zh";
  const status = useMemo(() => stateCopy(state), [state]);

  useEffect(() => {
    const stops: Array<() => void> = [];
    let disposed = false;
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    void (async () => {
      keep(await listen<PetChatState>("hara-pet-chat-state", ({ payload }) => {
        const targetChanged = stateTargetInitialized.current
          && stateTarget.current !== payload.sessionId;
        stateTarget.current = payload.sessionId;
        stateTargetInitialized.current = true;
        if (targetChanged) {
          setDraft("");
          setPending(null);
          pendingDraft.current = "";
          setError("");
        }
        setState(payload);
      }));
      keep(await listen<PetChatResult>("hara-pet-chat-result", ({ payload }) => {
        setPending((current) => {
          if (current !== payload.requestId) return current;
          if (!payload.ok) {
            setError(payload.error || (locale.current === "zh" ? "发送失败" : "Could not send"));
            if (pendingDraft.current) {
              setDraft((draft) => restoreFailedDraft(pendingDraft.current, draft));
            }
          } else {
            setError("");
          }
          pendingDraft.current = "";
          return null;
        });
      }));
      if (!disposed) {
        await emitTo("main", "hara-pet-chat-ready", null);
        requestAnimationFrame(() => textarea.current?.focus());
      }
    })().catch(() => {
      if (!disposed) {
        setError(locale.current === "zh" ? "无法连接主窗口，请重新打开" : "Could not reach the main window. Reopen the companion.");
      }
    });
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const request = pending;
    const timer = window.setTimeout(() => {
      setPending((current) => {
        if (current !== request) return current;
        // The trusted main window may already be dispatching this request. Keep the request pending
        // and disable retry; restoring the draft here could execute the same task twice.
        setError(locale.current === "zh"
          ? "主窗口仍在处理，请勿重复发送"
          : "The main window is still processing. Do not resend.");
        return current;
      });
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages, state.task?.checkpoint.current]);

  const submit = () => {
    const text = draft.trim();
    if (!text || pending || !state.canSubmit) return;
    const id = requestId();
    const payload: PetChatSubmit = {
      requestId: id,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
      text,
    };
    setPending(id);
    pendingDraft.current = text;
    setError("");
    setDraft("");
    void emitTo("main", "hara-pet-chat-submit", payload).catch(() => {
      setPending((current) => current === id ? null : current);
      setError(locale.current === "zh" ? "无法连接主窗口，请重试" : "Could not reach the main window. Try again.");
      setDraft((draft) => restoreFailedDraft(pendingDraft.current, draft));
      pendingDraft.current = "";
    });
  };

  const answer = (allow: boolean) => {
    if (!state.sessionId || !state.task?.approval || pending) return;
    const id = requestId();
    const payload: PetChatApproval = {
      requestId: id,
      sessionId: state.sessionId,
      approvalId: state.task.approval.id,
      allow,
    };
    setPending(id);
    pendingDraft.current = "";
    setError("");
    void emitTo("main", "hara-pet-chat-approval", payload).catch(() => {
      setPending((current) => current === id ? null : current);
      setError(locale.current === "zh" ? "无法连接主窗口，请重试" : "Could not reach the main window. Try again.");
    });
  };

  return (
    <main className={`pet-chat pet-chat-${state.petStatus}`}>
      <header className="pet-chat-header" data-tauri-drag-region>
        <div className="pet-chat-brand" data-tauri-drag-region>
          <span className="pet-chat-mark" aria-hidden="true">ハ</span>
          <span data-tauri-drag-region>
            <strong>Hara</strong>
            <small>{state.title || (zh ? "个人助理" : "Personal assistant")}</small>
          </span>
        </div>
        <div className="pet-chat-actions">
          <button
            title={zh ? "在主窗口打开" : "Open in main window"}
            aria-label={zh ? "在主窗口打开" : "Open in main window"}
            onClick={() => void emitTo("main", "hara-pet-chat-open-main", { sessionId: state.sessionId })}
          >
            ↗
          </button>
          <button
            title={zh ? "关闭" : "Close"}
            aria-label={zh ? "关闭" : "Close"}
            onClick={() => void emitTo("main", "hara-pet-chat-close", null)}
          >
            ×
          </button>
        </div>
      </header>

      <section className="pet-chat-status" aria-live="polite">
        <span className="pet-chat-status-dot" aria-hidden="true" />
        <div>
          <strong>{status}</strong>
          <small>
            {state.task?.checkpoint.current
              || state.task?.objective
              || (zh ? "告诉我你想完成什么" : "Tell me what you want to get done")}
          </small>
        </div>
        {!!state.task?.checkpoint.total && (
          <span className="pet-chat-progress">
            {state.task.checkpoint.done}/{state.task.checkpoint.total}
          </span>
        )}
      </section>

      <section
        className="pet-chat-thread"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label={zh ? "最近对话" : "Recent conversation"}
      >
        {state.messages.length === 0 ? (
          <div className="pet-chat-welcome">
            <span>⌁</span>
            <p>{zh ? "可以直接交代任务，也可以在 Hara 工作时补充要求。" : "Start a task, or refine Hara's work while it is running."}</p>
          </div>
        ) : state.messages.map((message, index) => (
          <div className={`pet-chat-message pet-chat-message-${message.role}`} key={`${message.role}-${index}`}>
            {message.text}
          </div>
        ))}
        <div ref={bottom} />
      </section>

      {state.canSubmit && state.task?.state === "waiting" && state.task.approval && (
        <section className="pet-chat-approval">
          <p>{state.task.approval.question}</p>
          <div>
            <button className="pet-chat-deny" disabled={!!pending} onClick={() => answer(false)}>
              {zh ? "不允许" : "Deny"}
            </button>
            <button className="pet-chat-allow" disabled={!!pending} onClick={() => answer(true)}>
              {zh ? "允许这次" : "Allow once"}
            </button>
          </div>
        </section>
      )}

      <footer className="pet-chat-composer">
        {error && <div className="pet-chat-error" role="alert">{error}</div>}
        <div className="pet-chat-input-shell">
          <textarea
            ref={textarea}
            value={draft}
            maxLength={4_000}
            rows={2}
            disabled={!state.canSubmit}
            placeholder={state.connected
              ? state.canSubmit
                ? (zh ? "发消息给 Hara…" : "Message Hara…")
                : state.unavailable
                  ? (zh ? "原会话已不可用，请关闭后重新打开" : "The original conversation is unavailable; close and reopen")
                  : (zh ? "自动任务为只读，请在主窗口继续" : "Automated runs are read-only; continue in the main window")
              : (zh ? "等待主窗口连接…" : "Waiting for the main window…")}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            className="pet-chat-send"
            disabled={!draft.trim() || !!pending || !state.canSubmit}
            aria-label={zh ? "发送" : "Send"}
            onClick={submit}
          >
            {pending ? "··" : "↑"}
          </button>
        </div>
        <small>{zh ? "Enter 发送 · Shift+Enter 换行" : "Enter to send · Shift+Enter for a new line"}</small>
      </footer>
    </main>
  );
}
