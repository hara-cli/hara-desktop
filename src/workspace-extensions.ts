export interface ExtensionToolDescriptor { toolId: string; name: string; description: string }
export interface WorkspaceExtensionSource {
  sourceId: string; sourceRevision: string; kind: "global" | "plugin" | "workspace"; name: string;
  transport: "stdio" | "streamable-http" | "sse"; executableSummary: string; description: string;
  tools: ExtensionToolDescriptor[]; status: "ready" | "unreviewed" | "needs-review" | "unavailable";
  enabled: boolean; workspaceEnabled: boolean; allowedTools: string[]; assignedAgentCount: number;
  assignmentEnabled?: boolean; assignedTools?: string[]; effectiveTools?: string[];
}
export interface WorkspaceExtensionsView {
  workspaceId: string; resourceGeneration: string; revision: number; readOnly: boolean;
  agentId?: string; agentEpoch?: number; sources: WorkspaceExtensionSource[];
}
export type ExtensionChange = { sourceId: string; sourceRevision: string; enabled: boolean; allowedTools: string[] } &
  ({ target: "workspace" } | { target: "agent"; agentId: string; agentEpoch: number });
export interface ExtensionProposal { proposalId: string; workspaceId: string; resourceGeneration: string; revision: number; change: ExtensionChange }
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 64 && value.every(item => typeof item === "string") && new Set(value).size === value.length;
export function extensionView(value: unknown, workspaceId: string, generation: string, agent?: { agentId: string; agentEpoch: number }): WorkspaceExtensionsView {
  if (!value || typeof value !== "object") throw new Error("Invalid extension view");
  const view = value as WorkspaceExtensionsView;
  if (view.workspaceId !== workspaceId || view.resourceGeneration !== generation || !Number.isSafeInteger(view.revision) || view.revision < 0
    || typeof view.readOnly !== "boolean" || !Array.isArray(view.sources) || view.sources.length > 256
    || view.agentId !== agent?.agentId || view.agentEpoch !== agent?.agentEpoch) throw new Error("Invalid extension view");
  for (const source of view.sources) {
    if (!source || typeof source.sourceId !== "string" || source.sourceId.length > 256 || typeof source.sourceRevision !== "string"
      || !/^[a-f0-9]{64}$/u.test(source.sourceRevision) || ![source.name, source.executableSummary, source.description].every(item => typeof item === "string" && item.length <= 300)
      || !["global", "plugin", "workspace"].includes(source.kind) || !["stdio", "streamable-http", "sse"].includes(source.transport)
      || !["ready", "unreviewed", "needs-review", "unavailable"].includes(source.status) || typeof source.enabled !== "boolean" || typeof source.workspaceEnabled !== "boolean"
      || !Number.isSafeInteger(source.assignedAgentCount) || source.assignedAgentCount < 0 || !strings(source.allowedTools)
      || !Array.isArray(source.tools) || source.tools.length > 64 || !source.tools.every(tool => tool && typeof tool.toolId === "string" && typeof tool.name === "string" && typeof tool.description === "string")
      || new Set(source.tools.map(tool => tool.toolId)).size !== source.tools.length || !source.allowedTools.every(id => source.tools.some(tool => tool.toolId === id))
      || agent && (typeof source.assignmentEnabled !== "boolean" || !strings(source.assignedTools) || !strings(source.effectiveTools)
        || !source.effectiveTools.every(id => source.allowedTools.includes(id) && source.assignedTools!.includes(id)))) throw new Error("Invalid extension source view");
  }
  if (new Set(view.sources.map(source => source.sourceId)).size !== view.sources.length) throw new Error("Duplicate extension source view");
  return view;
}
