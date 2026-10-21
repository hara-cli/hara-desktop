import type { Key } from "./i18n.ts";

/** Fixed renderer errors carry a locale-independent key until they reach the UI. */
export class WorkspaceViewError extends Error {
  readonly messageKey: Key;
  constructor(messageKey: Key) { super(messageKey); this.messageKey = messageKey; }
  toString() { return this.messageKey; }
}

/** Transport wait expiry is not evidence that a background task failed or was never accepted. */
export class WorkspaceRpcWaitError extends Error {
  readonly code = "WORKSPACE_RPC_WAIT_EXPIRED";
  readonly method: string;
  constructor(method: string) { super("Workspace transport receipt is pending; verify the original outcome read-only"); this.method = method; }
}
