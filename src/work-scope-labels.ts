import type { Key } from "./i18n";
const tools = new Map<string, Key>([
  ["workspace_read", "ws.workScope.tool.read"], ["workspace_write", "ws.workScope.tool.write"],
  ["workspace_verify", "ws.workScope.tool.verify"], ["task_intake", "ws.workScope.tool.intake"],
  ["task_checkpoint", "ws.workScope.tool.checkpoint"], ["todo_write", "ws.workScope.tool.todo"], ["ask_user", "ws.workScope.tool.ask"],
]);
/** Host IDs remain opaque data. Unknown names, including Object prototype names, use ordinary copy. */
export const workScopeToolLabelKey = (toolId: string): Key => tools.get(toolId) ?? "ws.workScope.tool.other";

/** Display only. The full Host-registered path stays available under Advanced. */
export function workScopeDirectoryName(label: string | null, path: string | null): string | null {
  const name = label?.trim();
  if (name && !/^(?:[\\/]|[A-Za-z]:(?:[\\/]|$))/.test(name)) return name;
  const leaf = (path ?? name)?.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
  return leaf && !/^[A-Za-z]:$/.test(leaf) ? leaf : null;
}
