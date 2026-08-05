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
