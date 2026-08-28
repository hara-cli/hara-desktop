import type { Key } from "./i18n";

/** Turn stable, observed external errors into renderer-owned guidance. These hints never infer success,
 * execute a command, or expose raw provider diagnostics beyond the already-sanitized checkpoint. */
export function knownManualActionHintKeys(parts: Array<string | undefined>): Key[] {
  const observed = parts.filter(Boolean).join("\n");
  const keys: Key[] = [];
  if (/load failed:?\s*5|input\/output error/iu.test(observed)) keys.push("taskKnownHintLaunchLoad");
  if (/launchctl/iu.test(observed) && /exit(?:\s+code)?\s*[=:]?\s*0/iu.test(observed)) {
    keys.push("taskKnownHintLaunchVerify");
  }
  if (/operation not permitted/iu.test(observed)) keys.push("taskKnownHintOperationNotPermitted");
  if (/permission denied/iu.test(observed)) keys.push("taskKnownHintPermissionDenied");
  return keys;
}
