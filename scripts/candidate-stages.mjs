// Shared phase contract, offline/injectable. No default adapters and no implicit subprocesses.
// This is not wired into the current tag workflow until candidate admission is approved.
import { validateCandidate } from "./candidate-gate.mjs";

export const CANDIDATE_STAGES = Object.freeze([
  "admission", "source", "updaterFilePreflight", "piOnlyPreflight", "tests", "formalBuild",
  "signAndNotarize", "packageSmoke", "upgradeSmoke", "receipt",
]);
const PROMOTION_STAGES = Object.freeze(["inspect", "publishImmutable", "verifyPublic", "publishStable", "verifyStable"]);
const checkAdapters = (adapters, stages) => {
  if (!adapters || Object.keys(adapters).length !== stages.length || stages.some(name => !Object.hasOwn(adapters, name) || typeof adapters[name] !== "function")) {
    throw new Error("explicit complete stage adapters required; unknown build/publication callbacks forbidden");
  }
};

/** Candidate executes every build/check phase, but has no publication callback at all. */
export async function runCandidateStages(adapters) {
  checkAdapters(adapters, CANDIDATE_STAGES);
  adapters = { ...adapters };
  const completed = [];
  for (const name of CANDIDATE_STAGES) {
    const result = await adapters[name]();
    if (result?.ok !== true || (name === "piOnlyPreflight" && result.onlyPiPreinstalledRequirementMet !== true)) {
      throw new Error(`candidate stopped at ${name}`);
    }
    completed.push(name);
  }
  return Object.freeze({ mode: "candidate", completed: Object.freeze(completed), published: false });
}

/**
 * Tag path only retrieves/inspects exact existing bytes, validates, then promotes them.
 * No build/sign callback, catch/retry, or older-candidate fallback exists in this path.
 * The trusted caller must still perform existing tag/actor/immutable-release policy admission.
 */
export async function runCandidatePromotion(expected, adapters) {
  checkAdapters(adapters, PROMOTION_STAGES);
  adapters = { ...adapters };
  expected = structuredClone(expected);
  const observation = await adapters.inspect();
  const proof = validateCandidate({ ...observation, source: expected.source, policy: expected.policy, nowSeconds: expected.nowSeconds });
  for (const name of PROMOTION_STAGES.slice(1)) {
    const result = await adapters[name](proof);
    if (result?.ok !== true) throw new Error(`candidate promotion stopped at ${name}`);
  }
  return Object.freeze({ mode: "promotion", proof });
}
