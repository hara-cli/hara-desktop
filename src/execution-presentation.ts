import type { ConversationItem } from "./ConversationTimeline";

export type IndexedConversationItem = {
  index: number;
  item: ConversationItem;
};

export type ConversationSegment =
  | ({ kind: "item" } & IndexedConversationItem)
  | { kind: "execution"; items: IndexedConversationItem[] };

export type ExecutionDetailCounts = {
  tools: number;
  changes: number;
};

export function isExecutionDetail(item: ConversationItem): boolean {
  return item.kind === "tool" || item.kind === "diff";
}

/**
 * Keep the conversational transcript readable while retaining complete local execution evidence.
 * Consecutive tool/diff events become one disclosure row; provider reasoning is never retained in the
 * renderer. User messages, assistant results, notices, approvals, and usage markers retain their original
 * ordering and rewind indexes.
 */
export function groupConversationItems(items: ConversationItem[]): ConversationSegment[] {
  const segments: ConversationSegment[] = [];
  let execution: IndexedConversationItem[] = [];

  const flushExecution = () => {
    if (!execution.length) return;
    segments.push({ kind: "execution", items: execution });
    execution = [];
  };

  items.forEach((item, index) => {
    // Providers can persist tool-call assistant turns with no user-visible text. Keep their
    // execution evidence, but never turn those protocol records into blank chat bubbles.
    if (item.kind === "text" && !item.text.trim()) return;
    if (isExecutionDetail(item)) {
      execution.push({ index, item });
      return;
    }
    flushExecution();
    segments.push({ kind: "item", index, item });
  });
  flushExecution();
  return segments;
}

export function countExecutionDetails(items: IndexedConversationItem[]): ExecutionDetailCounts {
  return items.reduce<ExecutionDetailCounts>(
    (counts, entry) => {
      if (entry.item.kind === "tool") counts.tools += 1;
      else if (entry.item.kind === "diff") counts.changes += 1;
      return counts;
    },
    { tools: 0, changes: 0 },
  );
}

export function executionToolNames(
  items: IndexedConversationItem[],
  limit = 3,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.min(10, Math.floor(limit))) : 3;
  if (boundedLimit === 0) return names;
  for (const entry of items) {
    if (entry.item.kind !== "tool" || seen.has(entry.item.name)) continue;
    seen.add(entry.item.name);
    names.push(entry.item.name);
    if (names.length >= boundedLimit) break;
  }
  return names;
}
