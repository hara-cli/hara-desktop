/**
 * @typedef {{ phase: "downloaded" | "installed" }} DesktopUpdateHandoffState
 * @typedef {{
 *   retireEngine: () => Promise<void>,
 *   install: () => Promise<void>,
 *   restart: () => Promise<void>
 * }} DesktopUpdateHandoffSteps
 */

/**
 * Apply a downloaded Desktop update as one ordered handoff.
 *
 * The engine retirement barrier always runs before installation or relaunch. The phase mutation happens
 * only after installation succeeds, so a failed install remains retryable while a failed relaunch cannot
 * install the same package twice.
 *
 * @param {DesktopUpdateHandoffState} state
 * @param {DesktopUpdateHandoffSteps} steps
 */
export async function applyDesktopUpdateHandoff(state, steps) {
  await steps.retireEngine();
  if (state.phase === "downloaded") {
    await steps.install();
    state.phase = "installed";
  }
  await steps.restart();
}
