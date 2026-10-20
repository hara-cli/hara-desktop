// DEV-only real controls. No Tauri bridge, Core, filesystem, credentials or updater network calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ToggleSwitch } from "../../src/ToggleSwitch";
import { WorkspaceThemeSettings, WorkspaceFeaturePanel } from "../../src/WorkspaceSettingsPanels";
import { WorkspaceSoftwareUpdate } from "../../src/WorkspaceSoftwareUpdate";
import { ModuleDockSettings } from "../../src/ModuleDockSettings";
import { CORE_NAVIGATION_CONTRIBUTIONS, parseNavigationPreferences, withNavigationVisibility } from "../../src/navigation";
import { updateDefaults } from "../../src/workspace-updater-state";
import "../../src/App.css";
import "../../src/theme-light.css";
import "../../src/workspace-local-dev.css";
import "../../src/workspace-theme.css";
import "../../src/workspace-settings.css";
import "./switch-capsule-preview.css";
if (!import.meta.env.DEV || location.hostname !== "127.0.0.1") throw Error("Task-owned synthetic localhost fixture only");
const params = new URLSearchParams(location.search), theme = params.get("theme") === "dark" ? "dark" : "light", locale = params.get("locale") ?? "zh-Hans", view = params.get("view") ?? "matrix";
document.documentElement.dataset.theme = theme; localStorage.setItem("hara.locale", locale);
const calls: unknown[] = [], listeners = new Set<() => void>(); let hold = false, release: (() => void) | undefined;
let updateView = { phase: "latest", version: "", notes: "", downloaded: 0, total: null, notice: false, message: "", installing: false, preferences: updateDefaults() };
const updater = { getSnapshot: () => updateView, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  async setAutoCheck(checked: boolean) { calls.push({ method: "synthetic.auto", checked }); updateView = { ...updateView, preferences: { ...updateView.preferences, autoCheck: checked } }; listeners.forEach(listener => listener()); } };
let features = { revision: 1, skills: [true, false].map((enabled, index) => ({ id: `fixture-skill-${index}`, description: "Synthetic reviewed skill", source: "private", version: "fixture-version", locked: true, enabled })),
  schedules: [true, false].map((enabled, index) => ({ id: `fixture-schedule-${index}`, name: `Local schedule ${index}`, enabled, schedule: { expr: "0 8 * * *" } })) };
const model = { async workspaceRequest(method: string, values: Record<string, unknown> = {}) {
  calls.push({ method, values });
  if (method === "workspace.features.list") return structuredClone(features);
  if (method !== "workspace.features.update") throw Error("No external operations in fixture");
  if (hold) await new Promise<void>(done => { release = done; });
  const key = values.kind === "skill" ? "skills" : "schedules";
  features = { ...features, revision: features.revision + 1, [key]: features[key].map(row => row.id === values.id ? { ...row, enabled: values.enabled } : row) };
  return structuredClone(features);
} };
const workspace = { workspaceId: "synthetic", resourceGeneration: "fixture-generation", label: "Synthetic workspace", agents: [{ agentId: "main", kind: "main", state: "active", identity: { displayName: "Hara" } }] };
const states = ["off", "on", "hover-off", "hover-on", "focus-off", "focus-on", "disabled-off", "disabled-on"];
function Fixture() {
  const [checked, setChecked] = useState(true), [preferences, setPreferences] = useState(() => parseNavigationPreferences(null));
  const appearance = { preference: theme, settings: { theme, executionDetails: "brief", collapseDetails: checked, readOnly: false }, notice: "", change() {}, changeDetails(_mode: string, value: boolean) { calls.push({ method: "synthetic.appearance", checked: value }); setChecked(value); } };
  const content = view === "appearance" ? <WorkspaceThemeSettings theme={appearance as any} />
    : view === "updates" ? <WorkspaceSoftwareUpdate controller={updater as any} info={{ desktop: "1.1.0", engine: "1.0.2", arch: "synthetic", channel: "fixture" }} />
      : view === "skills" || view === "schedules" ? <WorkspaceFeaturePanel model={model as any} workspace={workspace as any} kind={view} />
        : view === "modules" ? <ModuleDockSettings embedded contributions={CORE_NAVIGATION_CONTRIBUTIONS} preferences={preferences}
          labels={{ "core.chat": { title: "Workbench", description: "Fixed" }, "core.tasks": { title: "Tasks", description: "Local" }, "core.groups": { title: "Groups", description: "Local" } }}
          copy={{ eyebrow: "Navigation", title: "Modules", description: "", cardTitle: "Module visibility", cardDescription: "Real legacy settings controls", visible: "Visible", hidden: "Hidden", show: "Show", hide: "Hide", moveUp: "Move up", moveDown: "Move down", fixedTitle: "Fixed entries", fixedDescription: "Workbench remains available" }}
          onMove={() => { throw Error("Not part of switch regression"); }} onVisibilityChange={(id, visible) => { calls.push({ method: "synthetic.module", id, checked: visible }); setPreferences(previous => withNavigationVisibility(CORE_NAVIGATION_CONTRIBUTIONS, previous, id, visible)); }} /> : null;
  return <><header className="fixture-heading"><h1>Switch regression · {view} · {theme} · {locale}</h1><p>Real components · synthetic state only</p></header>
    {view === "matrix" ? <div className="fixture-matrices">{["workspace", "legacy"].map(context => <section key={context} data-context={context} className={context === "workspace" ? "fixture-matrix wsd-app hs wss-app" : "fixture-matrix settings-card"}>
      <div className="wss-page-card"><h2>{context}</h2><div className="fixture-state-grid">{states.map(state => <figure key={state} data-case={`${context}-${state}`}><ToggleSwitch label={`${context} ${state}`} checked={state.endsWith("on")} disabled={state.startsWith("disabled")}
        onCheckedChange={value => calls.push({ method: "synthetic.matrix", checked: value })} /><figcaption>{state}</figcaption></figure>)}</div></div></section>)}</div>
      : <main data-consumer={view} className={view === "modules" ? "fixture-consumer" : "fixture-consumer wsd-app hs wss-app"}><div className="wss-content wss-page-card">{content}</div></main>}
  </>;
}
(window as any).__HARA_SWITCH_FIXTURE__ = { calls, hold(value: boolean) { hold = value; }, release() { hold = false; release?.(); } };
createRoot(document.getElementById("root")!).render(<Fixture />);
