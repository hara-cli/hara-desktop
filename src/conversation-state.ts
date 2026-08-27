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

/**
 * Reconcile streamed transcript state with serve's authoritative terminal reply.
 *
 * A transport can lose one or more `event.text` frames while still receiving `event.turn_end`. The
 * terminal event carries the exact last assistant message persisted for this turn, so use it to repair
 * only the final response segment. Earlier commentary and execution details remain in place.
 */
export function reconcileTerminalReply(
  items: ConversationItem[],
  reply: string,
): ConversationItem[] {
  if (!reply.trim()) return items;

  let segmentStart = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "user" || item.kind === "end") {
      segmentStart = index + 1;
      break;
    }
  }

  // Text emitted before the last execution boundary is explanatory commentary, not the terminal reply.
  for (let index = segmentStart; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "tool" || item.kind === "diff" || item.kind === "approval") {
      segmentStart = index + 1;
    }
  }

  const terminalTextIndexes: number[] = [];
  for (let index = segmentStart; index < items.length; index += 1) {
    if (items[index].kind === "text") terminalTextIndexes.push(index);
  }
  if (terminalTextIndexes.length === 0) return [...items, { kind: "text", text: reply }];

  const streamed = terminalTextIndexes
    .map((index) => (items[index] as Extract<ConversationItem, { kind: "text" }>).text)
    .join("");
  if (streamed === reply) return items;

  // The usual loss mode drops a suffix of streamed frames. Complete it in place so any interleaved
  // notices keep their original order. For a gap or other mismatch, replace only this terminal segment
  // with the durable reply instead of showing a duplicate or an incomplete answer.
  if (reply.startsWith(streamed)) {
    const lastTextIndex = terminalTextIndexes[terminalTextIndexes.length - 1];
    return items.map((item, index): ConversationItem =>
      index === lastTextIndex && item.kind === "text"
        ? { kind: "text", text: item.text + reply.slice(streamed.length) }
        : item,
    );
  }

  const firstTextIndex = terminalTextIndexes[0];
  const terminalTextSet = new Set(terminalTextIndexes);
  return items.flatMap((item, index): ConversationItem[] => {
    if (index === firstTextIndex) return [{ kind: "text", text: reply }];
    if (terminalTextSet.has(index)) return [];
    return [item];
  });
}
