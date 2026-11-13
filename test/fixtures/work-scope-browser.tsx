// Private browser fixture only. Production never binds this synthetic composition port.
import React, { useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import WorkspaceColleagueInspector from "../../src/WorkspaceColleagueInspector";
import { createWorkspaceWorkScopeSource, bindWorkspaceWorkScopeSource } from "../../src/workspace-work-scope";
import "../../src/desktop-redesign.css";
import "../../src/violet-tokens.css";
import "../../src/workspace-theme.css";

const root = createRoot(document.getElementById("root")!);
const listeners = new Set<() => void>();
let bootstrap: any, selected: any, locale = "zh-Hans", live = false, epoch = 1;
let unbind: (() => void) | undefined, reads = 0, failure = false, deferred: Promise<void> | null = null;
let release: (() => void) | null = null, abortSignals = 0, received = 0, lastCompleted = 0;
const model: any = { supportsRuntimeForm: () => false };
const notify = () => { for (const listener of listeners) listener(); };
const source = createWorkspaceWorkScopeSource({
  capture(target) {
    if (!live || !bootstrap?.view || JSON.stringify(target) !== JSON.stringify(bootstrap.target)) return null;
    return { connectionId: bootstrap.connectionId, connectionEpoch: epoch, capabilities: bootstrap.capabilities,
      context: bootstrap.view.context, provenance: bootstrap.view.provenance,
      assertCurrent() { if (!live) throw Error("Fixture connection retired"); } };
  },
  async read(target, signal) {
    const requestNo = ++reads;
    signal?.addEventListener("abort", () => abortSignals++, { once: true });
    const response = await fetch("/read", { method: "POST", body: JSON.stringify(target), signal });
    if (!response.ok) throw Error("Host declined the read");
    const value = await response.json(); received++;
    if (deferred) await deferred; // Exercise an uncancellable already-received late result too.
    lastCompleted = requestNo;
    return failure ? { ...value, policy: { approved: true } } : value;
  },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
});
function ObservedInspector(props: any) {
  // Observe each committed DOM before passive effects can clear a resurrected prior view.
  useLayoutEffect(() => {
    if ((window as any).__C5_WATCH_RETURN__ && document.querySelector(".hd-work-scope-duty-title")) (window as any).__C5_STALE_COMMITS__++;
  });
  return <WorkspaceColleagueInspector {...props} />;
}
function draw() {
  const workspace = { ...bootstrap.snapshot, workspaceId: selected.workspaceId, resourceGeneration: selected.generation, selectedAgentId: selected.agentId };
  const agent = { ...bootstrap.agent, agentId: selected.agentId, agentEpoch: selected.agentEpoch, configRevision: selected.configRevision };
  root.render(<ObservedInspector agent={agent} workspace={workspace} locale={locale as any} extensionsModel={model}
    features={null} supported={false} inert={false} error="" connectionModelSupported={false}
    onClose={() => {}} onRefresh={() => {}} onToggle={async () => {}} onSave={async () => {}} onDelete={async () => {}}
    listModels={async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] })}
    listConnectionModels={async () => ({ connectionId: "none", revision: 1, selectedModelId: null, models: [] })}
    onApplyRuntime={async () => {}} onApplyModel={async () => {}} onApplyConnectionModel={async () => {}}
    onRescan={async () => {}} onRegisterRuntime={async () => {}} onRuntimeDirectory={() => {}} onSaveProfile={async () => {}} />);
}
(window as any).__C5 = {
  async mount(mode = "owner") {
    unbind?.(); unbind = undefined; live = false; failure = false;
    bootstrap = await (await fetch("/bootstrap?mode=" + mode)).json();
    selected = { ...bootstrap.target }; live = mode === "owner"; epoch++;
    if (live) unbind = bindWorkspaceWorkScopeSource(model, source);
    draw();
  },
  locale(value: string) { locale = value; draw(); },
  fault(value: boolean, publish = true) { failure = value; if (publish) notify(); },
  defer(publish = true) { deferred = new Promise<void>(resolve => { release = resolve; }); if (publish) notify(); },
  release() { const finish = release; deferred = null; release = null; finish?.(); },
  target(patch: object) { selected = { ...bootstrap.target, ...patch }; draw(); },
  withdraw() { live = false; notify(); },
  async reconnect() {
    bootstrap = await (await fetch("/reconnect", { method: "POST" })).json();
    selected = { ...bootstrap.target }; live = true; epoch++; notify(); draw();
  },
  async revoke() { const response = await fetch("/revoke", { method: "POST" }); if (!response.ok) throw Error("Host revocation probe failed"); live = false; notify(); },
  stats() { return { reads, received, lastCompleted, abortSignals, bound: !!unbind, listeners: listeners.size }; },
};
(window as any).__C5_READY = true;
