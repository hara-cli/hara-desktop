// Synthetic private-host fixture only. Credentials and actual WS ownership remain in Node.
import React from "react";
import { createRoot } from "react-dom/client";
import WorkspaceColleagueInspector from "../../src/WorkspaceColleagueInspector";
import { createWorkspaceWorkScopeSource, bindWorkspaceWorkScopeSource } from "../../src/workspace-work-scope";
import { createWorkspaceWorkScopeWriter, bindWorkspaceWorkScopeWriter } from "../../src/work-scope-writer";
import { createWorkScopeReferenceStore } from "../../src/work-scope-references";
import "../../src/desktop-redesign.css";
import "../../src/violet-tokens.css";
import "../../src/workspace-theme.css";
const root = createRoot(document.getElementById("root")!), listeners = new Set<() => void>(), model: any = { supportsRuntimeForm: () => false };
const nonce = document.querySelector<HTMLMetaElement>('meta[name="c5-csrf"]')!.content;
let bootstrap: any, selected: any, live = false, epoch = 0, locale = "zh-Hans", binding: (() => void) | undefined, writeBinding: (() => void) | undefined;
let requests = 0, writeRequests = 0, deferred: Promise<void> | null = null, release: (() => void) | null = null;
async function rpc(route: string, data: unknown) {
  requests++; if (route === "submit") writeRequests++;
  const response = await fetch("/" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-C5-Nonce": nonce }, body: JSON.stringify(data) });
  if (!response.ok) throw Error("Private Host request unavailable"); return response.json();
}
const source = createWorkspaceWorkScopeSource({
  capture(target) {
    if (!live || JSON.stringify(target) !== JSON.stringify(selected) || JSON.stringify(selected) !== JSON.stringify(bootstrap.target)) return null;
    return { connectionId: bootstrap.connectionId, connectionEpoch: epoch, context: bootstrap.view.context, provenance: bootstrap.view.provenance, capabilities: bootstrap.capabilities,
      assertCurrent() { if (!live) throw Error("Retired fixture"); } };
  },
  async read(target) { const value = await rpc("read", { target }); if (deferred) await deferred; return value; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async describeResources(target, refs) { const value = await rpc("catalog", { target }); return value.resources.filter((row: any) => refs.some(ref => ref.resourceId === row.resourceId && ref.revision === row.revision)).map(({ resourceId, revision, label, path }: any) => ({ resourceId, revision, label, path })); },
});
const writer = createWorkspaceWorkScopeWriter(source, {
  assertCurrent(identity) { if (!live || identity.connectionId !== bootstrap.connectionId || identity.connectionEpoch !== epoch || JSON.stringify(identity.context) !== JSON.stringify(bootstrap.view.context)
    || JSON.stringify(identity.provenance) !== JSON.stringify(bootstrap.view.provenance)) throw Error("Retired Host owner connection"); },
  inspect: target => rpc("inspect", { target }), draft: (target, input) => rpc("draft", { target, input }), submit: (target, command, proposal) => rpc("submit", { target, command, proposal }),
  receipt: (target, commandId) => rpc("receipt", { target, commandId }), catalog: target => rpc("catalog", { target }),
}, createWorkScopeReferenceStore(window.localStorage));
function draw() {
  root.render(<WorkspaceColleagueInspector agent={{ ...bootstrap.agent, agentId: selected.agentId, agentEpoch: selected.agentEpoch, configRevision: selected.configRevision }}
    workspace={{ ...bootstrap.snapshot, workspaceId: selected.workspaceId, resourceGeneration: selected.generation, selectedAgentId: selected.agentId }} locale={locale as any} extensionsModel={model}
    features={null} supported={false} inert={false} error="" connectionModelSupported={false}
    onClose={() => {}} onRefresh={() => {}} onToggle={async () => {}} onSave={async () => {}} onDelete={async () => {}}
    listModels={async () => ({ runtimeId: "pi", revision: 1, selectedModelId: null, models: [] })}
    listConnectionModels={async () => ({ connectionId: "none", revision: 1, selectedModelId: null, models: [] })}
    onApplyRuntime={async () => {}} onApplyModel={async () => {}} onApplyConnectionModel={async () => {}}
    onRescan={async () => {}} onRegisterRuntime={async () => {}} onRuntimeDirectory={() => {}} onSaveProfile={async () => {}} />);
}
(window as any).__C5W = {
  async mount(mode = "owner") {
    writeBinding?.(); binding?.(); writeBinding = undefined; binding = undefined; live = false;
    bootstrap = await rpc("bootstrap", { mode }); selected = { ...bootstrap.target }; epoch = bootstrap.connectionEpoch; live = mode !== "no-cap";
    if (live) { binding = bindWorkspaceWorkScopeSource(model, source); if (mode === "owner") writeBinding = bindWorkspaceWorkScopeWriter(model, writer); }
    draw();
  },
  deferRead() { deferred = new Promise(resolve => { release = resolve; }); },
  releaseRead() { const finish = release; deferred = null; release = null; finish?.(); },
  locale(value: string) { locale = value; draw(); },
  target(patch: object) { selected = { ...bootstrap.target, ...patch }; draw(); },
  withdraw() { live = false; for (const fn of listeners) fn(); },
  stats() { return { requests, writeRequests, references: Object.keys(localStorage).filter(key => key.startsWith("hara.work-scope.pending.v1:")).map(key => JSON.parse(localStorage.getItem(key)!)) }; },
};
(window as any).__C5W_READY = true;
