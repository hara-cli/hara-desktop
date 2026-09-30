export type CommandLineHaraStatus = {
  path: string;
  bundledVersion: string;
  available: boolean;
  installed: boolean;
  current: boolean;
  managed: boolean;
  blocked: boolean;
};

export type TerminalHaraStatus = {
  path: string | null;
  version: string | null;
  usesManagedCli: boolean;
  pathSource: "loginShell" | "desktopEnvironment";
};

/** A user-run, current-window-only PATH change. Never writes a shell profile or removes a CLI. */
export function managedCliPathCommand(managedPath: string): string | null {
  if (!managedPath || /[\r\n\0]/.test(managedPath)) return null;
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(managedPath);
  const separator = windows ? /[\\/][^\\/]+$/ : /\/[^/]+$/;
  const directory = managedPath.replace(separator, "");
  if (directory === managedPath) return null;
  if (windows) return `$env:PATH = '${directory.replace(/'/g, "''")};' + $env:PATH`;
  if (!directory.startsWith("/")) return null;
  return `export PATH='${directory.replace(/'/g, "'\\''")}':"$PATH"; hash -r`;
}
