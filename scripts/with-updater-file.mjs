#!/usr/bin/env node
// The original updater key is opened read-only. No Keychain access, copies, argv or raw output.
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export function readUpdaterKey(home = homedir(), uid = process.getuid?.()) {
  const directory = join(realpathSync(home), ".tauri"), parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid || (parent.mode & 0o022) || realpathSync(directory) !== directory) throw new Error("Unsafe updater key directory");
  const fd = openSync(join(directory, "hara-desktop.key"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== uid || (st.mode & 0o777) !== 0o600 || st.size < 1 || st.size > 16384) throw new Error("Unsafe updater key file");
    const value = readFileSync(fd), after = fstatSync(fd);
    if (value.length !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) { value.fill(0); throw new Error("Updater key changed while reading"); }
    return value;
  } finally { closeSync(fd); }
}

export async function withUpdaterFile(command, args = [], { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!command) { stderr.write("error: missing updater build command\n"); return 2; }
  let bytes, key, secrets = [], child, childEnvironment, output = [], size = 0, exceeded = false, spawnFailed = false;
  const signals = new Map(); let deadline, killDeadline;
  const stop = signal => { if (child?.pid) try { process.kill(-child.pid, signal); } catch { /* child already reaped */ } };
  try {
    bytes = readUpdaterKey(env.HOME ?? homedir()); key = bytes.toString("utf8");
    if (!key.trim() || key.includes("\0")) throw new Error("Invalid updater key encoding");
    secrets = [key, key.trim(), ...key.split(/\r?\n/).filter(line => line.length >= 16 && !line.startsWith("untrusted comment:")), bytes.toString("base64"), bytes.toString("hex")].sort((a,b) => b.length-a.length);
    childEnvironment = { ...env };
    for (const name of Object.keys(childEnvironment)) if (/^(?:TAURI_SIGNING_PRIVATE_KEY|HARA_TAURI_SIGNING_PRIVATE_KEY)(?:_|$)/.test(name)) delete childEnvironment[name];
    childEnvironment.TAURI_SIGNING_PRIVATE_KEY = key;
    childEnvironment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
    child = spawn(command, args, { env: childEnvironment, stdio: ["ignore", "pipe", "pipe"], detached: true });
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) { const handler = () => stop(signal); signals.set(signal, handler); process.on(signal, handler); }
    const collect = data => {
      size += data.length;
      if (size > 32*1024*1024) { if (!exceeded) { exceeded = true; stop("SIGTERM"); killDeadline = setTimeout(() => stop("SIGKILL"), 3000); } return; }
      output.push(data);
    };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    deadline = setTimeout(() => { exceeded = true; stop("SIGTERM"); killDeadline = setTimeout(() => stop("SIGKILL"), 3000); }, 60*60*1000);
    const [code, signal] = await new Promise(resolve => { child.once("error", () => { spawnFailed = true; }); child.once("close", (code, signal) => resolve([code, signal])); });
    if (exceeded || spawnFailed) { stderr.write("error: updater signing child failed or exceeded safe output/deadline bounds\n"); return 1; }
    // Redact only after all chunks have been combined, including secrets split across chunks.
    let safe = Buffer.concat(output).toString("utf8");
    for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
    if (safe) stdout.write(safe);
    if (signal) stderr.write("error: updater signing child terminated\n");
    return code === 0 && !signal ? 0 : Number.isInteger(code) && code > 0 ? code : 1;
  } catch {
    stderr.write("error: updater signing input unavailable or unsafe; refusing to build unsigned\n"); return 1;
  } finally {
    clearTimeout(deadline); clearTimeout(killDeadline);
    for (const [signal, handler] of signals) process.off(signal, handler);
    if (bytes) bytes.fill(0);
    for (const chunk of output) chunk.fill(0);
    output = []; secrets = []; key = undefined;
    if (childEnvironment) { delete childEnvironment.TAURI_SIGNING_PRIVATE_KEY; delete childEnvironment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === "--check") {
    let bytes;
    try { bytes = readUpdaterKey(); if (bytes.includes(0) || !bytes.toString("utf8").trim()) throw new Error(); process.stdout.write("updater signing input ready: existing private file; no Keychain access\n"); }
    catch { process.stderr.write("error: updater signing input unavailable or unsafe\n"); process.exitCode = 1; }
    finally { bytes?.fill(0); }
  } else process.exitCode = await withUpdaterFile(process.argv[2], process.argv.slice(3));
}
