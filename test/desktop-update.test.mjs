import test from "node:test";
import assert from "node:assert/strict";
import { applyDesktopUpdateHandoff } from "../src/desktop-update.js";

test("Desktop update handoff retires the engine before install and restart", async () => {
  const state = { phase: "downloaded" };
  const events = [];
  await applyDesktopUpdateHandoff(state, {
    retireEngine: async () => events.push("retired"),
    install: async () => events.push("installed"),
    restart: async () => events.push("restarted"),
  });
  assert.deepEqual(events, ["retired", "installed", "restarted"]);
  assert.equal(state.phase, "installed");
});

test("Desktop update retry never installs an already installed package twice", async () => {
  const state = { phase: "installed" };
  const events = [];
  await applyDesktopUpdateHandoff(state, {
    retireEngine: async () => events.push("retired"),
    install: async () => events.push("installed"),
    restart: async () => events.push("restarted"),
  });
  assert.deepEqual(events, ["retired", "restarted"]);
});

test("Desktop update handoff cannot install when engine retirement fails", async () => {
  const state = { phase: "downloaded" };
  const events = [];
  await assert.rejects(
    applyDesktopUpdateHandoff(state, {
      retireEngine: async () => {
        events.push("retire-failed");
        throw new Error("engine busy");
      },
      install: async () => events.push("installed"),
      restart: async () => events.push("restarted"),
    }),
    /engine busy/,
  );
  assert.deepEqual(events, ["retire-failed"]);
  assert.equal(state.phase, "downloaded");
});

test("Desktop update handoff preserves a failed install for retry and does not restart", async () => {
  const state = { phase: "downloaded" };
  const events = [];
  await assert.rejects(
    applyDesktopUpdateHandoff(state, {
      retireEngine: async () => events.push("retired"),
      install: async () => {
        events.push("install-failed");
        throw new Error("installer failed");
      },
      restart: async () => events.push("restarted"),
    }),
    /installer failed/,
  );
  assert.deepEqual(events, ["retired", "install-failed"]);
  assert.equal(state.phase, "downloaded");
});
