import type { ContextCompactionView } from "./context-compaction";
import type { makeT } from "./i18n";
export function WorkspaceContextCompaction({ value, t }: { value: ContextCompactionView; t: ReturnType<typeof makeT> }) {
  const amount = (v: number | null) => v === null ? t("ws.compaction.unknown") : String(v);
  const sections = ["goals", "decisions", "unfinished", "references", "cards"] as const;
  return <details className="wsd-context-compaction">
    <summary>{t(value.status === "completed" ? "ws.compaction.completed" : value.status === "failed" ? "ws.compaction.failed" : "ws.compaction.pending")}</summary>
    <div className="wsd-context-compaction-body">
      <p>{t("ws.compaction.reference")}</p>
      {sections.map(key => value.summary[key].length ? <section key={key}><strong>{t(`ws.compaction.${key}`)}</strong>
        <ul>{value.summary[key].map((text, index) => <li key={index}>{text}</li>)}</ul></section> : null)}
      {value.summary.recent.length ? <section><strong>{t("ws.compaction.recent")}</strong>{value.summary.recent.map((row, i) => <p key={i}>{row.text}</p>)}</section> : null}
      <p>{t("ws.compaction.cost", { calls: String(value.usage.requests), input: amount(value.usage.inputTokens), output: amount(value.usage.outputTokens), cached: amount(value.usage.cachedInputTokens) })}</p>
    </div>
  </details>;
}
