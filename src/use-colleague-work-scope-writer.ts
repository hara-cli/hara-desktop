import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { workScopeVersion, subscribeWorkScope, type WorkScopeTarget } from "./workspace-work-scope";
import { workScopeWriter, workScopeWriterVersion, subscribeWorkScopeWriter, type WorkScopeEditSession } from "./work-scope-writer";
type State = { key: string; phase: "loading" | "error" } | { key: string; phase: "ready"; session: WorkScopeEditSession | null };
export function useColleagueWorkScopeWriter(model: WorkspaceDevModel | undefined, target: WorkScopeTarget) {
  const subscribe = useCallback((listener: () => void) => {
    const read = subscribeWorkScope(model, listener), write = subscribeWorkScopeWriter(model, listener); return () => { read(); write(); };
  }, [model]);
  const snapshot = useCallback(() => `${workScopeVersion(model)}:${workScopeWriterVersion(model)}`, [model]);
  const version = useSyncExternalStore(subscribe, snapshot, snapshot), writer = workScopeWriter(model), capture = writer?.capture(target);
  const key = capture ? `${version}:${capture.key}` : "", [state, setState] = useState<State | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!writer || !capture || !key) { setState(null); return; }
    let live = true; const controller = new AbortController(); setState({ key, phase: "loading" });
    void writer.load(capture, controller.signal).then(session => { if (live) setState({ key, phase: "ready", session }); }, () => { if (live) setState({ key, phase: "error" }); });
    return () => { live = false; controller.abort(); };
    // The primitive key covers source identity AND the writer binding. New opaque captures with the same key do not refetch on renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writer, key, retry]);
  // Synchronous visibility fence: old sessions/forms cannot paint while the next effect is pending.
  return !writer || !capture ? null : { key, writer, capture, value: state?.key === key ? state : { key, phase: "loading" as const }, retry: () => setRetry(value => value + 1) };
}
