import assert from "node:assert/strict";
import test from "node:test";

import {
  HARA_CONFLICT_ERROR_CODE,
  isPresentationRevisionConflict,
  loadPresentationSurface,
  presentationErrorKey,
} from "../src/presentation-surface.ts";

function details(revisionId) {
  return {
    artifact: {
      artifactId: "art_safe",
      currentRevisionId: revisionId,
    },
    currentRevision: { revisionId },
    project: { title: "Deck", slides: [] },
  };
}

test("presentation preview conflicts recover to one coherent latest revision", async () => {
  const gets = [];
  const previews = [];
  let firstPreview = true;
  const client = {
    async getPresentation(_artifactId, revisionId) {
      gets.push(revisionId ?? null);
      return revisionId ? details(revisionId) : details("rev_latest");
    },
    async getPresentationPreview(_artifactId, revisionId) {
      previews.push(revisionId);
      if (firstPreview) {
        firstPreview = false;
        throw Object.assign(
          new Error("the Artifact changed before the Desktop preview was prepared; reopen the latest revision"),
          { code: HARA_CONFLICT_ERROR_CODE },
        );
      }
      return { html: "<main>latest</main>", revisionId };
    },
  };

  const loaded = await loadPresentationSurface(client, "art_safe", "rev_stale");
  assert.deepEqual(gets, ["rev_stale", null]);
  assert.deepEqual(previews, ["rev_stale", "rev_latest"]);
  assert.equal(loaded.details.currentRevision.revisionId, "rev_latest");
  assert.equal(loaded.preview.revisionId, "rev_latest");
  assert.equal(loaded.recoveredLatest, true);
});

test("presentation conflict detection and error copy use stable protocol codes, never server prose", async () => {
  const conflict = Object.assign(new Error("arbitrary English server wording"), {
    code: HARA_CONFLICT_ERROR_CODE,
  });
  assert.equal(isPresentationRevisionConflict(conflict), true);
  assert.equal(presentationErrorKey(conflict), "presentationRevisionChanged");
  assert.equal(presentationErrorKey(new Error("other failure")), "presentationOpenFailed");
  assert.equal(
    presentationErrorKey(new Error("other failure"), "presentationExportFailed"),
    "presentationExportFailed",
  );
  assert.equal(
    presentationErrorKey(conflict, "presentationSaveFailed"),
    "presentationRevisionChanged",
  );

  await assert.rejects(
    loadPresentationSurface({
      async getPresentation() {
        throw new Error("sensitive implementation detail");
      },
      async getPresentationPreview() {
        throw new Error("unreachable");
      },
    }, "art_safe", "rev_one"),
    /sensitive implementation detail/,
  );
});
