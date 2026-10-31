import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeId } from "./client";
import { makeT } from "./i18n";
import { workspaceMessageText } from "./workspace-settings-copy";
import { WorkspaceAgentRuntimePicker } from "./AgentRuntimePicker";
import { ShellDialog } from "./WorkspaceShell";
import type { WorkspaceDevAgent, WorkspaceDevSnapshot, WorkspaceRuntimeModels, WorkspaceSessionRestart } from "./workspace-dev-state";

export default function WorkspaceRuntimeAccess({ agent, workspace, locale, compact = false, listModels, onApplyRuntime, onApplyModel, onRescan, onRegisterRuntime, onRuntimeDirectory }: {
  agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; locale: "en" | "zh-Hans" | "zh-Hant"; compact?: boolean;
  listModels(runtimeId: string): Promise<WorkspaceRuntimeModels>;
  onApplyRuntime(runtimeId: AgentRuntimeId, sessionRestart: WorkspaceSessionRestart): Promise<void>;
  onApplyModel(runtimeId: string, modelId: string, revision: number): Promise<void>;
  onRescan(): Promise<void>;
  onRegisterRuntime(runtimeId: string, fingerprint: string): Promise<void>;
  onRuntimeDirectory(): void;
}) {
  const zh = locale !== "en", t = makeT(locale);
  const owner = JSON.stringify([workspace.workspaceId, workspace.resourceGeneration, agent.agentId]);
  const scope = JSON.stringify([owner, agent.runtime.id, agent.configRevision, agent.agentEpoch]);
  const liveScope = useRef(scope); liveScope.current = scope;
  const liveOptions = useRef(workspace.runtimeOptions); liveOptions.current = workspace.runtimeOptions;
  const option = workspace.runtimeOptions?.find(row => row.id === agent.runtime.id);
  const [modelView, setModelView] = useState<{ scope: string; data: WorkspaceRuntimeModels } | null>(null);
  const models = option?.available && modelView?.scope === scope && modelView.data.runtimeId === agent.runtime.id ? modelView.data : null;
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const saveFence = useRef(false);
  const [directoryOwner, setDirectoryOwner] = useState("");
  const [change, setChange] = useState<{ scope: string; runtimeId: AgentRuntimeId } | null>(null);
  const [restart, setRestart] = useState<WorkspaceSessionRestart>("keep");
  const [local, setLocal] = useState<{ scope: string; runtimeId: string; label: string; fingerprint: string; path?: string } | null>(null);
  const directoryNeeded = workspace.runtimeOptions?.some(row => row.reason === "not_registered" || row.reason === "not_installed");
  const detected = workspace.runtimes?.options.filter(row => row.state === "detected" && !row.registered) ?? [];
  const missing = workspace.runtimes?.options.filter(row => row.state === "not_installed") ?? [];
  const conversation = workspace.conversation;
  const freshBlocked = !conversation || ["running", "draining"].includes(conversation.state)
    || Boolean(conversation.pendingQuestion || conversation.pendingInteractions?.length);
  useEffect(() => {
    let active = true;
    setModelView(null); setSelected(""); setError(""); setLoading(false);
    if (!option?.available) return () => { active = false; };
    setLoading(true);
    // Only the current binding supplies model authority. Picker drafts never query models.
    void listModels(agent.runtime.id).then(result => {
      if (!active || liveScope.current !== scope) return;
      if (result.runtimeId !== agent.runtime.id) throw new Error("ws.runtimeAccess.modelMismatch");
      setModelView({ scope, data: result }); setSelected(result.selectedModelId ?? "");
    }).catch(cause => { if (active && liveScope.current === scope) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active && liveScope.current === scope) setLoading(false); });
    return () => { active = false; };
  }, [scope, option?.available, listModels, reload, locale]);
  const run = async (action: () => Promise<void>) => {
    if (saveFence.current) return;
    saveFence.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { if (liveScope.current === scope) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { saveFence.current = false; setBusy(false); }
  };
  const target = change?.scope === scope ? workspace.runtimeOptions?.find(row => row.id === change.runtimeId) : null;
  if (compact) return <div className="vg-runtime-strip" aria-label={zh ? "本 bot 运行配置" : "This bot runtime"}>
    <span>Runtime <strong>{agent.runtime.label}</strong></span><span>{zh ? "模型" : "Model"} <strong>{models?.models.find(row => row.id === models.selectedModelId)?.label ?? "—"}</strong></span>
  </div>;
  return <div className="vg-runtime-access">
    <section className="vg-context-card vg-p0-card"><h3>Runtime</h3>
      <p>{t("ws.runtimeAccess.bound", { name: agent.identity.displayName, runtime: agent.runtime.label })}</p>
      {workspace.runtimeOptions ? <WorkspaceAgentRuntimePicker agent={agent} options={workspace.runtimeOptions} locale={zh ? "zh" : "en"} saving={busy}
        onApply={runtimeId => { setRestart("keep"); setError(""); setChange({ scope, runtimeId }); }} /> : null}
      {!workspace.runtimeOptions?.some(row => row.available) ? <p role="status">{t("ws.runtimeAccess.empty")}</p> : null}
      {!option?.available && !detected.some(row => row.runtimeId === agent.runtime.id) && !missing.some(row => row.runtimeId === agent.runtime.id)
        ? <p role="status">{t("ws.runtimeAccess.unavailable", { runtime: agent.runtime.label })}</p> : null}
      {detected.map(row => <div key={row.runtimeId}><p>{t("ws.runtimeAccess.detected", { runtime: row.label })}</p>
        <button disabled={busy || !row.fingerprint} onClick={() => { setError(""); setLocal({ scope, runtimeId: row.runtimeId, label: row.label, fingerprint: row.fingerprint!, path: row.path }); }}>{t("ws.runtimeAccess.register")}</button></div>)}
      {missing.map(row => <p key={row.runtimeId}>{t("ws.runtimeAccess.missing", { runtime: row.label })}</p>)}
      <button disabled={busy} onClick={() => void run(async () => {
        setScanning(true);
        try { await onRescan(); setReload(value => value + 1); } finally { setScanning(false); }
      })}>{t(scanning ? "ws.runtimeAccess.scanning" : "ws.runtimeAccess.rescan")}</button>
      {directoryNeeded && directoryOwner !== owner ? <button disabled={busy} onClick={() => { setDirectoryOwner(owner); onRuntimeDirectory(); }}>{zh ? "管理本机引擎…" : "Manage local runtimes…"} ↗</button> : null}
    </section>
    <section className="vg-context-card vg-p0-card"><h3>{zh ? "此 bot 的模型" : "This bot's model"}</h3>
      {loading ? <p role="status">{zh ? "读取模型…" : "Loading models…"}</p> : models ? <>
        <label>{zh ? "模型" : "Model"}<select aria-label={zh ? "此 bot 的模型" : "This bot's model"} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
          <option value="">{zh ? "选择模型" : "Choose a model"}</option>{models.models.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select></label>
        <button disabled={busy || !selected || selected === models.selectedModelId || !models.models.some(row => row.id === selected)}
          onClick={() => void run(async () => {
            if (liveScope.current !== scope || models.runtimeId !== agent.runtime.id) throw new Error("ws.runtimeAccess.stale");
            await onApplyModel(agent.runtime.id, selected, models.revision);
            if (liveScope.current === scope) setReload(value => value + 1);
          })}>{zh ? "应用模型" : "Apply model"}</button>
      </> : <p>{option?.available ? (zh ? "模型目录暂不可用" : "Model list unavailable") : (zh ? "请先绑定可用引擎" : "Bind an available runtime first")}</p>}
      {error ? <p role="alert">{workspaceMessageText(t, error)}</p> : null}
    </section>
    {target && change ? <ShellDialog label={t("ws.runtimeAccess.confirm")} onClose={() => { if (!saveFence.current) setChange(null); }} className="wsd-approval-dialog wsd-runtime-change-dialog">
      <section className="hs-card wsd-approval"><div className="wsd-kicker">{t("ws.runtimeAccess.confirm")}</div>
        <h3>{t("ws.runtimeAccess.target", { name: agent.identity.displayName, runtime: target.label })}</h3>
        <label><input type="radio" name="runtime-restart" checked={restart === "keep"} disabled={busy} onChange={() => setRestart("keep")} />{t("ws.runtimeAccess.keep")}</label>
        <p>{t("ws.runtimeAccess.keepNote", { runtime: target.label })}</p>
        <label><input type="radio" name="runtime-restart" checked={restart === "fresh"} disabled={busy || freshBlocked} onChange={() => setRestart("fresh")} />{t("ws.runtimeAccess.fresh")}</label>
        <p>{t("ws.runtimeAccess.freshNote", { runtime: target.label })}</p>
        {freshBlocked ? <p role="status">{t("ws.runtimeAccess.freshBlocked")}</p> : null}
        <p>{t("ws.runtimeAccess.oneShot")}</p>
        {error ? <p role="alert">{workspaceMessageText(t, error)}</p> : null}
        <div className="wsd-card-actions"><button disabled={busy} onClick={() => setChange(null)}>{t("ws.cancel")}</button>
          <button className="wsd-primary" disabled={busy || !target.available || (restart === "fresh" && freshBlocked)} onClick={() => void run(async () => {
            if (liveScope.current !== change.scope || !liveOptions.current?.some(row => row.id === change.runtimeId && row.available)) throw new Error("ws.runtimeAccess.stale");
            await onApplyRuntime(change.runtimeId, restart);
            setChange(null); setModelView(null); setReload(value => value + 1);
          })}>{zh ? "确认更换引擎" : "Confirm runtime change"}</button></div>
      </section></ShellDialog> : null}
    {local?.scope === scope ? <ShellDialog label={t("ws.runtimes.confirmLocal")} onClose={() => { if (!saveFence.current) setLocal(null); }} className="wsd-approval-dialog wsd-runtime-change-dialog">
      <section className="hs-card wsd-approval"><h3>{t("ws.runtimes.registerTitle", { name: local.label })}</h3><p>{t("ws.runtimes.bindLead")}</p>
        <code className="wsd-root">{local.path}</code><p>{t("ws.runtimes.registerNote")}</p>
        {error ? <p role="alert">{workspaceMessageText(t, error)}</p> : null}
        <div className="wsd-card-actions"><button disabled={busy} onClick={() => setLocal(null)}>{t("ws.cancel")}</button>
          <button className="wsd-primary" disabled={busy} onClick={() => void run(async () => {
            if (liveScope.current !== local.scope) throw new Error("ws.runtimeAccess.stale");
            await onRegisterRuntime(local.runtimeId, local.fingerprint); setLocal(null); setReload(value => value + 1);
          })}>{t("ws.runtimes.register")}</button></div>
      </section></ShellDialog> : null}
  </div>;
}
