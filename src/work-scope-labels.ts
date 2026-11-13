import type { Key } from "./i18n";
const tools = new Map<string, Key>([
  ["workspace_read", "ws.workScope.tool.read"], ["workspace_write", "ws.workScope.tool.write"],
  ["workspace_verify", "ws.workScope.tool.verify"], ["task_intake", "ws.workScope.tool.intake"],
  ["task_checkpoint", "ws.workScope.tool.checkpoint"], ["todo_write", "ws.workScope.tool.todo"], ["ask_user", "ws.workScope.tool.ask"],
]);
/** Host IDs remain opaque data. Unknown names, including Object prototype names, use ordinary copy. */
export const workScopeToolLabelKey = (toolId: string): Key => tools.get(toolId) ?? "ws.workScope.tool.other";
