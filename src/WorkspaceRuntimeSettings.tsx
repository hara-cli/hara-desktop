import { useEffect, useState } from "react";
import type { RuntimeApprovalCard, WorkspaceDevModel, WorkspaceDevSnapshot } from "./workspace-dev-state";

export function WorkspaceConnectionForm({ model }: { model: WorkspaceDevModel }) {
  const [label, setLabel] = useState("我的模型連接"), [provider, setProvider] = useState<"openai" | "anthropic">("openai");
  const [baseURL, setBaseURL] = useState(""), [defaultModel, setDefaultModel] = useState(""), [apiKey, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  return <form className="wsd-connection-form" onSubmit={event => { event.preventDefault(); if (saving) return;
    setSaving(true); void model.configureConnection({ label, provider, baseURL, defaultModel, apiKey }).then(saved => {
      if (saved) setKey("");
    }).finally(() => setSaving(false)); }}>
    <label>連接名稱<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} required /></label>
    <label>接口協議<select value={provider} onChange={event => setProvider(event.target.value as "openai" | "anthropic")}><option value="openai">OpenAI 相容</option><option value="anthropic">Anthropic 相容</option></select></label>
    <label>Base URL<input type="url" value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://…" autoComplete="off" required /></label>
    <label>模型 ID<input value={defaultModel} onChange={event => setDefaultModel(event.target.value)} autoComplete="off" required /></label>
    <label>API Key<input type="password" value={apiKey} onChange={event => setKey(event.target.value)} autoComplete="new-password" spellCheck={false} required /></label>
    <small>只保存到目前工作空間的本機私有儲存；不繼承其他空間或全局工具的密鑰。</small>
    <button className="wsd-primary" disabled={saving}>{saving ? "正在保存…" : "保存本空間連接"}</button>
  </form>;
}

export default function WorkspaceRuntimeSettings({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const [card, setCard] = useState<RuntimeApprovalCard | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const downloading = workspace.runtimes?.operations.some(row => row.state === "downloading") ?? false;
  useEffect(() => { if (!downloading) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [downloading, model]);
  const propose = async (id: string) => { setPending(true); setNotice(""); try { setCard(await model.proposeRuntime(id)); }
    catch { setNotice("無法取得可校驗的官方版本，尚未下載或安裝；請稍後再試。"); } finally { setPending(false); } };
  const decide = async (approved: boolean) => { if (!card || pending) return; setPending(true);
    try { await model.approveRuntime(card, approved); setCard(null); setNotice(approved ? "安裝請求已接收，完成狀態將在下方更新。" : "已取消，沒有下載。"); }
    catch { setCard(null); setNotice("安裝結果暫未確認。請刷新核對，不會自動重送。"); } finally { setPending(false); } };
  return <section aria-label="按需安裝編程運行時"><h3>運行時</h3><p>Pi 已內建。其他編程工具只在你確認後下載、校驗並註冊到本空間。</p>
    {workspace.runtimes?.options.map(runtime => <div className="wsd-connection" key={runtime.runtimeId}>
      <strong>{runtime.label}</strong><small>{runtime.registered ? `${runtime.version} · 已校驗註冊` : runtime.state === "integrity_failed" ? "完整性檢查失敗，已禁止使用" : "未安裝"}</small>
      <button disabled={pending || downloading} onClick={() => void propose(runtime.runtimeId)}>{runtime.registered ? "檢查新版本" : "按需安裝"}</button>
      {runtime.registered && !runtime.generalAgentDriverAvailable ? <small>文件已校驗註冊，尚未執行；通用同事驅動未開放，不會靜默改綁 Agent。</small> : null}
    </div>)}
    {workspace.runtimes?.operations.map(operation => <div className="wsd-runtime-operation" key={operation.id}><span>{operation.runtimeId} · {{ downloading: "正在下載與校驗…", registered: "安裝完成，已註冊", failed: "安裝未完成，未授予執行權限", cancelled: "安裝已取消" }[operation.state] ?? operation.state}</span>
      {operation.state === "downloading" ? <button onClick={() => void model.cancelRuntime(operation.id)}>取消安裝</button> : null}</div>)}
    {notice ? <p role="status">{notice}</p> : null}
    {card ? <section className="wsd-approval" role="dialog" aria-label="確認安裝運行時"><div className="wsd-kicker">HARA 想請你確認</div>
      <h3>為這個空間安裝 {card.label} {card.version}？</h3><p>{card.origin} · {card.target.platform}/{card.target.arch} · 最多 {Math.ceil(card.maxBytes / 1024 / 1024)} MB</p>
      <details><summary>完整性與權限</summary><code>{card.sha256}</code><p>只安裝在本空間私有目錄，不修改全局 Claude／Codex 設定；安裝不等於授權它執行任務。</p></details>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => void decide(false)}>暫不安裝</button><button className="wsd-primary" disabled={pending} onClick={() => void decide(true)}>批准本次下載與安裝</button></div>
    </section> : null}
  </section>;
}
