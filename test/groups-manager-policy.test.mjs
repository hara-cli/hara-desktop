import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canClaimDeskTask,
  DESK_TASK_STATES,
  deskTransitionRequiresNote,
  deskTransitionRequiresRelease,
  desktopTaskTransitions,
  deskTaskClaimExpired,
  shouldAutoReadDeskBoard,
} from "../src/groups-manager-policy.ts";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const agent = (overrides = {}) => ({
  id: "agent_hara",
  name: "Hara",
  owner: "person_1",
  client: "hara-desktop",
  role: "member",
  createdAt: 1,
  lastSeen: 2,
  revoked: false,
  ...overrides,
});

const task = (overrides = {}) => ({
  id: "t_1",
  kind: "feedback",
  title: "Feedback",
  excerpt: "",
  risk: "low",
  state: "claimed",
  priority: "normal",
  severity: "minor",
  slaDueAt: null,
  parentId: null,
  createdBy: "agent_hara",
  claimedBy: "agent_hara",
  ackedBy: null,
  reporterRef: "",
  occurrenceCount: 1,
  sourceCount: 0,
  releaseVersion: "",
  verificationSteps: "",
  claimedSessionId: null,
  claimExpiresAt: null,
  claimFence: 1,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

test("the Desktop workbench exposes every Desk 0.7 state and mirrors server transitions", () => {
  assert.deepEqual(DESK_TASK_STATES, [
    "open",
    "claimed",
    "blocked",
    "waiting_user",
    "waiting_release",
    "waiting_verification",
    "review",
    "done",
    "cancelled",
  ]);
  assert.deepEqual(desktopTaskTransitions(task(), agent()), [
    "blocked",
    "waiting_user",
    "waiting_release",
    "waiting_verification",
    "review",
    "done",
    "cancelled",
  ]);
  assert.deepEqual(
    desktopTaskTransitions(task({ state: "done" }), agent({ role: "owner" })),
    ["open"],
  );
  assert.deepEqual(
    desktopTaskTransitions(task({ state: "done" }), agent()),
    [],
    "only an organization owner may reopen closed work",
  );
});

test("Desktop delegates same-Agent fenced work to the Engine workbench Session", () => {
  const sessionTask = task({ claimedSessionId: "session_codex", claimExpiresAt: Date.now() + 60_000 });
  assert.deepEqual(desktopTaskTransitions(sessionTask, agent()), [
    "blocked",
    "waiting_user",
    "waiting_release",
    "waiting_verification",
    "review",
    "done",
    "cancelled",
  ]);
  assert.deepEqual(
    desktopTaskTransitions(sessionTask, agent({ id: "agent_owner", role: "owner" })),
    ["blocked", "waiting_user", "waiting_release", "waiting_verification", "review", "cancelled"],
    "a human owner can administratively hand off another Agent's live claim but cannot complete it",
  );
  assert.deepEqual(
    desktopTaskTransitions(sessionTask, agent({ id: "agent_other" })),
    [],
    "a member cannot operate another Agent's fenced Session",
  );
});

test("auditable reasons and feedback release evidence are required in the UI policy", () => {
  assert.equal(deskTransitionRequiresNote("blocked"), true);
  assert.equal(deskTransitionRequiresNote("waiting_user"), true);
  assert.equal(deskTransitionRequiresNote("cancelled"), true);
  assert.equal(deskTransitionRequiresNote("review"), false);
  assert.equal(deskTransitionRequiresRelease(task(), "waiting_verification"), true);
  assert.equal(deskTransitionRequiresRelease(task({ sourceCount: 2 }), "done"), true);
  assert.equal(deskTransitionRequiresRelease(task({ sourceCount: 0 }), "done"), false);
});

test("Desktop never offers a completion transition that Desk will reject", () => {
  assert.equal(
    desktopTaskTransitions(task({ risk: "high", ackedBy: null }), agent()).includes("done"),
    false,
    "high-risk work must be acknowledged by an owner before completion",
  );
  assert.equal(
    desktopTaskTransitions(task({ risk: "high", ackedBy: "agent_owner" }), agent()).includes("done"),
    true,
  );
  assert.equal(
    desktopTaskTransitions(task({ kind: "feedback", sourceCount: 1, state: "claimed" }), agent()).includes("done"),
    false,
    "intake feedback must pass release and verification before closure",
  );
  assert.equal(
    desktopTaskTransitions(task({ kind: "feedback", sourceCount: 1, state: "waiting_verification" }), agent()).includes("done"),
    true,
  );
});

test("high-risk and expired claims expose only truthful recovery actions", () => {
  const current = 50_000;
  const unapproved = task({ state: "open", risk: "high", ackedBy: null });
  assert.equal(canClaimDeskTask(unapproved, agent(), current), false);
  assert.equal(canClaimDeskTask(unapproved, agent({ role: "owner" }), current), false);
  assert.equal(canClaimDeskTask({ ...unapproved, ackedBy: "owner" }, agent(), current), true);

  const expired = task({
    state: "claimed",
    claimedSessionId: "s_old",
    claimExpiresAt: current - 1,
    claimFence: 8,
  });
  assert.equal(deskTaskClaimExpired(expired, current), true);
  assert.equal(canClaimDeskTask(expired, agent(), current), true);
  assert.deepEqual(desktopTaskTransitions(expired, agent(), current), []);
  assert.equal(
    canClaimDeskTask({ ...expired, risk: "high", ackedBy: null }, agent(), current),
    false,
    "an expired high-risk claim still needs human approval",
  );
});

test("entering a configured organization reads one bounded board snapshot without polling", () => {
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", true, undefined), true);
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", true, "idle"), true);
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", true, "loading"), false);
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", true, "ready"), false);
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", true, "error"), false);
  assert.equal(shouldAutoReadDeskBoard("ready", "company-a", false, undefined), false);
  assert.equal(shouldAutoReadDeskBoard("ready", undefined, true, undefined), false);
  assert.equal(shouldAutoReadDeskBoard("loading", "company-a", true, undefined), false);
});

test("Groups remains a thin native client and keeps organization credentials out of React", () => {
  const groups = readFileSync(`${root}/src/Groups.tsx`, "utf8");
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  for (const forbidden of ["fetch(", "WebSocket", "Authorization", "apiKey", "registrationCode"]) {
    assert.equal(groups.includes(forbidden), false, `Groups must not contain ${forbidden}`);
  }
  for (const method of ["createDeskTask", "claimDeskTask", "ackDeskTask", "transitionDeskTask", "completeDeskTask", "cancelDeskTask", "commentDeskTask"]) {
    assert.match(app, new RegExp(`client\\.${method}`));
  }
  assert.match(
    groups,
    /window\.confirm\(confirmation\)/,
    "an organization owner must deliberately confirm a high-risk approval",
  );
  assert.match(app, /focusOrganizationEnrollmentRequest=\{organizationEnrollmentFocusRequest\}/);
});
