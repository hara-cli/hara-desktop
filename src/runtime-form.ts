// Pure rules for the colleague engine form (runtime-form-1105, Jeff 2026-11-05: layout A).
// No I/O here: the component and tests share exactly these decisions.

/** Hara sends no effort argument; the engine decides. Distinct from "auto" (Hara picks per message). */
export const ENGINE_DEFAULT_EFFORT = "engine-default";
export const AUTO_EFFORT = "auto";
const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface FormModel { id: string; label: string; recommended?: boolean; supportedReasoningEfforts?: string[] }
export interface FormInventory { models: readonly FormModel[]; defaultModelId: string | null; selected: { modelId: string | null; effort: string | null } | null }

/** Levels the model declared, in a stable low→high order; unknown names keep their place at the end. */
export function modelLevels(model: FormModel | undefined, runtimeId: string): string[] {
  if (!model || runtimeId === "opencode") return [];
  const levels = [...new Set(model.supportedReasoningEfforts ?? [])];
  return levels.sort((a, b) => (LEVEL_ORDER.indexOf(a) + 1 || 99) - (LEVEL_ORDER.indexOf(b) + 1 || 99));
}

/** Fixed order: Auto, Engine default (external engines only), then the model's declared levels. */
export function effortChoices(model: FormModel | undefined, runtimeId: string): string[] {
  const levels = modelLevels(model, runtimeId);
  return levels.length ? [AUTO_EFFORT, ...(runtimeId === "pi" ? [] : [ENGINE_DEFAULT_EFFORT]), ...levels] : [];
}

/** null and "auto" are both Hara's automatic choice. */
export function savedEffortChoice(effort: string | null | undefined): string {
  return effort == null || effort === AUTO_EFFORT ? AUTO_EFFORT : effort;
}

/** What goes on the wire: Auto is null (unchanged legacy meaning); everything else verbatim. */
export function effortForWire(choice: string): string | null {
  return choice === AUTO_EFFORT ? null : choice;
}

/**
 * Raft-style reconcile, with Hara's rule for the fallback (Q4: Auto, not the model default):
 * keep Auto, keep Engine default where offered, keep a level the new model declares; otherwise Auto and
 * report which level was dropped so the form can say so once.
 */
export function reconcileEffort(current: string, model: FormModel | undefined, runtimeId: string): { effort: string; dropped: string | null } {
  if (current === AUTO_EFFORT) return { effort: current, dropped: null };
  if (current === ENGINE_DEFAULT_EFFORT) return runtimeId === "pi" ? { effort: AUTO_EFFORT, dropped: null } : { effort: current, dropped: null };
  return modelLevels(model, runtimeId).includes(current) ? { effort: current, dropped: null } : { effort: AUTO_EFFORT, dropped: current };
}

/**
 * Default model: the Workspace's saved choice for this engine → the engine-reported default →
 * the official list's recommendation → the first model. "" means the engine's own default (no list).
 */
export function defaultModel(inventory: FormInventory): string {
  const has = (id: string | null | undefined): id is string => Boolean(id) && inventory.models.some(row => row.id === id);
  if (has(inventory.selected?.modelId)) return inventory.selected!.modelId!;
  if (has(inventory.defaultModelId)) return inventory.defaultModelId!;
  return inventory.models.find(row => row.recommended)?.id ?? inventory.models[0]?.id ?? "";
}

/** The saved baseline of a form for one engine: what "no change" means. */
export function formBaseline(inventory: FormInventory): { model: string; effort: string } {
  return { model: defaultModel(inventory), effort: savedEffortChoice(inventory.selected?.effort) };
}

export type FormField = "engine" | "model" | "effort";
export function changedFields(current: { runtimeId: string }, draft: { runtimeId: string; model: string; effort: string },
  baseline: { model: string; effort: string } | null): FormField[] {
  const fields: FormField[] = [];
  if (draft.runtimeId !== current.runtimeId) fields.push("engine");
  if (baseline && draft.model !== baseline.model) fields.push("model");
  if (baseline && draft.effort !== baseline.effort) fields.push("effort");
  return fields;
}

/** Engine row status text key and its reason key, from Core's runtime-form projection. */
export function engineStatus(use: string | undefined, reason: string | undefined): { key: string; reasonKey?: string } | null {
  if (!use) return null;
  if (use === "unavailable") return { key: "ws.rf.status.unavailable", reasonKey: `ws.rf.reason.${["not_installed", "unsafe_file", "legacy_unsupported", "adapter_pending", "detection_failed", "host_login_required"].includes(reason ?? "") ? reason : "unknown"}` };
  return ["ready", "confirm_first_use", "confirm_update", "detecting"].includes(use) ? { key: `ws.rf.status.${use}` } : null;
}

export const needsConfirmation = (use: string | undefined) => use === "confirm_first_use" || use === "confirm_update";
/** Only Codex and Claude can sign in separately inside Hara; the others always use this computer's login. */
export const separateLoginOffered = (runtimeId: string) => runtimeId === "codex" || runtimeId === "claude";

/** Draft Pi reads the Workspace connection; only an actually listed model is applicable. */
export function canApplyPiModel(ready: boolean, connectionId: string | undefined,
  inventory: (FormInventory & { connectionId?: string }) | null, modelId: string): boolean {
  return ready && Boolean(connectionId) && inventory !== null && inventory.connectionId === connectionId
    && inventory.models.some(row => row.id === modelId);
}

/** Connection failures have closed user-facing explanations; raw internal details never enter Pi copy. */
export function piModelErrorKey(reason: string) {
  if (/changed|generation unavailable|agent unavailable|ws\.notice\.scopeChanged/i.test(reason)) return "ws.rf.piModelsChanged" as const;
  if (/credential|authorization pending|secure settings|unavailable scoped model connection/i.test(reason)) return "ws.rf.piCredentials" as const;
  if (/Connection unavailable|No usable connection/i.test(reason)) return "ws.rf.piNoConnection" as const;
  return "ws.rf.piModelsUnavailable" as const;
}
