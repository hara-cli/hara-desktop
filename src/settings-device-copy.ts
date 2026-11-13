import type { Key, makeT } from "./i18n";

type Translator = ReturnType<typeof makeT>;
export type SettingsDevicePlatform = "mac" | "windows" | "other";
/** Renderer platform names only label the device; they say nothing about Core's vault capability. */
export function settingsDevicePlatform(platform?: string): SettingsDevicePlatform {
  const value = platform ?? (typeof navigator === "undefined" ? "" : navigator.platform);
  return /^(mac|darwin)/i.test(value) ? "mac" : /^win/i.test(value) ? "windows" : "other";
}
const COPY: Partial<Record<Key, Key>> = {
  "ws.settings.savedHere": "ws.settings.deviceCopy.savedHere",
  "ws.settings.detail.overview": "ws.settings.deviceCopy.overview",
  "ws.settings.detail.appearance": "ws.settings.deviceCopy.appearance",
  "ws.theme.note": "ws.settings.deviceCopy.themeNote",
  "ws.updates.archMismatch": "ws.settings.deviceCopy.archMismatch",
  "ws.runtimeAccess.host": "ws.settings.deviceCopy.host",
  "ws.runtimeAccess.hostRecommended": "ws.settings.deviceCopy.hostRecommended",
  "ws.runtimeAccess.hostRecommendedRuntime": "ws.settings.deviceCopy.hostRecommendedRuntime",
  "ws.runtimeAccess.switchHost": "ws.settings.deviceCopy.switchHost",
  "ws.runtimes.check.network": "ws.settings.deviceCopy.network",
  "ws.connections.confirmMigrate": "ws.settings.deviceCopy.confirmMigrate",
  "ws.connections.deleteNote": "ws.settings.deviceCopy.deleteNote",
  "ws.connections.importConfirmNote": "ws.settings.deviceCopy.importNote",
  "ws.connections.keyNote": "ws.settings.deviceCopy.keyNote",
  "ws.connections.migrationPending": "ws.settings.deviceCopy.migrationPending",
  "ws.connections.savedKey": "ws.settings.deviceCopy.savedKey",
  "ws.connections.keyNoteShort": "ws.settings.deviceCopy.keyShort",
  "ws.connections.keyNoteFirst": "ws.settings.deviceCopy.keyFirst",
};
/** Settings-only copy until Core supplies its authenticated backend descriptor. Onboarding keeps its own copy. */
export function settingsTranslator(t: Translator, platform = settingsDevicePlatform()): Translator {
  return (key, values) => t(key === "ws.settings.device"
    ? platform === "mac" ? "ws.settings.deviceCopy.mac" : platform === "windows" ? "ws.settings.deviceCopy.windows" : "ws.settings.deviceCopy.other"
    : Object.hasOwn(COPY, key) ? COPY[key]! : key, values);
}
