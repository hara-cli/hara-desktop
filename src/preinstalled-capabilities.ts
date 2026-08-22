export type WorkforceRendererId = "webgl" | "spatial" | "list";

/**
 * Desktop-owned capabilities are shipped with the signed application and do not depend on a project
 * plugin, remote panel, or second Agent backend. Keeping a small descriptor makes the packaging and UI
 * contract explicit while the extension dock remains the place where the surface is opened.
 */
export const AGENT_OFFICE_CAPABILITY = Object.freeze({
  id: "core.agent-office",
  source: "first-party" as const,
  install: "preinstalled" as const,
  surfaceKind: "workforce" as const,
  stateProtocol: "event.workforce_state" as const,
  defaultRenderer: "spatial" as WorkforceRendererId,
  renderers: ["spatial", "list", "webgl"] as const satisfies readonly WorkforceRendererId[],
  lazy: true,
  networkAccess: false,
});
