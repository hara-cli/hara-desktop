import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { HaraClient } from "./client";
import type { Key } from "./i18n";
import {
  CODING_EXECUTOR_PREFERENCES, createCodingSettingsController,
  type CodingExecutorPreference, type CodingSettingsView,
} from "./coding-executor-state";
import { SettingsBadge, SettingsCard, SettingsItem, SettingsNotice } from "./SettingsUI";

const LABELS: Record<CodingExecutorPreference, Key> = {
  auto: "codingExecutorAuto", opencode: "codingExecutorOpenCode", pi: "codingExecutorPi",
  codex: "codingExecutorCodex", claude: "codingExecutorClaude",
};

interface PanelProps {
  view: CodingSettingsView;
  personal: boolean;
  t: (key: Key) => string;
  onSelect: (executor: string) => void;
  onSave: () => void;
  onReload: () => void;
}

export function CodingExecutorSettingsPanel({ view, personal, t, onSelect, onSave, onReload }: PanelProps) {
  const { settings, phase } = view;
  const busy = phase === "loading" || phase === "saving";
  const locked = !personal || phase !== "ready" || !settings?.executorEditable || view.needsReload;
  return (
    <SettingsCard title={t("codingExecutorTitle")} description={t("codingExecutorDescription")}
      aside={personal && settings ? <SettingsBadge tone={settings.experimental ? "warning" : "neutral"}>
        {t(LABELS[settings.effectiveExecutor])}
      </SettingsBadge> : undefined}
    >
      {!personal ? <SettingsNotice tone="neutral" title={t("codingExecutorPersonalTitle")}>
        {t("codingExecutorPersonalHint")}
      </SettingsNotice> : phase === "loading" ? <div role="status">{t("loading")}</div>
        : phase === "unsupported" ? <SettingsNotice tone="warning" title={t("codingExecutorUnsupportedTitle")}>
          {t("codingExecutorUnsupportedHint")}
        </SettingsNotice> : <>
          {settings ? <>
            <SettingsItem title={t("codingExecutorPreference")} description={t("codingExecutorPreferenceHint")} htmlFor="coding-executor-preference">
              <select id="coding-executor-preference" value={view.draft} disabled={locked}
                onChange={(event) => onSelect(event.target.value)}>
                {CODING_EXECUTOR_PREFERENCES.map((executor) => <option key={executor} value={executor}>{t(LABELS[executor])}</option>)}
              </select>
            </SettingsItem>
            {!settings.executorEditable ? <SettingsNotice tone="neutral" title={t("codingExecutorManagedTitle")}>
              {t("codingExecutorManagedHint")}
            </SettingsNotice> : null}
            {view.draft === "pi" ? <SettingsNotice tone="warning" title={t("codingExecutorPiTitle")}>
              {t("codingExecutorPiHint")}
            </SettingsNotice> : null}
          </> : null}
          {view.message ? <SettingsNotice tone={view.message === "saved" ? "success" : "error"}
            title={t(view.message === "saved" ? "codingExecutorSaved" : view.message === "load_failed" ? "codingExecutorLoadFailed" : "codingExecutorUpdateFailed")} /> : null}
          <div className="settings-choice">
            {settings ? <button type="button" disabled={locked || view.draft === settings.executor}
              onClick={onSave}>{t(phase === "saving" ? "codingExecutorSaving" : "codingExecutorSave")}</button> : null}
            <button type="button" className="ghost" disabled={busy} onClick={onReload}>{t("codingExecutorReload")}</button>
          </div>
          <SettingsNotice tone="neutral" title={t("codingExecutorAccountsTitle")}>
            {t("codingExecutorAccountsHint")}
          </SettingsNotice>
        </>}
    </SettingsCard>
  );
}

export function CodingExecutorSettings({ client, cwd, personal, t }: {
  client: HaraClient | null; cwd?: string; personal: boolean; t: (key: Key) => string;
}) {
  const controller = useMemo(() => createCodingSettingsController(personal ? client : null, cwd), [client, cwd, personal]);
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.activate(); void controller.load(); return () => controller.dispose(); }, [controller]);
  return <CodingExecutorSettingsPanel view={view} personal={personal} t={t}
    onSelect={(executor) => { controller.select(executor); }}
    onSave={() => { void controller.save(); }} onReload={() => { void controller.load(); }} />;
}
