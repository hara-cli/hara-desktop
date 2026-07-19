import type { ConversationItem } from "./ConversationTimeline";

/**
 * Resolve one optimistic user message by stable local identity.
 *
 * Accepted messages stay in the visible transcript and become eligible for server rewind.
 * Canceled messages disappear because they were never persisted by hara serve.
 */
export function resolveOptimisticUser(
  items: ConversationItem[],
  pendingId: string,
  accepted: boolean,
): ConversationItem[] {
  if (!pendingId) return items;
  if (!accepted) {
    return items.filter(
      (item) => item.kind !== "user" || item.pendingId !== pendingId,
    );
  }
  return items.map((item): ConversationItem => {
    if (item.kind !== "user" || item.pendingId !== pendingId) return item;
    const { pendingId: _pendingId, ...persisted } = item;
    return persisted;
  });
}

/** Count only turns that the server can actually rewind. */
export function persistedUserTurnsFrom(
  items: ConversationItem[],
  startIndex: number,
): number {
  return items
    .slice(startIndex)
    .filter((item) => item.kind === "user" && !item.pendingId)
    .length;
}

/**
 * Replace partial post-disconnect output with serve's durable history while retaining only local
 * messages that are still visibly queued and therefore cannot exist in that history yet.
 */
export function restoreAuthoritativeConversation(
  authoritative: ConversationItem[],
  local: ConversationItem[],
): ConversationItem[] {
  return [
    ...authoritative,
    ...local.filter(
      (item) => item.kind === "user" && !!item.pendingId,
    ),
  ];
}
