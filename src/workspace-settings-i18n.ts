/** Settings surface: connections, runtimes, permissions, schedules, MCP review. Values live in `src/locales/<lang>/<namespace>.json`; this keeps the legacy tuple shape. */
import { tuplesFor, type TranslationTuple } from "./i18n-catalog.ts";

export const WORKSPACE_SETTINGS_KEYS: readonly TranslationTuple[] = tuplesFor("WORKSPACE_SETTINGS_KEYS");
