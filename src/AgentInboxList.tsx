import type { ReactNode } from "react";
import type { AgentInboxEntry } from "./workbench-inbox";
import { isRootAgent } from "./agent-session";

/** Presentation only: retain the caller's Space-filtered, searched entries and original actions.
 * The coordinator stays above the recency-sorted colleague list, never identified by its nickname. */
export default function AgentInboxList({ entries, locale, renderContact }: {
  entries: readonly AgentInboxEntry[];
  locale: "en" | "zh";
  renderContact: (entry: AgentInboxEntry) => ReactNode;
}) {
  const coordinators = entries.filter(({ agent }) => isRootAgent(agent));
  const colleagues = entries.filter(({ agent }) => !isRootAgent(agent));
  return <>
    {coordinators.length ? <section className="inbox-main-coordinator"
      aria-label={locale === "zh" ? "主助手" : "Main assistant"}>
      {coordinators.map(renderContact)}
    </section> : null}
    {colleagues.length ? <section className="inbox-colleagues"
      aria-label={locale === "zh" ? "同事" : "Colleagues"}>
      {colleagues.map(renderContact)}
    </section> : null}
  </>;
}
