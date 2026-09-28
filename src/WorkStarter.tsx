import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import {
  IconClose,
  IconDocument,
  IconFolder,
  IconImage,
} from "./icons";
import type { Locale } from "./i18n";
import { isImeCompositionKey } from "./ime";
import {
  appendComposerAttachments,
  type ComposerAttachment,
} from "./composer-state";
import { buildWorkPrompt } from "./work-starter-prompt";

export interface WorkStarterSubmission {
  prompt: string;
  draftText: string;
  attachments: ComposerAttachment[];
}

interface WorkStarterProps {
  locale: Locale;
  busy: boolean;
  onStart: (submission: WorkStarterSubmission) => Promise<void>;
  onPickFiles: (kind: "image" | "file") => Promise<ComposerAttachment[]>;
  onPickDirectory: () => Promise<ComposerAttachment[]>;
  onPasteImages: (event: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<ComposerAttachment[]>;
  onDropPaths: (paths: string[]) => Promise<ComposerAttachment[]>;
}

const COPY = {
  en: {
    eyebrow: "Hara",
    title: "What can Hara help you get done?",
    hint: "Describe the outcome and add any useful context. Hara will choose the right capability, specialist, or coding runtime for the job.",
    placeholder: "For example: organize this week's customer feedback and give me the three actions we should take next…",
    start: "Send",
    starting: "Starting…",
    describe: "Describe the result you want Hara to complete",
    referenceLabel: "Reference material",
    image: "Images",
    file: "Files",
    folder: "Folder",
    drop: "Drop files or a folder here",
    dropping: "Add these materials to the task",
    remove: "Remove",
    shortcut: "⌘ / Ctrl + Enter",
    routing: "Hara chooses the capability. You review decisions, permissions, and results.",
    examples: [
      "Summarize customer feedback and recommend next steps",
      "Inspect a project and fix its most important issue",
      "Turn these materials into a deliverable plan",
    ],
  },
  zh: {
    eyebrow: "Hara",
    title: "想让 Hara 帮你完成什么？",
    hint: "说明想要的结果并添加必要资料。Hara 会自动选择合适的能力、专业助手或编码执行器。",
    placeholder: "例如：整理本周客户反馈，归纳出最重要的三个问题和下一步建议……",
    start: "发送",
    starting: "正在开始……",
    describe: "描述希望 Hara 完成的结果",
    referenceLabel: "参考资料",
    image: "图片",
    file: "文件",
    folder: "文件夹",
    drop: "可把图片、文件或文件夹拖到这里",
    dropping: "松开后加入本次工作",
    remove: "移除",
    shortcut: "⌘ / Ctrl + Enter",
    routing: "能力由 Hara 选择；你只需检查关键选择、权限和结果。",
    examples: [
      "整理客户反馈并给出下一步建议",
      "检查一个项目并修复最重要的问题",
      "把这些资料整理成可交付方案",
    ],
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
}: WorkStarterProps) {
  const copy = COPY[locale];
  const [brief, setBrief] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const blockedRef = useRef(false);
  const busyRef = useRef(busy);
  const onDropPathsRef = useRef(onDropPaths);
  busyRef.current = busy;
  onDropPathsRef.current = onDropPaths;
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
      prompt: buildWorkPrompt("general", brief, locale),
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
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (composingRef.current || isImeCompositionKey(event.nativeEvent)) return;
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
                    <IconClose size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="workstarter-compose-foot">
          <span className="workstarter-routing">{copy.routing}</span>
          <span className="workstarter-shortcut" aria-hidden>{copy.shortcut}</span>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? copy.starting : copy.start}
          </button>
        </div>
      </div>
      <div className="workstarter-examples" aria-label={locale === "zh" ? "示例" : "Examples"}>
        {copy.examples.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => {
              setBrief(example);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );
}
