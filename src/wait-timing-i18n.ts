/** WAIT timing: sending, retrying and recovering copy. Values live in `src/locales/<lang>/<namespace>.json`; this keeps the legacy tuple shape. */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const WAIT_TIMING_KEYS: readonly TranslationTuple[] = tuplesFor("WAIT_TIMING_KEYS");
