import { SettingsActionResult } from "./SettingsActionDialog";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SettingsAdvanced } from "./SettingsChrome";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { checkDesktopUpdate, DesktopUpdaterArchitectureError } from "./desktop-updater";
import { WorkspaceUpdater, updateDefaults, UPDATE_SNOOZE_KEY } from "./workspace-updater-state";
import type { Key } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import { ToggleSwitch } from "./ToggleSwitch";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { createEngineFreeUpdater, engineUnreachable, readLocalUpdatePreferences, withEngineOffline, writeLocalUpdatePreferences } from "./workspace-update-offline";

export interface DesktopVersionInfo { desktop: string; engine: string; channel: string; arch: string; isolatedCandidate?: boolean }
const updaterErrorKey = (error: unknown) => error instanceof DesktopUpdaterArchitectureError ? "ws.updates.archMismatch"
  : /signature|minisign|verification/i.test(String(error)) ? "ws.updates.signatureFailed"
  : "ws.updates.networkFailed";
const engineStopped = () => invoke<boolean>("workspace_engine_stopped");
const webStorage = () => { try { return localStorage; } catch { return null; } };
export function useWorkspaceUpdater(model: WorkspaceDevModel, enabled: boolean) {
  const [controller] = useState(() => new WorkspaceUpdater({
    check: () => checkDesktopUpdate(),
    load: async () => {
      // A lost engine must not silently switch automatic checks off (HARA-FB-001698).
      let value: ReturnType<typeof updateDefaults>; try { value = (await model.preferences()).updates ?? updateDefaults(); }
      catch (error) { if (engineUnreachable(error)) return readLocalUpdatePreferences(webStorage()); throw error; }
      // Migrate only the known, non-secret snooze preference from the current webview cache.
      if (!value.snooze) try { const old = JSON.parse(localStorage.getItem(UPDATE_SNOOZE_KEY) ?? "null");
        if (old && typeof old.version === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(old.version) && typeof old.until === "number") value.snooze = { version: old.version, until: old.until };
      } catch { /* Invalid cache never overrides stable preferences. */ }
      return value;
    },
    save: async value => { writeLocalUpdatePreferences(webStorage(), value); await model.saveUpdatePreferences(value); try { localStorage.setItem(UPDATE_SNOOZE_KEY, JSON.stringify(value.snooze)); } catch { /* Stable host store is authoritative. */ } },
    // A live engine keeps its idle lease; only an unreachable engine that Desktop shows stopped is bypassed.
    activity: () => withEngineOffline(() => model.activity(), { running: 0 }, engineStopped),
    prepare: () => withEngineOffline(() => model.prepareUpdate(), { id: "" }, engineStopped),
    release: id => id ? model.releaseUpdate(id) : Promise.resolve(),
    restart: () => invoke("desktop_restart_for_update"),
    error: updaterErrorKey,
  }));
  const [info, setInfo] = useState<DesktopVersionInfo | null>(null);
  const infoRef = useRef<DesktopVersionInfo | null>(null);
  useEffect(() => { let active = true; if (enabled && isTauri()) void invoke<DesktopVersionInfo>("desktop_update_info").then(value => { if (active) { setInfo(value); infoRef.current = value; if (enabled && !value.isolatedCandidate) void controller.start(); } }).catch(() => {});
    const wake = () => { if (enabled && infoRef.current && !infoRef.current.isolatedCandidate && document.visibilityState !== "hidden") void controller.wake(); };
    window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
    return () => { active = false; window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); controller.dispose(); };
  }, [controller, enabled]);
  return { controller, info };
}
/** Startup-failure screen: check, download and install without any engine RPC (HARA-FB-001698). */
export function WorkspaceBootUpdate() {
  const [controller] = useState(() => createEngineFreeUpdater({ check: () => checkDesktopUpdate(), engineStopped,
    restart: () => invoke("desktop_restart_for_update"), storage: webStorage(), error: updaterErrorKey }));
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { t } = useWorkspaceLocale();
  useEffect(() => { let active = true;
    if (isTauri()) void invoke<DesktopVersionInfo>("desktop_update_info").then(async info => {
      if (!active || info.isolatedCandidate) return; await controller.start();
      if (active && controller.getSnapshot().preferences.autoCheck) void controller.check(false);
    }).catch(() => {});
    return () => { active = false; controller.dispose(); };
  }, [controller]);
  const title: Record<typeof value.phase, Key> = { latest: value.preferences.lastChecked ? "ws.updates.latest" : "ws.updates.checkTitle", checking: "ws.updates.checking",
    available: "ws.updates.available", downloading: "ws.updates.downloading", ready: "ws.updates.ready", error: "ws.updates.failed" };
  return <section className="wsd-boot-update" data-update-state={value.phase} aria-live="polite">
    <p>{t(title[value.phase], { version: value.version })}</p>
    {value.phase === "downloading" ? <progress max={value.total ?? 1} value={value.total ? value.downloaded : undefined} aria-label={t("ws.updates.progress")} /> : null}
    {value.message ? <p role="status">{workspaceMessageText(t, value.message)}</p> : null}
    <div className="wsd-card-actions">
      {["latest", "error"].includes(value.phase) ? <button type="button" className="hs-btn sec" onClick={() => void controller.check(true)}>{t("ws.updates.check")}</button> : null}
      {value.phase === "available" ? <button type="button" className="hs-btn" onClick={() => void controller.download()}>{t("ws.updates.download")}</button> : null}
      {value.phase === "ready" ? <button type="button" className="hs-btn" disabled={value.installing} onClick={() => void controller.restart()}>{t(value.installing ? "ws.updates.installing" : "ws.updates.restart")}</button> : null}
    </div>
  </section>;
}
export function WorkspaceSoftwareUpdate({ controller, info }: { controller: WorkspaceUpdater; info: DesktopVersionInfo | null }) {
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  const { locale, t } = useWorkspaceLocale();
  const copyVersion = async () => {
    if (!info) return; setCopyFailed(false);
    try { await navigator.clipboard.writeText(`Hara Desktop ${info.desktop}\nCore ${info.engine}\n${info.channel} / ${info.arch}`); setCopied(true); }
    catch { setCopied(false); setCopyFailed(true); }
  };
  if (info?.isolatedCandidate) return <section className="wss-page-card"><h2>{t("ws.updates.candidate")}</h2><p>{t("ws.updates.candidateNote")}</p>
    <dl><dt>Desktop</dt><dd>{info.desktop}</dd><dt>{t("ws.updates.engine")}</dt><dd>{info.engine}</dd><dt>{t("ws.updates.channel")}</dt><dd>{info.channel}</dd><dt>{t("ws.updates.arch")}</dt><dd>{info.arch}</dd></dl>
    <button onClick={() => void copyVersion()}>{t(copied ? "ws.updates.copied" : "ws.updates.copy")}</button><SettingsActionResult text={copyFailed ? t("ws.updates.copyFailed") : ""} error /></section>;
  const percent = value.total ? Math.min(100, Math.floor(value.downloaded / value.total * 100)) : null;
  const titles: Record<typeof value.phase, Key> = {
    latest: value.preferences.lastChecked ? "ws.updates.latest" : "ws.updates.checkTitle",
    checking: "ws.updates.checking", available: "ws.updates.available",
    downloading: "ws.updates.downloading", ready: "ws.updates.ready", error: "ws.updates.failed",
  };
  return <section className="wss-updates" aria-label={t("ws.settings.page.updates")}>
    <article className={`wss-update-card is-${value.phase}`} data-update-state={value.phase} aria-live="polite"><span className="wss-update-symbol" aria-hidden>{value.phase === "latest" ? "✓" : value.phase === "error" ? "!" : "↻"}</span>
      <div><h2>{t(titles[value.phase], { version: value.version })}</h2><p>{value.phase === "ready" ? t("ws.updates.readyNote") : value.phase === "downloading" ? t("ws.updates.working") : value.phase === "checking" ? t("ws.updates.checkNote") : t("ws.updates.current", { version: info?.desktop ?? t("ws.updates.reading") })}</p>
        {value.phase === "available" && value.notes ? <details><summary>{t("ws.updates.notes")}</summary><pre>{value.notes}</pre></details> : null}
        {value.phase === "downloading" ? <><progress max={value.total ?? 1} value={value.total ? value.downloaded : undefined} aria-label={t("ws.updates.progress")} /><span>{percent === null ? `${Math.round(value.downloaded / 1024)} KB` : `${percent}%`}</span></> : null}
        <div className="wsd-card-actions">
          {["latest", "error"].includes(value.phase) ? <button className="wsd-primary" onClick={() => void controller.check(true)}>{t("ws.updates.check")}</button> : null}
          {value.phase === "available" ? <><button className="wsd-primary" onClick={() => void controller.download()}>{t("ws.updates.download")}</button><button onClick={() => void controller.later()}>{t("ws.updates.remind")}</button><button onClick={() => void controller.skip()}>{t("ws.updates.skip")}</button></> : null}
          {value.phase === "ready" ? <><button className="wsd-primary" disabled={value.installing} onClick={() => void controller.restart()}>{t(value.installing ? "ws.updates.installing" : "ws.updates.restart")}</button><button disabled={value.installing} onClick={() => controller.hideNotice()}>{t("ws.updates.later")}</button></> : null}
        </div></div></article>
    {value.message ? <p role="status" className="wss-callout">{workspaceMessageText(t, value.message)}</p> : null}
    <div className="wss-setting-row"><div><strong>{t("ws.updates.auto")}</strong><p>{t("ws.updates.lastChecked", { time: value.preferences.lastChecked ? new Date(value.preferences.lastChecked).toLocaleString(locale) : t("ws.updates.neverChecked") })}</p></div>
      <ToggleSwitch label={t("ws.updates.auto")} checked={value.preferences.autoCheck} onCheckedChange={checked => void controller.setAutoCheck(checked)} /></div>
    {/* «Receive previews» is not released yet, so it has no entry (settings IA audit; DESIGN.md §11.6). */}
    <SettingsAdvanced page="updates" items={[t("ws.updates.cadenceShort"), t("ws.updates.versionForReports")]}>
      <p>{t("ws.updates.cadence")}</p>
    <section className="wss-version"><h3>{t("ws.updates.versionForReports")}</h3><dl><dt>Desktop</dt><dd>{info?.desktop ?? "—"}</dd><dt>{t("ws.updates.engine")}</dt><dd>{info?.engine ?? "—"}</dd><dt>{t("ws.updates.channel")}</dt><dd>{info?.channel ?? "—"}</dd><dt>{t("ws.updates.arch")}</dt><dd>{info?.arch ?? "—"}</dd></dl>
      <button disabled={!info} onClick={() => void copyVersion()}>{t(copied ? "ws.updates.copied" : "ws.updates.copy")}</button><SettingsActionResult text={copyFailed ? t("ws.updates.copyFailed") : ""} error /></section>
    </SettingsAdvanced>
  </section>;
}
export function WorkspaceUpdateNotice({ controller, onView }: { controller: WorkspaceUpdater; onView: () => void }) {
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { t } = useWorkspaceLocale();
  if (!value.notice || !value.version) return null;
  return <aside className="wss-update-toast" role="status"><strong>{t(value.phase === "ready" ? "ws.updates.toastReady" : "ws.updates.toastAvailable", { version: value.version })}</strong><p>{t("ws.updates.uninterrupted")}</p>
    <div className="wsd-card-actions"><button onClick={onView}>{t("ws.updates.view")}</button>{value.phase === "available" ? <><button className="wsd-primary" onClick={() => void controller.download()}>{t("ws.updates.now")}</button><button onClick={() => void controller.later()}>{t("ws.updates.later")}</button><button onClick={() => void controller.skip()}>{t("ws.updates.skip")}</button></> : <button onClick={() => controller.hideNotice()}>{t("ws.updates.later")}</button>}</div></aside>;
}
