import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  ArtifactExportReceipt,
  ArtifactValidationReport,
  PresentationArtifactDetails,
  PresentationBlock,
  PresentationExportFormat,
  PresentationProject,
  PresentationSlide,
} from "./client";
import { OfficeEditorShell } from "./OfficeEditorShell";
import "./PresentationWorkbench.css";

const BLOCK_TYPES = [
  "heading", "text", "list", "metric", "table", "chart", "quote", "callout",
  "compare", "timeline", "flow", "diagram", "columns", "group", "image",
] as const;

const STRING_BLOCKS = new Set(["heading", "text", "quote", "callout"]);
let editorIdSequence = 0;

export interface PresentationWorkbenchCopy {
  presenter: string;
  exactPreview: string;
  loading: string;
  openBrowser: string;
  verify: string;
  verifying: string;
  verified: string;
  exportPptx: string;
  exportHtml: string;
  exportJson: string;
  exporting: string;
  importAnother: string;
  slides: string;
  local: string;
  browserPrint: string;
  noOverwrite: string;
  receipt: string;
  edit: string;
  present: string;
  save: string;
  saving: string;
  saved: string;
  unsaved: string;
  addSlide: string;
  duplicateSlide: string;
  deleteSlide: string;
  moveUp: string;
  moveDown: string;
  deckTitle: string;
  takeaway: string;
  claim: string;
  notes: string;
  inspector: string;
  blocks: string;
  addBlock: string;
  deleteBlock: string;
  blockType: string;
  content: string;
  applyJson: string;
  invalidJson: string;
  previewError: string;
}

interface PresentationWorkbenchProps {
  details: PresentationArtifactDetails;
  previewHtml: string | null;
  copy: PresentationWorkbenchCopy;
  loading: boolean;
  saving: boolean;
  verifying: boolean;
  exporting: boolean;
  openingBrowser: boolean;
  validationReport: ArtifactValidationReport | null;
  exportReceipt: ArtifactExportReceipt | null;
  onRenderDraft: (project: PresentationProject) => Promise<string>;
  onSave: (project: PresentationProject) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onVerify: () => void;
  onExport: (format: PresentationExportFormat) => void;
  onOpenBrowser: () => void;
  onImportAnother: () => void;
}

function cloneProject(project: PresentationProject): PresentationProject {
  return JSON.parse(JSON.stringify(project)) as PresentationProject;
}

function nextId(prefix: string): string {
  editorIdSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${editorIdSequence.toString(36)}`;
}

function defaultLiteral(type: string): unknown {
  if (STRING_BLOCKS.has(type)) return "New content";
  if (type === "list") return ["First point", "Second point"];
  if (type === "metric") return { label: "Metric", value: 0 };
  if (type === "table") return { headers: ["Column"], rows: [["Value"]] };
  if (type === "chart") return { values: [1, 2, 3] };
  if (type === "compare") return { left: "Before", right: "After" };
  if (type === "timeline" || type === "flow") return { items: ["First", "Next"] };
  if (type === "image") return { alt: "Image placeholder" };
  return { items: ["Content"] };
}

function shortRevision(value: string): string {
  return value.slice(-8).toUpperCase();
}

export default function PresentationWorkbench({
  details,
  previewHtml,
  copy,
  loading,
  saving,
  verifying,
  exporting,
  openingBrowser,
  validationReport,
  exportReceipt,
  onRenderDraft,
  onSave,
  onDirtyChange,
  onVerify,
  onExport,
  onOpenBrowser,
  onImportAnother,
}: PresentationWorkbenchProps) {
  const revisionId = details.currentRevision.revisionId;
  const [draft, setDraft] = useState<PresentationProject>(() => cloneProject(details.project));
  const [selectedSlideId, setSelectedSlideId] = useState(details.project.slides[0]?.id ?? "");
  const [selectedBlockId, setSelectedBlockId] = useState(details.project.slides[0]?.blocks[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "present">("edit");
  const [livePreview, setLivePreview] = useState<string | null>(previewHtml);
  const [rendering, setRendering] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [literalText, setLiteralText] = useState("");
  const [literalError, setLiteralError] = useState("");
  const renderSequenceRef = useRef(0);
  const renderDraftRef = useRef(onRenderDraft);
  const dirtyChangeRef = useRef(onDirtyChange);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const selectedSlideIndex = Math.max(0, draft.slides.findIndex((slide) => slide.id === selectedSlideId));
  const selectedSlide = draft.slides[selectedSlideIndex] ?? draft.slides[0];
  const selectedBlock = selectedSlide?.blocks.find((block) => block.id === selectedBlockId)
    ?? selectedSlide?.blocks[0];
  const validated = validationReport?.revisionId === revisionId
    && validationReport.snapshotDigest === details.content.sha256
    && validationReport.status === "pass";

  useEffect(() => {
    renderDraftRef.current = onRenderDraft;
  }, [onRenderDraft]);

  useEffect(() => {
    dirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    const next = cloneProject(details.project);
    setDraft(next);
    setSelectedSlideId(next.slides[0]?.id ?? "");
    setSelectedBlockId(next.slides[0]?.blocks[0]?.id ?? "");
    setDirty(false);
    setLivePreview(previewHtml);
    setPreviewError("");
    setLiteralError("");
  }, [details.artifact.artifactId, revisionId]);

  useEffect(() => {
    if (!dirty) setLivePreview(previewHtml);
  }, [dirty, previewHtml]);

  useEffect(() => {
    dirtyChangeRef.current(dirty);
  }, [dirty]);

  useEffect(() => {
    if (!selectedBlock) {
      setLiteralText("");
      return;
    }
    if (STRING_BLOCKS.has(selectedBlock.type)) {
      setLiteralText(typeof selectedBlock.literal === "string" ? selectedBlock.literal : "");
    } else if (selectedBlock.type === "list") {
      setLiteralText(Array.isArray(selectedBlock.literal) ? selectedBlock.literal.map(String).join("\n") : "");
    } else {
      setLiteralText(JSON.stringify(selectedBlock.literal ?? {}, null, 2));
    }
    setLiteralError("");
  }, [revisionId, selectedBlock?.id, selectedBlock?.type]);

  useEffect(() => {
    if (!dirty) return;
    const sequence = ++renderSequenceRef.current;
    setRendering(true);
    const timer = window.setTimeout(() => {
      void renderDraftRef.current(draft)
        .then((html) => {
          if (sequence !== renderSequenceRef.current) return;
          setLivePreview(html);
          setPreviewError("");
        })
        .catch(() => {
          if (sequence === renderSequenceRef.current) setPreviewError(copy.previewError);
        })
        .finally(() => {
          if (sequence === renderSequenceRef.current) setRendering(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [copy.previewError, dirty, draft]);

  const showSelectedPreviewSlide = () => {
    const frame = frameRef.current;
    try {
      const slides = frame?.contentDocument?.querySelectorAll<HTMLElement>(".slide");
      if (!slides?.length) return;
      slides.forEach((slide, index) => slide.classList.toggle("is-active", index === selectedSlideIndex));
      const progress = frame?.contentDocument?.querySelector<HTMLElement>(".progress");
      progress?.style.setProperty("--progress", `${((selectedSlideIndex + 1) / slides.length) * 100}%`);
    } catch {
      // Preview navigation is cosmetic; the canonical renderer remains visible if WebView isolation changes.
    }
  };

  useEffect(showSelectedPreviewSlide, [livePreview, selectedSlideIndex]);

  const updateDraft = (next: PresentationProject) => {
    if (!dirty) dirtyChangeRef.current(true);
    setDraft(next);
    setDirty(true);
    setPreviewError("");
  };

  const updateSlide = (patch: Partial<PresentationSlide>) => {
    if (!selectedSlide) return;
    updateDraft({
      ...draft,
      slides: draft.slides.map((slide) => slide.id === selectedSlide.id ? { ...slide, ...patch } : slide),
    });
  };

  const updateBlock = (patch: Partial<PresentationBlock>) => {
    if (!selectedSlide || !selectedBlock) return;
    updateSlide({
      blocks: selectedSlide.blocks.map((block) => block.id === selectedBlock.id ? { ...block, ...patch } : block),
    });
  };

  const addSlide = () => {
    const id = nextId("slide");
    const slide: PresentationSlide = {
      id,
      claim: "State the evidence-backed claim for this slide.",
      takeawayTitle: "New slide",
      blocks: [
        { id: nextId("heading"), type: "heading", literal: "New slide" },
        { id: nextId("text"), type: "text", literal: "Add the supporting evidence and next action." },
      ],
    };
    const index = selectedSlide ? selectedSlideIndex + 1 : draft.slides.length;
    const slides = [...draft.slides];
    slides.splice(index, 0, slide);
    updateDraft({ ...draft, slides });
    setSelectedSlideId(id);
    setSelectedBlockId(slide.blocks[0].id);
  };

  const duplicateSlide = () => {
    if (!selectedSlide) return;
    const copySlide: PresentationSlide = {
      ...cloneProject({ ...draft, slides: [selectedSlide] }).slides[0],
      id: nextId("slide"),
      takeawayTitle: `${selectedSlide.takeawayTitle} · Copy`,
      blocks: selectedSlide.blocks.map((block) => ({ ...block, id: nextId(block.type) })),
    };
    const slides = [...draft.slides];
    slides.splice(selectedSlideIndex + 1, 0, copySlide);
    updateDraft({ ...draft, slides });
    setSelectedSlideId(copySlide.id);
    setSelectedBlockId(copySlide.blocks[0].id);
  };

  const deleteSlide = () => {
    if (!selectedSlide || draft.slides.length <= 1) return;
    const slides = draft.slides.filter((slide) => slide.id !== selectedSlide.id);
    const next = slides[Math.min(selectedSlideIndex, slides.length - 1)];
    updateDraft({ ...draft, slides });
    setSelectedSlideId(next.id);
    setSelectedBlockId(next.blocks[0]?.id ?? "");
  };

  const moveSlide = (direction: -1 | 1) => {
    const destination = selectedSlideIndex + direction;
    if (!selectedSlide || destination < 0 || destination >= draft.slides.length) return;
    const slides = [...draft.slides];
    [slides[selectedSlideIndex], slides[destination]] = [slides[destination], slides[selectedSlideIndex]];
    updateDraft({ ...draft, slides });
  };

  const addBlock = () => {
    if (!selectedSlide) return;
    const block: PresentationBlock = { id: nextId("text"), type: "text", literal: "New content" };
    updateSlide({ blocks: [...selectedSlide.blocks, block] });
    setSelectedBlockId(block.id);
  };

  const deleteBlock = () => {
    if (!selectedSlide || !selectedBlock || selectedSlide.blocks.length <= 1) return;
    const index = selectedSlide.blocks.findIndex((block) => block.id === selectedBlock.id);
    const blocks = selectedSlide.blocks.filter((block) => block.id !== selectedBlock.id);
    updateSlide({ blocks });
    setSelectedBlockId(blocks[Math.min(index, blocks.length - 1)]?.id ?? "");
  };

  const applyLiteral = () => {
    if (!selectedBlock || STRING_BLOCKS.has(selectedBlock.type) || selectedBlock.type === "list") return;
    try {
      updateBlock({ literal: JSON.parse(literalText) });
      setLiteralError("");
    } catch {
      setLiteralError(copy.invalidJson);
    }
  };

  const slideRail = (
    <div className="presentation-slide-rail">
      <div className="presentation-pane-heading">
        <span>{copy.slides}</span>
        <button type="button" title={copy.addSlide} aria-label={copy.addSlide} onClick={addSlide}>＋</button>
      </div>
      <div className="presentation-slide-list" role="listbox" aria-label={copy.slides}>
        {draft.slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            role="option"
            aria-selected={slide.id === selectedSlide?.id}
            className={slide.id === selectedSlide?.id ? "is-selected" : ""}
            onClick={() => {
              setSelectedSlideId(slide.id);
              setSelectedBlockId(slide.blocks[0]?.id ?? "");
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{slide.takeawayTitle}</strong>
            <small>{slide.blocks.length} {copy.blocks}</small>
          </button>
        ))}
      </div>
      <div className="presentation-slide-actions">
        <button type="button" title={copy.moveUp} aria-label={copy.moveUp} disabled={selectedSlideIndex <= 0} onClick={() => moveSlide(-1)}>↑</button>
        <button type="button" title={copy.moveDown} aria-label={copy.moveDown} disabled={selectedSlideIndex >= draft.slides.length - 1} onClick={() => moveSlide(1)}>↓</button>
        <button type="button" title={copy.duplicateSlide} aria-label={copy.duplicateSlide} onClick={duplicateSlide}>⧉</button>
        <button type="button" title={copy.deleteSlide} aria-label={copy.deleteSlide} disabled={draft.slides.length <= 1} onClick={deleteSlide}>−</button>
      </div>
    </div>
  );

  const presenter = (
    <div className="presentation-stage">
      {(rendering || loading) && <div className="presentation-render-state"><i />{copy.loading}</div>}
      {previewError && <div className="presentation-preview-error" role="alert">{previewError}</div>}
      {livePreview ? (
        <iframe
          ref={frameRef}
          key={`${revisionId}:${livePreview.length}`}
          className="presentation-presenter-frame"
          srcDoc={livePreview}
          title={`${draft.title} · ${copy.exactPreview}`}
          sandbox="allow-scripts allow-modals allow-same-origin"
          allow="fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={showSelectedPreviewSlide}
        />
      ) : (
        <div className="presentation-preview-loading" role="status"><i /><span>{copy.loading}</span></div>
      )}
    </div>
  );

  const inspector = (
    <div className="presentation-inspector">
      <div className="presentation-pane-heading"><span>{copy.inspector}</span></div>
      <label>
        <span>{copy.deckTitle}</span>
        <input value={draft.title} maxLength={500} onChange={(event) => updateDraft({ ...draft, title: event.target.value })} />
      </label>
      {selectedSlide && (
        <>
          <label>
            <span>{copy.takeaway}</span>
            <textarea value={selectedSlide.takeawayTitle} onChange={(event) => updateSlide({ takeawayTitle: event.target.value })} />
          </label>
          <label>
            <span>{copy.claim}</span>
            <textarea value={selectedSlide.claim} onChange={(event) => updateSlide({ claim: event.target.value })} />
          </label>
          <label>
            <span>{copy.notes}</span>
            <textarea value={selectedSlide.notes ?? ""} onChange={(event) => updateSlide({ notes: event.target.value })} />
          </label>
          <div className="presentation-block-heading">
            <span>{copy.blocks}</span>
            <button type="button" onClick={addBlock}>{copy.addBlock}</button>
          </div>
          <div className="presentation-block-list">
            {selectedSlide.blocks.map((block, index) => (
              <button
                key={block.id}
                type="button"
                className={block.id === selectedBlock?.id ? "is-selected" : ""}
                onClick={() => setSelectedBlockId(block.id)}
              >
                <span>{index + 1}</span><strong>{block.type}</strong>
              </button>
            ))}
          </div>
        </>
      )}
      {selectedBlock && (
        <div className="presentation-block-editor">
          <label>
            <span>{copy.blockType}</span>
            <select
              value={selectedBlock.type}
              onChange={(event) => {
                const type = event.target.value;
                updateBlock({ type, literal: defaultLiteral(type) });
                setLiteralText(STRING_BLOCKS.has(type)
                  ? String(defaultLiteral(type))
                  : type === "list"
                    ? (defaultLiteral(type) as string[]).join("\n")
                    : JSON.stringify(defaultLiteral(type), null, 2));
              }}
            >
              {BLOCK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span>{copy.content}</span>
            <textarea
              className={STRING_BLOCKS.has(selectedBlock.type) ? "" : "is-code"}
              value={literalText}
              onChange={(event) => {
                const value = event.target.value;
                setLiteralText(value);
                if (STRING_BLOCKS.has(selectedBlock.type)) updateBlock({ literal: value });
                else if (selectedBlock.type === "list") updateBlock({
                  literal: value.split("\n").map((item) => item.trim()).filter(Boolean),
                });
              }}
              onBlur={applyLiteral}
            />
          </label>
          {literalError && <p className="presentation-literal-error" role="alert">{literalError}</p>}
          <div className="presentation-block-actions">
            {!STRING_BLOCKS.has(selectedBlock.type) && selectedBlock.type !== "list" && (
              <button type="button" onClick={applyLiteral}>{copy.applyJson}</button>
            )}
            <button type="button" disabled={(selectedSlide?.blocks.length ?? 0) <= 1} onClick={deleteBlock}>
              {copy.deleteBlock}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div className="presentation-workbench-bar">
      <div className="presentation-workbench-title">
        <span><i />{copy.presenter} / {copy.exactPreview}</span>
        <strong title={draft.title}>{draft.title}</strong>
      </div>
      <div className="presentation-workbench-meta" aria-label={copy.slides}>
        <span>{draft.slides.length} {copy.slides}</span>
        <span>{shortRevision(revisionId)}</span>
        <span className={dirty ? "is-dirty" : ""}>{dirty ? copy.unsaved : copy.saved}</span>
      </div>
      <div className="presentation-workbench-actions">
        <div className="presentation-mode-switch" role="group" aria-label={copy.presenter}>
          <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}>{copy.edit}</button>
          <button type="button" className={mode === "present" ? "is-active" : ""} onClick={() => setMode("present")}>{copy.present}</button>
        </div>
        <button
          type="button"
          className="presentation-save"
          disabled={!dirty || saving || rendering || Boolean(literalError) || Boolean(previewError)}
          onClick={() => void onSave(draft).then((saved) => saved && setDirty(false))}
        >
          {saving ? copy.saving : copy.save}
        </button>
        <button type="button" className="presentation-browser" disabled={openingBrowser || loading || dirty} onClick={onOpenBrowser}>
          <span aria-hidden>↗</span>{openingBrowser ? copy.loading : copy.openBrowser}
        </button>
      </div>
    </div>
  );

  const footer = (
    <div className="presentation-export-bar">
      <div className="presentation-proof">
        <button
          type="button"
          className={validated ? "is-verified" : ""}
          disabled={verifying || exporting || loading || dirty}
          onClick={onVerify}
        >
          <span aria-hidden>{verifying ? "◌" : validated ? "✓" : "○"}</span>
          {verifying ? copy.verifying : validated ? copy.verified : copy.verify}
        </button>
        <p>{copy.browserPrint} · {copy.noOverwrite}</p>
        {exportReceipt && exportReceipt.revisionId === revisionId && (
          <small>{copy.receipt} · {exportReceipt.format.toUpperCase()} · {shortRevision(exportReceipt.receiptId)}</small>
        )}
      </div>
      <div className="presentation-export-actions" aria-busy={exporting}>
        <button type="button" disabled={exporting || loading || dirty} onClick={onImportAnother}>{copy.importAnother}</button>
        <button type="button" disabled={exporting || loading || dirty} onClick={() => onExport("json")}>{copy.exportJson}</button>
        <button type="button" disabled={exporting || loading || dirty} onClick={() => onExport("html")}>{copy.exportHtml}</button>
        <button type="button" className="is-primary" disabled={exporting || loading || dirty} onClick={() => onExport("pptx")}>
          <span aria-hidden>{exporting ? "◌" : "⇩"}</span>
          {exporting ? copy.exporting : copy.exportPptx}
        </button>
      </div>
    </div>
  );

  return (
    <OfficeEditorShell
      ariaLabel={copy.presenter}
      className={`presentation-workbench${mode === "present" ? " is-presenting" : ""}`}
      toolbar={toolbar}
      rail={slideRail}
      canvas={presenter}
      inspector={inspector}
      footer={footer}
    />
  );
}
