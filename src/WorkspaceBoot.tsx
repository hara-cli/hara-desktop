import HaraLogo from "./mark";
import type { makeT, Key } from "./i18n";
import type { WorkspaceStartupView } from "./workspace-startup";
const DIAGNOSTIC_COPY: Record<string, Key> = {
  CORE_SIDECAR_UNAVAILABLE: "ws.boot.sidecarUnavailable", CORE_START_FAILED: "ws.boot.startFailed", CORE_EXITED: "ws.boot.coreExited",
  CORE_START_PENDING: "ws.boot.startPending", CORE_DISCOVERY_REFUSED: "ws.boot.attachmentRefused", CORE_ATTACHMENT_REFUSED: "ws.boot.attachmentRefused",
  CORE_HANDSHAKE_FAILED: "ws.boot.handshakeFailed", WORKSPACE_LOAD_FAILED: "ws.boot.loadFailed",
};

export function WorkspaceBoot({ view, t, mode, onReconnect }: { view: WorkspaceStartupView; t: ReturnType<typeof makeT>; mode: "workspace" | "lab"; onReconnect(): void }) {
  const busy = ["connecting", "handshake", "loading"].includes(view.phase);
  const stage = view.phase === "handshake" ? "ws.boot.handshake" : view.phase === "loading" ? "ws.boot.opening" : busy ? "ws.boot.connecting"
    : mode === "lab" ? "ws.boot.labFailed" : DIAGNOSTIC_COPY[view.diagnostic ?? ""] ?? "ws.boot.failed";
  return <div className="hs wsd-boot" aria-labelledby="workspace-boot-title" aria-busy={busy}>
    <HaraLogo size={48} /><h1 id="workspace-boot-title">{mode === "lab" ? "Hara Workspace Lab" : "Hara"}</h1>
    <p role="status" aria-live="polite">{t(stage)}</p>
    <p className="wsd-boot-attempt">{t("ws.boot.attempt", { n: view.attempt })}{view.diagnostic ? <> · <code>{view.diagnostic}</code></> : null}</p>
    <button type="button" className="hs-btn sec" disabled={busy} aria-busy={busy} onClick={onReconnect}>{t(busy ? "ws.boot.reconnecting" : "ws.reconnect")}</button>
    <small>{t(mode === "lab" ? "ws.lab.note" : "ws.boot.retained")}</small>
  </div>;
}
