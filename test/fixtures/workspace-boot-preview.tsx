// DEV-only real startup controller/view; no native bridge, credentials, Core or model calls.
import React, { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceBoot } from "../../src/WorkspaceBoot";
import { WorkspaceStartupModel } from "../../src/workspace-startup";
import type { WorkspaceDevConnection } from "../../src/workspace-dev-rpc";
import { makeT, normalizeLocale } from "../../src/i18n";
import "../../src/workspace-theme.css";
import "../../src/workspace-entry.css";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Synthetic localhost development fixture only");
const params = new URLSearchParams(location.search), t = makeT(normalizeLocale(params.get("locale")) ?? "en");
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
let calls = 0, fail: (() => void) | null = null;
const model = new WorkspaceStartupModel(async () => {
  if (++calls === 1) throw "Cannot start Workspace Core";
  return new Promise<WorkspaceDevConnection>((_resolve, reject) => { fail = () => { fail = null;reject("Workspace Core startup failed; original data preserved"); }; });
}, { client() { throw new Error("This fixture must not open sockets"); } });
(window as any).__HARA_BOOT_FIXTURE__ = { model, calls: () => calls, fail: () => fail?.() };
function Preview() {
  const view = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => { void model.start();return () => model.stop(); }, []);
  return <WorkspaceBoot view={view} t={t} mode="workspace" onReconnect={() => void model.start()} />;
}
createRoot(document.getElementById("root")!).render(<Preview />);
