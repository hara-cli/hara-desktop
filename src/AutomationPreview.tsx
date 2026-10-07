import { useState } from "react";
import {
  AutomationSidebar,
  AutomationsPage,
  type AutomationJob,
  type AutomationRun,
  type AutomationViewId,
} from "./Automations";
import { AUTOMATION_COPY_EN } from "./automation-copy-en";
import { AppRail } from "./AppRail";
import { ModuleDockSettings, type ModuleDockLabel } from "./ModuleDockSettings";
import { SettingsCard, SettingsItem, SettingsNotice, SettingsPage } from "./SettingsUI";
import { makeT } from "./i18n";
import {
  CORE_NAVIGATION_CONTRIBUTIONS,
  availableNavigation,
  moveNavigation,
  parseNavigationPreferences,
  pluginNavigationContributions,
  resetNavigationPreferences,
  visibleNavigation,
  withNavigationVisibility,
} from "./navigation";
import { THEME_PREFERENCES, type ThemePreference } from "./theme";

const previewJobs: AutomationJob[] = [
  {
    id: "weekly-project-review",
    name: "每周项目复盘",
    task: "汇总本周进展、风险和下周重点。",
    cwd: "/Users/demo/work/hara",
    workspaceLabel: "hara",
    enabled: true,
    schedule: { kind: "weekly", label: "每周五 18:00" },
    nextRunAt: "2026-09-04T10:00:00.000Z",
    lastRunAt: "2026-08-28T10:00:00.000Z",
    lastStatus: "ok",
  },
  {
    id: "invoice-check",
    name: "检查待同步发票",
    task: "核对财务台账与待同步发票，列出需要人工确认的项目。",
    cwd: "/Users/demo/work/finance",
    workspaceLabel: "finance",
    enabled: true,
    schedule: { kind: "daily", label: "每天 09:00" },
    nextRunAt: "2026-09-02T01:00:00.000Z",
    lastRunAt: "2026-09-01T01:00:00.000Z",
    lastStatus: "ok",
    lastSkippedAt: "2026-09-02T01:00:00.000Z",
    lastSkipCode: "delivery_configuration_required",
    lastSkipReason: "飞书投递尚未配置；配置恢复后会补跑这次到期任务。",
  },
];

const previewRuns: AutomationRun[] = [
  {
    id: "run-weekly-project-review",
    jobId: "weekly-project-review",
    status: "ok",
    summary: "复盘已生成并保存在 Hara。",
    startedAt: "2026-08-28T10:00:00.000Z",
    durationMs: 18_400,
  },
];

function AutomationBoardPreview({ locale }: { locale: "en" | "zh" }) {
  const [view, setView] = useState<AutomationViewId>("tasks");
  const copy = locale === "en" ? AUTOMATION_COPY_EN : undefined;
  const scheduler = {
    installed: true,
    supported: true,
    healthy: true,
    status: "ready",
    detail: "The local scheduler is installed and healthy.",
    lastTickAt: "2026-09-01T08:00:00.000Z",
  } as const;

  return (
    <div className="app">
      <nav className="rail" aria-label="Preview navigation">
        <button type="button" aria-label="Chat">○</button>
        <button type="button" className="on" aria-label="Automations">◇</button>
        <span className="railgap" />
      </nav>
      <aside className="sidebar automation-sidebar-shell">
        <div className="brand">Hara <span className="ver">visual QA</span></div>
        <AutomationSidebar
          copy={copy}
          jobs={previewJobs}
          sessions={previewRuns}
          scheduler={scheduler}
          view={view}
          onViewChange={setView}
        />
        <div className="foot">Engine preview</div>
      </aside>
      <main className="chat board automation-board">
        <AutomationsPage
          copy={copy}
          jobs={previewJobs}
          sessions={previewRuns}
          scheduler={scheduler}
          view={view}
          add={() => {}}
          run={() => {}}
          toggle={() => {}}
          delete={() => {}}
        />
      </main>
    </div>
  );
}

interface AutomationPreviewProps {
  locale: "en" | "zh";
  layout?: "settings";
  section?: "appearance";
  sidebarExpanded?: boolean;
}

function AutomationSettingsPreview({
  locale: initialLocale,
  section: initialSection,
  sidebarExpanded = false,
}: AutomationPreviewProps) {
  const [locale, setLocale] = useState(initialLocale);
  const [section, setSection] = useState<"automations" | "appearance">(initialSection ?? "automations");
  const [view, setView] = useState<AutomationViewId>("tasks");
  const [sidebarOpen, setSidebarOpen] = useState(sidebarExpanded);
  const [preferences, setPreferences] = useState(() => parseNavigationPreferences(null));
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [replay, setReplay] = useState<AutomationRun | null>(null);
  const [previewAction, setPreviewAction] = useState(false);
  const t = makeT(locale);
  const copy = locale === "en" ? AUTOMATION_COPY_EN : undefined;
  const scheduler = { installed: true, supported: true, healthy: true, status: "ready" } as const;
  const jobs = locale === "en" ? previewJobs.map((job) => ({
    ...job,
    name: job.id === "weekly-project-review" ? "Weekly project review" : "Check invoices awaiting sync",
    task: job.id === "weekly-project-review"
      ? "Summarize this week's progress, risks, and priorities for next week."
      : "Check the finance ledger and list invoices needing human review.",
    schedule: { kind: job.id === "weekly-project-review" ? "weekly" : "daily",
      label: job.id === "weekly-project-review" ? "Fridays at 18:00" : "Daily at 09:00" },
    lastSkipReason: job.lastSkipReason ? "Feishu delivery is not configured. This due run will retry when delivery is ready." : undefined,
  })) : previewJobs;
  const runs = locale === "en" ? previewRuns.map((run) => ({ ...run, summary: "The review was saved in Hara." })) : previewRuns;
  const pluginContributions = pluginNavigationContributions([{
    plugin: "visual-preview", panelId: "reports", icon: "office",
    title: locale === "en" ? "Reports" : "报告工作区",
    description: locale === "en" ? "A sample enabled extension for this visual preview." : "用于视觉测试的已启用扩展示例。",
  }]);
  const contributions = [...availableNavigation(CORE_NAVIGATION_CONTRIBUTIONS, {
    hasOrganizationWorkspace: false,
  }), ...pluginContributions];
  const labels: Record<string, ModuleDockLabel> = {
    "core.chat": { title: t("zoneWorkbench"), description: t("moduleChatDescription") },
    "core.tasks": { title: t("zoneAuto"), description: t("moduleTasksDescription") },
    ...Object.fromEntries(pluginContributions.map((item) => [item.id, {
      title: item.title, description: item.description,
    }])),
  };
  const simulateAction = () => { setPreviewAction(true); };
  const railItems = visibleNavigation(contributions, preferences).map((item) => ({
    id: item.id, label: labels[item.id]?.title ?? item.id, icon: item.icon, active: false,
  }));

  return (
    <div className="app">
      <AppRail
        activePlace="settings" items={railItems} updateAvailable=""
        labels={{ mainNavigation: t("mainNavigation"), settings: t("zoneSettings"), updateAvailable: t("updateAvail") }}
        onSelect={(id) => {
          if (id === "core.tasks") setSection("automations");
          else simulateAction();
        }}
        onIntent={() => {}} onSelectSettings={() => setSection("automations")} onIntentSettings={() => {}}
      />
      <aside className="sidebar">
        <div className="brand">Hara <span className="ver">visual QA</span></div>
        <nav className="sessions setlist" aria-label={t("settingsNavigation")}>
          <div className="setnav-group" role="group" aria-labelledby="preview-settings-general">
            <div className="setnav-label" id="preview-settings-general">{t("settingsGroupGeneral")}</div>
            {(["automations", "appearance"] as const).map((item) => (
              <button key={item} type="button" className={`setnav ${section === item ? "on" : ""}`}
                aria-current={section === item ? "page" : undefined}
                onClick={() => { setSection(item); setReplay(null); }}>
                {t(item === "automations" ? "setAutomations" : "setLang")}
              </button>
            ))}
          </div>
        </nav>
        <div className="foot">{locale === "en" ? "Local visual preview" : "本地视觉预览"}</div>
      </aside>
      <div className="chat board automation-board">
        <div className="scroll boardpad setstage">
          <SettingsNotice title={locale === "en" ? "Visual preview · simulated data" : "视觉测试 · 模拟数据"}>
            {previewAction
              ? (locale === "en" ? "This action was simulated. No schedule, session, or setting was changed." : "已模拟此操作，没有修改实际定时计划、会话或设置。")
              : (locale === "en" ? "Controls affect this preview only. Nothing is sent, scheduled, or saved to your Hara settings." : "控件仅影响当前预览；不会发送消息、运行调度器或保存到 Hara 设置。")}
          </SettingsNotice>
          {section === "automations" ? (
            <SettingsPage id="settings-automations-title" eyebrow={t("settingsSystem")}
              title={t("setAutomations")} description={t("automationSettingsDescription")}>
              {replay ? (
                <div className="automation-replay-surface">
                  <div className="anchor">
                    <button className="linky" onClick={() => setReplay(null)}>{t("backToBoard")}</button>
                    <b className="rotitle">{jobs.find((job) => job.id === replay.jobId)?.name}</b>
                    <span className="robadge">{t("readonlyAuto")}</span>
                    <button className="paneltab" onClick={simulateAction}>⑂ {t("forkFromHere")}</button>
                  </div>
                  <div className="scroll">
                    <div className="msg user ro">{jobs.find((job) => job.id === replay.jobId)?.task}</div>
                    <div className="msg assistant">{replay.summary}</div>
                  </div>
                </div>
              ) : (
                <>
                  <AutomationSidebar compact copy={copy} jobs={jobs} sessions={runs} scheduler={scheduler}
                    view={view} onViewChange={setView} />
                  <AutomationsPage key={view} copy={copy} jobs={jobs} sessions={runs} scheduler={scheduler}
                    view={view} add={simulateAction} update={simulateAction} run={simulateAction}
                    toggle={simulateAction} delete={simulateAction} install={simulateAction}
                    openReplay={(run) => setReplay(run)} />
                </>
              )}
            </SettingsPage>
          ) : (
            <SettingsPage id="settings-language-title" eyebrow={t("settingsSystem")}
              title={t("setLang")} description={t("languageDescription")}>
              <SettingsCard title={t("appearanceTheme")} description={t("appearanceThemeHint")}>
                <SettingsItem title={t("appearanceThemeChoice")}>
                  <div className="theme-choice" role="radiogroup" aria-label={t("appearanceThemeChoice")}>
                    {THEME_PREFERENCES.map((preference) => (
                      <button type="button" key={preference} role="radio"
                        className={`theme-option ${theme === preference ? "is-selected" : ""}`}
                        aria-checked={theme === preference} onClick={() => setTheme(preference)}>
                        <span className={`theme-preview ${preference}`} aria-hidden="true">
                          <span className="theme-preview-rail" />
                          <span className="theme-preview-stage"><span className="theme-preview-line" /><span className="theme-preview-card" /></span>
                        </span>
                        <span className="theme-option-copy">
                          <strong>{t(preference === "system" ? "themeSystem" : preference === "light" ? "themeLight" : "themeDark")}</strong>
                          <small>{t(preference === "system" ? "themeSystemHint" : preference === "light" ? "themeLightHint" : "themeDarkHint")}</small>
                        </span>
                        <span className="theme-option-check" aria-hidden="true">✓</span>
                      </button>
                    ))}
                  </div>
                </SettingsItem>
              </SettingsCard>
              <SettingsCard title={t("displayLanguage")} description={t("displayLanguageHint")}>
                <SettingsItem title={t("languageChoice")}>
                  <div className="settings-choice">
                    {(["zh", "en"] as const).map((language) => (
                      <button key={language} type="button" className={locale === language ? "" : "ghost"}
                        aria-pressed={locale === language} onClick={() => setLocale(language)}>
                        {language === "zh" ? "中文" : "English"}
                      </button>
                    ))}
                  </div>
                </SettingsItem>
              </SettingsCard>
              <details className="settings-sidebar-advanced" open={sidebarOpen}
                onToggle={(event) => setSidebarOpen(event.currentTarget.open)}>
                <summary><strong>{t("setModules")}</strong><span>{t("moduleDockAdvancedHint")}</span></summary>
                <ModuleDockSettings embedded contributions={contributions} preferences={preferences} labels={labels}
                  copy={{
                    eyebrow: t("settingsPersonalize"), title: t("setModules"), description: t("moduleDockDescription"),
                    cardTitle: t("moduleDockCardTitle"), cardDescription: t("moduleDockCardDescription"),
                    visible: t("moduleVisible"), hidden: t("moduleHidden"), show: t("showModule"), hide: t("hideModule"),
                    moveUp: t("moveModuleUp"), moveDown: t("moveModuleDown"), fixed: t("moduleWorkbenchFixed"),
                    reset: t("moduleDockReset"), fixedTitle: t("moduleSettingsFixed"), fixedDescription: t("moduleSettingsFixedHint"),
                  }}
                  onVisibilityChange={(id, visible) => setPreferences((current) => withNavigationVisibility(contributions, current, id, visible))}
                  onMove={(id, direction) => setPreferences((current) => moveNavigation(contributions, current, id, direction))}
                  onReset={() => setPreferences((current) => resetNavigationPreferences(contributions, current))} />
              </details>
            </SettingsPage>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AutomationPreview(props: AutomationPreviewProps) {
  return props.layout === "settings" ? <AutomationSettingsPreview {...props} /> : <AutomationBoardPreview locale={props.locale} />;
}
