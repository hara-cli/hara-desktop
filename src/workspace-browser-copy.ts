const en = { title: "Browser extension", browser: "Browser", context: "This workspace’s side panel", extension: "Extension", resize: "Resize panel", maximize: "Maximize", restore: "Restore", popOut: "Pop out", hide: "Hide", close: "Close browser extension", add: "Add view", address: "Browser address", open: "Open", loading: "Opening browser extension…",
  rejected: "Only local loopback previews are available here. Login credentials and ordinary websites are not accepted.",
  empty: "Open a local preview here. This fallback browser does not gain chat, connection, task, or Computer Use permissions." };
export type BrowserCopy = typeof en;
const copies: Record<string, BrowserCopy> = {
  en,
  "zh-Hans": { title: "浏览器扩展", browser: "浏览器", context: "本空间的右侧扩展", extension: "扩展", resize: "调整宽度", maximize: "放大", restore: "还原", popOut: "弹出", hide: "收起", close: "关闭浏览器扩展", add: "新增视图", address: "浏览器地址", open: "打开", loading: "正在打开浏览器扩展…",
    rejected: "这里只保留本机回环预览，不接收登录凭据或普通网站。", empty: "在这里打开本机预览。此兜底浏览器不会获得聊天、连接、任务或电脑操作权限。" },
  "zh-Hant": { title: "瀏覽器擴展", browser: "瀏覽器", context: "本空間的右側擴展", extension: "擴展", resize: "調整寬度", maximize: "放大", restore: "還原", popOut: "彈出", hide: "收起", close: "關閉瀏覽器擴展", add: "新增檢視", address: "瀏覽器位址", open: "開啟", loading: "正在開啟瀏覽器擴展…",
    rejected: "這裡只保留本機回環預覽，不接收登入憑據或一般網站。", empty: "在這裡開啟本機預覽。此備用瀏覽器不會獲得聊天、連線、任務或電腦操作權限。" },
};
export function workspaceBrowserCopy(locale?: string): BrowserCopy {
  if (!locale) {
    try { locale = typeof localStorage === "undefined" ? undefined : localStorage.getItem("hara.locale") ?? undefined; } catch { /* cache denial uses system locale */ }
    locale ??= typeof window === "undefined" ? "zh-Hans" : navigator.language;
  }
  return copies[/^zh-(?:hant|tw|hk|mo)(?:-|$)/i.test(locale) ? "zh-Hant" : /^zh/i.test(locale) ? "zh-Hans" : "en"];
}
