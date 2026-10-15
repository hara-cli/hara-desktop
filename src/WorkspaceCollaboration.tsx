import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import HaraLogo from "./mark";
import { WorkspaceCollaborationModel, type CollaborationCode, type CollaborationView, type WorkspaceCollaborationTransport } from "./workspace-collaboration-state";
import "./WorkspaceCollaboration.css";
import { WorkspaceChatScroll, submitsWorkspaceMessage } from "./workspace-chat-scroll";

const errors: Record<CollaborationCode, [string, string]> = {
  AUTH_REQUIRED: ["請先登入 Hara 帳號；登入過期時請重新授權。", "Sign in to Hara or renew the expired authorization."],
  SCOPE_CHANGED: ["登入身分已改變。請重新載入工作空間。", "Your sign-in changed. Reload Workspaces."],
  ACCESS_CHANGED: ["權限或內容已改變，請重新載入。舊空間內容已隱藏。", "Access or content changed. Reload; old Workspace content is hidden."],
  PROJECTION_PENDING: ["正在同步工作空間權限，稍後再重新整理。", "Workspace access is still synchronizing. Refresh shortly."],
  DIRECTORY_STALE: ["空間清單的分頁已失效，請重新載入清單。未確認的發送記錄仍保留。", "Workspace pagination expired or changed. Reload the directory; unconfirmed sends are retained."],
  HISTORY_STALE: ["歷史分頁已失效或權限版本已變更，請重新讀取頻道紀錄。待確認的發送仍保留。", "History pagination expired or its access version changed. Reload channel history; unconfirmed sends are retained."],
  INVALID_INPUT: ["內容不符合要求，請檢查輸入。", "Check the input requirements."],
  UNAVAILABLE: ["目前無法連線。未切換到其他服務，也未自動重送。", "Cannot connect. No service fallback or automatic resend occurred."],
  OUTCOME_UNKNOWN: ["尚未確認結果。重試會使用同一個發送編號。", "The outcome is not confirmed. Retry uses the same request identity."],
};
interface ViewProps { view: CollaborationView; model: WorkspaceCollaborationModel; locale: "en" | "zh"; onClose: () => void; onSignIn: () => void }

export function WorkspaceCollaborationView({ view, model, locale, onClose, onSignIn }: ViewProps) {
  const [creating, setCreating] = useState(false);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [exitReview, setExitReview] = useState(false);
  const [unread, setUnread] = useState(false);
  const messagesRef = useRef<HTMLElement>(null);
  const scrolling = useRef(new WorkspaceChatScroll());
  const zh = locale === "zh";
  const copy = (cn: string, en: string) => zh ? cn : en;
  const selected = view.bootstrap?.channels.find(channel => channel.id === view.channelId);
  const membership = view.bootstrap?.membership;
  const canCreate = view.phase === "ready" && (membership?.role === "OWNER" || membership?.role === "ADMIN");
  const messages = view.messages.filter(message => message.channelId === view.channelId);
  const creation = view.creation;
  const formValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80 && displayName.trim().length > 0 && displayName.length <= 160;
  const draftBytes = new TextEncoder().encode(view.draft).length;
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const pendingKey = view.pending?.idempotencyKey ?? null;
  const scrollScope = JSON.stringify([view.workspaceId, view.channelId]);
  useLayoutEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    scrolling.current.layout(node, scrollScope, lastMessageId, pendingKey, view.history.phase === "loading");
    setUnread(scrolling.current.unread);
  }, [scrollScope, lastMessageId, pendingKey, messages.length, view.history.phase]);
  const readOlder = () => {
    if (messagesRef.current) scrolling.current.beforeOlder(messagesRef.current);
    void model.loadHistory(true);
  };
  return <div className="workspace-collaboration" aria-label={copy("協作工作空間", "Collaboration Workspace")}>
    <aside className="workspace-collaboration-sidebar">
      <div className="workspace-collaboration-brand"><HaraLogo size={26} /><strong>Hara</strong><span>Workspace</span></div>
      <label className="workspace-collaboration-select">
        <span>{copy("工作空間", "Workspace")}</span>
        <select value={view.workspaceId ?? ""} disabled={view.directoryBusy || !view.directory?.workspaces.length}
          onChange={event => { setCreating(false); setSlug(""); setDisplayName(""); void model.selectWorkspace(event.target.value); }}>
          <option value="" disabled>{view.directoryBusy ? copy("載入中…", "Loading…") : copy("選擇工作空間", "Choose a Workspace")}</option>
          {view.workspaceId && view.bootstrap && !view.directory?.workspaces.some(item => item.workspaceId === view.workspaceId)
            ? <option value={view.workspaceId}>{view.bootstrap.displayName + copy(" · 清單尚未載入", " · Not in this page")}</option> : null}
          {view.directory?.workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>
            {view.workspaceNames[item.workspaceId] ?? (view.bootstrap?.workspaceId === item.workspaceId ? view.bootstrap.displayName : item.workspaceId)}
          </option>)}
        </select>
      </label>
      <div className="workspace-collaboration-directory-actions">
        <button type="button" disabled={view.directoryBusy} onClick={() => void model.loadDirectory()}>{copy("重新載入", "Reload")}</button>
        {view.directory?.nextCursor ? <button type="button" disabled={view.directoryBusy} onClick={() => void model.loadDirectory(true)}>{copy("更多空間", "More Workspaces")}</button> : null}
      </div>
      <div className="workspace-collaboration-section"><strong>{copy("頻道", "Channels")}</strong>
        {canCreate ? <button type="button" aria-label={copy("新增頻道", "Add channel")} aria-expanded={creating} onClick={() => setCreating(value => !value)}>＋</button> : null}
      </div>
      <nav aria-label={copy("頻道", "Channels")}>
        {view.bootstrap?.channels.map(channel => <button type="button" key={channel.id} aria-current={channel.id === view.channelId ? "page" : undefined}
          onClick={() => model.selectChannel(channel.id)}><span aria-hidden>#</span><span>{channel.displayName}</span></button>)}
        {view.phase === "ready" && !view.bootstrap?.channels.length ? <p>{copy("還沒有頻道", "No channels yet")}</p> : null}
      </nav>
      <div className="workspace-collaboration-local">
        <small>{copy("本機對話與任務仍在運行，未帶入這個空間。", "Local conversations and tasks are still running, outside this Workspace.")}</small>
        {exitReview ? <div className="workspace-collaboration-exit" role="alert">
          <p>{copy("還有未確認的發送或建立請求。離開會清除本機重試編號，但不會撤回伺服器可能已收到的內容。", "Some sends or channel requests are unconfirmed. Leaving clears local retry identities; it does not undo content the server may have received.")}</p>
          <button type="button" onClick={() => setExitReview(false)}>{copy("留下確認", "Stay and check")}</button>
          <button type="button" onClick={onClose}>{copy("仍要離開", "Leave anyway")}</button>
        </div> : <button type="button" onClick={() => model.hasUnresolvedMutations() ? setExitReview(true) : onClose()}>← {copy("返回本機工作空間", "Back to local Workspace")}</button>}
      </div>
    </aside>
    <main className="workspace-collaboration-chat">
      <header className="workspace-collaboration-header">
        <div><h1>{selected ? "# " + selected.displayName : copy("一起協作", "Work together")}</h1><p>{view.bootstrap?.displayName ?? copy("選擇工作空間與頻道開始聊天", "Choose a Workspace and channel to start chatting")}</p></div>
        <button type="button" disabled={view.phase !== "ready" || view.syncing} onClick={() => void model.sync()}>{view.syncing ? copy("同步中…", "Syncing…") : copy("重新整理", "Refresh")}</button>
      </header>
      <div className="workspace-collaboration-boundary">{copy("頻道協作預覽 · 尚未啟用 Agent 執行、檔案或金鑰共享", "Channel collaboration preview · Agent execution, files and key sharing are not enabled")}</div>
      {view.error ? <div className="workspace-collaboration-error" role="alert"><span>{errors[view.error][zh ? 0 : 1]}</span>
        {view.error === "AUTH_REQUIRED" ? <button type="button" onClick={onSignIn}>{copy("帳號授權", "Authorize account")}</button> : null}</div> : null}
      {creating && canCreate ? <form className="workspace-collaboration-create" aria-label={copy("新增頻道", "New channel")} onSubmit={event => { event.preventDefault(); if (formValid) void model.createChannel(slug, displayName); }}>
        <label>{copy("頻道名稱", "Channel name")}<input value={displayName} maxLength={160} disabled={!!creation} onChange={event => setDisplayName(event.target.value)} placeholder={copy("產品研發", "Product development")} /></label>
        <label>{copy("識別名稱（小寫英文、數字或連字號）", "Slug (lowercase, digits or hyphens)")}<input value={slug} maxLength={80} disabled={!!creation} onChange={event => setSlug(event.target.value)} placeholder="development" /></label>
        {creation ? <><p role="status">{creation.state === "sending" ? copy("建立中…", "Creating…") : errors[creation.code ?? "OUTCOME_UNKNOWN"][zh ? 0 : 1]}</p>
          <button type="button" disabled={creation.state === "sending"} onClick={() => void model.createChannel("", "", true)}>{copy("以同一編號重試", "Retry same request")}</button></>
          : <button type="submit" disabled={!formValid}>{copy("建立頻道", "Create channel")}</button>}
      </form> : null}
      <section ref={messagesRef} className="workspace-collaboration-messages" aria-label={copy("訊息", "Messages")}
        aria-busy={view.phase === "loading" || view.history.phase === "loading"}
        onScroll={event => { scrolling.current.observe(event.currentTarget); setUnread(scrolling.current.unread); }}>
        {view.phase === "loading" ? <p className="workspace-collaboration-empty" role="status">{copy("正在載入這個工作空間…", "Loading this Workspace…")}</p> : null}
        {view.phase === "idle" && !view.directoryBusy ? <p className="workspace-collaboration-empty">{view.directory?.workspaces.length === 0
          ? copy("這個帳號還沒有已接入的工作空間。本機聊天仍可使用。", "This account has no enrolled Workspaces. Local chat remains available.")
          : copy("從左側選擇一個工作空間。", "Choose a Workspace on the left.")}</p> : null}
        {view.phase === "ready" && view.history.phase === "unsupported" ? <p className="workspace-collaboration-history-note">{copy("目前顯示本次連線後收到的訊息；較早的歷史尚未接入。", "Showing messages received since this connection; earlier history is not connected yet.")}</p> : null}
        {view.history.phase === "loading" ? <p className="workspace-collaboration-history-note" role="status">{copy("正在讀取頻道紀錄…", "Loading channel history…")}</p> : null}
        {view.history.phase === "error" ? <div className="workspace-collaboration-history-error" role="alert">
          <p>{errors[view.history.error ?? "UNAVAILABLE"][zh ? 0 : 1]}</p>
          <button type="button" onClick={() => void model.loadHistory(view.history.error !== "HISTORY_STALE" && !!view.history.nextBefore)}>{copy("重新讀取", "Retry history")}</button>
        </div> : null}
        {view.history.phase === "ready" && view.history.nextBefore && !view.history.limited ? <button type="button"
          className="workspace-collaboration-history-more" onClick={readOlder}>{copy("載入更早的訊息", "Load earlier messages")}</button> : null}
        {view.history.limited ? <p className="workspace-collaboration-history-note">{copy("本次最多顯示 500 條訊息，重新進入頻道可回到最新紀錄。", "This view holds up to 500 messages. Reopen the channel for the latest history.")}</p> : null}
        {view.history.phase === "ready" && !messages.length ? <p className="workspace-collaboration-empty">{copy("還沒有訊息，打個招呼吧。", "No messages yet. Say hello.")}</p> : null}
        {messages.map(message => <article key={message.id} className={"workspace-collaboration-message" + (message.senderPrincipalId === membership?.principalId ? " is-own" : "")}>
          <span>{message.senderPrincipalId === membership?.principalId ? copy("你", "You") : copy("成員", "Member") + " " + message.senderPrincipalId.slice(-8)}</span>
          <div>{message.body}</div><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(zh ? "zh-TW" : "en", { hour: "2-digit", minute: "2-digit" })}</time>
        </article>)}
        {view.pending ? <article className="workspace-collaboration-message is-own is-pending"><span>{copy("你", "You")}</span><div>{view.pending.body}</div>
          <p role="status">{view.pending.state === "sending" ? copy("發送中…", "Sending…") : errors[view.pending.code ?? "OUTCOME_UNKNOWN"][zh ? 0 : 1]}</p>
          {view.pending.state !== "sending" ? <button type="button" onClick={() => void model.send(true)}>{copy("以同一編號重試", "Retry same request")}</button> : null}</article> : null}
        {view.hasMore ? <button type="button" disabled={view.syncing} onClick={() => void model.sync()}>{copy("讀取下一頁新訊息", "Read next page of new messages")}</button> : null}
      </section>
      {unread ? <button type="button" className="workspace-collaboration-new-messages" onClick={() => {
        if (messagesRef.current) scrolling.current.latest(messagesRef.current); setUnread(false);
      }}>{copy("查看新訊息 ↓", "New messages ↓")}</button> : null}
      <form className="workspace-collaboration-composer" onSubmit={event => { event.preventDefault(); void model.send(); }}>
        <textarea rows={2} value={view.draft} disabled={!selected || view.phase !== "ready" || !!view.pending}
          aria-label={copy("發送訊息", "Message")} placeholder={selected ? copy("發送訊息到 #", "Message #") + selected.displayName + "…" : copy("先選擇頻道", "Select a channel first")}
          onChange={event => model.setDraft(event.target.value)}
          onKeyDown={event => { if (submitsWorkspaceMessage({ ...event, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
            event.preventDefault(); void model.send();
          } }} />
        <div><small>{draftBytes > 8192 ? copy("訊息超過 8 KB，請縮短內容。", "Message exceeds 8 KB. Shorten it.") : copy("Enter 發送 · Shift + Enter 換行", "Enter to send · Shift + Enter for a new line")}</small>
          <button type="submit" disabled={!selected || view.phase !== "ready" || !view.draft.trim() || draftBytes > 8192 || !!view.pending}>{copy("發送 ↑", "Send ↑")}</button></div>
      </form>
    </main>
  </div>;
}

function ConnectedView(props: Omit<ViewProps, "view">) {
  const view = useSyncExternalStore(props.model.subscribe, props.model.getSnapshot, props.model.getSnapshot);
  useEffect(() => {
    if (view.phase !== "ready") return;
    const refresh = () => { if (document.visibilityState === "visible") void props.model.sync(); };
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [props.model, view.phase, view.workspaceId]);
  return <WorkspaceCollaborationView key={view.workspaceId ?? "directory"} {...props} view={view} />;
}
export default function WorkspaceCollaboration({ client, ...props }: { client: WorkspaceCollaborationTransport; locale: "en" | "zh"; onClose: () => void; onSignIn: () => void }) {
  const [binding, setBinding] = useState<{ client: WorkspaceCollaborationTransport; model: WorkspaceCollaborationModel } | null>(null);
  useEffect(() => {
    const next = new WorkspaceCollaborationModel(client);
    setBinding({ client, model: next }); void next.loadDirectory();
    return () => next.dispose();
  }, [client]);
  return binding?.client === client ? <ConnectedView {...props} model={binding.model} /> : <div role="status">{props.locale === "zh" ? "正在載入工作空間…" : "Loading Workspaces…"}</div>;
}
