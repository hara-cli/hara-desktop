import { useEffect, useMemo, useRef, useState } from "react";
import { detectLocalePreference, makeT, normalizeLocale, resolveLocale, saveLocale, type LocalePreference } from "./i18n";
import type { WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceTaskRecord } from "./workspace-dev-state";
import { buildWorkspaceShell, loadSidebarSections, type SidebarSectionId } from "./workspace-shell-state";

export function workspacePlatform(): "macos" | "other" {
  return /Mac/.test(globalThis.navigator?.platform ?? "") ? "macos" : "other";
}

export function useWorkspaceLocale() {
  const [choice, setChoice] = useState(() => { const preference = detectLocalePreference(); return { preference, locale: resolveLocale(preference) }; });
  useEffect(() => {
    const apply = (preference: LocalePreference) => setChoice(current => {
      const locale = resolveLocale(preference);
      return current.preference === preference && current.locale === locale ? current : { preference, locale };
    });
    const update = () => apply(detectLocalePreference());
    const changed = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      const preference = detail === "system" ? "system" : typeof detail === "string" ? normalizeLocale(detail) : null;
      if (preference) apply(preference); else update();
    };
    const storage = (event: StorageEvent) => { if (event.key === "hara.locale" || event.key === null) update(); };
    const system = () => setChoice(current => current.preference === "system" ? { ...current, locale: resolveLocale("system") } : current);
    window.addEventListener("hara:locale-changed", changed); window.addEventListener("storage", storage); window.addEventListener("languagechange", system);
    return () => { window.removeEventListener("hara:locale-changed", changed); window.removeEventListener("storage", storage); window.removeEventListener("languagechange", system); };
  }, []);
  return { ...choice, t: useMemo(() => makeT(choice.locale), [choice.locale]), changeLocale: saveLocale };
}
export function useSectionState(workspaceId: string) {
  const loaded = useMemo(() => loadSidebarSections(workspaceId, key => localStorage.getItem(key)), [workspaceId]);
  const [saved, setSaved] = useState({ workspaceId, value: loaded });
  const sections = saved.workspaceId === workspaceId ? saved.value : loaded;
  const toggle = (id: SidebarSectionId) => {
    const value = { ...sections, [id]: !sections[id] };
    setSaved({ workspaceId, value });
    try { localStorage.setItem(`hara.sidebar.sections.${workspaceId}`, JSON.stringify(value)); } catch { /* keep this view usable */ }
  };
  return { sections, toggle };
}
export function useWorkspaceOverview(model: WorkspaceDevModel, workspace: WorkspaceDevSnapshot | null) {
  const [overview, setOverview] = useState<{ scope: string; snapshots: WorkspaceDevSnapshot[]; incomplete: boolean } | null>(null);
  const [history, setHistory] = useState<{ scope: string; rows: WorkspaceTaskRecord[] } | null>(null);
  const [revision, setRevision] = useState(0), [now, setNow] = useState(Date.now);
  const observations = useRef(new Map<string, { fingerprint: string; observedAt: number; unread: number }>());
  const scope = workspace ? JSON.stringify([workspace.workspaceId, workspace.resourceGeneration]) : "";
  useEffect(() => {
    if (!workspace || workspace.executionMode !== "workspace") return;
    let active = true;
    void model.workspaceRequest<WorkspaceTaskRecord[]>("workspace.tasks").then(rows => { if (active) setHistory({ scope, rows }); })
      .catch(() => { if (active) setHistory(null); });
    return () => { active = false; };
  }, [model, workspace, scope, revision]);
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    void model.readOverview(workspace, { reuseUnchanged: true }).then(value => { if (active) setOverview({ scope, ...value }); })
      .catch(() => { if (active) setOverview({ scope, snapshots: [], incomplete: true }); });
    return () => { active = false; };
  }, [model, workspace, scope, revision]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const snapshots = useMemo(() => workspace ? [workspace,
    ...(overview?.scope === scope ? overview.snapshots.filter(row => row.selectedAgentId !== workspace.selectedAgentId) : [])] : [], [workspace, overview, scope]);
  const [activity, setActivity] = useState<Record<string, { observedAt: number; unread: number }>>({});
  useEffect(() => {
    const result: typeof activity = {};
    for (const row of snapshots) {
      const key = `${scope}:${row.selectedAgentId}`, history = row.conversation.history;
      const last = [...history].reverse().find(message => message.role !== "tool");
      const fingerprint = JSON.stringify([history.length, last]);
      const previous = observations.current.get(key), changed = previous && previous.fingerprint !== fingerprint;
      const observedAt = changed ? Date.now() : previous?.observedAt ?? 0;
      const unread = row.selectedAgentId === workspace?.selectedAgentId ? 0
        : row.conversation.unreadCount ?? (previous?.unread ?? 0) + (changed && last?.role === "assistant" ? 1 : 0);
      observations.current.set(key, { fingerprint, observedAt, unread }); result[row.selectedAgentId] = { observedAt, unread };
    }
    setActivity(result);
  }, [snapshots, scope, workspace?.selectedAgentId]);
  return { ...useMemo(() => buildWorkspaceShell(snapshots, now, history?.scope === scope ? history.rows : []), [snapshots, now, history, scope]), snapshots, now, activity, historyAvailable: history?.scope === scope,
    loading: Boolean(workspace && overview?.scope !== scope), incomplete: overview?.scope === scope && overview.incomplete,
    refresh: () => { model.invalidateOverview(); setNow(Date.now()); setRevision(value => value + 1); void model.refresh(); } };
}
