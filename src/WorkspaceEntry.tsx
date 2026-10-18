import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
const Workspace = lazy(() => import("./WorkspaceLocalDev"));
const Legacy = lazy(() => import("./App"));
/** Native host chooses an explicit rollback entry, never a URL/query/provider response. */
export default function WorkspaceEntry() {
  const [mode, setMode] = useState<"workspace" | "lab" | "legacy" | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let current = true;
    void invoke<string>("workspace_entry_mode").then(value => {
      if (!["workspace", "lab", "legacy"].includes(value)) throw new Error("Unsupported entry mode");
      if (current) setMode(value as "workspace" | "lab" | "legacy");
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, []);
  if (!mode) return <main className="wsd-boot"><h1>Hara</h1><p>{failed ? "無法確認工作空間入口；已保留原資料，沒有切換到其他連接。" : "正在打開你的工作空間…"}</p></main>;
  return <Suspense fallback={<main className="wsd-boot">正在打開 Hara…</main>}>
    {mode === "legacy" ? <Legacy /> : <Workspace mode={mode} />}
  </Suspense>;
}
