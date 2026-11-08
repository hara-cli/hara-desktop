export interface ContextCompactionView {
  id: string; agentId: string; sessionId: string; runId: string; at: string;
  runtimeId: "codex" | "pi" | "claude"; method: "codex-native" | "pi-native" | "host-seed";
  status: "running" | "completed" | "failed"; historyStart: number; beforeTokens: number | null; afterTokens: number | null;
  summary: { goals: string[]; decisions: string[]; unfinished: string[]; references: string[]; cards: string[];
    recent: { role: "user" | "assistant"; text: string }[] };
  usage: { requests: number; inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null };
}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(v, key));
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullableCount = (v: unknown) => v === null || count(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const bytes = (s: string) => new TextEncoder().encode(s).length;
const safeText = (v: unknown): v is string => typeof v === "string" && bytes(v) <= 2000 && v.trim() === v
  && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v)
  && !/-----BEGIN [^-]*PRIVATE KEY|Bearer\s+(?!\*{3}|\[redacted\])\S+|(?:api[ _-]?key|password|secret|token)["']?\s*[:=]\s*["']?(?!\*{3}|\[redacted\])[^\s"']+/iu.test(v);
/** Closed read-only projection. It cannot authorize a tool, answer a card, or remove an original message. */
export function parseContextCompactions(raw: unknown, scope: { agentId: string; sessionId: string; historyLength: number }): ContextCompactionView[] | null {
  if (!Array.isArray(raw) || raw.length > 32) return null;
  const ids = new Set<string>();
  for (const row of raw) {
    if (!plain(row) || !exact(row, ["id", "agentId", "sessionId", "runId", "at", "runtimeId", "method", "status", "historyStart", "beforeTokens", "afterTokens", "summary", "usage"])
      || !uuid(row.id) || ids.has(row.id) || !uuid(row.runId) || row.agentId !== scope.agentId || row.sessionId !== scope.sessionId || !uuid(row.sessionId)
      || typeof row.at !== "string" || !Number.isFinite(Date.parse(row.at)) || new Date(row.at).toISOString() !== row.at
      || !["codex", "pi", "claude"].includes(String(row.runtimeId)) || !["codex-native", "pi-native", "host-seed"].includes(String(row.method))
      || row.method === "codex-native" && row.runtimeId !== "codex" || row.method === "pi-native" && row.runtimeId !== "pi"
      || !["running", "completed", "failed"].includes(String(row.status)) || !count(row.historyStart) || row.historyStart > scope.historyLength
      || !nullableCount(row.beforeTokens) || !nullableCount(row.afterTokens) || !plain(row.summary)
      || !exact(row.summary, ["goals", "decisions", "unfinished", "references", "cards", "recent"]) || bytes(JSON.stringify(row.summary)) > 12_000) return null;
    for (const key of ["goals", "decisions", "unfinished", "references", "cards"])
      if (!Array.isArray(row.summary[key]) || row.summary[key].length > 8 || !(row.summary[key] as unknown[]).every(safeText)) return null;
    if (!Array.isArray(row.summary.recent) || row.summary.recent.length > 6 || !row.summary.recent.every(value => plain(value)
      && exact(value, ["role", "text"]) && ["user", "assistant"].includes(String(value.role)) && safeText(value.text))) return null;
    if (!plain(row.usage) || !exact(row.usage, ["requests", "inputTokens", "outputTokens", "cachedInputTokens"])
      || !count(row.usage.requests) || row.usage.requests > 100 || ![row.usage.inputTokens, row.usage.outputTokens, row.usage.cachedInputTokens].every(nullableCount)
      || row.usage.cachedInputTokens !== null && (!count(row.usage.inputTokens) || !count(row.usage.cachedInputTokens) || row.usage.cachedInputTokens > row.usage.inputTokens)) return null;
    ids.add(row.id);
  }
  return structuredClone(raw) as ContextCompactionView[];
}
