import type { DeskAgent, DeskTask, DeskTaskState } from "./client";

export const DESK_TASK_STATES: readonly DeskTaskState[] = [
  "open",
  "claimed",
  "blocked",
  "waiting_user",
  "waiting_release",
  "waiting_verification",
  "review",
  "done",
  "cancelled",
];

const TASK_TRANSITIONS: Readonly<Record<DeskTaskState, readonly DeskTaskState[]>> = {
  open: ["cancelled"],
  claimed: ["blocked", "waiting_user", "waiting_release", "waiting_verification", "review", "done", "cancelled"],
  blocked: ["claimed", "cancelled"],
  waiting_user: ["claimed", "cancelled"],
  waiting_release: ["claimed", "waiting_verification", "cancelled"],
  waiting_verification: ["claimed", "done", "cancelled"],
  review: ["claimed", "done", "cancelled"],
  done: ["open"],
  cancelled: ["open"],
};

export const desktopTaskTransitions = (
  task: DeskTask,
  actor: DeskAgent | undefined,
  at = Date.now(),
): readonly DeskTaskState[] => {
  if (!actor) return [];
  if (deskTaskClaimExpired(task, at)) return [];
  const mayWork = actor.role === "owner"
    || task.createdBy === actor.id
    || task.claimedBy === actor.id;
  if (!mayWork) return [];
  if (task.claimedSessionId && task.claimedBy !== actor.id && actor.role !== "owner") return [];
  if ((task.state === "done" || task.state === "cancelled") && actor.role !== "owner") return [];

  // The Engine renews one private workbench Session for the local Agent. A different Agent's live
  // claim remains owner-administered; its completion stays with its owning Session until handoff.
  return TASK_TRANSITIONS[task.state].filter((target) => (
    !(target === "done" && task.claimedSessionId && task.claimedBy !== actor.id)
    && !(target === "done" && task.risk === "high" && !task.ackedBy)
    && !(target === "done" && task.kind === "feedback" && task.sourceCount > 0 && task.state !== "waiting_verification")
  ));
};

export const deskTaskClaimExpired = (task: DeskTask, at = Date.now()): boolean =>
  task.state === "claimed"
  && Boolean(task.claimedSessionId)
  && typeof task.claimExpiresAt === "number"
  && task.claimExpiresAt <= at;

export const canClaimDeskTask = (
  task: DeskTask,
  actor: DeskAgent | undefined,
  at = Date.now(),
): boolean => Boolean(actor)
  && (task.state === "open" || deskTaskClaimExpired(task, at))
  && (task.risk !== "high" || Boolean(task.ackedBy));

export const deskTransitionRequiresNote = (state: DeskTaskState): boolean =>
  state === "blocked" || state === "waiting_user" || state === "cancelled";

export const deskTransitionRequiresRelease = (task: DeskTask, state: DeskTaskState): boolean =>
  state === "waiting_verification"
  || (state === "done" && task.kind === "feedback" && task.sourceCount > 0);

export const shouldAutoReadDeskBoard = (
  directoryPhase: "idle" | "loading" | "ready" | "error" | "unsupported",
  profileId: string | undefined,
  deskConfigured: boolean,
  snapshotPhase: "idle" | "loading" | "ready" | "error" | undefined,
): boolean => directoryPhase === "ready"
  && Boolean(profileId)
  && deskConfigured
  && (snapshotPhase === undefined || snapshotPhase === "idle");
