#!/usr/bin/env node
// Keep the existing CI panel gate on the current shell and its channel/browser regression cases.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

assert.equal(process.argv.length, 3, "Pass one explicit private evidence directory");
assert.equal(process.platform === "win32", false, "This POSIX browser fixture does not validate Windows ACLs");
assert(isAbsolute(process.argv[2]), "Evidence directory must be absolute");
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true, mode: 0o700 });
const info = lstatSync(output);
assert(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() && (info.mode & 0o077) === 0);
assert.equal(realpathSync(output), output, "Use a canonical private path");
assert.deepEqual(readdirSync(output), [], "Never overwrite previous browser evidence");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root, configFile: false, plugins: [react()],
  server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: { ignored: ["**/src-tauri/**"] } },
});
let child, stopping = false;
const stopChild = () => { if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); };
const stop = () => { stopping = true; stopChild(); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address === "object" && address.address === "127.0.0.1");
  child = spawn(process.execPath, [join(root, "scripts/workspace-shell-smoke.mjs"), `http://127.0.0.1:${address.port}/`, output, "--channels-only"], { cwd: root, env: process.env, stdio: "inherit" });
  const deadline = setTimeout(stop, 300000);
  let code;
  try { code = await new Promise((done, fail) => { child.once("error", fail); child.once("close", done); }); }
  finally { clearTimeout(deadline); }
  assert.equal(stopping, false, "Browser gate was interrupted or exceeded its deadline");
  assert.equal(code, 0, "Current shell/channel/browser gate failed");
  writeFileSync(join(output, "ci-panel-entry.json"), JSON.stringify({ passed: true, fixture: "workspace-shell-preview", mode: "channels-only", existingCiEntryPreserved: true }) + "\n", { mode: 0o600 });
} finally {
  stopChild(); await server.close();
  process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
}
