/** Computer Use is a first-party policy surface. The native adapter ships with Hara; its optional
 * structured-browser backend is installed only after an explicit user action in this surface. */
export const COMPUTER_USE_CAPABILITY = Object.freeze({
  id: "core.computer-use",
  source: "first-party" as const,
  install: "preinstalled" as const,
  surfaceKind: "settings" as const,
  settingsSection: "security" as const,
  networkAccess: "explicit-browser-backend" as const,
});
