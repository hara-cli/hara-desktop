import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type {
  ExternalTerminalEvent,
  ExternalTerminalStreamConnection,
  ExternalTerminalStreamMode,
} from "./client";
import "@xterm/xterm/css/xterm.css";
import "./ExternalNativeTerminalSurface.css";

interface ExternalNativeTerminalSurfaceProps {
  sessionId: string;
  locale: "en" | "zh";
  streaming: boolean;
  legacyText?: string;
  legacyLoading?: boolean;
  legacyError?: string;
  onLegacyRefresh?: () => Promise<void>;
  onAttach: (
    mode: ExternalTerminalStreamMode,
    takeover: boolean,
    cols: number,
    rows: number,
  ) => Promise<ExternalTerminalStreamConnection>;
  onInput: (streamId: string, text: string) => Promise<void>;
  onResize: (streamId: string, cols: number, rows: number) => Promise<void>;
  onScroll: (streamId: string, direction: "up" | "down", lines: number) => Promise<void>;
  onRelease: (streamId: string) => Promise<void>;
  onOpenWezTerm: (takeover: boolean) => Promise<void>;
  subscribe: (listener: (event: ExternalTerminalEvent) => void) => () => void;
}

type TerminalStatus = "connecting" | "control" | "observe" | "closed" | "error" | "wezterm";

const COPY = {
  zh: {
    connecting: "正在连接原生终端…",
    control: "本机控制",
    observe: "只读观察",
    closed: "会话终端已结束",
    error: "终端连接中断",
    wezterm: "控制已转交 WezTerm",
    controlAction: "取得控制",
    reconnect: "重新连接",
    openWezTerm: "在 WezTerm 打开",
    release: "释放控制",
    scrollUp: "向上翻页",
    scrollDown: "向下翻页",
    installHint: "WezTerm 未安装时仍可继续使用 Hara 内置终端。",
    transferConfirm: "将输入控制转交给 WezTerm？Hara 内置终端会切换为已转交状态，但不会启动新的 Codex 或 Claude Code 进程。",
    takeoverConfirm: "另一窗口可能正在控制这个终端。确认把输入控制切换到当前窗口吗？",
    inputHint: "直接点击终端输入；支持中文粘贴、方向键、Tab、Enter 和 Ctrl+C。",
    legacy: "当前引擎仅支持终端快照；升级后可使用实时输入、缩放和 WezTerm。",
    refresh: "刷新",
    keys: [
      ["Esc", "取消", "\u001b"],
      ["↑", "上移", "\u001b[A"],
      ["↓", "下移", "\u001b[B"],
      ["Enter", "确认", "\r"],
      ["Tab", "切换", "\t"],
      ["Ctrl+C", "中断", "\u0003"],
    ] as const,
  },
  en: {
    connecting: "Connecting to the native terminal…",
    control: "Local control",
    observe: "Read-only observer",
    closed: "Terminal session ended",
    error: "Terminal connection interrupted",
    wezterm: "Control transferred to WezTerm",
    controlAction: "Take control",
    reconnect: "Reconnect",
    openWezTerm: "Open in WezTerm",
    release: "Release control",
    scrollUp: "Page up",
    scrollDown: "Page down",
    installHint: "If WezTerm is not installed, Hara's built-in terminal remains available.",
    transferConfirm: "Transfer input control to WezTerm? Hara will keep the same Codex or Claude Code process and release its built-in controller.",
    takeoverConfirm: "Another window may control this terminal. Transfer input control to this window?",
    inputHint: "Click the terminal and type directly. Paste, arrows, Tab, Enter, and Ctrl+C are supported.",
    legacy: "This engine only supports terminal snapshots. Upgrade for live input, resize, and WezTerm handoff.",
    refresh: "Refresh",
    keys: [
      ["Esc", "Cancel", "\u001b"],
      ["↑", "Up", "\u001b[A"],
      ["↓", "Down", "\u001b[B"],
      ["Enter", "Confirm", "\r"],
      ["Tab", "Switch", "\t"],
      ["Ctrl+C", "Interrupt", "\u0003"],
    ] as const,
  },
} as const;

const terminalBytes = (encoded: string): Uint8Array => {
  const raw = window.atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
};

export default function ExternalNativeTerminalSurface({
  sessionId,
  locale,
  streaming,
  legacyText = "",
  legacyLoading = false,
  legacyError = "",
  onLegacyRefresh,
  onAttach,
  onInput,
  onResize,
  onScroll,
  onRelease,
  onOpenWezTerm,
  subscribe,
}: ExternalNativeTerminalSurfaceProps) {
  const copy = COPY[locale];
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const streamRef = useRef<ExternalTerminalStreamConnection | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const inputBufferRef = useRef("");
  const inputTimerRef = useRef<number | null>(null);
  const inputTailRef = useRef(Promise.resolve());
  const resizeTimerRef = useRef<number | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>("connecting");
  const [error, setError] = useState("");

  const releaseCurrent = useCallback(async () => {
    const current = streamRef.current;
    streamRef.current = null;
    lastSeqRef.current = null;
    if (current) await onRelease(current.streamId).catch(() => {});
  }, [onRelease]);

  const flushInput = useCallback(() => {
    inputTimerRef.current = null;
    const current = streamRef.current;
    const text = inputBufferRef.current;
    inputBufferRef.current = "";
    if (!current || current.mode !== "control" || !text) return;
    inputTailRef.current = inputTailRef.current
      .catch(() => {})
      .then(() => onInput(current.streamId, text))
      .catch((cause) => {
        setError(String(cause instanceof Error ? cause.message : cause).slice(0, 240));
        setTerminalStatus("error");
      });
  }, [onInput]);

  const queueInput = useCallback((text: string) => {
    if (!text || streamRef.current?.mode !== "control") return;
    inputBufferRef.current += text;
    if (inputBufferRef.current.length >= 16 * 1024) flushInput();
    else if (inputTimerRef.current === null) inputTimerRef.current = window.setTimeout(flushInput, 12);
  }, [flushInput]);

  const sendScroll = useCallback((direction: "up" | "down") => {
    const current = streamRef.current;
    if (!current || current.mode !== "control") return;
    const lines = Math.max(1, Math.min(1_000, (terminalRef.current?.rows ?? 24) - 2));
    inputTailRef.current = inputTailRef.current
      .catch(() => {})
      .then(() => onScroll(current.streamId, direction, lines))
      .catch((cause) => {
        setError(String(cause instanceof Error ? cause.message : cause).slice(0, 240));
        setTerminalStatus("error");
      });
  }, [onScroll]);

  const attach = useCallback(async (mode: ExternalTerminalStreamMode, takeover = false) => {
    if (!streaming || !terminalRef.current || !fitRef.current) return;
    setTerminalStatus("connecting");
    setError("");
    await releaseCurrent();
    fitRef.current.fit();
    const cols = Math.max(2, terminalRef.current.cols || 80);
    const rows = Math.max(2, terminalRef.current.rows || 24);
    try {
      const connection = await onAttach(mode, takeover, cols, rows);
      streamRef.current = connection;
      lastSeqRef.current = null;
      terminalRef.current.reset();
      terminalRef.current.focus();
      setTerminalStatus(connection.mode);
    } catch (cause) {
      if (mode === "control" && !takeover) {
        try {
          const observer = await onAttach("observe", false, cols, rows);
          streamRef.current = observer;
          lastSeqRef.current = null;
          terminalRef.current.reset();
          setTerminalStatus("observe");
          return;
        } catch {
          // Surface the original controller error; it usually has the more useful recovery message.
        }
      }
      setError(String(cause instanceof Error ? cause.message : cause).slice(0, 240));
      setTerminalStatus("error");
    }
  }, [onAttach, releaseCurrent, streaming]);

  useEffect(() => {
    if (!streaming || !hostRef.current) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.22,
      scrollback: 5_000,
      theme: {
        background: "#090d0b",
        foreground: "#d9f5e5",
        cursor: "#72dda0",
        cursorAccent: "#090d0b",
        selectionBackground: "#335b48aa",
        black: "#111713",
        brightBlack: "#627068",
        red: "#ef786c",
        brightRed: "#ff9b8f",
        green: "#67d493",
        brightGreen: "#93e9b2",
        yellow: "#dfbd72",
        brightYellow: "#f3d88c",
        blue: "#78a9d1",
        brightBlue: "#9cc8ea",
        magenta: "#bc8ccc",
        brightMagenta: "#d8aae6",
        cyan: "#75bfc0",
        brightCyan: "#9bdddc",
        white: "#d7dfda",
        brightWhite: "#f4fff8",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitRef.current = fit;
    const dataSubscription = terminal.onData(queueInput);
    const unsubscribe = subscribe((event) => {
      const current = streamRef.current;
      if (!current || event.sessionId !== sessionId || event.streamId !== current.streamId) return;
      if (event.method === "external.event.terminal.closed") {
        streamRef.current = null;
        lastSeqRef.current = null;
        if (event.reason === "control_transferred") setTerminalStatus("wezterm");
        else {
          setTerminalStatus(event.reason === "released" ? "closed" : "error");
          if (event.reason !== "released" && event.reason !== "runtime_closed") setError(event.reason.replace(/_/gu, " "));
        }
        return;
      }
      if (event.encoding !== "ansi-base64") return;
      const prior = lastSeqRef.current;
      if (prior !== null && event.seq !== prior + 1 && !event.full) {
        setError("terminal frame sequence gap");
        setTerminalStatus("error");
        void releaseCurrent();
        return;
      }
      try {
        if (event.full) terminal.reset();
        terminal.write(terminalBytes(event.bytes));
        lastSeqRef.current = event.seq;
      } catch {
        setError("invalid terminal frame");
        setTerminalStatus("error");
      }
    });
    const fitAndResize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const current = streamRef.current;
      if (!current || current.mode !== "control") return;
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        void onResize(current.streamId, terminal.cols, terminal.rows).catch(() => {});
      }, 80);
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(hostRef.current);
    const frame = window.requestAnimationFrame(() => {
      fitAndResize();
      setRendererReady(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      unsubscribe();
      dataSubscription.dispose();
      if (inputTimerRef.current !== null) window.clearTimeout(inputTimerRef.current);
      if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
      void releaseCurrent();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      setRendererReady(false);
    };
  }, [onResize, queueInput, releaseCurrent, sessionId, streaming, subscribe]);

  useEffect(() => {
    if (rendererReady) void attach("control", false);
  }, [attach, rendererReady, sessionId]);

  const takeControl = () => {
    if (!window.confirm(copy.takeoverConfirm)) return;
    void attach("control", true);
  };

  const openWezTerm = async () => {
    if (!window.confirm(copy.transferConfirm)) return;
    setError("");
    try {
      await onOpenWezTerm(true);
      streamRef.current = null;
      lastSeqRef.current = null;
      setTerminalStatus("wezterm");
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause).slice(0, 240));
      setTerminalStatus(streamRef.current?.mode ?? "error");
    }
  };

  if (!streaming) {
    return (
      <section className="external-terminal-surface is-legacy">
        <div className="external-terminal-statusbar"><span>{copy.legacy}</span><button type="button" onClick={() => void onLegacyRefresh?.()} disabled={legacyLoading}>{copy.refresh}</button></div>
        {legacyError ? <div className="external-terminal-surface-error" role="alert">{legacyError}</div> : null}
        <pre data-native-context-menu="true">{legacyText}</pre>
      </section>
    );
  }

  return (
    <section className="external-terminal-surface" data-status={terminalStatus}>
      <div className="external-terminal-statusbar">
        <span><i aria-hidden />{copy[terminalStatus]}</span>
        <div>
          {terminalStatus === "observe" ? <button type="button" onClick={takeControl}>{copy.controlAction}</button> : null}
          {terminalStatus === "closed" || terminalStatus === "error" || terminalStatus === "wezterm"
            ? <button type="button" onClick={() => void attach("control", false)}>{copy.reconnect}</button>
            : null}
          {terminalStatus === "control" ? <button type="button" onClick={() => void releaseCurrent().then(() => setTerminalStatus("closed"))}>{copy.release}</button> : null}
          <button type="button" className="is-wezterm" onClick={() => void openWezTerm()}>{copy.openWezTerm}</button>
        </div>
      </div>
      {error ? <div className="external-terminal-surface-error" role="alert">{error}</div> : null}
      <div className="external-terminal-canvas" ref={hostRef} data-native-context-menu="true" />
      <div className="external-terminal-softkeys" aria-label={copy.inputHint}>
        {copy.keys.map(([key, action, bytes]) => (
          <button type="button" key={key} disabled={terminalStatus !== "control"} title={`${action} · ${key}`} onClick={() => queueInput(bytes)}>
            <kbd>{key}</kbd><span>{action}</span>
          </button>
        ))}
        <button type="button" disabled={terminalStatus !== "control"} title={copy.scrollUp} onClick={() => sendScroll("up")}>
          <kbd>PgUp</kbd><span>{copy.scrollUp}</span>
        </button>
        <button type="button" disabled={terminalStatus !== "control"} title={copy.scrollDown} onClick={() => sendScroll("down")}>
          <kbd>PgDn</kbd><span>{copy.scrollDown}</span>
        </button>
      </div>
      <footer><span>{copy.inputHint}</span><span>{copy.installHint}</span></footer>
    </section>
  );
}
