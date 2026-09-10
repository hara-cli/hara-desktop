import { useEffect, useMemo, useState } from "react";

import type {
  ComputerSettingsState,
  ComputerUseMode,
  HaraClient,
} from "./client";
import type { Key } from "./i18n";
import {
  SettingsBadge,
  SettingsCard,
  SettingsItem,
  SettingsNotice,
} from "./SettingsUI";

const MODES: ComputerUseMode[] = ["off", "read", "click", "full"];

interface ComputerUseSettingsProps {
  client: HaraClient | null;
  cwd?: string;
  restarting: boolean;
  t: (key: Key) => string;
  onRestartEngine: () => void;
  onPluginsChanged: () => void;
}

const parseApps = (value: string): string[] => value
  .split(/[\n,，]+/u)
  .map((item) => item.trim())
  .filter(Boolean);

export function ComputerUseSettings({
  client,
  cwd,
  restarting,
  t,
  onRestartEngine,
  onPluginsChanged,
}: ComputerUseSettingsProps) {
  const [settings, setSettings] = useState<ComputerSettingsState | null>(null);
  const [mode, setMode] = useState<ComputerUseMode>("off");
  const [appsText, setAppsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    if (!client) {
      setSettings(null);
      setLoading(false);
      return () => { cancelled = true; };
    }
    void client.getComputerSettings(cwd).then((next) => {
      if (cancelled) return;
      setSettings(next);
      if (next) {
        setMode(next.mode);
        setAppsText(next.apps.join("\n"));
      }
    }).catch((error: unknown) => {
      if (!cancelled) setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client, cwd]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return mode !== settings.mode
      || JSON.stringify(parseApps(appsText)) !== JSON.stringify(settings.apps);
  }, [appsText, mode, settings]);

  const save = async () => {
    if (!client || !settings || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await client.saveComputerSettings(mode, parseApps(appsText), cwd);
      setSettings(next);
      setMode(next.mode);
      setAppsText(next.apps.join("\n"));
      setMessage({ tone: "success", text: t("computerUseSaved") });
    } catch (error: unknown) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const installBrowser = async () => {
    if (!client || installing) return;
    setInstalling(true);
    setMessage(null);
    try {
      const result = await client.installCoreBrowser();
      setSettings((current) => current ? {
        ...current,
        browser: {
          installed: true,
          enabled: result.plugin.enabled,
          version: result.plugin.version,
        },
      } : current);
      setRestartRequired(result.restartRequired);
      onPluginsChanged();
    } catch (error: unknown) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section id="settings-computer-use" className="computer-use-settings" aria-label={t("computerUseTitle")}>
      <SettingsCard
        title={t("computerUseTitle")}
        description={t("computerUseDescription")}
        aside={settings ? (
          <SettingsBadge tone={settings.mode === "off" ? "warning" : "success"}>
            {t(settings.mode === "off" ? "computerUseDisabled" : "computerUseEnabled")}
          </SettingsBadge>
        ) : undefined}
      >
        {loading ? (
          <div className="computer-use-loading" role="status">{t("loading")}</div>
        ) : !settings ? (
          <SettingsNotice tone="warning" title={t("computerUseUnsupportedTitle")}>
            {t("computerUseUnsupportedHint")}
          </SettingsNotice>
        ) : (
          <>
            <SettingsItem title={t("computerUseModeTitle")} description={t("computerUseModeHint")}>
              <select
                aria-label={t("computerUseModeTitle")}
                value={mode}
                disabled={!settings.modeEditable || saving}
                onChange={(event) => setMode(event.target.value as ComputerUseMode)}
              >
                {MODES.map((candidate) => (
                  <option value={candidate} key={candidate}>
                    {t(candidate === "off"
                      ? "computerUseModeOff"
                      : candidate === "read"
                        ? "computerUseModeRead"
                        : candidate === "click"
                          ? "computerUseModeClick"
                          : "computerUseModeFull")}
                  </option>
                ))}
              </select>
            </SettingsItem>
            <SettingsItem title={t("computerUseAppsTitle")} description={t("computerUseAppsHint")}>
              <textarea
                className="computer-use-apps"
                aria-label={t("computerUseAppsTitle")}
                placeholder={t("computerUseAppsPlaceholder")}
                value={appsText}
                disabled={!settings.appsEditable || saving}
                onChange={(event) => setAppsText(event.target.value)}
                rows={3}
              />
            </SettingsItem>
            {(!settings.modeEditable || !settings.appsEditable) && (
              <SettingsNotice tone="warning" title={t("computerUseManagedTitle")}>
                {t("computerUseManagedHint")}
              </SettingsNotice>
            )}
            <SettingsItem title={t("computerUseBackendTitle")} description={t("computerUseBackendHint")}>
              <SettingsBadge>{settings.platform} · {settings.backend}</SettingsBadge>
            </SettingsItem>
            <SettingsItem title={t("computerUseBrowserTitle")} description={t("computerUseBrowserHint")}>
              <div className="computer-use-browser-action">
                <SettingsBadge tone={settings.browser.installed && settings.browser.enabled ? "success" : "warning"}>
                  {settings.browser.installed && settings.browser.enabled
                    ? `${t("computerUseBrowserReady")}${settings.browser.version ? ` · ${settings.browser.version}` : ""}`
                    : t("computerUseBrowserMissing")}
                </SettingsBadge>
                {(!settings.browser.installed || !settings.browser.enabled) && (
                  <button
                    type="button"
                    disabled={installing || !client || !client.supports("settings.computer.browser.install")}
                    onClick={() => void installBrowser()}
                  >
                    {installing ? t("computerUseBrowserInstalling") : t("computerUseBrowserInstall")}
                  </button>
                )}
              </div>
            </SettingsItem>
            <div className="computer-use-actions">
              <button type="button" disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? t("computerUseSaving") : t("computerUseSave")}
              </button>
            </div>
            {restartRequired && (
              <SettingsNotice
                tone="success"
                title={t("computerUseRestartTitle")}
                actions={(
                  <button type="button" disabled={restarting} onClick={onRestartEngine}>
                    {restarting ? t("restarting") : t("computerUseRestartAction")}
                  </button>
                )}
              >
                {t("computerUseRestartHint")}
              </SettingsNotice>
            )}
            {message && <SettingsNotice tone={message.tone} title={message.text} />}
            <SettingsNotice tone="neutral" title={t("computerUseSafetyTitle")}>
              {t("computerUseSafetyHint")}
            </SettingsNotice>
          </>
        )}
      </SettingsCard>
    </section>
  );
}
