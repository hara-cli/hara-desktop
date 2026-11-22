// Workspace RPCs used by the installed Desktop credential smoke.
export class SmokeError extends Error {}
export const check = (condition, message) => { if (!condition) throw new SmokeError(message); };
export const origin = "127.0.0.1";

// Only these literals from the Core credential and RPC contracts reach public receipts.
const rpcMethods = new Set([
  "initialize", "workspace.list", "workspace.create", "workspace.snapshot", "workspace.credentialStorage.get",
  "workspace.connection.add", "workspace.connection.edit", "workspace.connection.delete", "workspace.connection.listModels",
]);
const rpcCodes = new Set([-32001, -32602]);
const vaultCodes = new Set([
  "unsupported", "unavailable", "access_denied", "credential_unreadable", "write_unconfirmed", "cleanup_unconfirmed", "invalid_request",
]);
const publicCodes = new Set([
  "request_failed", "unauthorized", "request_invalid", "parameters_invalid", "fields_unsupported", "method_unsupported",
  "workspace_unavailable", "workspace_revoked", "workspace_generation_changed", "workspace_catalog_changed",
  "workspace_directory_changed", "workspace_closing", "workspace_restarting", "agent_unavailable",
  "view_changed", "connection_invalid", "connection_models_invalid", "connection_unavailable",
  "connection_delete_approval", "state_changed", "state_full",
]);
const rpcDomains = new Set(["credential-vault"]);
const vaultReasons = new Set([
  "platform_unsupported", "architecture_unsupported", "host_binding_unavailable", "helper_missing",
  "helper_invalid", "access_denied", "backend_unavailable", "windows_desktop_required",
]);
const vaultRetries = new Set(["none", "explicit_user_only", "readback_only"]);
const vaultStates = new Set(["not_checked", "ready", "unavailable", "unsupported"]);
const permitted = (values, value) => value == null ? null : values.has(value) ? value : "other";
const credentialStorageStatus = descriptor => descriptor == null ? null : {
  state: permitted(vaultStates, descriptor.state), reason: permitted(vaultReasons, descriptor.reason),
};

class SmokeRpcError extends SmokeError {
  constructor(method, kind, error) {
    const safeMethod = rpcMethods.has(method) ? method : null;
    super("Installed Core RPC failed: " + (safeMethod ?? "unknown") + " (" + kind + ")");
    const data = error?.data;
    const domain = permitted(rpcDomains, data?.domain);
    const vaultError = domain === "credential-vault";
    this.diagnostic = { method: safeMethod, kind, error: kind === "rpc_error" ? {
      code: rpcCodes.has(error?.code) ? error.code : null,
      data: { domain, code: permitted(vaultError ? vaultCodes : publicCodes, data?.code),
        reason: vaultError ? permitted(vaultReasons, data?.reason) : null,
        retry: vaultError ? permitted(vaultRetries, data?.retry) : null },
    } : null, initialCredentialStorage: null, credentialStorage: null };
  }
}

export async function withWorkspace(record, action, { backend = "windows-dpapi", expectedWorkspaceId, onInitialized, onRpcFailure, expectMissingWorker = false, remaining = () => Infinity } = {}) {
  if (!remaining()) throw new SmokeRpcError("initialize", "timeout");
  const socket = new WebSocket(`ws://${origin}:${record.port}`);
  let id = 0;
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        clearTimeout(timer);
        socket.removeEventListener("open", opened);
        socket.removeEventListener("error", failed);
        socket.removeEventListener("close", failed);
        if (error) reject(error); else resolve();
      };
      const opened = () => finish();
      const failed = () => finish(new SmokeError("Installed Core WebSocket could not connect"));
      const timer = setTimeout(failed, Math.min(8000, remaining()));
      socket.addEventListener("open", opened);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
    const rpc = (method, params = {}, expectedVaultError, timeoutMs = 35_000) => new Promise((resolve, reject) => {
      const budget = Math.min(timeoutMs, remaining());
      if (!budget) { reject(new SmokeRpcError(method, "timeout")); return; }
      const requestId = ++id;
      const finish = (error, result) => {
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        socket.removeEventListener("close", closed);
        socket.removeEventListener("error", socketError);
        if (error) reject(error); else resolve(result);
      };
      const receive = event => {
        let response;
        try { response = JSON.parse(String(event.data)); } catch { return; }
        if (!response || typeof response !== "object" || response.id !== requestId) return;
        const { error } = response;
        if (expectedVaultError) {
          if (error?.data?.domain !== "credential-vault" || error.data.code !== expectedVaultError)
            return failed(error ? "rpc_error" : "unexpected_result", error);
          if (expectMissingWorker && (error.code !== -32602 || error.data.retry !== "explicit_user_only"))
            return failed("rpc_error", error);
          if (expectedVaultError === "unsupported" &&
              (error.data.retry !== "none" || typeof error.message !== "string" || !error.message.includes("Hara Desktop")))
            return failed("rpc_error", error);
          finish(null, true);
        } else if (error) failed("rpc_error", error);
        else if (!Object.hasOwn(response, "result")) failed("invalid_response");
        else finish(null, response.result);
      };
      const failed = (kind, error) => finish(new SmokeRpcError(method, kind, error));
      const closed = () => failed("socket_closed");
      const socketError = () => failed("socket_error");
      const timer = setTimeout(() => failed("timeout"), budget);
      socket.addEventListener("message", receive);
      socket.addEventListener("close", closed);
      socket.addEventListener("error", socketError);
      try { socket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })); } catch { failed("send_failed"); }
    });
    let initialCredentialStorage = null;
    try {
      const init = await rpc("initialize", { token: record.token });
      initialCredentialStorage = credentialStorageStatus(init?.credentialStorage);
      onInitialized?.(initialCredentialStorage);
      check(init.capabilities?.includes("workspace.v1") && init.capabilities.includes("workspace.credential-storage.v1")
        && init.credentialStorage?.backend === backend, "Core did not advertise the expected credential backend");
      if (expectMissingWorker) {
      check(init.credentialStorage?.supported === true && initialCredentialStorage?.state === "unavailable"
        && initialCredentialStorage.reason === "helper_missing", "Missing worker not reported at Workspace initialize");
    }
    // A clean install has a Host and an empty catalog until a client creates a Workspace.
      const directory = await rpc("workspace.list");
      check(Array.isArray(directory?.workspaces) && Number.isSafeInteger(directory.revision) && directory.revision > 0,
        "Installed Core did not return the smoke Workspace directory");
      let workspaceId = directory.activeWorkspaceId;
      if (expectedWorkspaceId === undefined && workspaceId === null && directory.workspaces.length === 0) {
        const created = await rpc("workspace.create", { label: "Windows smoke Workspace", expectedRevision: directory.revision });
        workspaceId = created?.workspaceId;
      } else {
        check(directory.workspaces.some(row => row?.workspaceId === workspaceId && row.active === true),
          "Installed Core has no active smoke Workspace");
      }
      check(typeof workspaceId === "string" && workspaceId.length > 0, "Installed Core has no smoke Workspace");
      check(expectedWorkspaceId === undefined || workspaceId === expectedWorkspaceId,
        "Installed Core did not reopen the same smoke Workspace");
      return await action(rpc, () => rpc("workspace.snapshot", { workspaceId, agentId: null }));
    } catch (error) {
      if (error instanceof SmokeRpcError) {
        const diagnostic = error.diagnostic;
        diagnostic.initialCredentialStorage = initialCredentialStorage;
        // c85eaab puts the worker reason on its current descriptor, not on the error wire data.
        if (diagnostic.error?.data.domain === "credential-vault" &&
            diagnostic.method !== "workspace.credentialStorage.get" && socket.readyState === WebSocket.OPEN) {
          try {
            const descriptor = await rpc("workspace.credentialStorage.get", {}, undefined, 5000);
            diagnostic.credentialStorage = credentialStorageStatus(descriptor);
          } catch { /* Best-effort read only. Keep the original failure. */ }
        }
        onRpcFailure?.(diagnostic);
      }
      throw error;
    }
  } finally { socket.close(); }
}
