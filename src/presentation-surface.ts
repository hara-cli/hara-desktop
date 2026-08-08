import type {
  HaraClient,
  PresentationArtifactDetails,
} from "./client";

export const HARA_CONFLICT_ERROR_CODE = -32005;

export function isPresentationRevisionConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === HARA_CONFLICT_ERROR_CODE;
}

export type PresentationSurfaceClient = Pick<
  HaraClient,
  "getPresentation" | "getPresentationPreview"
>;

export interface LoadedPresentationSurface {
  details: PresentationArtifactDetails;
  preview: { html: string; revisionId: string };
  requestedRevisionId: string | null;
  recoveredLatest: boolean;
}

/** Load one coherent project/preview pair. A revision may legitimately advance while the renderer is
 * preparing HTML; recover by resolving current state and retrying, never by showing a stale blank tab. */
export async function loadPresentationSurface(
  client: PresentationSurfaceClient,
  artifactId: string,
  requestedRevisionId?: string,
  conflictRetries = 2,
): Promise<LoadedPresentationSurface> {
  const originalRevisionId = requestedRevisionId ?? null;
  let revisionId = requestedRevisionId;
  let recoveredLatest = false;
  for (let attempt = 0; attempt <= conflictRetries; attempt += 1) {
    try {
      const details = await client.getPresentation(artifactId, revisionId);
      const resolvedRevisionId = details.currentRevision.revisionId;
      const preview = await client.getPresentationPreview(artifactId, resolvedRevisionId);
      if (preview.revisionId !== resolvedRevisionId) {
        const mismatch = Object.assign(new Error("presentation preview revision mismatch"), {
          code: HARA_CONFLICT_ERROR_CODE,
        });
        throw mismatch;
      }
      return {
        details,
        preview,
        requestedRevisionId: originalRevisionId,
        recoveredLatest: recoveredLatest || (
          originalRevisionId !== null && resolvedRevisionId !== originalRevisionId
        ),
      };
    } catch (error) {
      if (!isPresentationRevisionConflict(error) || attempt >= conflictRetries) throw error;
      recoveredLatest = true;
      revisionId = undefined;
    }
  }
  throw new Error("presentation surface retry invariant failed");
}

export type PresentationErrorKey =
  | "presentationRevisionChanged"
  | "presentationOpenFailed"
  | "presentationVerifyFailed"
  | "presentationExportFailed"
  | "presentationSaveFailed";

export function presentationErrorKey(
  error: unknown,
  fallback: Exclude<PresentationErrorKey, "presentationRevisionChanged"> = "presentationOpenFailed",
): PresentationErrorKey {
  return isPresentationRevisionConflict(error)
    ? "presentationRevisionChanged"
    : fallback;
}
