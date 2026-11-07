import { convertFileSrc, invoke } from "@tauri-apps/api/core";
export interface WorkspaceMedia { id: string; mime: string; bytes: number }
export interface WorkspaceMediaAccess { readonly mediaScope: string; registerMedia(path: string, expectedScope?: string): Promise<WorkspaceMedia> }
/** Only local image references are eligible for Host registration. Remote URLs keep normal behavior. */
export function localMediaPath(source: string): string | null {
  if (!source || source.startsWith("//") || /^(?:https?:|data:|blob:|hara-media:)/iu.test(source)) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(source) && !/^file:/iu.test(source) && !/^[a-z]:[\\/]/iu.test(source)) return null;
  try { return source.startsWith("file:") ? source : decodeURIComponent(source); } catch { return null; }
}
export const workspaceMediaUrl = (id: string) => {
  if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error("Media unavailable");
  return convertFileSrc(id, "hara-media");
};
export const revealWorkspaceMedia = (id: string) => invoke<void>("workspace_media_reveal", { id });
