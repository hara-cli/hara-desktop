import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import type { Locale } from "./i18n";

export type MacUpdaterTarget = "darwin-x86_64" | "darwin-aarch64";

export class DesktopUpdaterArchitectureError extends Error {
  constructor() {
    super("desktop updater architecture mismatch");
    this.name = "DesktopUpdaterArchitectureError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Fail closed if a macOS manifest maps the selected target to the other CPU architecture. */
export function assertMacUpdaterManifestTarget(
  rawJson: Record<string, unknown>,
  target: MacUpdaterTarget,
): void {
  const platforms = record(rawJson.platforms);
  const entry = record(platforms?.[target]);
  const url = typeof entry?.url === "string" ? entry.url.toLowerCase() : "";
  const expectsIntel = target === "darwin-x86_64";
  const hasIntel = /(?:x86[_-]?64|x64)/u.test(url);
  const hasArm = /(?:aarch64|arm64)/u.test(url);
  if (!url || (expectsIntel ? !hasIntel || hasArm : !hasArm || hasIntel)) {
    throw new DesktopUpdaterArchitectureError();
  }
}

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

export function desktopUpdaterErrorText(locale: Locale, error: unknown): string {
  if (error instanceof DesktopUpdaterArchitectureError) {
    return locale === "zh"
      ? "更新清单中的安装包与本机架构不一致，已停止下载。请稍后重试或使用官网对应的安装包。"
      : "The update package does not match this Mac's architecture, so the download was stopped. Try again later or use the matching installer from the website.";
  }
  return String((error as { message?: unknown } | null)?.message ?? error).slice(0, 160);
}
