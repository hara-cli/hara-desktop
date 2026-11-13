import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ModelCombobox } from "./ModelCombobox";
import { SettingsActionResult } from "./SettingsActionDialog";
import { useWorkspaceLocale } from "./workspace-shell-hooks";
import { connectionCatalogScope, SettingsConnectionCatalog, type ConnectionCatalogDraft } from "./settings-connection-models";
import type { WorkspaceDevModel, WorkspaceDevSnapshot, WorkspaceModelConnection } from "./workspace-dev-state";

/** Settings-only use: onboarding retains the shared form's existing manual field. */
export function SettingsConnectionModelField({ model, workspace, existing, draft, value, disabled, onChange }: {
  model: WorkspaceDevModel; workspace: WorkspaceDevSnapshot; existing?: WorkspaceModelConnection; draft: ConnectionCatalogDraft;
  value: string; disabled: boolean; onChange(value: string): void;
}) {
  const { t } = useWorkspaceLocale(), id = useId(), hint = `${id}-hint`;
  const supported = model.supportsConnectionModels?.() === true;
  const scope = connectionCatalogScope(workspace, existing?.id, draft, supported, disabled);
  const latest = useRef({ model, draft, disabled, connectionId: existing?.id });
  latest.current = { model, draft, disabled, connectionId: existing?.id };
  const [controller] = useState(() => new SettingsConnectionCatalog(() => {
    const { model, draft, disabled, connectionId } = latest.current;
    return connectionCatalogScope(model.getSnapshot().workspace, connectionId, draft, model.supportsConnectionModels?.() === true, disabled);
  }, (agentId, connectionId) => { const model = latest.current.model; return model.listConnectionModels(agentId, connectionId); }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => { controller.invalidate(); return controller.invalidate; }, [controller, model, scope.key]);
  const current = state.scope === scope.key ? state : null, catalog = current?.catalog;
  const waiting = current?.phase === "loading", canList = Boolean(existing) && supported;
  const hintText = t(scope.reason === "new" ? "ws.connections.models.needsSaved" : scope.reason === "upgrade" ? "ws.connections.models.upgrade"
    : scope.reason === "sourceChanged" ? "ws.connections.models.sourceChanged" : scope.reason === "keyRequired" ? "ws.connections.models.keyRequired"
      : scope.reason === "unavailable" ? "ws.connections.models.unavailable" : "ws.connections.models.hint");
  const status = waiting ? t("ws.connections.models.loading") : current?.phase === "stale" ? t("ws.connections.models.changed")
    : catalog ? t(catalog.source === "documented" ? "ws.connections.models.documented" : "ws.connections.models.live")
      + (catalog.models.length ? "" : ` ${t("ws.connections.models.empty")}`) : "";
  return <div className="wsd-connection-models">
    <label htmlFor={id}>{t("ws.connections.model")}</label>
    {canList ? <ModelCombobox inputId={id} describedBy={hint} presentation="inline" required value={value}
      options={catalog?.models.map(row => row.id) ?? []} disabled={disabled} ariaLabel={t("ws.connections.model")}
      searchPlaceholder={t("ws.connections.models.search")} customOptionLabel={t("ws.connections.models.customOption")}
      customBadge={t("ws.connections.models.custom")} emptyLabel={t("ws.connections.models.emptyChoices")}
      describeOption={modelId => catalog?.models.find(row => row.id === modelId)?.label} onChange={onChange} />
      : <input id={id} aria-describedby={hint} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} autoComplete="off" required />}
    <small id={hint}>{hintText}</small>
    {catalog && value.trim() && !catalog.models.some(row => row.id === value.trim()) ? <small className="wsd-model-custom">{t("ws.connections.models.custom")}</small> : null}
    {canList ? <button type="button" className="wsd-model-list-read" aria-disabled={waiting || scope.reason !== "ready" || undefined}
      onClick={() => { if (!waiting && scope.reason === "ready") void controller.request(scope.key); }}>{t(waiting ? "ws.connections.models.loading" : current?.phase === "ready" || current?.phase === "failed" || current?.phase === "stale" ? "ws.connections.models.retry" : "ws.connections.models.read")}</button> : null}
    <SettingsActionResult text={current?.phase === "failed" ? t("ws.connections.models.failed") : status} error={current?.phase === "failed"} />
  </div>;
}
