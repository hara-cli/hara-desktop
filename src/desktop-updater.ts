import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  assertMacUpdaterManifestTarget,
  type MacUpdaterTarget,
} from "./desktop-updater-policy";

export {
  DesktopUpdaterArchitectureError,
  assertMacUpdaterManifestTarget,
  desktopUpdaterErrorText,
} from "./desktop-updater-policy";
export type { MacUpdaterTarget } from "./desktop-updater-policy";

/**
 * macOS updates use the compile-time architecture reported by the native shell. Other platforms keep
 * Tauri's installer-aware default target selection (for example MSI versus NSIS on Windows).
 */
export async function checkDesktopUpdate(): Promise<Update | null> {
  const target = await invoke<MacUpdaterTarget | null>("desktop_updater_target");
  const candidate = await check(target ? { target } : undefined);
  if (!candidate || !target) return candidate;
  try {
    assertMacUpdaterManifestTarget(candidate.rawJson, target);
    return candidate;
  } catch (error) {
    await candidate.close().catch(() => {});
    throw error;
  }
}
