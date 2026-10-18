import { useState } from "react";
import ExtensionDock from "./ExtensionDock";
import type { ExtensionDockMode } from "./extension-dock-state";

/** Keep the existing extension dock/browser surface available in v1. A browser view is not a
 * Computer Use permission, workspace session, or place to put model/transport credentials. */
export default function WorkspaceBrowserExtension({ label, onClose }: { label: string; onClose(): void }) {
  const [address, setAddress] = useState(""), [url, setURL] = useState(""), [error, setError] = useState(""), [mode, setMode] = useState<ExtensionDockMode>("docked");
  const open = () => { try { const value = new URL(address);
    if (!["https:", "http:"].includes(value.protocol) || value.username || value.password || !["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)) throw new Error();
    setURL(value.href); setError("");
  } catch { setError("这里只保留原有的本机回环预览，不接收登录凭据。普通网页内嵌与控制规则待确认，尚未开放。"); } };
  return <div className="wsd-browser-extension"><ExtensionDock kind="browser" kindLabel="浏览器" title="浏览器扩展" source={label} context="本空间的右侧扩展" mode={mode}
    onModeChange={setMode} onClose={onClose} copy={{ extension: "扩展", resize: "调整宽度", maximize: "展开", restore: "还原", popOut: "弹出", hide: "收起", close: "关闭浏览器扩展", add: "新增视图" }}>
    <form className="wsd-browser-address" onSubmit={event => { event.preventDefault(); open(); }}><input aria-label="浏览器地址" type="url" value={address} onChange={event => setAddress(event.target.value)} placeholder="https://…" autoComplete="off" /><button>打开</button></form>
    {error ? <p role="alert">{error}</p> : null}{url ? <iframe key={url} src={url} title="浏览器扩展" sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer" />
      : <p className="wsd-sidebar-note">在这里打开本机预览。普通网页、网站授权和浏览数据隔离方案待确认；该扩展不会获得聊天、连接或任务权限。</p>}
  </ExtensionDock></div>;
}
