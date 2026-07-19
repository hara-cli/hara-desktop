import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, monitorFromPoint } from "@tauri-apps/api/window";
import type { PetChatState, PetConfig, PetSnapshot } from "./pets";

export const PET_AWAKE_KEY = "hara.pet.awake";
export const PET_SELECTOR_KEY = "hara.pet.selector";
export const DEFAULT_PET_SELECTOR = "builtin:hara";

const PET_WIDTH = 224;
const PET_HEIGHT = 230;
const PET_CHAT_WIDTH = 380;
const PET_CHAT_HEIGHT = 360;
let windowSync: Promise<void> = Promise.resolve();
let chatWindowSync: Promise<void> = Promise.resolve();

function readNumber(key: string): number | undefined {
  const raw = localStorage.getItem(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function initialPosition(): Promise<{ x?: number; y?: number }> {
  const savedX = readNumber("hara.pet.x");
  const savedY = readNumber("hara.pet.y");
  if (savedX !== undefined && savedY !== undefined) return { x: savedX, y: savedY };
  const monitor = await currentMonitor().catch(() => null);
  if (!monitor) return {};
  const scale = monitor.scaleFactor || 1;
  const left = monitor.position.x / scale;
  const top = monitor.position.y / scale;
  const width = monitor.size.width / scale;
  const height = monitor.size.height / scale;
  return {
    x: Math.round(left + width - PET_WIDTH - 28),
    y: Math.round(top + height - PET_HEIGHT - 52),
  };
}

async function petChatPosition(): Promise<{ x?: number; y?: number }> {
  const pet = await WebviewWindow.getByLabel("pet");
  const petPosition = await pet?.outerPosition().catch(() => null);
  const petScale = await pet?.scaleFactor().catch(() => 1) || 1;
  const petMonitor = petPosition
    ? await monitorFromPoint(
        petPosition.x + (PET_WIDTH * petScale) / 2,
        petPosition.y + (PET_HEIGHT * petScale) / 2,
      ).catch(() => null)
    : null;
  const monitor = petMonitor ?? await currentMonitor().catch(() => null);
  if (!monitor) return {};
  const scale = monitor.scaleFactor || 1;
  const left = monitor.position.x / scale;
  const top = monitor.position.y / scale;
  const width = monitor.size.width / scale;
  const height = monitor.size.height / scale;
  const petX = petPosition ? petPosition.x / scale : left + width - PET_WIDTH - 28;
  const petY = petPosition ? petPosition.y / scale : top + height - PET_HEIGHT - 52;
  let x = petX - PET_CHAT_WIDTH - 12;
  if (x < left + 12) x = petX + PET_WIDTH + 12;
  x = Math.max(left + 12, Math.min(x, left + width - PET_CHAT_WIDTH - 12));
  const y = Math.max(
    top + 12,
    Math.min(petY + PET_HEIGHT - PET_CHAT_HEIGHT, top + height - PET_CHAT_HEIGHT - 12),
  );
  return { x: Math.round(x), y: Math.round(y) };
}

async function applyPetWindow(awake: boolean): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel("pet");
  if (!awake) {
    await existing?.hide();
    return;
  }
  if (existing) {
    await existing.show();
    return;
  }
  const position = await initialPosition();
  const pet = new WebviewWindow("pet", {
    url: "/?pet=1",
    title: "Hara Pet",
    width: PET_WIDTH,
    height: PET_HEIGHT,
    minWidth: PET_WIDTH,
    minHeight: PET_HEIGHT,
    maxWidth: PET_WIDTH,
    maxHeight: PET_HEIGHT,
    ...position,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    shadow: false,
    focus: false,
    focusable: false,
    preventOverflow: true,
  });
  void pet.once("tauri://error", (event) => console.error("could not create Hara pet window", event.payload));
}

/** StrictMode and rapid settings clicks can request opposite window states in one tick; serialize them. */
export function syncPetWindow(awake: boolean): Promise<void> {
  windowSync = windowSync.catch(() => {}).then(() => applyPetWindow(awake));
  return windowSync;
}

async function applyPetChatWindow(open: boolean): Promise<void> {
  if (!isTauri()) return;
  const existing = await WebviewWindow.getByLabel("pet-chat");
  if (!open) {
    await existing?.hide();
    return;
  }
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const position = await petChatPosition();
  const chat = new WebviewWindow("pet-chat", {
    // The production build injects connect-src 'none' into the dedicated entry document. Tauri
    // capability scopes native IPC only; CSP independently blocks browser exfiltration here.
    url: "/pet-chat.html",
    title: "Hara Companion",
    width: PET_CHAT_WIDTH,
    height: PET_CHAT_HEIGHT,
    minWidth: PET_CHAT_WIDTH,
    minHeight: PET_CHAT_HEIGHT,
    maxWidth: PET_CHAT_WIDTH,
    maxHeight: PET_CHAT_HEIGHT,
    ...position,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    shadow: true,
    focus: true,
    focusable: true,
    preventOverflow: true,
  });
  void chat.once("tauri://error", (event) => console.error("could not create Hara companion chat", event.payload));
}

/** The focusable chat is a separate least-privilege webview; the draggable pet remains non-focusable. */
export function syncPetChatWindow(open: boolean): Promise<void> {
  chatWindowSync = chatWindowSync.catch(() => {}).then(() => applyPetChatWindow(open));
  return chatWindowSync;
}

export async function emitPetConfig(config: PetConfig): Promise<void> {
  if (isTauri()) await emitTo("pet", "hara-pet-config", config);
}

export async function emitPetState(snapshot: PetSnapshot): Promise<void> {
  if (isTauri()) await emitTo("pet", "hara-pet-state", snapshot);
}

export async function emitPetChatState(state: PetChatState): Promise<void> {
  if (isTauri()) await emitTo("pet-chat", "hara-pet-chat-state", state);
}
