export interface LocalChannelCreation { id: string; name: string; memberIds: string[]; expectedRevision: number }
export interface LocalChannelPreferences {
  selectedChannelId: string | null;
  recipients: Record<string, string[] | null>;
  pending: Record<string, { requestId: string; recipientIds: string[] }>;
  creation: LocalChannelCreation | null;
}
export interface LocalChannelPreferencesStore {
  load(workspaceId: string, generation: string): LocalChannelPreferences;
  save(workspaceId: string, generation: string, value: LocalChannelPreferences): void;
}
export const emptyChannelPreferences = (): LocalChannelPreferences => ({ selectedChannelId: null, recipients: Object.create(null), pending: Object.create(null), creation: null });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(value)
  && !["__proto__", "constructor", "prototype"].includes(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;

/** Per-Workspace UI intent and receipt identities only: never messages, drafts or credentials. */
export function createLocalChannelPreferencesStore(storage?: Pick<Storage, "getItem" | "setItem"> | null): LocalChannelPreferencesStore | null {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { return null; } }
  if (!storage) return null;
  const target = storage, key = (workspaceId: string, generation: string) => `hara.local-channels.v1:${JSON.stringify([workspaceId, generation])}`;
  return {
    load(workspaceId, generation) {
      const empty = emptyChannelPreferences();
      try {
        const text = target.getItem(key(workspaceId, generation)); if (!text || text.length > 4 * 1024 * 1024) return empty;
        const value: unknown = JSON.parse(text);
        if (!record(value) || value.schemaVersion !== 1 || value.workspaceId !== workspaceId || value.generation !== generation
          || !(value.selectedChannelId === null || id(value.selectedChannelId)) || !record(value.recipients) || !record(value.pending)) return empty;
        for (const [channelId, recipients] of Object.entries(value.recipients)) {
          if (!id(channelId) || !(recipients === null || ids(recipients))) return emptyChannelPreferences();
          empty.recipients[channelId] = recipients === null ? null : [...recipients];
        }
        for (const [channelId, pending] of Object.entries(value.pending)) {
          if (!id(channelId) || !record(pending) || !id(pending.requestId) || !ids(pending.recipientIds)) return emptyChannelPreferences();
          empty.pending[channelId] = { requestId: pending.requestId, recipientIds: [...pending.recipientIds] };
        }
        if (value.creation !== null) {
          const creation = value.creation;
          if (!record(creation) || !id(creation.id) || typeof creation.name !== "string" || !creation.name.trim() || creation.name.length > 80
            || /[\u0000-\u001f\u007f]/.test(creation.name) || !ids(creation.memberIds) || !Number.isSafeInteger(creation.expectedRevision) || Number(creation.expectedRevision) < 0) return emptyChannelPreferences();
          empty.creation = { id: creation.id, name: creation.name, memberIds: [...creation.memberIds], expectedRevision: Number(creation.expectedRevision) };
        }
        empty.selectedChannelId = value.selectedChannelId;
        return empty;
      } catch { return emptyChannelPreferences(); }
    },
    save(workspaceId, generation, value) {
      // Whitelist fields so a caller can never accidentally cache a message or connection object.
      const recipients = Object.fromEntries(Object.entries(value.recipients).map(([channelId, selected]) => [channelId, selected === null ? null : [...selected]]));
      const pending = Object.fromEntries(Object.entries(value.pending).map(([channelId, request]) => [channelId, { requestId: request.requestId, recipientIds: [...request.recipientIds] }]));
      const creation = value.creation ? { id: value.creation.id, name: value.creation.name, memberIds: [...value.creation.memberIds], expectedRevision: value.creation.expectedRevision } : null;
      try { target.setItem(key(workspaceId, generation), JSON.stringify({ schemaVersion: 1, workspaceId, generation, selectedChannelId: value.selectedChannelId, recipients, pending, creation })); }
      catch { /* Unavailable storage must not prevent current-session local channel use. */ }
    },
  };
}
