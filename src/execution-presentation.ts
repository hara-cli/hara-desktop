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

export type AssistantTextPresentation = {
  visibleText: string;
  technicalText?: string;
};

const TECHNICAL_RECEIPT_HEADING = /^(?:delivery|execution|technical) receipt$|^(?:投递|执行|技术)回执$|^技术详情$/iu;
const TECHNICAL_RECEIPT_FIELD = /^(?:[-*+]\s+|\d+[.)]\s+)?`?(?:status|recipient|session(?:id| id)|turn(?:id| id)|task(?:id| id)|provider(?:session)?id|runtime(?:session)?id|agentref|operationid)`?\s*[:：]/iu;

function plainMarkdownLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^[*_`]+|[*_`]+$/gu, "")
    .replace(/[:：]\s*$/u, "")
    .trim();
}

function tidyVisibleText(lines: string[]): string {
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

/**
 * Keep a natural Agent reply in the transcript while preserving an explicitly-labelled machine receipt.
 * This intentionally recognizes only a narrow heading followed by at least two internal-id/status fields;
 * ordinary prose, code, and user-requested technical explanations are never heuristically hidden.
 */
export function splitAssistantTechnicalReceipt(text: string): AssistantTextPresentation {
  const lines = text.split(/\r?\n/u);
  for (let start = 0; start < lines.length; start += 1) {
    if (!TECHNICAL_RECEIPT_HEADING.test(plainMarkdownLine(lines[start]!))) continue;
    let end = start + 1;
    let fields = 0;
    const detailLines: string[] = [];
    while (end < lines.length) {
      const line = lines[end]!;
      if (!line.trim()) {
        detailLines.push(line);
        end += 1;
        continue;
      }
      if (!TECHNICAL_RECEIPT_FIELD.test(line.trim())) break;
      detailLines.push(line);
      fields += 1;
      end += 1;
    }
    if (fields < 2) continue;
    return {
      visibleText: tidyVisibleText([...lines.slice(0, start), ...lines.slice(end)]),
      technicalText: tidyVisibleText(detailLines),
    };
  }
  return { visibleText: text };
}

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
