/**
 * Shared shell keys (B0).
 *
 * The values moved to `src/locales/<lang>/<namespace>.json`. This module keeps the
 * historical two-array export so existing imports, `.ts` derivation and the shell
 * tests keep working unchanged; the membership split is recorded in
 * `src/locales/keys.json`.
 */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const WORKSPACE_KEYS: readonly TranslationTuple[] = tuplesFor("WORKSPACE_KEYS");

// Additional live controls and recovery copy; the canonical keys above remain unchanged.
export const WORKSPACE_EXTRA_KEYS: readonly TranslationTuple[] = tuplesFor("WORKSPACE_EXTRA_KEYS");
