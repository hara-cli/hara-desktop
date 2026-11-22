import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SmokeProcessError, observeCoreIdentity, smokeRuntime, verifyIdentity } from "../scripts/windows-install-process.mjs";
import { SmokeError, check } from "../scripts/windows-install-workspace.mjs";

function recorder(options) {
  const rows = [], notices = [];
  const runtime = smokeRuntime({ ...options, write(line) {
    if (line.startsWith("::notice")) notices.push(line);
    else rows.push(JSON.parse(line));
  } });
  return { runtime, rows, notices };
}

function fakeChild({ closeOnKill, code, error, stdout } = {}) {
  const child = new EventEmitter();
  child.pid = error ? undefined : 200;
  child.exitCode = null;
  child.signalCode = null;
  child.kills = 0;
  child.unref = () => { child.released = true; };
  if (stdout) child.stdout = new EventEmitter();
  child.kill = () => {
    child.kills++;
    if (closeOnKill) queueMicrotask(() => child.emit("close", null));
    return closeOnKill;
  };
  queueMicrotask(() => {
    if (error) child.emit("error", error);
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (code !== undefined) {
      child.exitCode = code;
      child.emit("close", code);
    }
  });
  return child;
}

test("installer progress begins before spawning and reports only fixed fields and numeric status", async () => {
  const child = fakeChild({ code: 0, stdout: "private output" });
  const { runtime, rows, notices } = recorder({
    spawnChild(file, args, options) {
      assert.equal(rows[0].event, "begin");
      assert.equal(options.stdio[0], "ignore");
      assert.deepEqual(options.stdio.slice(1), ["pipe", "ignore"]);
      assert.deepEqual([file, args], ["private.exe", ["private argument"]]);
      return child;
    },
  });
  const value = await runtime.command("msi", "msi.precheck", "private.exe", ["private argument"], { capture: true });
  assert.deepEqual(value, { exitCode: 0, stdout: "private output" });
  assert.deepEqual(rows.map(v => [v.sequence, v.event, v.outcome, v.exitCode]), [[1, "begin", null, null], [2, "end", "ok", 0]]);
  assert.deepEqual(Object.keys(rows[0]), ["version", "sequence", "kind", "stage", "event", "outcome", "elapsedMs", "exitCode"]);
  assert(!JSON.stringify({ rows, notices }).includes("private"));
  assert.equal(notices.length, 1);
});

test("installer commands distinguish spawn failure, nonzero and intentionally accepted codes", async () => {
  // Emit each result after the command subscribes.
  let index = 0;
  const { runtime, rows } = recorder({ spawnChild: () => {
    const entry = [{ error: new Error("private error") }, { code: 7 }, { code: 65 }][index++];
    return fakeChild(entry);
  } });
  await assert.rejects(runtime.command("nsis", "worker.empty_input", "worker", []), { message: "spawn_failed" });
  await assert.rejects(runtime.command("nsis", "worker.empty_input", "worker", []), { message: "nonzero", exitCode: 7 });
  assert.equal((await runtime.command("nsis", "worker.empty_input", "worker", [], { accepted: [65] })).exitCode, 65);
  assert.deepEqual(rows.filter(v => v.event === "end").map(v => [v.outcome, v.exitCode]),
    [["spawn_failed", null], ["nonzero", 7], ["nonzero", 65]]);
  assert(!JSON.stringify(rows).includes("private"));
});

test("installer command timeout terminates only its child and waits for confirmed close", async () => {
  const child = fakeChild({ closeOnKill: true }), unrelated = fakeChild();
  const spawned = [];
  const { runtime, rows } = recorder({ workMs: 25, spawnChild: file => { spawned.push(file); return child; } });
  await assert.rejects(runtime.command("msi", "msi.install", "owned child", []), { message: "timeout" });
  assert.equal(child.kills, 1);
  assert.equal(unrelated.kills, 0);
  assert.deepEqual(spawned, ["owned child"]);
  assert.equal(runtime.canInstallOrRemove(), true);
  assert.equal(rows.at(-1).event, "timeout");
  assert.equal(rows.at(-1).outcome, "timeout");
});

test("installer unconfirmed exit prevents every later external command including cleanup", async () => {
  const child = fakeChild();
  let spawns = 0;
  const { runtime, rows } = recorder({ workMs: 25, cleanupMs: 20, spawnChild: () => { spawns++; return child; } });
  await assert.rejects(runtime.command("msi", "msi.install", "owned child", []), { message: "exit_unconfirmed" });
  assert.equal(child.released, true);
  assert.equal(runtime.canInstallOrRemove(), false);
  assert.equal(rows.at(-1).event, "timeout");
  await assert.rejects(runtime.command("msi", "msi.uninstall", "installer", [], { cleanup: true }),
    error => error instanceof SmokeProcessError);
  assert.equal(spawns, 1);
});

test("installer work budget and cleanup grace use one fixed deadline", async () => {
  let now = 10;
  const { runtime } = recorder({ workMs: 100, cleanupMs: 50, now: () => now, spawnChild: () => fakeChild({ code: 0 }) });
  now = 120;
  assert.equal(runtime.remaining(), 0);
  assert.equal(runtime.remaining({ cleanup: true }), 40);
  await assert.rejects(runtime.command("nsis", "nsis.install", "installer", []), { message: "timeout" });
  await runtime.command("nsis", "nsis.uninstall", "installer", [], { cleanup: true });
  now = 160;
  await assert.rejects(runtime.command("nsis", "nsis.uninstall", "installer", [], { cleanup: true }), { message: "timeout" });
});

test("installer stage timeout bounds a listener promise", async () => {
  const { runtime, rows } = recorder({});
  await assert.rejects(runtime.phase("msi", "http.close", () => runtime.waitFor(new Promise(() => {}), 10)),
    { message: "timeout" });
  assert.deepEqual(rows.map(v => v.event), ["begin", "timeout"]);
});

test("installer progress rejects an unknown stage before writing", async () => {
  const { runtime, rows } = recorder({});
  await assert.rejects(runtime.phase("msi", "private path", assert.fail), { message: "invalid_stage" });
  assert.deepEqual(rows, []);
});

test("installer records MSI exit 0, 3010 and 1641 without treating an initiated reboot as accepted", async () => {
  const codes = [0, 3010, 1641];
  const { runtime, rows } = recorder({ spawnChild: () => fakeChild({ code: codes.shift() }) });
  const run = () => runtime.command("msi", "msi.install", "msiexec.exe", ["/i", "fixture.msi", "/norestart"], { accepted: [0, 3010] });
  assert.equal((await run()).exitCode, 0);
  assert.equal((await run()).exitCode, 3010);
  await assert.rejects(run(), { message: "nonzero", exitCode: 1641 });
  assert.deepEqual(rows.filter(row => row.event === "end").map(row => [row.outcome, row.exitCode]),
    [["ok", 0], ["nonzero", 3010], ["nonzero", 1641]]);
});

test("installer JSON and notices exclude injected paths, ports, keys and workflow commands", async () => {
  const privatePath = "C:\\synthetic-fixture\\private.txt";
  const privatePort = "49123", fixtureKey = "synthetic-not-a-credential";
  const injection = [privatePath, privatePort, fixtureKey, "\n::notice::INJECTED"].join(" ");
  const { runtime, rows, notices } = recorder({
    spawnChild: () => fakeChild({ code: 0, stdout: injection }),
  });
  await assert.rejects(runtime.phase(injection, "msi.install", assert.fail), /invalid_stage/);
  await assert.rejects(runtime.phase("msi", injection, assert.fail), /invalid_stage/);
  assert.equal((await runtime.command("msi", "msi.precheck", privatePath, [privatePort, fixtureKey], { capture: true })).stdout, injection);
  const invalid = new SmokeProcessError(injection, injection);
  assert.equal(invalid.message, "failed");
  invalid.outcome = injection;
  invalid.exitCode = fixtureKey;
  await assert.rejects(runtime.phase("msi", "msi.install", () => { throw invalid; }), { message: "failed" });
  await runtime.phase("msi", "msi.layout", () => ({ exitCode: injection }), { reportExit: true });

  assert.deepEqual(rows.slice(-3).map(row => [row.stage, row.outcome, row.exitCode]),
    [["msi.install", "failed", null], ["msi.layout", null, null], ["msi.layout", "nonzero", null]]);
  const publicOutput = JSON.stringify({ rows, notices });
  for (const value of [privatePath, privatePort, fixtureKey, "INJECTED"]) {
    assert(!publicOutput.includes(value));
  }
  assert.equal(notices.at(-1), "::notice title=Windows install smoke::4 msi msi.install end failed\n");
});

const executable = fileURLToPath(new URL("../scripts/windows-install-process.mjs", import.meta.url));
const otherExecutable = fileURLToPath(import.meta.url);
const record = { schemaVersion: 2, executionMode: "workspace", instanceId: "fixture", pid: 15, port: 12345,
  token: "a".repeat(64) };
const row = { ProcessId: record.pid, ParentProcessId: 11, ExecutablePath: executable, Started: "123" };

test("installer Core discovery can wait through a missing CIM row without opening RPC", () => {
  assert.deepEqual(observeCoreIdentity(record, record, null, executable, 11), { outcome: "core_pid_unseen", row: null });
  const confirmed = observeCoreIdentity(record, { ...record }, row, executable, 11);
  assert.deepEqual(confirmed, { outcome: "confirmed", row });
  assert.throws(() => verifyIdentity({ ...row, Started: "124" }, executable, confirmed.row.Started), /identity changed/);
});

test("installer Core discovery resamples publication and never attaches to the stale row", () => {
  for (const key of Object.keys(record)) {
    const current = { ...record, [key]: "changed-private-value" };
    const observed = observeCoreIdentity(record, current, row, executable, 11);
    assert.deepEqual(observed, { outcome: "core_discovery_changed", row: null });
  }
  assert.deepEqual(observeCoreIdentity(record, null, row, executable, 11), { outcome: "core_discovery_changed", row: null });
  const latest = { ...record, pid: 16, instanceId: "new-fixture" };
  const latestRow = { ...row, ProcessId: latest.pid };
  assert.deepEqual(observeCoreIdentity(latest, latest, latestRow, executable, 11),
    { outcome: "confirmed", row: latestRow });
});

test("installer Core discovery fails closed on stable PID, path and parent mismatches", () => {
  assert.throws(() => observeCoreIdentity(record, record, { ...row, ProcessId: 16 }, executable, 11),
    { message: "core_pid_mismatch" });
  assert.throws(() => observeCoreIdentity(record, record, { ...row, ExecutablePath: otherExecutable }, executable, 11),
    { message: "core_executable_mismatch" });
  assert.throws(() => observeCoreIdentity(record, record, { ...row, ExecutablePath: executable + "-not-present" }, executable, 11),
    { message: "core_executable_unresolved" });
  assert.throws(() => observeCoreIdentity(record, record, { ...row, ParentProcessId: 12 }, executable, 11),
    { message: "core_parent_mismatch" });
});


test("installer startup times out after late discovery confirmation and cleans the verified Core", async () => {
  const source = readFileSync(new URL("../scripts/windows-install-smoke.mjs", import.meta.url), "utf8");
  const startSource = source.match(/^async function start\([\s\S]*?^\}/mu)?.[0];
  assert(startSource, "the regression must exercise the shipped start function");

  let now = 0, reads = 0;
  const child = { pid: row.ParentProcessId, exitCode: null, signalCode: null, on() {}, unref: assert.fail };
  const { runtime, rows } = recorder({ now: () => now });
  const stopCalls = [];
  const fixtureRoot = "fixture-app";
  const start = runInNewContext(startSource + "\nstart", {
    performance: { now: () => now }, process: { env: {} },
    join: (...parts) => {
      if (parts[0] === fixtureRoot) return parts[1] === "hara.exe" ? executable : otherExecutable;
      return join(...parts);
    },
    spawn: () => child, SmokeError, SmokeProcessError, check, observeCoreIdentity, verifyIdentity,
    wait: async () => assert.fail("the confirmed but late Core should time out without another poll"),
    readDiscovery: () => {
      if (++reads === 2) now = 180_001;
      return record;
    },
    identify: async (_runtime, _kind, pid, options) => {
      if (pid === child.pid) {
        if (options.cleanup) {
          child.exitCode = 0;
          return null;
        }
        return { ProcessId: child.pid, ExecutablePath: otherExecutable, Started: "100" };
      }
      assert.equal(pid, row.ProcessId);
      if (options.cleanup) return stopCalls.length ? null : row;
      now = 179_999;
      return row;
    },
  });
  runtime.command = async (kind, stage, program, args) => {
    stopCalls.push([kind, stage, program, ...args]);
    return { exitCode: 0 };
  };

  await assert.rejects(start(runtime, "nsis", fixtureRoot, "fixture-home"),
    error => error instanceof SmokeProcessError && error.outcome === "timeout");
  assert.equal(reads, 2);
  assert.deepEqual(stopCalls, [["nsis", "process.stop", "taskkill.exe", "/PID", String(row.ProcessId), "/T", "/F"]]);
  assert.equal(runtime.canInstallOrRemove(), true);
  assert.deepEqual(rows.filter(entry => entry.event !== "begin").map(entry => [entry.stage, entry.event, entry.outcome]),
    [["desktop.start", "end", "ok"], ["core.ready", "timeout", "timeout"], ["desktop.stop", "end", "ok"]]);
});
