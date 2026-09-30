import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { makeT } from "./i18n";
import { SettingsBadge, SettingsItem, SettingsNotice } from "./SettingsUI";
import { managedCliPathCommand, type CommandLineHaraStatus, type TerminalHaraStatus } from "./command-line-status";

export default function CommandLineDiagnostics({ managed, onManagedStatus, t }: {
  managed: CommandLineHaraStatus | null;
  onManagedStatus: (status: CommandLineHaraStatus) => void;
  t: ReturnType<typeof makeT>;
}) {
  const [terminal, setTerminal] = useState<TerminalHaraStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">("ready");
  const checkingRef = useRef(false);
  const refresh = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setFailed(false);
    setCopyState("ready");
    try {
      // Independent, read-only checks. Shell/version probes stay native and off the UI thread.
      const [managedResult, terminalResult] = await Promise.allSettled([
        invoke<CommandLineHaraStatus>("inspect_command_line_hara"),
        invoke<TerminalHaraStatus>("inspect_terminal_hara"),
      ]);
      if (managedResult.status === "fulfilled") onManagedStatus(managedResult.value);
      if (terminalResult.status === "fulfilled") setTerminal(terminalResult.value);
      else {
        setTerminal(null);
        setFailed(true);
      }
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [onManagedStatus]);
  // Mount only in App & updates; retry when installation/ownership changes, not on every render.
  useEffect(() => { void refresh(); }, [refresh, managed?.path, managed?.current, managed?.managed]);

  const pathCommand = managed?.installed && managed.managed && !managed.blocked
    ? managedCliPathCommand(managed.path)
    : null;
  const needsPathChange = !!terminal && !terminal.usesManagedCli;
  const copyPathCommand = async () => {
    if (!pathCommand) return;
    try {
      await navigator.clipboard.writeText(pathCommand);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return <>
    <SettingsItem
      title={t("cliTerminalTitle")}
      description={t(terminal?.pathSource === "desktopEnvironment" ? "cliTerminalEnvironmentHint" : "cliTerminalHint")}
    >
      <div className="settings-choice" aria-live="polite">
        <SettingsBadge tone={terminal?.usesManagedCli && managed?.managed ? "success" : terminal?.path ? "warning" : "neutral"}>
          {checking ? t("cliTerminalChecking") : failed ? t("cliTerminalCheckFailed") : terminal?.path
            ? `${terminal.version || t("cliTerminalUnknownVersion")} · ${t(terminal.usesManagedCli ? "cliTerminalManaged" : "cliTerminalOther")}`
            : t("cliTerminalNotFound")}
        </SettingsBadge>
        <button type="button" className="ghost" disabled={checking} onClick={() => void refresh()}>
          {t("cliTerminalRecheck")}
        </button>
      </div>
    </SettingsItem>
    {terminal?.path && <SettingsItem title={t("cliTerminalPath")}>
      <span className="settings-mono settings-update-storage-path" title={terminal.path}>{terminal.path}</span>
    </SettingsItem>}
    {needsPathChange && !checking && <SettingsNotice
      tone="warning"
      title={t(terminal.path ? "cliTerminalShadowedTitle" : "cliTerminalMissingTitle")}
      actions={pathCommand ? <button type="button" className="compact" onClick={() => void copyPathCommand()}>
        {t(copyState === "copied" ? "cliTerminalCommandCopied" : copyState === "failed" ? "cliTerminalCopyFailed" : "cliTerminalCopyCommand")}
      </button> : undefined}
    >
      {t("cliTerminalPathHint")}
      {pathCommand && <> {t("cliTerminalCommandHint")} <code>{pathCommand}</code></>}
    </SettingsNotice>}
  </>;
}
