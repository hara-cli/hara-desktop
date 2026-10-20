import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { checkDesktopUpdate, DesktopUpdaterArchitectureError, desktopUpdaterErrorText } from "./desktop-updater";
import { WorkspaceUpdater, updateDefaults, UPDATE_SNOOZE_KEY } from "./workspace-updater-state";
import type { WorkspaceDevModel } from "./workspace-dev-state";

export interface DesktopVersionInfo { desktop: string; engine: string; channel: string; arch: string; isolatedCandidate?: boolean }
export function useWorkspaceUpdater(model: WorkspaceDevModel, enabled: boolean) {
  const [controller] = useState(() => new WorkspaceUpdater({
    check: () => checkDesktopUpdate(),
    load: async () => {
      const value = (await model.preferences()).updates ?? updateDefaults();
      // Migrate only the known, non-secret snooze preference from the current webview cache.
      if (!value.snooze) try { const old = JSON.parse(localStorage.getItem(UPDATE_SNOOZE_KEY) ?? "null");
        if (old && typeof old.version === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(old.version) && typeof old.until === "number") value.snooze = { version: old.version, until: old.until };
      } catch { /* Invalid cache never overrides stable preferences. */ }
      return value;
    },
    save: async value => { await model.saveUpdatePreferences(value); try { localStorage.setItem(UPDATE_SNOOZE_KEY, JSON.stringify(value.snooze)); } catch { /* Stable host store is authoritative. */ } },
    activity: () => model.activity(), prepare: () => model.prepareUpdate(), release: id => model.releaseUpdate(id),
    restart: () => invoke("desktop_restart_for_update"),
    error: error => error instanceof DesktopUpdaterArchitectureError ? desktopUpdaterErrorText("zh", error)
      : /signature|minisign|verification/i.test(String(error)) ? "更新套件签名验证失败，已停止安装。当前版本仍可正常使用。"
      : "暂时无法检查或下载更新。请检查网络后重试；当前版本仍可正常使用。",
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
export function WorkspaceSoftwareUpdate({ controller, info }: { controller: WorkspaceUpdater; info: DesktopVersionInfo | null }) {
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [copied, setCopied] = useState(false);
  const { t } = useWorkspaceLocale();
  if (info?.isolatedCandidate) return <section className="wss-page-card"><h2>{t("ws.updates.candidate")}</h2><p>{t("ws.updates.candidateNote")}</p>
    <dl><dt>Desktop</dt><dd>{info.desktop}</dd><dt>{t("ws.updates.engine")}</dt><dd>{info.engine}</dd><dt>{t("ws.updates.channel")}</dt><dd>{info.channel}</dd><dt>{t("ws.updates.arch")}</dt><dd>{info.arch}</dd></dl>
    <button onClick={() => void navigator.clipboard.writeText(`Hara Desktop ${info.desktop}\nCore ${info.engine}\n${info.channel} / ${info.arch}`).then(() => setCopied(true)).catch(() => setCopied(false))}>{t(copied ? "ws.updates.copied" : "ws.updates.copy")}</button></section>;
  const percent = value.total ? Math.min(100, Math.floor(value.downloaded / value.total * 100)) : null;
  const title = { latest: value.preferences.lastChecked ? "Hara 已是最新版本" : "检查 Hara 更新", checking: "正在检查更新…", available: `发现新版本 Hara ${value.version}`,
    downloading: `正在下载并校验 ${value.version}`, ready: "更新已就绪", error: "暂时无法检查更新" }[value.phase];
  return <section className="wss-updates" aria-label="软件更新">
    <p>Hara 启动后约 30 秒检查一次，之后每 6 小时检查。重启前一定会先问你，不会打断同事。</p>
    <article className={`wss-update-card is-${value.phase}`} data-update-state={value.phase} aria-live="polite"><span className="wss-update-symbol" aria-hidden>{value.phase === "latest" ? "✓" : value.phase === "error" ? "!" : "↻"}</span>
      <div><h2>{title}</h2><p>{value.phase === "ready" ? "已通过签名校验。你确认后才会安装并重启。" : value.phase === "downloading" ? "你可以继续工作。" : value.phase === "checking" ? "通常几秒完成。" : `当前版本 ${info?.desktop ?? "正在读取"}`}</p>
        {value.phase === "available" && value.notes ? <details><summary>完整更新说明</summary><pre>{value.notes}</pre></details> : null}
        {value.phase === "downloading" ? <><progress max={value.total ?? 1} value={value.total ? value.downloaded : undefined} aria-label="更新下载进度" /><span>{percent === null ? `${Math.round(value.downloaded / 1024)} KB` : `${percent}%`}</span></> : null}
        <div className="wsd-card-actions">
          {["latest", "error"].includes(value.phase) ? <button className="wsd-primary" onClick={() => void controller.check(true)}>检查更新</button> : null}
          {value.phase === "available" ? <><button className="wsd-primary" onClick={() => void controller.download()}>下载并更新</button><button onClick={() => void controller.later()}>稍后提醒</button><button onClick={() => void controller.skip()}>跳过此版本</button></> : null}
          {value.phase === "ready" ? <><button className="wsd-primary" disabled={value.installing} onClick={() => void controller.restart()}>{value.installing ? "正在安装…" : "现在重启"}</button><button disabled={value.installing} onClick={() => controller.hideNotice()}>稍后</button></> : null}
        </div></div></article>
    {value.message ? <p role="status" className="wss-callout">{value.message}</p> : null}
    <div className="wss-setting-row"><div><strong>自动检查更新</strong><p>上次检查：{value.preferences.lastChecked ? new Date(value.preferences.lastChecked).toLocaleString() : "尚未检查"}</p></div>
      <button role="switch" aria-label="自动检查更新" aria-checked={value.preferences.autoCheck} onClick={() => void controller.setAutoCheck(!value.preferences.autoCheck)} className="wss-switch"><span /></button></div>
    <div className="wss-setting-row"><div><strong>接收预览版</strong><p>以后提供</p></div><button role="switch" aria-label="接收预览版，以后提供" aria-checked="false" disabled className="wss-switch"><span /></button></div>
    <section className="wss-version"><h3>版本信息</h3><dl><dt>Desktop</dt><dd>{info?.desktop ?? "—"}</dd><dt>引擎</dt><dd>{info?.engine ?? "—"}</dd><dt>渠道</dt><dd>{info?.channel ?? "—"}</dd><dt>架构</dt><dd>{info?.arch ?? "—"}</dd></dl>
      <button disabled={!info} onClick={() => { if (!info) return; void navigator.clipboard.writeText(`Hara Desktop ${info.desktop}\n引擎 ${info.engine}\n渠道 ${info.channel}\n架构 ${info.arch}`).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "已复制" : "复制版本信息"}</button></section>
  </section>;
}
export function WorkspaceUpdateNotice({ controller, onView }: { controller: WorkspaceUpdater; onView: () => void }) {
  const value = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!value.notice || !value.version) return null;
  return <aside className="wss-update-toast" role="status"><strong>{value.phase === "ready" ? "Hara 更新已就绪" : `Hara 有新版本 ${value.version}`}</strong><p>你的工作不会被打断。</p>
    <div className="wsd-card-actions"><button onClick={onView}>查看</button>{value.phase === "available" ? <><button className="wsd-primary" onClick={() => void controller.download()}>立即更新</button><button onClick={() => void controller.later()}>稍后</button><button onClick={() => void controller.skip()}>跳过此版本</button></> : <button onClick={() => controller.hideNotice()}>稍后</button>}</div></aside>;
}
