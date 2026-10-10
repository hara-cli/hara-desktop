/** Scope local submission state to one durable question, not a progress refresh. */
export function decisionCardIdentity(
  sessionId: string | undefined,
  taskId: string | undefined,
  turnId: string | undefined,
  question: string,
  options: readonly string[],
): string {
  return JSON.stringify([sessionId, taskId, turnId, question, options]);
}
