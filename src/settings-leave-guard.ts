export type SettingsLeaveAction =
  | { kind: "page"; page: string }
  | { kind: "scope"; workspaceId: string }
  | { kind: "close" }
  | { kind: "skill"; workspaceId: string };
export interface SettingsLeaveContext { workspaceId: string | null; generation: string | null; page: string }
export interface SettingsLeaveDecision { readonly context: SettingsLeaveContext; readonly action: SettingsLeaveAction }

/** A local navigation decision, never an execution/tool approval. Native WebViews need not
 * implement window.confirm, so pending edits must be guarded before any navigation commits. */
export class SettingsLeaveGuard {
  private dirty = false;
  private pending: SettingsLeaveDecision | null = null;
  private listeners = new Set<() => void>();
  private context: () => SettingsLeaveContext;
  private commit: (action: SettingsLeaveAction) => void;
  constructor(context: () => SettingsLeaveContext, commit: (action: SettingsLeaveAction) => void) { this.context = context; this.commit = commit; }
  getSnapshot = () => this.pending;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setDirty = (value: boolean) => { this.dirty = value; };
  private publish(value: SettingsLeaveDecision | null) { this.pending = value; for (const listener of this.listeners) listener(); }
  request(action: SettingsLeaveAction) {
    if (this.pending) return;
    if (!this.dirty) { this.commit(action); return; }
    this.publish(Object.freeze({ context: Object.freeze({ ...this.context() }), action: Object.freeze({ ...action }) }));
  }
  cancel = () => { if (this.pending) this.publish(null); };
  confirm = (): "committed" | "stale" | "none" => {
    const pending = this.pending;
    if (!pending) return "none";
    const current = this.context();
    this.publish(null); // Consume before committing so a same-frame repeat cannot navigate twice.
    if (pending.context.workspaceId !== current.workspaceId || pending.context.generation !== current.generation || pending.context.page !== current.page) return "stale";
    this.dirty = false; this.commit(pending.action); return "committed";
  };
}
