// Workspace RPCs used by the installed Desktop credential smoke.
export class SmokeError extends Error {}
export const check = (condition, message) => { if (!condition) throw new SmokeError(message); };
export const origin = "127.0.0.1";

export async function withWorkspace(record, action, { backend = "windows-dpapi", expectedWorkspaceId } = {}) {
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
      const timer = setTimeout(failed, 8000);
      socket.addEventListener("open", opened);
      socket.addEventListener("error", failed);
      socket.addEventListener("close", failed);
    });
    const rpc = (method, params = {}, expectedVaultError) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const finish = (error, result) => {
        clearTimeout(timer);
        socket.removeEventListener("message", receive);
        socket.removeEventListener("close", failed);
        socket.removeEventListener("error", failed);
        if (error) reject(error); else resolve(result);
      };
      const receive = event => {
        let response;
        try { response = JSON.parse(String(event.data)); } catch { return; }
        if (response.id !== requestId) return;
        if (expectedVaultError) {
          const error = response.error;
          if (error?.data?.domain !== "credential-vault" || error.data.code !== expectedVaultError) return failed();
          if (expectedVaultError === "unsupported" &&
              (error.data.retry !== "none" || typeof error.message !== "string" || !error.message.includes("Hara Desktop"))) return failed();
          finish(null, true);
        } else if (response.error || !Object.hasOwn(response, "result")) failed();
        else finish(null, response.result);
      };
      const failed = () => finish(new SmokeError(`Installed Core did not return the expected result for ${method}`));
      const timer = setTimeout(failed, 35_000);
      socket.addEventListener("message", receive);
      socket.addEventListener("close", failed);
      socket.addEventListener("error", failed);
      try { socket.send(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })); } catch { failed(); }
    });
    const init = await rpc("initialize", { token: record.token });
    check(init.capabilities?.includes("workspace.v1") && init.capabilities.includes("workspace.credential-storage.v1")
      && init.credentialStorage?.backend === backend, "Core did not advertise the expected credential backend");
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
  } finally { socket.close(); }
}
