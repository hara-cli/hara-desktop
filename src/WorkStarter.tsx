import { useMemo, useRef, useState } from "react";
import {
  IconDocument,
  IconFolder,
  IconPresentation,
  IconSpreadsheet,
  IconSummary,
} from "./icons";
import type { Locale } from "./i18n";
import { buildWorkPrompt, type WorkKind } from "./work-starter-prompt";

interface WorkStarterProps {
  locale: Locale;
  busy: boolean;
  onStart: (prompt: string) => Promise<void>;
  onOpenProject: () => void;
}

interface WorkTemplate {
  id: Exclude<WorkKind, "general">;
  title: string;
  description: string;
  output: string;
  Icon: typeof IconPresentation;
}

const COPY = {
  en: {
    eyebrow: "Hara workbench",
    title: "What do you want to finish today?",
    hint: "Describe the outcome in plain language. Hara will organize the brief and acceptance checks before it starts changing files.",
    placeholder: "For example: organize this week's customer feedback and give me the three actions we should take next…",
    start: "Start working",
    starting: "Preparing the task…",
    general: "General task",
    describe: "Describe the result you want Hara to complete",
    resetKind: "Use a general task instead",
    shortcut: "⌘ / Ctrl + Enter",
    choose: "Or start with a common job",
    files: "Work from existing files",
    filesHint: "Open a folder when the job depends on documents, sheets, images, or company material.",
    presentation: "Create a presentation",
    presentationDesc: "Audience, key takeaway, story, visual review",
    presentationOutput: "Request: PPTX · PDF",
    spreadsheet: "Organize a spreadsheet",
    spreadsheetDesc: "Clean, summarize, chart, and validate",
    spreadsheetOutput: "Request: XLSX · CSV",
    document: "Write a document",
    documentDesc: "Reports, proposals, notices, and minutes",
    documentOutput: "Request: DOCX · PDF",
    summary: "Make sense of files",
    summaryDesc: "Extract conclusions, evidence, and next actions",
    summaryOutput: "Request: summary · checklist",
    capabilityHint: "Each task asks Hara to verify the installed capability before promising a file export.",
  },
  zh: {
    eyebrow: "Hara 工作台",
    title: "今天想完成什么？",
    hint: "像交代同事一样说明结果。Hara 会先整理任务简报和验收条件，再开始修改文件。",
    placeholder: "例如：整理本周客户反馈，归纳出最重要的三个问题和下一步建议……",
    start: "开始工作",
    starting: "正在准备任务……",
    general: "通用任务",
    describe: "描述希望 Hara 完成的结果",
    resetKind: "切回通用任务",
    shortcut: "⌘ / Ctrl + Enter",
    choose: "也可以从常用工作开始",
    files: "从现有文件开始",
    filesHint: "需要处理文档、表格、图片或公司资料时，先打开它们所在的文件夹。",
    presentation: "做演示文稿",
    presentationDesc: "先定受众、主结论、叙事和视觉把关",
    presentationOutput: "期望格式：PPTX · PDF",
    spreadsheet: "整理表格",
    spreadsheetDesc: "清洗、汇总、图表与结果校验",
    spreadsheetOutput: "期望格式：XLSX · CSV",
    document: "写一份文档",
    documentDesc: "报告、方案、通知与会议纪要",
    documentOutput: "期望格式：DOCX · PDF",
    summary: "整理资料",
    summaryDesc: "从文件中提炼结论、证据和待办",
    summaryOutput: "期望格式：摘要 · 清单",
    capabilityHint: "任务会先要求 Hara 检查已安装能力，再承诺文件导出。",
  },
} as const;

export function WorkStarter({ locale, busy, onStart, onOpenProject }: WorkStarterProps) {
  const copy = COPY[locale];
  const [kind, setKind] = useState<WorkKind>("general");
  const [brief, setBrief] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const templates = useMemo<WorkTemplate[]>(
    () => [
      {
        id: "presentation",
        title: copy.presentation,
        description: copy.presentationDesc,
        output: copy.presentationOutput,
        Icon: IconPresentation,
      },
      {
        id: "spreadsheet",
        title: copy.spreadsheet,
        description: copy.spreadsheetDesc,
        output: copy.spreadsheetOutput,
        Icon: IconSpreadsheet,
      },
      {
        id: "document",
        title: copy.document,
        description: copy.documentDesc,
        output: copy.documentOutput,
        Icon: IconDocument,
      },
      {
        id: "summary",
        title: copy.summary,
        description: copy.summaryDesc,
        output: copy.summaryOutput,
        Icon: IconSummary,
      },
    ],
    [copy],
  );

  const submit = async () => {
    if (busy || !brief.trim()) return;
    await onStart(buildWorkPrompt(kind, brief, locale));
  };

  return (
    <section className="workstarter" aria-labelledby="workstarter-title">
      <div className="workstarter-head">
        <div className="workstarter-eyebrow">
          <span aria-hidden />
          {copy.eyebrow}
        </div>
        <h1 id="workstarter-title">{copy.title}</h1>
        <p>{copy.hint}</p>
      </div>

      <div className="workstarter-compose">
        <textarea
          ref={textareaRef}
          aria-label={copy.describe}
          value={brief}
          placeholder={copy.placeholder}
          disabled={busy}
          onChange={(event) => setBrief(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="workstarter-compose-foot">
          {kind === "general" ? (
            <span className="workstarter-selected">{copy.general}</span>
          ) : (
            <button
              type="button"
              className="workstarter-selected workstarter-kind-reset"
              title={copy.resetKind}
              onClick={() => setKind("general")}
            >
              {templates.find((template) => template.id === kind)?.title} ×
            </button>
          )}
          <span className="workstarter-shortcut" aria-hidden>{copy.shortcut}</span>
          <button type="button" disabled={busy || !brief.trim()} onClick={() => void submit()}>
            {busy ? copy.starting : copy.start}
          </button>
        </div>
      </div>

      <div id="workstarter-common-jobs" className="workstarter-label">{copy.choose}</div>
      <div className="workstarter-grid" role="group" aria-labelledby="workstarter-common-jobs">
        {templates.map(({ id, title, description, output, Icon }, index) => (
          <button
            type="button"
            key={id}
            className={`workstarter-card ${kind === id ? "on" : ""}`}
            aria-pressed={kind === id}
            onClick={() => {
              setKind(id);
              textareaRef.current?.focus();
            }}
          >
            <span className="workstarter-card-index" aria-hidden>0{index + 1}</span>
            <Icon size={21} />
            <span className="workstarter-card-copy">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <span className="workstarter-card-output">{output}</span>
          </button>
        ))}
      </div>
      <p className="workstarter-capability-hint">{copy.capabilityHint}</p>

      <button type="button" className="workstarter-files" onClick={onOpenProject}>
        <IconFolder size={18} />
        <span>
          <strong>{copy.files}</strong>
          <small>{copy.filesHint}</small>
        </span>
        <b aria-hidden>→</b>
      </button>
    </section>
  );
}
