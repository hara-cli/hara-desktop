import type { makeT } from "./i18n";
import { knownRuntimeVersionId, parseRuntimeVersionStatus, type RuntimeVersionBinding } from "./runtime-version-drift";
import "./runtime-version-drift.css";

export function WorkspaceRuntimeVersion({ runtimeId, binding, t }: {
  runtimeId?: string; binding?: RuntimeVersionBinding | null; t: ReturnType<typeof makeT>;
}) {
  if (!knownRuntimeVersionId(runtimeId) || !binding || binding.runtimeId !== runtimeId) return null;
  const status = parseRuntimeVersionStatus(binding.status);
  if (!status) return <div className="wsd-runtime-version" role="note"><strong>{t("ws.runtimeVersion.title")}</strong><p>{t("ws.runtimeVersion.invalid")}</p></div>;
  return <div className="wsd-runtime-version" role="note" data-version-change={status.change}>
    <strong>{t("ws.runtimeVersion.title")}</strong>
    <dl><div><dt>{t("ws.runtimeVersion.last")}</dt><dd>{status.lastSuccessfulVersion ?? t(status.change === "no_history" ? "ws.runtimeVersion.noSuccess" : "ws.runtimeVersion.unknownVersion")}</dd></div>
      <div><dt>{t("ws.runtimeVersion.current")}</dt><dd>{status.currentVersion ?? t("ws.runtimeVersion.unknownVersion")}</dd></div></dl>
    <p>{t(`ws.runtimeVersion.${status.change}`, { from: status.lastSuccessfulVersion ?? "", to: status.currentVersion ?? "" })}</p>
    {status.compatibility !== "unknown" ? <p>{t(`ws.runtimeVersion.${status.compatibility}`)}</p> : null}
    {status.binaryChanged ? <p>{t("ws.runtimeVersion.binaryChanged")}</p> : null}
    {status.requiresRetrust ? <p>{t("ws.runtimeVersion.retrust")}</p> : null}
  </div>;
}
