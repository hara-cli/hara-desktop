import { useEffect, useRef, useState } from "react";
import type { RuntimeApprovalCard, WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";

export function WorkspaceConnectionForm({ model, existing, onSaved, onCancel, onDirty }: { model: WorkspaceDevModel; existing?: WorkspaceModelConnection; onSaved?: () => void; onCancel?: () => void; onDirty?: (value: boolean) => void }) {
  const [label, setLabel] = useState(existing?.label ?? "我的模型連接"), [provider, setProvider] = useState<"openai" | "anthropic">(existing?.provider ?? "openai");
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? ""), [defaultModel, setDefaultModel] = useState(existing?.defaultModel ?? ""), [apiKey, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const saveFence = useRef(false);
  return <form className="wsd-connection-form" onChange={() => onDirty?.(true)} onSubmit={event => { event.preventDefault(); if (saveFence.current) return; saveFence.current = true;
    const input = { label, provider, baseURL, defaultModel, apiKey };
    setSaving(true); void (existing ? model.editConnection(existing.id, input) : model.configureConnection(input)).then(saved => {
      if (saved) { setKey(""); onDirty?.(false); onSaved?.(); }
    }).finally(() => { saveFence.current = false; setSaving(false); }); }}>
    <label>連接名稱<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} required /></label>
    <label>接口協議<select value={provider} onChange={event => setProvider(event.target.value as "openai" | "anthropic")}><option value="openai">OpenAI 相容</option><option value="anthropic">Anthropic 相容</option></select></label>
    <label>Base URL<input type="url" value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://…" autoComplete="off" required /></label>
    <label>模型 ID<input value={defaultModel} onChange={event => setDefaultModel(event.target.value)} autoComplete="off" required /></label>
    <label>API Key{existing && !existing.credentialRequired ? "（留空不修改）" : ""}<input type="password" value={apiKey} onChange={event => setKey(event.target.value)} autoComplete="new-password" spellCheck={false} required={!existing || existing.credentialRequired} /></label>
    <small>Key 只保存在 macOS 钥匙串，不会写入设置、日志、备份或同步；保存后无法查看，只能替换或删除。留空编辑表示保留已保存的 Key。首次保存时系统可能请求授权。</small>
    <small>修改只影响本空间。新任务使用新设置；已开始的任务不会随默认连接切换。</small>
    {onCancel ? <button type="button" disabled={saving} onClick={() => { setKey(""); onDirty?.(false); onCancel(); }}>取消</button> : null}
    <button className="wsd-primary" disabled={saving}>{saving ? "正在保存…" : "保存本空間連接"}</button>
  </form>;
}

export default function WorkspaceRuntimeSettings({ model, workspace }: { model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot }) {
  const [card, setCard] = useState<RuntimeApprovalCard | null>(null), [pending, setPending] = useState(false), [notice, setNotice] = useState("");
  const [detecting, setDetecting] = useState(true), [checked, setChecked] = useState(false);
  const [local, setLocal] = useState<NonNullable<WorkspaceDevSnapshot["runtimes"]>["options"][number] | null>(null);
  useEffect(() => { let active = true; void model.detectRuntimes().then(() => { if (active) setChecked(true); })
    .catch(() => { if (active) setNotice("本機探測尚未完成，請重試；沒有下載或安裝。"); }).finally(() => { if (active) setDetecting(false); }); return () => { active = false; }; }, [model, workspace.workspaceId, workspace.resourceGeneration]);
  const downloading = workspace.runtimes?.operations.some(row => row.state === "downloading") ?? false;
  useEffect(() => { if (!downloading) return; const timer = setInterval(() => { void model.refresh(); }, 1000); return () => clearInterval(timer); }, [downloading, model]);
  const propose = async (id: string) => { setPending(true); setNotice(""); try { setCard(await model.proposeRuntime(id)); }
    catch { setNotice("無法取得可校驗的官方版本，尚未下載或安裝；請稍後再試。"); } finally { setPending(false); } };
  const decide = async (approved: boolean) => { if (!card || pending) return; setPending(true);
    try { await model.approveRuntime(card, approved); setCard(null); setNotice(approved ? "安裝請求已接收，完成狀態將在下方更新。" : "已取消，沒有下載。"); }
    catch { setCard(null); setNotice("安裝結果暫未確認。請刷新核對，不會自動重送。"); } finally { setPending(false); } };
  return <section aria-label="按需安裝編程運行時"><h3>運行時</h3><p>Pi 已內建。先探測本機已安裝的工具，不會自動下載。找不到時才可另外批准安裝。</p>
    <div className="wsd-connection wsd-runtime-row"><div><strong>Pi</strong><small>1.1.0 · Hara 已内置 · 可用</small><small>系统默认运行时，不需要另装本机 Pi CLI。</small></div></div>
    <button disabled={detecting || pending} onClick={() => { setDetecting(true); setChecked(false); setNotice(""); void model.detectRuntimes().then(() => setChecked(true)).catch(() => setNotice("本機探測未完成，未下載。")).finally(() => setDetecting(false)); }}>{detecting ? "正在探測本機…" : "重新探測本機"}</button>
    {workspace.runtimes?.options.map(runtime => <div className="wsd-connection wsd-runtime-row" key={runtime.runtimeId}>
      <div><strong>{runtime.label}</strong><small>{runtime.registered ? `${runtime.version} · 已校驗註冊` : runtime.state === "detected" ? `${runtime.version} · 本機已安裝` : runtime.state === "integrity_failed" ? "完整性檢查失敗，已禁止使用" : detecting || !checked ? "正在確認本機安裝" : "未找到可用安裝"}</small>
      {runtime.path ? <code className="wsd-root">{runtime.path}</code> : null}
      {runtime.registered && !runtime.generalAgentDriverAvailable ? <small>文件已校驗註冊，尚未執行；通用同事驅動未開放，不會靜默改綁 Agent。</small> : null}</div>
      {runtime.state === "detected" ? <button disabled={pending || detecting} onClick={() => setLocal(runtime)}>使用本機安裝</button>
        : !runtime.path ? <button disabled={pending || downloading || detecting || !checked} onClick={() => void propose(runtime.runtimeId)}>{runtime.registered ? "檢查新版本" : "按需安裝"}</button> : null}
    </div>)}
    {workspace.runtimes?.operations.map(operation => <div className="wsd-runtime-operation" key={operation.id}><span>{operation.runtimeId} · {{ downloading: "正在下載與校驗…", registered: "安裝完成，已註冊", failed: "安裝未完成，未授予執行權限", cancelled: "安裝已取消" }[operation.state] ?? operation.state}</span>
      {operation.state === "downloading" ? <button onClick={() => void model.cancelRuntime(operation.id)}>取消安裝</button> : null}</div>)}
    {notice ? <p role="status">{notice}</p> : null}
    {local ? <section className="wsd-approval" role="dialog" aria-label="確認使用本機運行時"><h3>在這個空間登記 {local.label}？</h3><p>{local.version} · {local.path}</p><p>不下載、不複製或改動全局工具設定；使用前會重驗文件指紋。登記不會自動授予同事執行權限。</p>
      <button disabled={pending} onClick={() => setLocal(null)}>取消</button><button className="wsd-primary" disabled={pending} onClick={() => { if (!local.fingerprint) return; setPending(true);
        void model.registerLocalRuntime(local.runtimeId, local.fingerprint, workspace.workspaceId, workspace.resourceGeneration).then(() => { setLocal(null); setNotice("本機安裝已登記，沒有下載。"); })
          .catch(() => setNotice("登記未確認，請重新探測核對；不會重送或下載。")).finally(() => setPending(false)); }}>確認登記本機安裝</button></section> : null}
    {card ? <section className="wsd-approval" role="dialog" aria-label="確認安裝運行時"><div className="wsd-kicker">HARA 想請你確認</div>
      <h3>為這個空間安裝 {card.label} {card.version}？</h3><p>{card.origin} · {card.target.platform}/{card.target.arch} · 最多 {Math.ceil(card.maxBytes / 1024 / 1024)} MB</p>
      <details><summary>完整性與權限</summary><code>{card.sha256}</code><p>只安裝在本空間私有目錄，不修改全局 Claude／Codex 設定；安裝不等於授權它執行任務。</p></details>
      <div className="wsd-card-actions"><button disabled={pending} onClick={() => void decide(false)}>暫不安裝</button><button className="wsd-primary" disabled={pending} onClick={() => void decide(true)}>批准本次下載與安裝</button></div>
    </section> : null}
  </section>;
}
