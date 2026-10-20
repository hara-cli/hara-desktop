import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowPathIcon, ArrowsPointingInIcon, ArrowsPointingOutIcon, GlobeAltIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { makeT, type Locale } from "./i18n";
import { workspacePreviewURL } from "./workspace-browser-state";
import "./workspace-browser.css";

/** An isolated preview is a sibling of chat, never a modal or execution authority. */
export default function WorkspaceBrowserExtension({ label, locale, inert, onClose }: { label: string; locale: Locale; inert?: boolean; onClose(): void }) {
  const t = makeT(locale);
  const [address, setAddress] = useState(""), [url, setURL] = useState(""), [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false), [reload, setReload] = useState(0);
  const open = () => { const next = workspacePreviewURL(address); setError(next === null); if (next) { setURL(next); setReload(0); } };
  return <aside id="workspace-browser-panel" className={`hs-browser${expanded ? " is-expanded" : ""}`} aria-label={t("ws.browser.title")} inert={inert}>
    <header className="hs-browser-head"><GlobeAltIcon className="hico" /><div className="grow"><strong>{t("ws.browser.title")}</strong><small>{label}</small></div>
      <button className="hs-icon" aria-label={t(expanded ? "ws.browser.restore" : "ws.browser.expand")} aria-pressed={expanded} onClick={() => { setExpanded(value => !value); if (!expanded && isTauri()) void invoke("ensure_extension_window_width").catch(() => {}); }}>
        {expanded ? <ArrowsPointingInIcon className="hico" /> : <ArrowsPointingOutIcon className="hico" />}</button>
      <button className="hs-icon" aria-label={t("ws.browser.close")} onClick={onClose}><XMarkIcon className="hico" /></button></header>
    <form className="hs-browser-address" onSubmit={event => { event.preventDefault(); open(); }}>
      <input aria-label={t("ws.browser.address")} type="url" value={address} onChange={event => setAddress(event.target.value)} placeholder="http://localhost:…" autoComplete="off" />
      <button className="hs-btn sec" type="submit">{t("ws.browser.open")}</button>
      <button className="hs-icon" type="button" aria-label={t("ws.browser.reload")} disabled={!url} onClick={() => setReload(value => value + 1)}><ArrowPathIcon className="hico" /></button>
    </form>
    {error ? <p className="hs-browser-notice" role="alert">{t("ws.browser.invalid")}</p> : null}
    {url ? <iframe key={`${url}:${reload}`} src={url} title={t("ws.browser.title")} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" />
      : <div className="hs-browser-empty"><GlobeAltIcon className="hico" /><h2>{t("ws.browser.empty")}</h2><p>{t("ws.browser.boundary")}</p></div>}
  </aside>;
}
