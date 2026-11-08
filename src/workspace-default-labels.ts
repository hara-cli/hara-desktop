import { coreText } from "./core-i18n.ts";
import type { Locale } from "./i18n.ts";
import type { WorkspaceDevView, WorkspaceDevAgent } from "./workspace-dev-state.ts";
/** Renderer-only projection. Never mutates the controller, stored labels, identities or task bindings. */
export function localizedWorkspaceView(view: WorkspaceDevView, locale: Locale): WorkspaceDevView {
  const name = (row: { label: string; labelSource?: "default"; labelKey?: "core.name.workspace" }) => row.labelSource === "default"
    && row.labelKey === "core.name.workspace" ? coreText(row.labelKey, locale) : row.label;
  const agent = (row: WorkspaceDevAgent): WorkspaceDevAgent => row.kind === "main" && row.titleSource === "default" && row.titleKey === "core.name.orchestrator"
    ? { ...row, identity: { ...row.identity, title: coreText(row.titleKey, locale) } } : row;
  return { ...view, directory: view.directory ? { ...view.directory, workspaces: view.directory.workspaces.map(row => ({ ...row, label: name(row) })) } : null,
    roster: (view.roster ?? []).map(agent), workspace: view.workspace ? { ...view.workspace, label: name(view.workspace), agents: view.workspace.agents.map(agent) } : null };
}
