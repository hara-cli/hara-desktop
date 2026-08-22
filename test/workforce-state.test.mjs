import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WORKFORCE_ACTOR_LIMIT,
  boundedWorkforceState,
  workforceHasLiveActors,
  workforceFromTask,
  workforceStateIsNewer,
} from "../src/workforce-state.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

const event = (sequence, overrides = {}) => ({
  version: 1,
  streamId: "stream-a",
  sequence,
  sessionId: "session-a",
  taskId: "task-a",
  turnId: "turn-a",
  mode: "snapshot",
  actors: [],
  ...overrides,
});

test("workforce reducer rejects stale and malformed snapshots", () => {
  assert.equal(workforceStateIsNewer(event(2), event(1)), false);
  assert.equal(workforceStateIsNewer(event(2), event(3)), true);
  assert.equal(workforceStateIsNewer(event(9), event(1, { streamId: "stream-b" })), true);
  assert.equal(workforceStateIsNewer(undefined, event(0)), false);
});

test("older engines project only the authoritative root task", () => {
  const snapshot = workforceFromTask("session-a", {
    version: 1,
    sessionId: "session-a",
    taskId: "task-a",
    turnId: "turn-a",
    objective: "private objective",
    state: "waiting",
    taskStatus: "running",
    phase: "approval",
    at: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    checkpoint: { done: 0, total: 0 },
  });
  assert.equal(snapshot.actors.length, 1);
  assert.equal(snapshot.actors[0].state, "waiting");
  assert.equal(snapshot.actors[0].activity, "awaiting_approval");
  assert.doesNotMatch(JSON.stringify(snapshot), /private objective/);
});

test("renderer bounds actor count and strips unsafe role text", () => {
  const snapshot = boundedWorkforceState(event(1, {
    actors: Array.from({ length: WORKFORCE_ACTOR_LIMIT + 4 }, (_, index) => ({
      actorId: `agent-${index}`,
      kind: index ? "subagent" : "root",
      role: index === 1 ? "unsafe role" : "research",
      capability: "research",
      state: "working",
      activity: "running",
      startedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
    })),
  }));
  assert.equal(snapshot.actors.length, WORKFORCE_ACTOR_LIMIT);
  assert.equal(snapshot.actors[1].role, undefined);
});

test("renderer drops actors with invalid wire enums or timestamps", () => {
  const valid = {
    actorId: "agent-valid",
    kind: "subagent",
    role: "ui-design",
    capability: "design",
    state: "working",
    activity: "running",
    startedAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:01.000Z",
  };
  const snapshot = boundedWorkforceState(event(1, {
    actors: [
      valid,
      { ...valid, actorId: "bad-state", state: "teleporting" },
      { ...valid, actorId: "bad-capability", capability: "credentials" },
      { ...valid, actorId: "bad-time", updatedAt: "not-a-date" },
    ],
    untrusted: "must not survive",
  }));
  assert.deepEqual(snapshot.actors.map((actor) => actor.actorId), ["agent-valid"]);
  assert.equal("untrusted" in snapshot, false);
});

test("terminal task fallback can reject a stale live workforce projection", () => {
  assert.equal(workforceHasLiveActors(event(1, {
    actors: [{
      actorId: "root",
      kind: "root",
      capability: "orchestration",
      state: "working",
      activity: "running",
      startedAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:01.000Z",
    }],
  })), true);
  assert.equal(workforceHasLiveActors(event(2, {
    actors: [{
      actorId: "root",
      kind: "root",
      capability: "orchestration",
      state: "completed",
      activity: "delivering",
      startedAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:02.000Z",
    }],
  })), false);
});

test("Agent Office combines public social identities, direct chat, and comic workstations", () => {
  const surface = readFileSync(`${root}/src/WorkforceSurface.tsx`, "utf8");
  const css = readFileSync(`${root}/src/WorkforceSurface.css`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const picker = readFileSync(`${root}/src/AgentPicker.tsx`, "utf8");
  assert.match(surface, /<AgentPortrait/);
  assert.match(surface, /<AgentCharacter/);
  assert.doesNotMatch(surface, /BUILTIN_HARA_ASSET|AtlasCssPet|petStatusForActor/);
  assert.match(surface, /CAPABILITY_VISUALS/);
  assert.match(surface, /seat\.zone === desiredZone/);
  assert.match(surface, /workforce-role-tool/);
  assert.match(surface, /workforce-stage-camera is-\$\{camera\}/);
  assert.match(surface, /changeOffice\(event\.target\.value\)/);
  assert.match(surface, /workforce-team-deck/);
  assert.match(surface, /EXPERIMENTAL 3D/);
  assert.match(surface, /COMIC OFFICE/);
  assert.match(surface, /selected\.identity\?\.traits/);
  assert.match(surface, /if \(actor\?\.agentRef\) onChatWithAgent\(actor\.agentRef\)/);
  assert.match(app, /latestAgentSession\(sessionsRef\.current, cwd, agentRef\)/);
  assert.match(app, /const targetCwd = agent\?\.home \|\| activeSession\?\.cwd/);
  assert.match(app, /openAgentConversation\(agentRef, targetAgent\?\.home \|\| workforceOffice\.cwd, true\)/);
  assert.match(picker, /Every Agent keeps separate history/);
  assert.match(picker, /agentDisplayName/);
  assert.match(picker, /<AgentPortrait/);
  assert.match(css, /Hara Comic Campus/);
  assert.match(css, /\.workforce-stage-camera\.is-focus/);
  assert.match(css, /\.workforce-actor\.is-idle/);
  assert.doesNotMatch(css, /is-waiting \.workforce-character \{ animation:/);
  for (const capability of ["code", "browser", "research", "design", "files", "office", "communication"]) {
    assert.match(css, new RegExp(`is-capability-${capability} \\.workforce-role-tool`));
  }
});

test("Agent Office ships a lazy local WebGL renderer with explicit fallbacks", () => {
  const surface = readFileSync(`${root}/src/WorkforceSurface.tsx`, "utf8");
  const renderer = readFileSync(`${root}/src/WorkforceThreeScene.tsx`, "utf8");
  const descriptor = readFileSync(`${root}/src/preinstalled-capabilities.ts`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const i18n = readFileSync(`${root}/src/i18n.ts`, "utf8");
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

  assert.equal(typeof packageJson.dependencies.three, "string");
  assert.match(surface, /lazy\(\(\) => import\("\.\/WorkforceThreeScene"\)\)/);
  assert.match(surface, /AGENT_OFFICE_CAPABILITY\.defaultRenderer/);
  assert.match(surface, /view === "webgl"/);
  assert.match(surface, /view === "spatial"/);
  assert.match(surface, /view === "list"/);
  assert.match(surface, /onUnavailable=\{\(\) =>/);
  assert.match(renderer, /new WebGLRenderer/);
  assert.match(renderer, /new OrbitControls/);
  assert.match(renderer, /applySemanticZoom/);
  assert.match(renderer, /hoverActor/);
  assert.match(renderer, /new IntersectionObserver/);
  assert.match(renderer, /powerPreference: "low-power"/);
  assert.match(renderer, /webglcontextlost/);
  assert.match(renderer, /stableActorHash/);
  assert.match(renderer, /runtime\.hasWorkingActors && !runtime\.reduced/);
  assert.match(renderer, /const FRAME_INTERVAL = 1000 \/ 30/);
  assert.match(renderer, /renderer\.dispose\(\)/);
  assert.match(renderer, /renderer\.forceContextLoss\(\)/);
  assert.match(renderer, /data-renderer="webgl"/);
  assert.doesNotMatch(renderer, /Math\.random/);
  assert.doesNotMatch(renderer, /fetch\(|TextureLoader|GLTFLoader/);
  assert.match(descriptor, /id: "core\.agent-office"/);
  assert.match(descriptor, /install: "preinstalled"/);
  assert.match(descriptor, /networkAccess: false/);
  assert.match(descriptor, /defaultRenderer: "spatial"/);
  assert.match(descriptor, /renderers: \["spatial", "list", "webgl"\]/);
  assert.match(app, /id: AGENT_OFFICE_CAPABILITY\.id/);
  assert.match(i18n, /workforceThree: "Experimental 3D"/);
  assert.match(i18n, /workforceThree: "实验 3D"/);
  assert.match(i18n, /workforceScene: "Comic office"/);
  assert.match(i18n, /workforceScene: "漫画办公室"/);
  assert.doesNotMatch(i18n, /workforceScene: "3D (?:office|办公室)"/);
});
