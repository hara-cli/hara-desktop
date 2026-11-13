import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { WorkspaceDevModel } from "./workspace-dev-state";
import { workScopeSource, workScopeVersion, subscribeWorkScope, type WorkScopeTarget, type WorkScopeView } from "./workspace-work-scope";
type State = { key: string; state: "loading" | "error" } | { key: string; state: "ready"; view: WorkScopeView };
export function useColleagueWorkScope(model: WorkspaceDevModel | undefined, target: WorkScopeTarget) {
  const subscribe = useCallback((listener: () => void) => subscribeWorkScope(model, listener), [model]);
  const snapshot = useCallback(() => workScopeVersion(model), [model]);
  const version = useSyncExternalStore(subscribe, snapshot, snapshot), source = workScopeSource(model);
  const capture = source?.capture(target), key = capture ? `${version}:${capture.key}` : "";
  const [state, setState] = useState<State | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!source || !capture || !key) { setState(null); return; }
    let live = true; const controller = new AbortController(); setState({ key, state: "loading" });
    void source.read(capture, controller.signal).then(view => { if (live) setState({ key, state: "ready", view }); }, () => { if (live) setState({ key, state: "error" }); });
    return () => { live = false; controller.abort(); };
    // The primitive key binds the full scope, principal, grant, physical connection and observed epoch.
    // A fresh opaque capture with the same key does not start another read on ordinary renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key, retry]);
  return !capture || !source ? null : { value: state?.key === key ? state : { key, state: "loading" as const }, retry: () => setRetry(value => value + 1) };
}
