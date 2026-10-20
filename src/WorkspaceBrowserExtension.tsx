import { useState, type RefObject } from "react";
import ExtensionDock from "./ExtensionDock";
import type { ExtensionDockMode } from "./extension-dock-state";
import type { BrowserCopy } from "./workspace-browser-copy";

/** Keep the existing extension dock/browser surface available in v1. A browser view is not a
 * Computer Use permission, workspace session, or place to put model/transport credentials. */
export default function WorkspaceBrowserExtension({ label, copy, mode, onModeChange, onWidthChange, resizeContainerRef, onClose }: {
  copy: BrowserCopy;
  label: string; mode: ExtensionDockMode; onModeChange(mode: ExtensionDockMode): void; onWidthChange(width: number): void;
  resizeContainerRef: RefObject<HTMLElement | null>; onClose(): void;
}) {
  const [address, setAddress] = useState(""), [url, setURL] = useState(""), [rejected, setRejected] = useState(false);
  const open = () => { try { const value = new URL(address);
    if (!["https:", "http:"].includes(value.protocol) || value.username || value.password || !["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)) throw new Error();
    setURL(value.href); setRejected(false);
  } catch { setRejected(true); } };
  return <div className="wsd-browser-extension"><ExtensionDock kind="browser" kindLabel={copy.browser} title={copy.title} source={label} context={copy.context} mode={mode}
    onModeChange={onModeChange} onWidthChange={onWidthChange} resizeContainerRef={resizeContainerRef} onClose={onClose} copy={copy}>
    <form className="wsd-browser-address" onSubmit={event => { event.preventDefault(); open(); }}><input aria-label={copy.address} type="url" value={address} onChange={event => setAddress(event.target.value)} placeholder="http://localhost:…" autoComplete="off" /><button>{copy.open}</button></form>
    {rejected ? <p role="alert">{copy.rejected}</p> : null}{url ? <iframe key={url} src={url} title={copy.title} sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" />
      : <p className="wsd-sidebar-note">{copy.empty}</p>}
  </ExtensionDock></div>;
}
