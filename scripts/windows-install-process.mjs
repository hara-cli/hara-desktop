import { spawn } from "node:child_process";
import { appendFileSync, closeSync, fstatSync, openSync, readSync, realpathSync, writeSync } from "node:fs";
import { join } from "node:path";
import { SmokeError, check } from "./windows-install-workspace.mjs";

const commandLimits = new Map([
  ["git.head", 10_000], ["worker.empty_input", 10_000],
  ["msi.precheck", 30_000], ["msi.layout", 30_000], ["msi.removal_check", 30_000],
  ["msi.migration_removal_check", 30_000], ["nsis.migration_check", 30_000],
  ["msi.install", 120_000], ["msi.uninstall", 120_000], ["nsis.install", 120_000], ["nsis.uninstall", 120_000],
  ["process.identify", 15_000], ["process.stop", 15_000], ["vault.app_data", 15_000],
]);
const phases = new Set([...commandLimits.keys(), "smoke", "desktop.start", "core.ready", "desktop.stop",
  "vault.save", "vault.restart", "vault.rotate", "http.listen", "http.close", "nsis.removal_check",
  "refusal.helper_invalid", "refusal.helper_missing", "refusal.windows_desktop_required"]);
const notices = new Set(["smoke", "msi.precheck", "msi.install", "msi.uninstall", "msi.removal_check", "msi.migration_removal_check",
  "nsis.migration_check", "nsis.install", "nsis.uninstall"]);
const outcomes = new Set(["ok", "failed", "timeout", "spawn_failed", "nonzero", "exit_unconfirmed", "output_limit"]);
const exitGrace = 3_000;
const capturedLimit = 64 * 1024;

const nativePath = path => realpathSync.native(path).toLowerCase();

export function verifyIdentity(row, expectedPath, startTime) {
  check(row && nativePath(row.ExecutablePath) === nativePath(expectedPath)
    && (startTime === undefined || row.Started === startTime), "Smoke process identity changed");
}

export function sameCoreDiscovery(record, current) {
  return !!record && !!current
    && ["schemaVersion", "executionMode", "instanceId", "pid", "port", "token"].every(key => current[key] === record[key]);
}

export function observeCoreIdentity(record, current, row, executable, desktopPid) {
  // The CIM result must describe the same discovery that is still on disk.
  if (!sameCoreDiscovery(record, current)) {
    return { outcome: "core_discovery_changed", row: null };
  }
  if (!row) return { outcome: "core_pid_unseen", row: null };
  check(row.ProcessId === record.pid, "core_pid_mismatch");
  let matchesExecutable;
  try { matchesExecutable = nativePath(row.ExecutablePath) === nativePath(executable); }
  catch { throw new SmokeError("core_executable_unresolved"); }
  check(matchesExecutable, "core_executable_mismatch");
  check(row.ParentProcessId === desktopPid, "core_parent_mismatch");
  return { outcome: "confirmed", row };
}

function readStartupPrefix(file) {
  const fd = openSync(file, "r");
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a regular smoke log");
    const bytes = Buffer.alloc(8192);
    return bytes.toString("utf8", 0, readSync(fd, bytes, 0, bytes.length, 0));
  } finally { closeSync(fd); }
}

export function observeCoreExit(home, pid, { probe = process.kill, readLog = readStartupPrefix } = {}) {
  let pidPresence = "unknown";
  if (Number.isSafeInteger(pid) && pid > 1 && pid <= 0x7fffffff) {
    try { probe(pid, 0); pidPresence = "present"; }
    catch (error) { if (error?.code === "ESRCH") pidPresence = "absent"; }
  }
  const marker = (name, pattern) => {
    try { return pattern.test(readLog(join(home, ".hara", name))) ? "seen" : "not_seen"; }
    catch (error) { return error?.code === "ENOENT" ? "not_seen" : "unknown"; }
  };
  return {
    pidPresence,
    desktopEarlyExit: marker("workspace-startup.log", /^\d+ desktop=\S+ os=windows engine exited before connecting:/mu),
    coreCliStartupError: marker("workspace-core-stderr.log", /^hara workspace: startup\/request failed; verify the explicit private Workspace root and options\. No legacy fallback was started\.\r?$/mu),
  };
}

export class SmokeProcessError extends SmokeError {
  constructor(outcome, exitCode = null) {
    const safeOutcome = outcomes.has(outcome) ? outcome : "failed";
    super(safeOutcome);
    this.outcome = safeOutcome;
    this.exitCode = Number.isSafeInteger(exitCode) ? exitCode : null;
  }
}

export function smokeRuntime({ progressFile, now = () => performance.now(), spawnChild = spawn,
  write = line => writeSync(process.stdout.fd, line), workMs = 600_000, cleanupMs = 60_000 } = {}) {
  const workEnds = now() + workMs, cleanupEnds = workEnds + cleanupMs;
  let sequence = 0, unsafe = false;

  const remaining = ({ cleanup = false, until = Infinity } = {}) =>
    Math.max(0, Math.floor(Math.min(cleanup ? cleanupEnds : workEnds, until) - now()));

  function mark(kind, stage, event, started, outcome = null, exitCode = null) {
    const row = { version: 1, sequence: ++sequence, kind, stage, event,
      outcome: outcome === null || outcomes.has(outcome) ? outcome : "failed",
      elapsedMs: Math.max(0, Math.round(now() - started)), exitCode: Number.isSafeInteger(exitCode) ? exitCode : null };
    const line = JSON.stringify(row) + "\n";
    write(line);
    if (progressFile) appendFileSync(progressFile, line, { mode: 0o600 });
    if (notices.has(stage) && (event === "begin" || row.outcome !== "ok")) {
      write(`::notice title=Windows install smoke::${row.sequence} ${kind} ${stage} ${event} ${row.outcome ?? "pending"}\n`);
    }
  }

  async function phase(kind, name, action, options = {}) {
    if (!["none", "msi", "nsis"].includes(kind) || !phases.has(name)) throw new SmokeError("invalid_stage");
    const started = now();
    mark(kind, name, "begin", started);
    try {
      if (!remaining(options)) throw new SmokeProcessError("timeout");
      const value = await action();
      const status = options.reportExit ? value.exitCode : null;
      mark(kind, name, "end", started, status === null || status === 0 ? "ok" : "nonzero", status);
      return value;
    } catch (error) {
      const commandError = error instanceof SmokeProcessError;
      const timeout = commandError && (error.outcome === "timeout" || error.timedOut === true);
      mark(kind, name, timeout ? "timeout" : "end", started,
        commandError ? error.outcome : "failed", commandError ? error.exitCode : null);
      throw error;
    }
  }

  function command(kind, name, file, args, { accepted = [0], capture = false, cleanup = false, until = Infinity,
    env, windowsVerbatimArguments = false } = {}) {
    if (!commandLimits.has(name)) throw new SmokeError("invalid_operation");
    const options = { cleanup, until, reportExit: true };
    return phase(kind, name, () => {
      if (unsafe) throw new SmokeProcessError("exit_unconfirmed");
      const budget = Math.min(commandLimits.get(name), remaining(options));
      if (!budget) throw new SmokeProcessError("timeout");
      return new Promise((resolve, reject) => {
        let child;
        try {
          child = spawnChild(file, args, {
            env, windowsHide: true, stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
            ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true, argv0: `"${file}"` } : {}),
          });
        } catch { reject(new SmokeProcessError("spawn_failed")); return; }
        let done = false, fault = null, grace, size = 0;
        const chunks = [];
        const finish = (error, result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          clearTimeout(grace);
          if (error) reject(error);
          else resolve(result);
        };
        const stop = reason => {
          if (done || fault) return;
          fault = reason;
          if (child.pid && child.exitCode === null && child.signalCode === null) {
            try { child.kill(); } catch { /* The close event will establish whether it exited. */ }
          }
          grace = setTimeout(() => {
            unsafe = true;
            child.stdout?.destroy();
            child.unref();
            const error = new SmokeProcessError("exit_unconfirmed");
            error.timedOut = fault === "timeout";
            finish(error);
          }, Math.min(exitGrace, remaining({ cleanup: true })));
        };
        const timer = setTimeout(() => stop("timeout"), budget);
        child.on("error", () => { if (!child.pid) finish(new SmokeProcessError("spawn_failed")); });
        child.stdout?.on("data", chunk => {
          size += chunk.length;
          if (size > capturedLimit) stop("output_limit");
          else chunks.push(chunk);
        });
        child.once("close", code => {
          const exitCode = Number.isSafeInteger(code) ? code : null;
          if (fault) finish(new SmokeProcessError(fault, exitCode));
          else if (!accepted.includes(exitCode)) finish(new SmokeProcessError("nonzero", exitCode));
          else finish(null, { exitCode, stdout: Buffer.concat(chunks).toString("utf8") });
        });
      });
    }, options);
  }

  function waitFor(promise, limit, options = {}) {
    const budget = Math.min(limit, remaining(options));
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SmokeProcessError("timeout")), budget);
    })]).finally(() => clearTimeout(timer));
  }

  return { command, phase, remaining, waitFor, canInstallOrRemove: () => !unsafe, markUnsafe: () => { unsafe = true; } };
}
