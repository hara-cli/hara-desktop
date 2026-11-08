export interface RosterPreference { pinned?: boolean; hidden?: boolean; unread?: boolean; section?: string; collapsed?: boolean; readCount?: number }
export interface RosterEntry { id: string; kind: "colleague" | "group"; name: string; role: string; preview: string; timestamp?: string; order: number; unread: number }
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
