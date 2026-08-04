import type {
  EffectiveAttachmentCapabilities,
  SessionAttachmentIntent,
} from "./client";

export interface ComposerAttachment extends SessionAttachmentIntent {
  id: string;
  name: string;
  /** Local metadata used only for preflight; never sent as part of the Serve attachment intent. */
  byteSize?: number;
}

export interface ComposerDraft {
  text: string;
  attachments: ComposerAttachment[];
}

export type ComposerAttachmentIssue =
  | "engine-update-required"
  | "image-too-large"
  | "model-capabilities-loading"
  | "image-unsupported"
  | "image-unknown";

export const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 3_600_000;
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
  byteSize?: number,
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
    ...(typeof byteSize === "number" && Number.isSafeInteger(byteSize) && byteSize >= 0
      ? { byteSize }
      : {}),
  };
}

export function maxImageAttachmentBytes(
  capabilities: EffectiveAttachmentCapabilities | undefined,
): number {
  const advertised = capabilities?.image.maxBytes;
  return typeof advertised === "number" && Number.isSafeInteger(advertised) && advertised > 0
    ? advertised
    : DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES;
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
  const images = attachments.filter((attachment) => attachment.kind === "image");
  if (images.length === 0) return null;
  const maxBytes = maxImageAttachmentBytes(capabilities);
  if (images.some((attachment) => (
    typeof attachment.byteSize === "number" && attachment.byteSize > maxBytes
  ))) return "image-too-large";
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
