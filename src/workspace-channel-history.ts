/** A bounded presentation window; Core history is never truncated or rewritten. */
export const CHANNEL_HISTORY_PAGE_SIZE = 100;
export function channelHistoryPage<T extends { id: string }>(rows: readonly T[], anchor: string | null = null, size = CHANNEL_HISTORY_PAGE_SIZE) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("Invalid history page size");
  const found = anchor === null ? -1 : rows.findIndex(row => row.id === anchor);
  const end = found < 0 ? rows.length : found + 1, start = Math.max(0, end - size);
  return { rows: rows.slice(start, end), start, end, total: rows.length,
    older: start > 0 ? rows[start - 1].id : null,
    newer: end + size < rows.length ? rows[end + size - 1].id : null,
    hasOlder: start > 0, hasNewer: end < rows.length,
    anchor: found < 0 ? null : anchor,
  };
}
