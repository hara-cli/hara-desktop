// HARA-FB-001698: Desktop updates must still reach users whose Workspace engine cannot start or attach.
// Check, signed download and install use only the native updater; the engine's idle lease is replaced
// by a native "no engine is running or starting" answer, and any doubt keeps the install refused.
import { WorkspaceUpdater, updateDefaults, type UpdateHandle, type UpdatePreferences } from "./workspace-updater-state.ts";

export const LOCAL_UPDATE_PREFERENCES_KEY = "hara.desktopUpdatePreferences";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const version = (value: unknown) => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value);

/** Transport-level absence only. A live engine's refusal (busy, admission race) is never "unreachable". */
export function engineUnreachable(error: unknown) {
  const key = (error as { messageKey?: unknown } | null)?.messageKey;
  return key === "ws.rpc.notConnected" || key === "ws.rpc.transportLost";
}

export function readLocalUpdatePreferences(storage: Storage | null): UpdatePreferences {
  try {
    const value = JSON.parse(storage?.getItem(LOCAL_UPDATE_PREFERENCES_KEY) ?? "null");
    if (!value || typeof value !== "object" || typeof value.autoCheck !== "boolean") return updateDefaults();
    return { autoCheck: value.autoCheck, lastChecked: Number.isSafeInteger(value.lastChecked) ? value.lastChecked : null,
      skippedVersion: version(value.skippedVersion) ? value.skippedVersion : null,
      snooze: value.snooze && version(value.snooze.version) && Number.isSafeInteger(value.snooze.until) ? { version: value.snooze.version, until: value.snooze.until } : null };
  } catch { return updateDefaults(); }
}

export function writeLocalUpdatePreferences(storage: Storage | null, value: UpdatePreferences) {
  try { storage?.setItem(LOCAL_UPDATE_PREFERENCES_KEY, JSON.stringify(value)); } catch { /* the in-memory value still applies */ }
}

/** Fall back to the native answer only when the engine is unreachable AND natively shown stopped. */
export async function withEngineOffline<T>(primary: () => Promise<T>, offline: T, engineStopped: () => Promise<boolean>): Promise<T> {
  try { return await primary(); }
  catch (error) {
    if (engineUnreachable(error) && await engineStopped().catch(() => false)) return offline;
    throw error;
  }
}

/** Updater for the startup-failure screen, where no engine RPC exists at all. */
export function createEngineFreeUpdater(deps: { check(): Promise<UpdateHandle | null>; engineStopped(): Promise<boolean>; restart(): Promise<void>;
  storage: Storage | null; error(error: unknown): string; now?: () => number }) {
  const stopped = () => deps.engineStopped().catch(() => false);
  return new WorkspaceUpdater({
    check: deps.check, restart: deps.restart, error: deps.error, now: deps.now,
    load: async () => readLocalUpdatePreferences(deps.storage),
    save: async value => writeLocalUpdatePreferences(deps.storage, value),
    activity: async () => ({ running: await stopped() ? 0 : 1 }),
    prepare: async () => { if (!await stopped()) throw new Error("A Workspace engine may be running"); return { id: "" }; },
    release: async () => {},
  });
}
