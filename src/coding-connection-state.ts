import type { ExternalSessionInfo } from "./client.ts";

/** A stalled metadata/binding RPC must not keep the chat toolbar or modal disabled indefinitely.
 * This UI deadline never retries, cancels a native turn, or treats an unknown binding as successful. */
export async function codingConnectionRequest<T>(request: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("coding connection request timed out")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export function codingConnectionCandidate(session: ExternalSessionInfo): boolean {
  return ["codex", "claude", "runtime"].includes(session.sourceId)
    && session.origin !== "subAgent" && !session.ephemeral
    && (session.sourceId !== "runtime" || session.agentKind === "codex" || session.agentKind === "claude");
}

/** Metadata guides the picker only. Serve revalidates native ownership and read-only state on connect. */
export function codingConnectionNeedsRecovery(session: ExternalSessionInfo): boolean {
  return ["stored", "error", "unknown"].includes(session.state);
}

export function codingConnectionChoices(sessions: readonly ExternalSessionInfo[], query = ""): ExternalSessionInfo[] {
  const needle = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (!codingConnectionCandidate(session) || seen.has(session.id)) return false;
    seen.add(session.id);
    return !needle || [session.title, session.workspaceName, session.sourceId, session.agentKind]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle);
  }).sort((a, b) => Number(codingConnectionNeedsRecovery(a)) - Number(codingConnectionNeedsRecovery(b))
    || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
