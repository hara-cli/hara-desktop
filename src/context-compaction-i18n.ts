/** Context compaction summary labels and notices. Values live in `src/locales/<lang>/<namespace>.json`; this keeps the legacy tuple shape. */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const CONTEXT_COMPACTION_KEYS: readonly TranslationTuple[] = tuplesFor("CONTEXT_COMPACTION_KEYS");
