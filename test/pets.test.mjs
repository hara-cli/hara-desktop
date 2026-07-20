import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acknowledgePetActivity,
  BUILTIN_HARA_PET,
  selectPetSnapshot,
  setPetActivity,
} from "../src/pets.ts";
import {
  restoredTaskLifecycle,
  taskLifecycleIsNewer,
  taskStateIsLive,
  taskStatePetStatus,
  taskStateTitle,
} from "../src/task-lifecycle.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("built-in pet provenance is independent from local and future market providers", () => {
  assert.equal(BUILTIN_HARA_PET.source, "builtin");
  assert.equal(BUILTIN_HARA_PET.selector, "builtin:hara");
});

test("pet activity priority matches needs-input, blocked, paused, ready, running", () => {
  let activities = {};
  activities = setPetActivity(activities, "running", "running", "compile", 40);
  activities = setPetActivity(activities, "ready", "ready", "tests", 30);
  activities = setPetActivity(activities, "paused", "paused", "checkpoint", 25);
  activities = setPetActivity(activities, "blocked", "blocked", "release", 20);
  activities = setPetActivity(activities, "waiting", "waiting", "approval", 10);

  const snapshot = selectPetSnapshot(activities);
  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.activity.sessionId, "waiting");
  assert.equal(snapshot.activityCount, 5);
});

test("newest activity wins within the same pet status", () => {
  let activities = {};
  activities = setPetActivity(activities, "old", "blocked", "old failure", 10);
  activities = setPetActivity(activities, "new", "blocked", "new failure", 20);
  assert.equal(selectPetSnapshot(activities).activity.sessionId, "new");
});

test("opening a task acknowledges ready without hiding actionable states", () => {
  let ready = setPetActivity({}, "task", "ready", "done", 1);
  ready = acknowledgePetActivity(ready, "task");
  assert.equal(selectPetSnapshot(ready).status, "idle");

  const waiting = setPetActivity({}, "task", "waiting", "approve", 1);
  assert.equal(acknowledgePetActivity(waiting, "task"), waiting);
  assert.equal(selectPetSnapshot(waiting).status, "waiting");

  const paused = setPetActivity({}, "task", "paused", "resume", 1);
  assert.equal(acknowledgePetActivity(paused, "task"), paused);
  assert.equal(selectPetSnapshot(paused).status, "paused");
});

test("typed task lifecycle has one deterministic pet projection", () => {
  assert.equal(taskStateIsLive("running"), true);
  assert.equal(taskStateIsLive("waiting"), true);
  assert.equal(taskStateIsLive("paused"), false);
  assert.equal(taskStatePetStatus("completed"), "ready");
  assert.equal(taskStatePetStatus("blocked"), "blocked");
  const sensitiveEvent = {
    state: "running",
    phase: "tool",
    checkpoint: { done: 1, total: 2, current: "Run the focused tests" },
    detail: "tool output",
    brief: { goal: "Fix the task", intent: "change" },
    objective: "Original request",
  };
  assert.equal(taskStateTitle(sensitiveEvent), "Working on the task");
  const ambientTitle = taskStateTitle({
    ...sensitiveEvent,
    detail: "shell: /private/work/customer-file",
    brief: { goal: "Customer secret", intent: "change" },
    objective: "token=not-a-real-secret",
  });
  assert.equal(ambientTitle, "Working on the task");
  assert.doesNotMatch(ambientTitle, /customer|private|secret|token/i);
  assert.equal(taskStateTitle({ ...sensitiveEvent, state: "completed", phase: "finished" }), "Task complete");
});

test("legacy resume snapshots become deterministic restored lifecycle events", () => {
  assert.deepEqual(
    restoredTaskLifecycle("session-1", {
      id: "task-1",
      objective: "Continue the report",
      status: "paused",
      turnId: "turn-1",
      updatedAt: "2026-07-19T01:02:03.000Z",
    }),
    {
      version: 1,
      sessionId: "session-1",
      taskId: "task-1",
      turnId: "turn-1",
      objective: "Continue the report",
      state: "paused",
      taskStatus: "paused",
      phase: "restored",
      at: "2026-07-19T01:02:03.000Z",
      updatedAt: "2026-07-19T01:02:03.000Z",
      checkpoint: { done: 0, total: 0 },
    },
  );
});

test("ordered task lifecycle rejects duplicate and stale events from one server stream", () => {
  const current = {
    ...restoredTaskLifecycle("session-1", {
      id: "task-1",
      objective: "Continue the report",
      status: "running",
      turnId: "turn-1",
      updatedAt: "2026-07-19T01:02:03.000Z",
    }),
    streamId: "serve-a",
    sequence: 5,
  };
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 4 }), false);
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 5 }), false);
  assert.equal(taskLifecycleIsNewer(current, { ...current, sequence: 6 }), true);
  assert.equal(
    taskLifecycleIsNewer(current, { ...current, streamId: "serve-b", sequence: 1 }),
    true,
    "a restarted server begins a new incomparable stream",
  );
  const legacy = restoredTaskLifecycle("session-1", {
    id: "task-1",
    objective: "Continue the report",
    status: "paused",
    turnId: "turn-1",
    updatedAt: "2026-07-19T01:03:03.000Z",
  });
  assert.equal(taskLifecycleIsNewer(current, legacy), true, "old local engines stay compatible");
  assert.equal(taskLifecycleIsNewer(legacy, { ...current, sequence: 1 }), true);
});

test("tracked pet activity is bounded", () => {
  let activities = {};
  for (let index = 0; index < 80; index += 1) {
    activities = setPetActivity(activities, `s-${index}`, "running", `task ${index}`, index);
  }
  assert.equal(Object.keys(activities).length, 64);
  assert.equal(selectPetSnapshot(activities).activity.sessionId, "s-79");
  assert.equal(activities["s-0"], undefined);
});

test("desktop companion owns its window bridge and registers listeners before window sync", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const companion = readFileSync(
    `${root}/src/companion/useDesktopCompanion.ts`,
    "utf8",
  );
  const settings = readFileSync(
    `${root}/src/companion/DesktopCompanionSettings.tsx`,
    "utf8",
  );
  const petChat = readFileSync(`${root}/src/PetChat.tsx`, "utf8");
  const petChatDocument = readFileSync(`${root}/pet-chat.html`, "utf8");
  const viteConfig = readFileSync(`${root}/vite.config.ts`, "utf8");
  const petChatCss = readFileSync(`${root}/src/PetChat.css`, "utf8");
  const petRuntime = readFileSync(`${root}/src/pet-runtime.ts`, "utf8");
  const petChatCapability = JSON.parse(
    readFileSync(`${root}/src-tauri/capabilities/pet-chat.json`, "utf8"),
  );

  assert.match(app, /useDesktopCompanion\(\{/);
  assert.match(app, /<DesktopCompanionSettings/);
  assert.doesNotMatch(app, /listen\("hara-pet-ready"/);
  assert.match(
    app,
    /place === "auto"[\s\S]*setZone\("auto"\)[\s\S]*await openReplay\(session\)/,
    "clicking an automation activity opens that exact read-only run",
  );
  assert.ok(
    companion.indexOf('listen("hara-pet-ready"') <
      companion.indexOf("syncPetWindow(awake)"),
    "a fast companion boot cannot lose its initial configuration",
  );
  assert.match(companion, /onOpenActivity: \(sessionId: string\)/);
  assert.match(companion, /resolveChatSession: \(requestedSessionId\?: string\)/);
  assert.match(companion, /chatSessionRef\.current = resolveChatSessionRef\.current\(payload\?\.sessionId\)/);
  assert.match(companion, /payload\.sessionId !== pinnedSessionId/);
  assert.match(companion, /generation === chatGenerationRef\.current/);
  assert.match(companion, /const pinnedSessionId = chatSessionRef\.current;[\s\S]*openActivityRef\.current\(pinnedSessionId\)/);
  assert.doesNotMatch(companion, /chatSessionRef\.current \?\? snapshot\.activity\?\.sessionId/);
  assert.match(companion, /activitiesRef\.current\[sessionId\]\?\.status \?\? "idle"/);
  assert.match(companion, /if \(!chatOpenRef\.current\) return;/);
  assert.match(companion, /chatRefreshTimerRef\.current !== null/);
  assert.match(companion, /window\.setTimeout\(\(\) => \{[\s\S]*emitChatState\(\);[\s\S]*\}, 50\)/);
  assert.match(companion, /closeChatProjection\(\);[\s\S]*syncPetChatWindow\(false\)/);
  assert.match(app, /const unavailable = !!target && !session/);
  assert.match(app, /canSubmit: connected && !unavailable/);
  assert.match(app, /if \(sessionId && !requestedSession\)/, "the trusted main renderer rejects a stale or forged target");
  assert.match(app, /expectedApprovalId !== request\.approvalId/, "the trusted main renderer binds approvals to current session state");
  assert.match(companion, /WebviewWindow\.getByLabel\("main"\)/);
  assert.match(petRuntime, /new WebviewWindow\("pet-chat"/);
  assert.match(petRuntime, /url: "\/pet-chat\.html"/);
  assert.match(petRuntime, /focusable: true/);
  assert.doesNotMatch(petChatDocument, /Content-Security-Policy/, "Vite HMR remains usable in tauri dev");
  assert.match(viteConfig, /name: "hara-pet-chat-production-csp"/);
  assert.match(viteConfig, /apply: "build"/);
  assert.match(viteConfig, /connect-src 'none'/);
  assert.match(viteConfig, /script-src 'self'/);
  assert.match(petChat, /emitTo\("main", "hara-pet-chat-submit"/);
  assert.doesNotMatch(petChat, /\binvoke\(/, "companion chat cannot call native commands directly");
  assert.match(petChat, /restoreFailedDraft\(pendingDraft\.current, draft\)/);
  assert.match(petChat, /Keep the request pending[\s\S]*return current;/);
  assert.doesNotMatch(
    petChat,
    /main window did not respond[\s\S]*restoreFailedDraft/,
    "an advisory timeout cannot restore a request that may already be executing",
  );
  assert.ok(
    petChat.indexOf('listen<PetChatResult>("hara-pet-chat-result"') <
      petChat.indexOf('emitTo("main", "hara-pet-chat-ready"'),
    "the result listener is registered before requesting initial state",
  );
  assert.match(petChat, /stateTarget\.current !== payload\.sessionId[\s\S]*setDraft\(""\)[\s\S]*setPending\(null\)/);
  assert.doesNotMatch(petChat, /setState\(payload\);\s*setError\(""\)/, "ordinary state refreshes preserve request errors");
  assert.match(petChat, /state\.canSubmit && state\.task\?\.state === "waiting"/);
  assert.match(petChat, /role="log"/);
  assert.match(petChat, /className="pet-chat-error" role="alert"/);
  assert.match(petChatCss, /\.pet-chat button:focus-visible/);
  assert.match(petChatCss, /\.pet-chat-welcome[\s\S]*color:\s*#918d88/);
  assert.match(petChatCss, /\.pet-chat textarea::placeholder[\s\S]*color:\s*#918d88/);
  assert.deepEqual(petChatCapability.windows, ["pet-chat"]);
  assert.ok(petChatCapability.permissions.includes("core:event:allow-listen"));
  assert.ok(petChatCapability.permissions.includes("core:event:allow-unlisten"));
  assert.ok(petChatCapability.permissions.includes("core:event:allow-emit-to"));
  assert.ok(!petChatCapability.permissions.includes("core:event:allow-emit"));
  assert.ok(!petChatCapability.permissions.includes("core:window:default"));
  assert.ok(petChatCapability.permissions.includes("core:window:allow-start-dragging"));
  assert.match(petRuntime, /monitorFromPoint\([\s\S]*petPosition\.x[\s\S]*petPosition\.y/);
  assert.ok(
    petChatCapability.permissions.every(
      (permission) =>
        !/(?:dialog|opener|notification|updater|window-state)/.test(permission),
    ),
    "companion chat is an event-only bridge without file, network, updater, or notification plugins",
  );
  assert.match(settings, /case "codex-local":/);
  assert.match(settings, /case "hara-market":/);
  assert.match(settings, /disabled=\{!pet\.compatible\}/);
});
