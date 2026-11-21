import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { SmokeProcessError, smokeRuntime } from "../scripts/windows-install-process.mjs";

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
  const child = fakeChild({ closeOnKill: true });
  const { runtime, rows } = recorder({ workMs: 25, spawnChild: () => child });
  await assert.rejects(runtime.command("msi", "msi.install", "owned child", []), { message: "timeout" });
  assert.equal(child.kills, 1);
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
