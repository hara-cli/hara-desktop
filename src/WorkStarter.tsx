import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconDocument,
  IconFolder,
  IconImage,
  IconPresentation,
  IconSpreadsheet,
  IconSummary,
} from "./icons";
import type { Locale } from "./i18n";
import {
  appendComposerAttachments,
  type ComposerAttachment,
} from "./composer-state";
import { buildWorkPrompt, type WorkKind } from "./work-starter-prompt";

export interface WorkStarterSubmission {
  prompt: string;
  draftText: string;
  attachments: ComposerAttachment[];
}

export interface WorkbenchApp {
  id: string;
  title: string;
  description: string;
  icon: "office" | "project" | "design" | "browser" | "capability";
  source: string;
  disabled?: boolean;
}

interface WorkStarterProps {
  locale: Locale;
  busy: boolean;
  onStart: (submission: WorkStarterSubmission) => Promise<void>;
  onPickFiles: (kind: "image" | "file") => Promise<ComposerAttachment[]>;
  onPickDirectory: () => Promise<ComposerAttachment[]>;
  onPasteImages: (event: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<ComposerAttachment[]>;
  onDropPaths: (paths: string[]) => Promise<ComposerAttachment[]>;
  onOpenProject: () => void;
  apps?: WorkbenchApp[];
  onOpenApp?: (appId: string) => void;
}

interface WorkTemplate {
  id: Exclude<WorkKind, "general">;
  title: string;
  description: string;
  output: string;
  Icon: typeof IconPresentation;
}

function WorkbenchAppIcon({ icon }: { icon: WorkbenchApp["icon"] }) {
  if (icon === "office") return <IconPresentation size={19} />;
  if (icon === "project") return <IconFolder size={19} />;
  if (icon === "design") return <IconImage size={19} />;
  if (icon === "browser") return <IconSummary size={19} />;
  return <IconDocument size={19} />;
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
    referenceLabel: "Reference material",
    image: "Images",
    file: "Files",
    folder: "Folder",
    drop: "Drop files or a folder here",
    dropping: "Add these materials to the task",
    remove: "Remove",
    resetKind: "Use a general task instead",
    shortcut: "⌘ / Ctrl + Enter",
    choose: "Or start with a common job",
    apps: "Apps & extensions",
    appsHint: "Open a native work surface or a project-owned visual tool without leaving the workbench.",
    unavailable: "Open a project first",
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
    referenceLabel: "参考资料",
    image: "图片",
    file: "文件",
    folder: "文件夹",
    drop: "可把图片、文件或文件夹拖到这里",
    dropping: "松开后加入本次工作",
    remove: "移除",
    resetKind: "切回通用任务",
    shortcut: "⌘ / Ctrl + Enter",
    choose: "也可以从常用工作开始",
    apps: "应用与扩展",
    appsHint: "从总工作台直接打开原生办公区或当前项目的可视化工具。",
    unavailable: "请先打开项目",
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

export function WorkStarter({
  locale,
  busy,
  onStart,
  onPickFiles,
  onPickDirectory,
  onPasteImages,
  onDropPaths,
  onOpenProject,
  apps = [],
  onOpenApp = () => {},
}: WorkStarterProps) {
  const copy = COPY[locale];
  const [kind, setKind] = useState<WorkKind>("general");
  const [brief, setBrief] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const blockedRef = useRef(false);
  const busyRef = useRef(busy);
  const onDropPathsRef = useRef(onDropPaths);
  busyRef.current = busy;
  onDropPathsRef.current = onDropPaths;
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

  const ingest = async (loader: () => Promise<ComposerAttachment[]>) => {
    if (busyRef.current || blockedRef.current) return;
    blockedRef.current = true;
    setAttachmentBusy(true);
    try {
      const additions = await loader();
      if (additions.length) {
        setAttachments((current) => appendComposerAttachments(current, additions));
      }
    } finally {
      blockedRef.current = false;
      setAttachmentBusy(false);
    }
  };
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          if (!busyRef.current) setDragActive(true);
          return;
        }
        setDragActive(false);
        if (event.payload.type === "drop" && event.payload.paths.length) {
          const paths = event.payload.paths;
          void ingestRef.current(() => onDropPathsRef.current(paths));
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // Browser preview does not expose the native drop channel. Picker and paste actions remain usable.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const submit = async () => {
    if (busy || (!brief.trim() && attachments.length === 0)) return;
    await onStart({
      prompt: buildWorkPrompt(kind, brief, locale),
      draftText: brief.trim(),
      attachments: [...attachments],
    });
  };

  const canSubmit = !busy && (brief.trim().length > 0 || attachments.length > 0);

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

      {apps.length > 0 && (
        <section className="workstarter-apps" aria-labelledby="workstarter-apps-title">
          <div className="workstarter-section-head">
            <div>
              <span id="workstarter-apps-title">{copy.apps}</span>
              <small>{copy.appsHint}</small>
            </div>
            <b>{String(apps.length).padStart(2, "0")}</b>
          </div>
          <div className="workstarter-app-grid">
            {apps.map((app) => (
              <button
                type="button"
                key={app.id}
                disabled={app.disabled}
                title={app.disabled ? copy.unavailable : app.description}
                onClick={() => onOpenApp(app.id)}
              >
                <span className={`workstarter-app-mark is-${app.icon}`}><WorkbenchAppIcon icon={app.icon} /></span>
                <span>
                  <strong>{app.title}</strong>
                  <small>{app.description}</small>
                </span>
                <em>{app.disabled ? copy.unavailable : app.source}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className={`workstarter-compose ${dragActive ? "drop-active" : ""}`}>
        {dragActive ? (
          <div className="workstarter-drop-note" role="status">
            <IconFolder size={20} />
            <strong>{copy.dropping}</strong>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label={copy.describe}
          value={brief}
          placeholder={copy.placeholder}
          disabled={busy}
          onChange={(event) => setBrief(event.target.value)}
          onPaste={(event) => void ingest(() => onPasteImages(event))}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="workstarter-reference-bar">
          <span>{copy.referenceLabel}</span>
          <div className="workstarter-reference-actions" role="group" aria-label={copy.referenceLabel}>
            <button
              type="button"
              disabled={busy || attachmentBusy}
              onClick={() => void ingest(() => onPickFiles("image"))}
            >
              <IconImage size={14} /> {copy.image}
            </button>
            <button
              type="button"
              disabled={busy || attachmentBusy}
              onClick={() => void ingest(() => onPickFiles("file"))}
            >
              <IconDocument size={14} /> {copy.file}
            </button>
            <button
              type="button"
              disabled={busy || attachmentBusy}
              onClick={() => void ingest(onPickDirectory)}
            >
              <IconFolder size={14} /> {copy.folder}
            </button>
          </div>
          <small>{copy.drop}</small>
        </div>
        {attachments.length ? (
          <div className="workstarter-attachments" aria-live="polite">
            {attachments.map((attachment) => {
              const AttachmentIcon = attachment.kind === "image"
                ? IconImage
                : attachment.kind === "directory" ? IconFolder : IconDocument;
              return (
                <span className="workstarter-attachment" key={attachment.id}>
                  <AttachmentIcon size={13} />
                  <b>{attachment.name}</b>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${copy.remove} ${attachment.name}`}
                    onClick={() => setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id))}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
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
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
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
