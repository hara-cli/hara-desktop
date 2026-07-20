export type DesktopUpdateHandoffState = {
  phase: "downloaded" | "installed";
};

export type DesktopUpdateHandoffSteps = {
  retireEngine: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
};

export function applyDesktopUpdateHandoff(
  state: DesktopUpdateHandoffState,
  steps: DesktopUpdateHandoffSteps,
): Promise<void>;
