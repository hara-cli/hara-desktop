import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import type { PetConfig, PetSnapshot } from "./pets";

export const PET_AWAKE_KEY = "hara.pet.awake";
export const PET_SELECTOR_KEY = "hara.pet.selector";
export const DEFAULT_PET_SELECTOR = "builtin:hara";

const PET_WIDTH = 224;
const PET_HEIGHT = 230;
let windowSync: Promise<void> = Promise.resolve();

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

export async function emitPetConfig(config: PetConfig): Promise<void> {
  if (isTauri()) await emitTo("pet", "hara-pet-config", config);
}

export async function emitPetState(snapshot: PetSnapshot): Promise<void> {
  if (isTauri()) await emitTo("pet", "hara-pet-state", snapshot);
}
