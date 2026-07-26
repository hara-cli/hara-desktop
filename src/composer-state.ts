import type {
  EffectiveAttachmentCapabilities,
  SessionAttachmentIntent,
} from "./client";

export interface ComposerAttachment extends SessionAttachmentIntent {
  id: string;
  name: string;
}

export interface ComposerDraft {
  text: string;
  attachments: ComposerAttachment[];
}

export type ComposerAttachmentIssue =
  | "engine-update-required"
  | "model-capabilities-loading"
  | "image-unsupported"
  | "image-unknown";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const pathName = (path: string): string =>
  path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;

export const emptyComposerDraft = (): ComposerDraft => ({
  text: "",
  attachments: [],
});

export function composerAttachment(
  path: string,
  selectedKind: "image" | "file" | "directory",
  id: string,
  mediaType?: string,
): ComposerAttachment {
  const extension = pathName(path).split(".").pop()?.toLowerCase() ?? "";
  const kind = selectedKind === "file" && (
    mediaType?.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)
  )
    ? "image"
    : selectedKind;
  return {
    id,
    kind,
    path,
    name: pathName(path),
    ...(mediaType ? { mediaType } : {}),
  };
}

export function appendComposerAttachments(
  current: ComposerAttachment[],
  additions: ComposerAttachment[],
): ComposerAttachment[] {
  const next = [...current];
  const seen = new Set(current.map((attachment) => `${attachment.kind}:${attachment.path}`));
  for (const attachment of additions) {
    const key = `${attachment.kind}:${attachment.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(attachment);
  }
  return next;
}

export function composerAttachmentIssue(
  attachments: ComposerAttachment[],
  capabilities: EffectiveAttachmentCapabilities | undefined,
  structuredAttachmentsSupported: boolean,
): ComposerAttachmentIssue | null {
  if (attachments.length === 0) return null;
  if (!structuredAttachmentsSupported) return "engine-update-required";
  if (!attachments.some((attachment) => attachment.kind === "image")) return null;
  if (!capabilities) return "model-capabilities-loading";
  if (capabilities.image.mode === "unsupported") return "image-unsupported";
  if (capabilities.image.mode === "unknown") return "image-unknown";
  return null;
}

export function composerCanSend(
  draft: ComposerDraft,
  issue: ComposerAttachmentIssue | null,
): boolean {
  return (draft.text.trim().length > 0 || draft.attachments.length > 0) && issue === null;
}
