import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DEFAULT_PET_SELECTOR, PET_SELECTOR_KEY } from "./pet-runtime";
import type { PetAsset, PetConfig, PetSnapshot, PetStatus } from "./pets";
import "./PetOverlay.css";

type MoveDirection = "left" | "right" | null;

const EMPTY_SNAPSHOT: PetSnapshot = { status: "idle", activityCount: 0 };
const FRAME_COUNTS: Record<PetStatus, number> = { idle: 6, running: 6, waiting: 6, paused: 6, ready: 6, blocked: 8 };
const FRAME_MS: Record<PetStatus, number> = { idle: 840, running: 120, waiting: 150, paused: 260, ready: 150, blocked: 140 };
const STATUS_ROWS: Record<PetStatus, number> = { idle: 0, blocked: 5, waiting: 6, paused: 6, running: 7, ready: 8 };

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useFrame(status: PetStatus, movement: MoveDirection, reduced: boolean): { row: number; column: number } {
  const [frame, setFrame] = useState(0);
  const row = movement === "right" ? 1 : movement === "left" ? 2 : STATUS_ROWS[status];
  const count = movement ? 8 : FRAME_COUNTS[status];
  const duration = movement ? 120 : FRAME_MS[status];
  useEffect(() => {
    setFrame(0);
    if (reduced) return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % count), duration);
    return () => clearInterval(timer);
  }, [count, duration, reduced, row]);
  return { row, column: reduced ? 0 : frame % count };
}

function AtlasPet({ asset, status, movement, reduced }: { asset: PetAsset; status: PetStatus; movement: MoveDirection; reduced: boolean }) {
  const frame = useFrame(status, movement, reduced);
  return (
    <div className="atlas-frame" aria-hidden="true">
      <img
        src={asset.dataUrl}
        alt=""
        draggable={false}
        style={{
          width: `${asset.columns * 100}%`,
          height: `${asset.rows * 100}%`,
          left: `${-frame.column * 100}%`,
          top: `${-frame.row * 100}%`,
        }}
      />
    </div>
  );
}

function HaraPet({ status, reduced }: { status: PetStatus; reduced: boolean }) {
  return (
    <div className={`hara-pet hara-pet-${status} ${reduced ? "reduced" : ""}`} aria-hidden="true">
      <div className="hara-aura" />
      <div className="hara-ear hara-ear-left" />
      <div className="hara-ear hara-ear-right" />
      <div className="hara-head">
        <span className="hara-eye hara-eye-left" />
        <span className="hara-eye hara-eye-right" />
        <span className="hara-seal">ハ</span>
      </div>
      <div className="hara-body" />
      <div className="hara-shadow" />
    </div>
  );
}

function statusText(status: PetStatus, zh: boolean): string {
  const copy = zh
    ? { idle: "待命", running: "处理中", waiting: "需要你确认", paused: "已暂停，可继续", ready: "任务完成", blocked: "遇到问题" }
    : { idle: "Idle", running: "Working", waiting: "Needs input", paused: "Paused · ready to resume", ready: "Ready", blocked: "Blocked" };
  return copy[status];
}

export default function PetOverlay() {
  const [selector, setSelector] = useState(() => localStorage.getItem(PET_SELECTOR_KEY) || DEFAULT_PET_SELECTOR);
  const [snapshot, setSnapshot] = useState<PetSnapshot>(EMPTY_SNAPSHOT);
  const [asset, setAsset] = useState<PetAsset | null>(null);
  const [assetError, setAssetError] = useState("");
  const [movement, setMovement] = useState<MoveDirection>(null);
  const reduced = useReducedMotion();
  const moveTimer = useRef<number | null>(null);
  const lastX = useRef<number | null>(null);
  const movedDuringPointer = useRef(false);
  const zh = useMemo(() => (localStorage.getItem("hara.locale") || navigator.language).toLowerCase().startsWith("zh"), []);

  useEffect(() => {
    if (selector === "builtin:hara") {
      setAsset(null);
      setAssetError("");
      return;
    }
    let current = true;
    setAsset(null);
    setAssetError("");
    void invoke<PetAsset>("read_pet_asset", { selector })
      .then((value) => current && setAsset(value))
      .catch((error) => current && setAssetError(String(error)));
    return () => {
      current = false;
    };
  }, [selector]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    void listen<PetConfig>("hara-pet-config", ({ payload }) => {
      setSelector(payload.selector || DEFAULT_PET_SELECTOR);
    }).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    void listen<PetSnapshot>("hara-pet-state", ({ payload }) => setSnapshot(payload)).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    void emitTo("main", "hara-pet-ready", null);
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const windowHandle = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void windowHandle.onMoved(async ({ payload }) => {
      movedDuringPointer.current = true;
      const scale = await windowHandle.scaleFactor().catch(() => 1);
      localStorage.setItem("hara.pet.x", String(Math.round(payload.x / scale)));
      localStorage.setItem("hara.pet.y", String(Math.round(payload.y / scale)));
      if (lastX.current !== null && payload.x !== lastX.current) setMovement(payload.x > lastX.current ? "right" : "left");
      lastX.current = payload.x;
      if (moveTimer.current !== null) clearTimeout(moveTimer.current);
      moveTimer.current = window.setTimeout(() => setMovement(null), 280);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (moveTimer.current !== null) clearTimeout(moveTimer.current);
    };
  }, []);

  const openActivity = async () => {
    if (movedDuringPointer.current) {
      movedDuringPointer.current = false;
      return;
    }
    await emitTo("main", "hara-pet-open", { sessionId: snapshot.activity?.sessionId });
    const main = await WebviewWindow.getByLabel("main");
    await main?.show();
    await main?.setFocus();
  };

  const beginDrag = () => {
    movedDuringPointer.current = false;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const visibleError = assetError ? (zh ? "宠物包无效，已回退到 Hara" : "Invalid pet package; using Hara") : "";
  const title = snapshot.activity?.title || visibleError;

  return (
    <main className={`pet-overlay pet-status-${snapshot.status}`}>
      {(snapshot.status !== "idle" || visibleError) && (
        <button className="pet-activity" title={title} onClick={() => void openActivity()}>
          <span className="pet-status-dot" />
          <span className="pet-activity-copy">
            <strong>{visibleError || statusText(snapshot.status, zh)}</strong>
            {title && !visibleError && <small>{title}</small>}
          </span>
          {snapshot.activityCount > 1 && <span className="pet-count">{snapshot.activityCount}</span>}
        </button>
      )}
      <button className="pet-tuck" title={zh ? "收起桌宠" : "Tuck away"} onClick={() => void emitTo("main", "hara-pet-tuck", null)}>
        ×
      </button>
      <button
        className="pet-chat-launch"
        aria-label={zh ? "和 Hara 对话" : "Chat with Hara"}
        title={zh ? "和 Hara 对话" : "Chat with Hara"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void emitTo("main", "hara-pet-chat-open", { sessionId: snapshot.activity?.sessionId })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.4 5.5h13.2a2.4 2.4 0 0 1 2.4 2.4v6.2a2.4 2.4 0 0 1-2.4 2.4h-7.3l-4.7 3v-3H5.4A2.4 2.4 0 0 1 3 14.1V7.9a2.4 2.4 0 0 1 2.4-2.4Z" />
          <circle cx="8" cy="11" r="1" />
          <circle cx="12" cy="11" r="1" />
          <circle cx="16" cy="11" r="1" />
        </svg>
      </button>
      <button className="pet-stage" aria-label={zh ? "打开 Hara" : "Open Hara"} onPointerDown={beginDrag} onClick={() => void openActivity()}>
        {asset && !assetError ? <AtlasPet asset={asset} status={snapshot.status} movement={movement} reduced={reduced} /> : <HaraPet status={snapshot.status} reduced={reduced} />}
      </button>
    </main>
  );
}
