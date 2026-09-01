import { useState } from "react";
import {
  AutomationSidebar,
  AutomationsPage,
  type AutomationJob,
  type AutomationRun,
  type AutomationViewId,
} from "./Automations";
import { AUTOMATION_COPY_EN } from "./automation-copy-en";

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
    lastStatus: "error",
    lastError: "连接财务台账失败",
    consecutiveErrors: 1,
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

export default function AutomationPreview({ locale }: { locale: "en" | "zh" }) {
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
