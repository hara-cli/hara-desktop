import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { detectLocale, makeT } from "./i18n";
const Workspace = lazy(() => import("./WorkspaceLocalDev"));
const Legacy = lazy(() => import("./LegacyDesktopEntry"));
type EntryMode = "workspace" | "lab" | "legacy";
/** Native host chooses an explicit rollback entry, never a URL/query/provider response. */
export default function WorkspaceEntry() {
  const [mode, setMode] = useState<EntryMode | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let current = true;
    void invoke<string>("workspace_entry_mode").then(value => {
      if (!["workspace", "lab", "legacy"].includes(value)) throw new Error("Unsupported entry mode");
      if (current) setMode(value as EntryMode);
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, []);
  return <WorkspaceEntryView mode={mode} failed={failed} />;
}
/** Keep the v1 surface and its lazy loading behind the same native decision. */
export function WorkspaceEntryView({ mode, failed = false }: { mode: EntryMode | null; failed?: boolean }) {
  const t = makeT(detectLocale());
  if (!mode) return <main className="wsd-boot"><h1>Hara</h1><p>{t(failed ? "ws.boot.entryFailed" : "ws.boot.opening")}</p></main>;
  return <Suspense fallback={<main className="wsd-boot">{t("ws.boot.opening")}</main>}>
    {mode === "legacy" ? <Legacy /> : <Workspace mode={mode} />}
  </Suspense>;
}
