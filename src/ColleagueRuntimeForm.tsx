import { DEFAULT_RUNTIME_PLATFORM } from "./runtime-platform.ts";
import { WorkspacePublicRpcError } from "./core-i18n.ts";
import { redesignText } from "./desktop-redesign-copy";
import desktopPackage from "../package.json";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentRuntimeId } from "./client";
import { makeT, type Key } from "./i18n";
import { agentRuntimeLabel } from "./agent-runtime-selection";
import { formatList } from "./i18n-runtime.ts";
import { inheritsPersonalExtensions } from "./runtime-expansion";
import { WorkspaceRuntimeVersion } from "./WorkspaceRuntimeVersion";
import { runtimeVersionFor } from "./runtime-version-drift";
import { workspaceMessageText } from "./workspace-settings-copy";
import { AUTO_EFFORT, ENGINE_DEFAULT_EFFORT, changedFields, effortChoices, effortForWire, engineStatus, formBaseline, needsConfirmation,
  reconcileEffort, separateLoginOffered, defaultModel, canApplyPiModel, piModelErrorKey, type FormInventory } from "./runtime-form";
import type { RuntimeLoginSource, RuntimePermissionTier, WorkspaceDevAgent, WorkspaceDevModel, WorkspaceDevSnapshot,
  WorkspaceRuntimeFormOptions, WorkspaceSessionRestart } from "./workspace-dev-state";

type Inventory = FormInventory & { runtimeId: string; source: WorkspaceRuntimeFormOptions["modelSource"] | "connection"; revision: number;
  connectionId?: string; form?: WorkspaceRuntimeFormOptions };
type Loaded = { key: string; status: "loading" } | { key: string; status: "ok"; data: Inventory } | { key: string; status: "error"; error: string };

/** Modal with the same focus rules as the Settings setup dialog: focus the primary action, trap Tab, Esc closes. */
function FormDialog({ label, pending, onClose, children }: { label: string; pending: boolean; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const panel = dialog.current!, previous = document.activeElement as HTMLElement | null;
    if (typeof panel.showModal === "function") panel.showModal();
    (panel.querySelector<HTMLElement>("button.wsd-primary:not(:disabled)") ?? panel).focus({ preventScroll: true });
    return () => { if (typeof panel.close === "function") panel.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="vg-rf-dialog" aria-modal="true" aria-label={label} aria-busy={pending}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input[type="radio"]:checked:not(:disabled),summary'))
        .filter(node => node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>{children}</dialog>;
}

/**
 * Colleague settings › Engine and model (Jeff 2026-11-05, layout A): one form, one Apply. Switching the
 * engine immediately shows that engine's models, default, effort choices and version. A first use or an
 * updated file is confirmed once, inside Apply; Core refuses execution until then.
 */
export default function ColleagueRuntimeForm({ agent, workspace, model, locale, permissionSupported = false, onApplyPermissionTier, onRuntimeDirectory, onConnections }: {
  agent: WorkspaceDevAgent; workspace: WorkspaceDevSnapshot; model: WorkspaceDevModel; locale: "en" | "zh-Hans" | "zh-Hant";
  permissionSupported?: boolean; onApplyPermissionTier?(tier: RuntimePermissionTier): Promise<void>; onRuntimeDirectory(): void; onConnections?(): void;
}) {
  const t = makeT(locale);
  const r = (key: Parameters<typeof redesignText>[1]) => redesignText(locale, key);
  const engineName = (id: string) => agentRuntimeLabel(id as AgentRuntimeId, locale);
  const connection = workspace.connections?.connections.find(row => row.id === (workspace.connections.activeConnectionId ?? workspace.connections.defaultConnectionId) && row.status === "active");
  const scope = JSON.stringify([workspace.workspaceId, workspace.resourceGeneration, agent.agentId, agent.configRevision, agent.agentEpoch, agent.runtime.id, connection?.id ?? null, workspace.connections?.revision ?? null]);
  const liveScope = useRef(scope); liveScope.current = scope;
  const [draftRuntime, setDraftRuntime] = useState(agent.runtime.id);
  const [draftModel, setDraftModel] = useState(""), [draftEffort, setDraftEffort] = useState(AUTO_EFFORT);
  const [initFor, setInitFor] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [dropped, setDropped] = useState<{ model: string; level: string } | null>(null);
  const [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loginSource, setLoginSource] = useState<RuntimeLoginSource>("host");
  const [restart, setRestart] = useState<WorkspaceSessionRestart>("keep");
  const fence = useRef(false);
  useEffect(() => { setDraftRuntime(agent.runtime.id); setInitFor(""); setDropped(null); setError(""); }, [scope]);
  const loadKey = JSON.stringify([scope, draftRuntime, reload]);
  useEffect(() => {
    let active = true;
    setLoaded({ key: loadKey, status: "loading" });
    const done = (value: Loaded) => { if (active) setLoaded(value); };
    if (draftRuntime === "hara") { done({ key: loadKey, status: "ok", data: { runtimeId: "hara", models: [], defaultModelId: null, selected: null, source: "none", revision: 0 } }); return () => { active = false; }; }
    if (draftRuntime === "pi") {
      if (!connection || !model.supportsConnectionModels()) { done({ key: loadKey, status: "ok", data: { runtimeId: "pi", models: [], defaultModelId: null, selected: null, source: "connection", revision: 0 } }); return () => { active = false; }; }
      void model.listConnectionModels(agent.agentId, connection.id).then(result => done({ key: loadKey, status: "ok", data: { runtimeId: "pi", models: result.models,
        defaultModelId: connection.defaultModel || null, selected: { modelId: result.selectedModelId, effort: result.selectedEffort ?? null }, source: "connection",
        revision: result.revision, connectionId: result.connectionId } }), cause => done({ key: loadKey, status: "error", error: cause instanceof Error ? cause.message : String(cause) }));
      return () => { active = false; };
    }
    void model.runtimeFormOptions(draftRuntime, agent.agentId).then(form => done({ key: loadKey, status: "ok", data: { runtimeId: draftRuntime, models: form.models,
      defaultModelId: form.defaultModelId, selected: form.selected, source: form.modelSource, revision: form.revision, form } }),
    cause => done({ key: loadKey, status: "error", error: cause instanceof Error ? cause.message : String(cause) }));
    return () => { active = false; };
  }, [loadKey]);
  const inventory = loaded?.key === loadKey && loaded.status === "ok" ? loaded.data : null;
  const baseline = inventory ? formBaseline(inventory) : null;
  // First data for a runtime: the current engine starts at its saved state; a newly picked engine starts at
  // its own default model, and the effort is carried over by the reconcile rule.
  useEffect(() => {
    if (!inventory || initFor === loadKey) return;
    const next = draftRuntime === agent.runtime.id ? baseline!.model : defaultModel(inventory);
    const chosen = inventory.models.find(row => row.id === next);
    const start = draftRuntime === agent.runtime.id ? baseline!.effort : draftEffort;
    const reconciled = reconcileEffort(start, chosen, draftRuntime);
    setDraftModel(next); setDraftEffort(effortChoices(chosen, draftRuntime).length ? reconciled.effort : AUTO_EFFORT);
    setDropped(reconciled.dropped && chosen ? { model: chosen.label, level: reconciled.dropped } : null);
    setInitFor(loadKey);
  }, [inventory, loadKey]);
  const ready = Boolean(inventory) && initFor === loadKey;
  const runtimeRow = workspace.runtimes?.options.find(row => row.runtimeId === draftRuntime);
  const form = inventory?.form;
  const use = draftRuntime === "pi" || draftRuntime === "hara" ? "ready" : form?.use ?? runtimeRow?.use;
  const status = engineStatus(use, form?.unavailableReason ?? runtimeRow?.unavailableReason);
  const selectedModel = inventory?.models.find(row => row.id === draftModel);
  const choices = effortChoices(selectedModel, draftRuntime);
  const piModelReady = draftRuntime !== "pi" || canApplyPiModel(ready, connection?.id, inventory, draftModel);
  const fields = changedFields({ runtimeId: agent.runtime.id }, { runtimeId: draftRuntime, model: draftModel, effort: choices.length ? draftEffort : (baseline?.effort ?? AUTO_EFFORT) }, ready ? baseline : null);
  const confirmNeeded = needsConfirmation(use);
  const usable = use === "ready" || confirmNeeded;
  const conversation = workspace.conversation;
  const freshBlocked = !conversation || ["running", "draining"].includes(conversation.state) || Boolean(conversation.pendingQuestion || conversation.pendingInteractions?.length);
  const options = (workspace.runtimeOptions ?? []).filter(row => row.id !== "hara" || row.id === agent.runtime.id);
  const effortLabel = (choice: string) => choice === AUTO_EFFORT ? t("ws.rf.effort.auto") : choice === ENGINE_DEFAULT_EFFORT ? t("ws.rf.effort.engineDefault")
    : ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(choice) ? t(`ws.rf.effort.${choice}` as Key) : choice;
  const statusText = (value: ReturnType<typeof engineStatus>) => value ? t(value.key as Key, { reason: value.reasonKey ? t(value.reasonKey as Key) : "" }) : "";
  const fieldText = formatList(locale, fields.map(field => t(`ws.rf.field.${field}` as Key)));
  const shared = form?.sharedWith.filter(row => row.agentId !== agent.agentId) ?? [];
  const chooseModel = (id: string) => {
    const next = inventory?.models.find(row => row.id === id);
    const reconciled = reconcileEffort(draftEffort, next, draftRuntime);
    setDraftModel(id); setDraftEffort(effortChoices(next, draftRuntime).length ? reconciled.effort : AUTO_EFFORT);
    setDropped(reconciled.dropped && next ? { model: next.label, level: reconciled.dropped } : null); setNotice("");
  };
  const apply = async () => {
    if (fence.current || !inventory || !piModelReady || liveScope.current !== scope) return;
    fence.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const modelChanged = fields.includes("model") || fields.includes("effort");
      const wireEffort = effortForWire(choices.length ? draftEffort : AUTO_EFFORT);
      if (draftRuntime === "pi" || draftRuntime === "hara") {
        if (fields.includes("engine")) {
          const result = await model.applyRuntimeForm(agent, { runtimeId: draftRuntime as AgentRuntimeId }, restart);
          if (result.failed) throw new Error(result.failed.message);
        }
        if (draftRuntime === "pi" && modelChanged && draftModel && inventory.connectionId) await model.selectConnectionModel(inventory.connectionId, draftModel, inventory.revision, wireEffort);
      } else {
        const result = await model.applyRuntimeForm(agent, { runtimeId: draftRuntime as AgentRuntimeId,
          ...(confirmNeeded && form?.fingerprint ? { confirm: { fingerprint: form.fingerprint, loginSource: separateLoginOffered(draftRuntime) ? loginSource : "host" } } : {}),
          ...(modelChanged && draftModel ? { model: { modelId: draftModel, expectedRevision: inventory.revision, effort: wireEffort } } : {}) }, restart);
        if (result.failed) { setError(t("ws.rf.partial", { reason: workspaceMessageText(t, result.failed.data ? String(new WorkspacePublicRpcError(undefined, result.failed.data, result.failed.message)) : result.failed.message) })); setConfirming(false); setReload(value => value + 1); return; }
      }
      setConfirming(false); setNotice(t("ws.rf.appliedNext")); setReload(value => value + 1);
    } catch (cause) {
      if (liveScope.current === scope) { const reason = cause instanceof Error ? cause.message : String(cause); setError(draftRuntime === "pi" ? t(piModelErrorKey(reason)) : workspaceMessageText(t, reason)); }
    } finally { fence.current = false; setBusy(false); }
  };
  const startApply = () => {
    if (confirmNeeded || fields.includes("engine")) {
      // A first use defaults to this computer's login (as Core does); an update keeps the confirmed choice.
      setRestart("keep"); setLoginSource(use === "confirm_update" && form?.loginSource === "isolated" && separateLoginOffered(draftRuntime) ? "isolated" : "host"); setConfirming(true);
    } else void apply();
  };
  const rescan = async () => {
    setScanning(true); setError("");
    try { await model.detectRuntimes(); setReload(value => value + 1); }
    catch (cause) { setError(workspaceMessageText(t, cause instanceof Error ? cause.message : String(cause))); }
    finally { setScanning(false); }
  };
  const refreshModels = async () => {
    setScanning(true); setError(""); setNotice("");
    try { await model.refresh(); setReload(value => value + 1); }
    catch (cause) { setError(t(piModelErrorKey(cause instanceof Error ? cause.message : String(cause)))); }
    finally { setScanning(false); }
  };
  const platform = model.runtimePlatform?.() ?? DEFAULT_RUNTIME_PLATFORM;
  const permissionBlocked = !permissionSupported || !onApplyPermissionTier || busy || freshBlocked;
  return <div className="vg-runtime-access vg-rf" data-runtime-form="a">
    <details className="hd-manage-section hd-engine-section" open><summary>{r("engine")}<small>{engineName(agent.runtime.id)}</small></summary>
    <section className="vg-context-card vg-p0-card vg-rf-card" aria-label={t("ws.rf.title")}>
      <label className="vg-rf-field">{t("ws.rf.engine")}
        <select aria-label={t("ws.rf.engine")} value={draftRuntime} disabled={busy || scanning} onChange={event => { setDraftRuntime(event.target.value); setNotice(""); setError(""); }}>
          {!options.some(row => row.id === agent.runtime.id) ? <option value={agent.runtime.id}>{engineName(agent.runtime.id)}</option> : null}
          {/* Option text is the engine name; the selected engine's status shows once, in the chip below. Only an
              unselectable engine keeps its reason, since nothing else explains why it is disabled. */}
          {options.map(row => {
            const rowStatus = engineStatus(workspace.runtimes?.options.find(item => item.runtimeId === row.id)?.use, workspace.runtimes?.options.find(item => item.runtimeId === row.id)?.unavailableReason);
            const selectable = row.selectable ?? row.available;
            return <option key={row.id} value={row.id} disabled={!selectable && row.id !== agent.runtime.id}>{engineName(row.id)}{!selectable && row.id !== agent.runtime.id && rowStatus ? ` · ${statusText(rowStatus)}` : ""}</option>;
          })}
        </select>
      </label>
      <div className="vg-rf-meta" data-runtime-use={use ?? "unknown"}>
        {status && draftRuntime !== "pi" && draftRuntime !== "hara" ? <span className={`vg-rf-chip ${use === "ready" ? "ok" : use === "unavailable" ? "fail" : "warn"}`}>{statusText(status)}</span> : null}
        {(form?.version ?? runtimeRow?.version) ? <span>{t("ws.rf.version", { version: (form?.version ?? runtimeRow?.version)! })}</span> : null}
        {draftRuntime === "pi" ? <span className="vg-rf-chip ok">{r("piAvailable")}</span> : null}
      </div>
      {inheritsPersonalExtensions(draftRuntime) ? <p role="note" data-personal-extensions="inherited">{t("ws.runtimeExpansion.extensionsInherited")}</p> : null}
      {draftRuntime === "pi" ? <p className="vg-muted">{t(connection ? "ws.rf.piModels" : "ws.rf.piNoConnection")}</p> : null}
      {loaded?.key === loadKey && loaded.status === "loading" ? <p role="status">{t("ws.rf.modelsLoading")}</p> : null}
      {loaded?.key === loadKey && loaded.status === "error" ? <p role="alert">{draftRuntime === "pi" ? t(piModelErrorKey(loaded.error)) : t("ws.rf.modelsFailed", { reason: workspaceMessageText(t, loaded.error) })}</p> : null}
      {draftRuntime === "pi" ? <div className="vg-rf-actions">{onConnections ? <button type="button" onClick={onConnections}>{t("ws.rf.piConnections")}</button> : null}<button type="button" disabled={busy || scanning || !connection || !model.supportsConnectionModels()} onClick={() => void refreshModels()}>{t("ws.rf.piRefreshModels")}</button></div> : null}
      {ready && usable && draftRuntime !== "hara" && (draftRuntime !== "pi" || inventory!.models.length) ? <>
        <label className="vg-rf-field">{t("ws.rf.model")}
          <select aria-label={t("ws.rf.model")} value={draftModel} disabled={busy || scanning || !inventory!.models.length} onChange={event => chooseModel(event.target.value)}>
            {!inventory!.models.length ? <option value="">{t("ws.rf.modelEngineDefault")}</option> : null}
            {inventory!.models.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        {inventory!.source === "engine_default" ? <p className="vg-muted">{t("ws.rf.modelsAfterConfirm")}</p>
          : inventory!.source === "official" && confirmNeeded ? <p className="vg-muted">{t("ws.rf.modelsOfficial")}</p>
          : inventory!.source === "live" ? <p className="vg-muted">{t("ws.rf.modelsLive")}</p> : null}
        {choices.length ? <label className="vg-rf-field">{t("ws.rf.effort")}
          <select aria-label={t("ws.rf.effort")} value={draftEffort} disabled={busy || scanning} onChange={event => { setDraftEffort(event.target.value); setDropped(null); setNotice(""); }}>
            {choices.map(choice => <option key={choice} value={choice}>{effortLabel(choice)}</option>)}
          </select>
        </label> : inventory!.models.length ? <p className="vg-muted" data-effort-hidden="true">{t("ws.rf.effortNone")}</p> : null}
        {dropped ? <p role="status" className="vg-rf-warn">{t("ws.rf.effortDropped", { model: dropped.model, level: effortLabel(dropped.level) })}</p> : null}
        {shared.length && draftRuntime !== "pi" ? <p className="vg-muted" data-shared-setting="true">{t("ws.rf.shared", { engine: engineName(draftRuntime), names: formatList(locale, shared.map(row => row.displayName)) })}</p> : null}
      </> : null}
      {use === "unavailable" || use === "detecting" ? <div className="vg-rf-actions">
        <button type="button" disabled={busy || scanning} onClick={() => void rescan()}>{t(scanning ? "ws.rf.status.detecting" : "ws.rf.recheck")}</button>
        {form?.unavailableReason === "not_installed" || runtimeRow?.unavailableReason === "not_installed" ? <button type="button" className="vg-runtime-install" onClick={onRuntimeDirectory}>{t("ws.rf.install")} <span aria-hidden="true">↗</span></button> : null}
      </div> : null}
      <details className="vg-rf-details"><summary>{r("details")}</summary>{draftRuntime === "pi" ? <p>{r("piDetails")} (Hara {desktopPackage.version})</p> : <>
        {(form?.path ?? runtimeRow?.path) ? <code>{form?.path ?? runtimeRow?.path}</code> : null}
        {draftRuntime !== "hara" ? <WorkspaceRuntimeVersion runtimeId={draftRuntime} binding={runtimeVersionFor(workspace.runtimes?.options, draftRuntime)} t={t} /> : null}
      </>}</details>
      <footer className="vg-rf-foot">
        {fields.length ? <span className="vg-rf-chip dirty" role="status">{t("ws.rf.unsaved", { fields: fieldText })}</span>
          : confirmNeeded ? <span className="vg-rf-chip warn" role="status">{statusText(status)}</span> : <span className="vg-rf-chip" role="status">{t("ws.rf.saved")}</span>}
        {fields.length ? <button type="button" className="vg-rf-revert" disabled={busy || scanning} onClick={() => { setDraftRuntime(agent.runtime.id); if (draftRuntime === agent.runtime.id && baseline) { setDraftModel(baseline.model); setDraftEffort(baseline.effort); } else setInitFor(""); setDropped(null); setError(""); setNotice(""); }}>{redesignText(locale, "revert")}</button> : null}
        <button type="button" className="vg-rf-apply" disabled={busy || scanning || !ready || !piModelReady || !fields.length && !confirmNeeded || !usable || draftRuntime === "hara" && draftRuntime !== agent.runtime.id} onClick={startApply}>{t(busy ? "ws.rf.applying" : "ws.rf.apply")}</button>
      </footer>
      {fields.includes("engine") ? <p className="vg-muted">{t("ws.rf.untilApplied", { name: agent.identity.displayName, engine: engineName(agent.runtime.id) })}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error && !confirming ? <p role="alert">{error}</p> : null}
    </section></details>
    <details className="hd-manage-section"><summary>{r("permissions")}<small>{t(agent.permissionTier === "full-protected" ? "ws.permissions.full" : "ws.permissions.controlled")}</small></summary>
    <section className="vg-context-card vg-p0-card">
      <label className="vg-permission-tier vg-rf-field">{t("ws.permissions.label")}
        <select aria-label={t("ws.permissions.label")} value={agent.permissionTier ?? "unknown"} disabled={permissionBlocked}
          onChange={event => { const tier = event.target.value; if ((tier === "full-protected" || tier === "controlled") && onApplyPermissionTier) void onApplyPermissionTier(tier).catch(cause => setError(workspaceMessageText(t, cause instanceof Error ? cause.message : String(cause)))); }}>
          {!agent.permissionTier ? <option value="unknown">{t("ws.permissions.unknown")}</option> : null}
          {/* Decision B: offer the full tier only where the Host has Seatbelt; keep a stored value visible but unselectable. */}
          {platform.permissionTiers.includes("full-protected") || agent.permissionTier === "full-protected"
            ? <option value="full-protected" disabled={!platform.permissionTiers.includes("full-protected")}>{t("ws.permissions.full")}</option> : null}
          <option value="controlled">{t("ws.permissions.controlled")}</option>
        </select>
      </label>
      {platform.writeProtection === "none" ? <p className="vg-platform-note" role="note">{t("ws.permissions.noOsProtection")}</p> : <p>{t("ws.permissions.help")}</p>}
      {agent.permissionTierUnavailable ? <div className="vg-platform-alert" role="alert"><p>{t("ws.permissions.unavailableHere")}</p>
        <button type="button" className="hs-btn pri" disabled={permissionBlocked || !onApplyPermissionTier}
          onClick={() => { if (onApplyPermissionTier) void onApplyPermissionTier("controlled").catch(cause => setError(workspaceMessageText(t, cause instanceof Error ? cause.message : String(cause)))); }}>{t("ws.permissions.switchControlled")}</button></div> : null}
      {!permissionSupported ? <p role="status">{t("ws.permissions.upgrade")}</p> : null}
    </section></details>
    {confirming ? <FormDialog label={t("ws.rf.confirmAction")} pending={busy} onClose={() => setConfirming(false)}>
      <section className="vg-rf-confirm">
        <h3>{t(use === "confirm_update" ? "ws.rf.confirmUpdateTitle" : use === "confirm_first_use" ? "ws.rf.confirmFirstTitle" : "ws.rf.confirmChangeTitle",
          { engine: engineName(draftRuntime), name: agent.identity.displayName })}</h3>
        {fields.length ? <p>{t("ws.rf.changes", { fields: fieldText })}</p> : null}
        {confirmNeeded ? <>
          <p>{t(use === "confirm_update" ? "ws.rf.confirmUpdateNote" : "ws.rf.confirmFirstNote")}</p>
          <div className="vg-rf-meta">{form?.version ? <span>{t("ws.rf.version", { version: form.version })}</span> : null}{form?.path ? <code>{form.path}</code> : null}</div>
          <p>{t("ws.runtimeExpansion.hostLogin")}</p>
          {separateLoginOffered(draftRuntime) ? <details><summary>{t("ws.rf.loginMethod")}</summary>
            <label><input type="radio" name="rf-login" checked={loginSource === "host"} disabled={busy} onChange={() => setLoginSource("host")} />{t("ws.rf.loginHost")}</label>
            <label><input type="radio" name="rf-login" checked={loginSource === "isolated"} disabled={busy} onChange={() => setLoginSource("isolated")} />{t("ws.rf.loginIsolated")}</label>
          </details> : null}
        </> : null}
        {fields.includes("engine") ? <fieldset><legend>{t("ws.rf.chatKeep")} / {t("ws.rf.chatFresh")}</legend>
          <label><input type="radio" name="rf-restart" checked={restart === "keep"} disabled={busy} onChange={() => setRestart("keep")} />{t("ws.rf.chatKeep")}</label>
          <label><input type="radio" name="rf-restart" checked={restart === "fresh"} disabled={busy || freshBlocked} onChange={() => setRestart("fresh")} />{t("ws.rf.chatFresh")}</label>
          {freshBlocked ? <p role="status">{t("ws.rf.chatFreshBlocked")}</p> : null}
        </fieldset> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="wsd-card-actions"><button type="button" disabled={busy} onClick={() => setConfirming(false)}>{t("ws.rf.cancel")}</button>
          <button type="button" className="wsd-primary" disabled={busy || !piModelReady || restart === "fresh" && freshBlocked} onClick={() => void apply()}>{t(busy ? "ws.rf.applying" : "ws.rf.confirmAction")}</button></div>
      </section>
    </FormDialog> : null}
  </div>;
}
