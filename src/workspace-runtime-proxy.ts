export interface WorkspaceRuntimeProxyView {
  workspaceId: string;
  resourceGeneration: string;
  revision: number;
  proxyUrl: string | null;
  readOnly: boolean;
}

/** A proxy address is deliberately not a credential store or a bypass list. */
export function normalizeRuntimeProxyUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (value.length > 2048 || /[\s\u0000-\u001f\u007f?#@]/u.test(value)) throw new Error("Invalid runtime proxy");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid runtime proxy");
  return url.origin;
}

export function runtimeProxyView(value: unknown, workspaceId: string, generation: string): WorkspaceRuntimeProxyView {
  if (!value || typeof value !== "object") throw new Error("Invalid runtime proxy settings");
  const view = value as WorkspaceRuntimeProxyView;
  if (view.workspaceId !== workspaceId || view.resourceGeneration !== generation
    || !Number.isSafeInteger(view.revision) || view.revision < 0 || typeof view.readOnly !== "boolean"
    || !(view.proxyUrl === null || typeof view.proxyUrl === "string" && normalizeRuntimeProxyUrl(view.proxyUrl))) {
    throw new Error("Invalid runtime proxy settings");
  }
  return view;
}
