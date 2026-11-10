import type { WorkspaceDevMessage } from "./workspace-dev-state.ts";
import { userVisibleText } from "./user-visible-text.ts";

export interface RosterPreference { pinned?: boolean; hidden?: boolean; unread?: boolean; section?: string; collapsed?: boolean; readCount?: number; muted?: boolean }
export interface RosterAvatarMember { id: string; accent: string }
export interface RosterEntry { id: string; kind: "colleague" | "group"; name: string; role: string; preview: string; timestamp?: string; order: number; unread: number; shortRole?: string; needsYou?: number; members?: RosterAvatarMember[] }
export const folderPreferenceKey = (folder: string) => `folder:${encodeURIComponent(folder)}`;
export function rosterGroups<T extends RosterEntry>(entries: readonly T[], preferences: Record<string, RosterPreference>, query = "") {
  const normalized = query.trim().toLocaleLowerCase();
  const matching = entries.filter(row => `${row.name} ${row.role} ${row.preview}`.toLocaleLowerCase().includes(normalized));
  const byTime = (a: T, b: T) => b.order - a.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const hidden = entries.filter(row => preferences[row.id]?.hidden).sort(byTime);
  const visible = matching.filter(row => normalized || !preferences[row.id]?.hidden).sort(byTime);
  const pinned = normalized ? [] : visible.filter(row => preferences[row.id]?.pinned);
  const grouped = normalized ? [] : visible.filter(row => !preferences[row.id]?.pinned && preferences[row.id]?.section);
  const folders = [...new Set(grouped.map(row => preferences[row.id]!.section!))].sort().map(name => {
    const rows = grouped.filter(row => preferences[row.id]?.section === name);
    return { name, rows, unread: rows.reduce((sum, row) => sum + Math.max(row.unread, preferences[row.id]?.unread ? 1 : 0), 0), collapsed: Boolean(preferences[folderPreferenceKey(name)]?.collapsed) };
  });
  const recent = normalized ? visible : visible.filter(row => !preferences[row.id]?.pinned && !preferences[row.id]?.section);
  return { pinned, folders, recent, hidden, searching: Boolean(normalized) };
}

/** A short role is whole text, never a cut-off job title. Unicode characters count once. */
export function rosterShortRole(title: string, shortRole?: string): string {
  const value = (shortRole?.trim() || title.trim()).replace(/\s+/gu, " ");
  return [...value].length <= 12 ? value : "";
}

/** Only messages shown to the person can change a conversation's preview, order or unread observation. */
export function rosterConversationActivity(history: readonly WorkspaceDevMessage[]) {
  let preview = "", timestamp: string | undefined, role: "user" | "assistant" | undefined, count = 0;
  for (const message of history) {
    if (message.role === "tool") continue;
    const text = userVisibleText(message.role === "user" ? message.content : message.text).trim();
    if (!text) continue;
    preview = text; timestamp = message.createdAt; role = message.role; count++;
  }
  return { preview, timestamp, role, fingerprint: JSON.stringify([count, role, preview, timestamp]) };
}

/** Unknown members keep a stable place after the members observed speaking most recently. */
export function rosterGroupMembers<T extends RosterAvatarMember>(members: readonly T[], recentSpeakerIds: readonly string[] = []): T[] {
  const order = new Map<string, number>();
  recentSpeakerIds.forEach(id => { if (!order.has(id)) order.set(id, order.size); });
  return [...members].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

/** Names and full titles are already accessible on the row; only omitted visual text needs a tooltip. */
export function rosterTooltipText(entry: Pick<RosterEntry, "kind" | "name" | "role" | "shortRole">, nameTruncated: boolean, isMain = false): string | null {
  const title = entry.role.trim().replace(/\s+/gu, " ");
  const omittedTitle = entry.kind === "colleague" && !isMain && title && rosterShortRole(title, entry.shortRole) !== title;
  return [nameTruncated ? entry.name : "", omittedTitle ? title : ""].filter(Boolean).join(" · ") || null;
}
