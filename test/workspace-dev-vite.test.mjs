import assert from "node:assert/strict";
import test from "node:test";
async function config(flag, host) {
  const beforeFlag = process.env.VITE_HARA_WORKSPACE_DEV, beforeHost = process.env.TAURI_DEV_HOST;
  try {
    if (flag === undefined) delete process.env.VITE_HARA_WORKSPACE_DEV; else process.env.VITE_HARA_WORKSPACE_DEV = flag;
    if (host === undefined) delete process.env.TAURI_DEV_HOST; else process.env.TAURI_DEV_HOST = host;
    const { default: factory } = await import(`../vite.config.ts?test=${crypto.randomUUID()}`); return await factory({});
  } finally {
    if (beforeFlag === undefined) delete process.env.VITE_HARA_WORKSPACE_DEV; else process.env.VITE_HARA_WORKSPACE_DEV = beforeFlag;
    if (beforeHost === undefined) delete process.env.TAURI_DEV_HOST; else process.env.TAURI_DEV_HOST = beforeHost;
  }
}
test("workspace native URL, frontend and HMR bind exact IPv4 loopback", async () => {
  const result = await config("1", "192.0.2.1"); assert.equal(result.server.host, "127.0.0.1"); assert.equal(result.server.port, 1437);
  assert.equal(result.server.strictPort, true); assert.deepEqual(result.server.hmr, { protocol: "ws", host: "127.0.0.1", port: 1438 });
});
test("normal Dev host/port semantics remain unchanged and opt-in is literal", async () => {
  const normal = await config(undefined, undefined); assert.equal(normal.server.host, false); assert.equal(normal.server.port, 1420);
  const remote = await config("true", "192.0.2.1"); assert.equal(remote.server.host, "192.0.2.1"); assert.equal(remote.server.hmr.port, 1421);
});
