/** Transport wait expiry is not evidence that a background task failed or was never accepted. */
export class WorkspaceRpcWaitError extends Error {
  readonly code = "WORKSPACE_RPC_WAIT_EXPIRED";
  readonly method: string;
  constructor(method: string) { super("尚未收到 Workspace 傳輸回執，執行結果需只讀核對"); this.method = method; }
}
