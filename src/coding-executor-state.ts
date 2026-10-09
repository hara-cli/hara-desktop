export const CODING_EXECUTOR_PREFERENCES = ["auto", "opencode", "pi", "codex", "claude"] as const;
export type CodingExecutorPreference = typeof CODING_EXECUTOR_PREFERENCES[number];
export type CodingExecutorId = Exclude<CodingExecutorPreference, "auto">;

export interface CodingSettingsState {
  version: 1;
  revision: number;
  executor: CodingExecutorPreference;
  effectiveExecutor: CodingExecutorId;
  recommendedExecutor: "opencode";
  executorEditable: boolean;
  experimental: boolean;
}

export function isCodingExecutorPreference(value: unknown): value is CodingExecutorPreference {
  return typeof value === "string" && (CODING_EXECUTOR_PREFERENCES as readonly string[]).includes(value);
}

/** Project only the versioned, credential-free settings contract. Unknown contracts stay closed. */
export function codingSettingsState(value: unknown): CodingSettingsState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !Number.isSafeInteger(item.revision) || (item.revision as number) < 0
    || !isCodingExecutorPreference(item.executor) || !isCodingExecutorPreference(item.effectiveExecutor)
    || item.effectiveExecutor === "auto" || item.recommendedExecutor !== "opencode"
    || typeof item.executorEditable !== "boolean" || typeof item.experimental !== "boolean") return null;
  return {
    version: 1, revision: item.revision as number, executor: item.executor,
    effectiveExecutor: item.effectiveExecutor, recommendedExecutor: "opencode",
    executorEditable: item.executorEditable, experimental: item.experimental,
  };
}

export interface CodingSettingsApi {
  getCodingSettings(cwd?: string): Promise<CodingSettingsState | null>;
  updateCodingSettings(input: { executor: CodingExecutorPreference; expectedRevision: number }, cwd?: string): Promise<CodingSettingsState>;
}

export interface CodingSettingsView {
  phase: "loading" | "ready" | "saving" | "unsupported" | "error";
  settings: CodingSettingsState | null;
  draft: CodingExecutorPreference;
  message: "saved" | "load_failed" | "update_failed" | null;
  needsReload: boolean;
}

/** One mounted settings scope. No execution authority, persistence, or automatic write retries. */
export function createCodingSettingsController(api: CodingSettingsApi | null, cwd?: string) {
  let view: CodingSettingsView = { phase: "loading", settings: null, draft: "auto", message: null, needsReload: false };
  let generation = 0;
  let live = true;
  const listeners = new Set<() => void>();
  const publish = (next: CodingSettingsView) => {
    view = next;
    for (const listener of listeners) listener();
  };
  const current = (ticket: number) => live && ticket === generation;
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() { live = true; },
    dispose() { live = false; generation += 1; listeners.clear(); },
    select(executor: unknown) {
      if (!live || view.phase !== "ready" || view.needsReload || !view.settings?.executorEditable
        || !isCodingExecutorPreference(executor)) return false;
      publish({ ...view, draft: executor, message: null });
      return true;
    },
    async load() {
      if (!live || view.phase === "saving") return false;
      const ticket = ++generation;
      publish({ ...view, phase: "loading", message: null });
      if (!api) {
        publish({ phase: "unsupported", settings: null, draft: "auto", message: null, needsReload: false });
        return false;
      }
      try {
        const response = await api.getCodingSettings(cwd);
        if (!current(ticket)) return false;
        if (response === null) {
          publish({ phase: "unsupported", settings: null, draft: "auto", message: null, needsReload: false });
          return false;
        }
        const settings = codingSettingsState(response);
        if (!settings) throw new Error("invalid_coding_settings");
        publish({ phase: "ready", settings, draft: settings.executor, message: null, needsReload: false });
        return true;
      } catch {
        if (current(ticket)) publish({ phase: "error", settings: null, draft: "auto", message: "load_failed", needsReload: true });
        return false;
      }
    },
    async save() {
      if (!live || !api || view.phase !== "ready" || view.needsReload || !view.settings?.executorEditable
        || view.draft === view.settings.executor) return false;
      const ticket = ++generation;
      const { draft, settings: previous } = view;
      // The synchronous phase change locks a second click before React can render.
      publish({ ...view, phase: "saving", message: null });
      try {
        const response = await api.updateCodingSettings({ executor: draft, expectedRevision: previous.revision }, cwd);
        if (!current(ticket)) return false;
        const settings = codingSettingsState(response);
        if (!settings || settings.executor !== draft || settings.revision <= previous.revision) throw new Error("invalid_coding_settings_ack");
        publish({ phase: "ready", settings, draft: settings.executor, message: "saved", needsReload: false });
        return true;
      } catch {
        // An absent ACK is not proof of no write. Require a read before another explicit save.
        if (current(ticket)) publish({ ...view, phase: "ready", message: "update_failed", needsReload: true });
        return false;
      }
    },
  };
}
