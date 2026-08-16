import type { PetStatus } from "./pets";

export type PetMoveDirection = "left" | "right" | null;
export type PetAnimationMode = "loop" | "once";

export interface PetAnimationFrame {
  column: number;
  durationMs: number;
}

export interface PetAnimationSpec {
  row: number;
  mode: PetAnimationMode;
  frames: readonly PetAnimationFrame[];
}

function sequence(durations: readonly number[]): readonly PetAnimationFrame[] {
  return durations.map((durationMs, column) => ({ column, durationMs }));
}

const IDLE: PetAnimationSpec = {
  row: 0,
  mode: "once",
  // One quiet greeting after entering idle, then return to column zero and stop. Ambient desktop
  // presence must never look like work is still running or consume a perpetual animation timer.
  frames: [
    { column: 0, durationMs: 5_200 },
    { column: 1, durationMs: 110 },
    { column: 2, durationMs: 110 },
    { column: 3, durationMs: 140 },
    { column: 4, durationMs: 140 },
    { column: 5, durationMs: 320 },
    { column: 0, durationMs: 1 },
  ],
};

const RUNNING: PetAnimationSpec = {
  row: 7,
  mode: "loop",
  frames: sequence([120, 120, 120, 120, 120, 220]),
};

const WAITING: PetAnimationSpec = {
  row: 6,
  mode: "once",
  frames: sequence([150, 150, 150, 150, 150, 260]),
};

const READY: PetAnimationSpec = {
  row: 8,
  mode: "once",
  frames: sequence([150, 150, 150, 150, 150, 280]),
};

const BLOCKED: PetAnimationSpec = {
  row: 5,
  mode: "once",
  frames: sequence([140, 140, 140, 140, 140, 140, 140, 240]),
};

const WALK_RIGHT: PetAnimationSpec = {
  row: 1,
  mode: "loop",
  frames: sequence([120, 120, 120, 120, 120, 120, 120, 220]),
};

const WALK_LEFT: PetAnimationSpec = {
  row: 2,
  mode: "loop",
  frames: sequence([120, 120, 120, 120, 120, 120, 120, 220]),
};

/** Animation playback is intentionally independent from task state semantics. */
export function petAnimationFor(status: PetStatus, movement: PetMoveDirection): PetAnimationSpec {
  if (movement === "right") return WALK_RIGHT;
  if (movement === "left") return WALK_LEFT;
  if (status === "running") return RUNNING;
  if (status === "waiting" || status === "paused") return WAITING;
  if (status === "ready") return READY;
  if (status === "blocked") return BLOCKED;
  return IDLE;
}
