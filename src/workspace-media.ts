import { convertFileSrc, invoke } from "@tauri-apps/api/core";
export const workspaceMediaMimeAllowed = (mime: string) => ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/quicktime", "video/webm", "application/pdf", "application/zip", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/markdown", "text/plain"].includes(mime);
export interface WorkspaceMedia { id: string; mime: string; bytes: number }
export type WorkspaceMediaFailureReason = "symlink" | "path_spelling";
export type WorkspaceMediaDescription = { state: "ready"; media: WorkspaceMedia } | { state: "outside" } | { state: "missing" } | { state: "failed"; reason?: WorkspaceMediaFailureReason };
export interface WorkspaceMediaAccess { readonly mediaScope: string; registerMedia(path: string, expectedScope?: string): Promise<WorkspaceMedia>;
  describeMedia?(path: string, expectedScope?: string): Promise<WorkspaceMediaDescription> }
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
/** Pasted images (workspace.media.import.v1) follow the image attachment rules: these four types, at most 3.6 MB. */
export const PASTE_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_PASTE_IMAGE_BYTES = 3_600_000;
/** Each chunk stays well under the Workspace RPC frame (128 KiB) once base64-encoded. */
export const PASTE_CHUNK_BYTES = 64 * 1024;
export function pasteImageChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += PASTE_CHUNK_BYTES) {
    const part = bytes.subarray(at, at + PASTE_CHUNK_BYTES); let binary = "";
    for (let i = 0; i < part.length; i += 8192) binary += String.fromCharCode(...part.subarray(i, i + 8192));
    chunks.push(btoa(binary));
  }
  return chunks;
}
/** The clipboard image to paste, or null when it carries text (text paste keeps its normal behaviour). */
export function pastedImageFile(data: Pick<DataTransfer, "items"> | null | undefined): File | null {
  const items = [...(data?.items ?? [])];
  if (items.some(item => item.kind === "string" && item.type === "text/plain")) return null;
  return items.find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile() ?? null;
}
