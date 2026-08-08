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
const THEME_PRESETS = ["editorial", "midnight", "signal", "calm"] as const;
const TEMPLATE_PRESETS = ["pitch", "report", "technical", "visual"] as const;
const CHART_TYPES = ["bar", "line", "area", "pie", "doughnut"] as const;
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
  exportPdf: string;
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
  theme: string;
  themeEditorial: string;
  themeMidnight: string;
  themeSignal: string;
  themeCalm: string;
  template: string;
  templatePitch: string;
  templateReport: string;
  templateTechnical: string;
  templateVisual: string;
  takeaway: string;
  claim: string;
  notes: string;
  inspector: string;
  inspectorShow: string;
  inspectorHide: string;
  blocks: string;
  addBlock: string;
  deleteBlock: string;
  blockType: string;
  content: string;
  chooseImage: string;
  imageAlt: string;
  chartType: string;
  chartTitle: string;
  chartCategories: string;
  chartSeries: string;
  chartValues: string;
  addSeries: string;
  removeSeries: string;
  applyJson: string;
  invalidJson: string;
  previewError: string;
  layoutError: string;
}

interface PresentationWorkbenchProps {
  details: PresentationArtifactDetails;
  previewHtml: string | null;
  copy: PresentationWorkbenchCopy;
  loading: boolean;
  saving: boolean;
  verifying: boolean;
  exporting: boolean;
  validationReport: ArtifactValidationReport | null;
  exportReceipt: ArtifactExportReceipt | null;
  onRenderDraft: (project: PresentationProject) => Promise<string>;
  onSave: (project: PresentationProject) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onVerify: () => void;
  onExport: (format: PresentationExportFormat) => void;
  onOpenBrowser: () => void;
  onImportAnother: () => void;
  onChooseImage: () => Promise<string | null>;
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
  if (type === "chart") return {
    chartType: "bar",
    title: "Chart title",
    categories: ["A", "B", "C"],
    series: [{ name: "Series 1", values: [1, 2, 3] }],
  };
  if (type === "compare") return { left: "Before", right: "After" };
  if (type === "timeline" || type === "flow") return { items: ["First", "Next"] };
  if (type === "image") return { alt: "Image placeholder" };
  return { items: ["Content"] };
}

function shortRevision(value: string): string {
  return value.slice(-8).toUpperCase();
}

type EditableChart = {
  chartType: typeof CHART_TYPES[number];
  title: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
};

function objectLiteral(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function editableChart(value: unknown): EditableChart {
  const literal = objectLiteral(value);
  const rawType = String(literal.chartType ?? literal.type ?? "bar");
  const chartType = CHART_TYPES.includes(rawType as EditableChart["chartType"])
    ? rawType as EditableChart["chartType"]
    : "bar";
  const legacyValues = Array.isArray(literal.values)
    ? literal.values.map(Number).filter(Number.isFinite)
    : [];
  const rawSeries = Array.isArray(literal.series) && literal.series.length > 0
    ? literal.series
    : [{ name: literal.name ?? "Series 1", values: legacyValues }];
  const series = rawSeries.slice(0, 8).map((entry, index) => {
    const item = objectLiteral(entry);
    return {
      name: String(item.name ?? item.title ?? `Series ${index + 1}`),
      values: Array.isArray(item.values)
        ? item.values.map(Number).filter(Number.isFinite).slice(0, 32)
        : [],
    };
  });
  const rawCategories = Array.isArray(literal.categories)
    ? literal.categories
    : Array.isArray(literal.labels)
      ? literal.labels
      : [];
  const categories = rawCategories.map(String).slice(0, 32);
  const valueCount = Math.max(0, ...series.map((entry) => entry.values.length));
  return {
    chartType,
    title: String(literal.title ?? ""),
    categories: Array.from({ length: valueCount }, (_, index) => categories[index] ?? String(index + 1)),
    series: series.length > 0 ? series : [{ name: "Series 1", values: [1, 2, 3] }],
  };
}

export default function PresentationWorkbench({
  details,
  previewHtml,
  copy,
  loading,
  saving,
  verifying,
  exporting,
  validationReport,
  exportReceipt,
  onRenderDraft,
  onSave,
  onDirtyChange,
  onVerify,
  onExport,
  onOpenBrowser,
  onImportAnother,
  onChooseImage,
}: PresentationWorkbenchProps) {
  const revisionId = details.currentRevision.revisionId;
  const [draft, setDraft] = useState<PresentationProject>(() => cloneProject(details.project));
  const [selectedSlideId, setSelectedSlideId] = useState(details.project.slides[0]?.id ?? "");
  const [selectedBlockId, setSelectedBlockId] = useState(details.project.slides[0]?.blocks[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "present">("edit");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [livePreview, setLivePreview] = useState<string | null>(previewHtml);
  const [rendering, setRendering] = useState(false);
  const [layoutChecked, setLayoutChecked] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [layoutError, setLayoutError] = useState("");
  const [literalText, setLiteralText] = useState("");
  const [literalError, setLiteralError] = useState("");
  const renderSequenceRef = useRef(0);
  const renderDraftRef = useRef(onRenderDraft);
  const dirtyChangeRef = useRef(onDirtyChange);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const layoutListenerRef = useRef<{
    window: Window;
    listener: EventListener;
  } | null>(null);

  const selectedSlideIndex = Math.max(0, draft.slides.findIndex((slide) => slide.id === selectedSlideId));
  const selectedSlide = draft.slides[selectedSlideIndex] ?? draft.slides[0];
  const selectedBlock = selectedSlide?.blocks.find((block) => block.id === selectedBlockId)
    ?? selectedSlide?.blocks[0];
  const validated = validationReport?.revisionId === revisionId
    && validationReport.snapshotDigest === details.content.sha256
    && validationReport.status === "pass"
    && layoutChecked
    && !layoutError;
  const themePreset = typeof draft.theme?.preset === "string"
    && THEME_PRESETS.includes(draft.theme.preset as typeof THEME_PRESETS[number])
    ? draft.theme.preset
    : "editorial";
  const templatePreset = typeof draft.template?.preset === "string"
    && TEMPLATE_PRESETS.includes(draft.template.preset as typeof TEMPLATE_PRESETS[number])
    ? draft.template.preset
    : "pitch";
  const selectedChart = selectedBlock?.type === "chart"
    ? editableChart(selectedBlock.literal)
    : null;
  const selectedImage = selectedBlock?.type === "image"
    ? objectLiteral(selectedBlock.literal)
    : null;

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
    setLayoutError("");
    setLayoutChecked(false);
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

  const syncPreviewLayoutStatus = () => {
    try {
      const slides = [...(frameRef.current?.contentDocument?.querySelectorAll<HTMLElement>(
        ".slide[data-layout-status]",
      ) ?? [])];
      if (slides.length === 0 || slides.some((slide) => slide.dataset.layoutStatus === "pending")) {
        setLayoutChecked(false);
        return;
      }
      const failedSlides = slides.filter((slide) => slide.dataset.layoutStatus === "fail");
      setLayoutChecked(true);
      if (failedSlides.length === 0) {
        setLayoutError("");
        return;
      }
      const evidence = failedSlides.map((slide) => {
        const number = slide.dataset.slide ?? "?";
        const findings = slide.dataset.layoutFindings || "LAYOUT_CHECK_FAILED";
        return `#${number} · ${findings}`;
      }).join("; ");
      setLayoutError(`${copy.layoutError} ${evidence}`);
    } catch {
      setLayoutChecked(true);
      setLayoutError(copy.layoutError);
    }
  };

  const handlePreviewLoad = () => {
    setLayoutChecked(false);
    showSelectedPreviewSlide();
    const frameWindow = frameRef.current?.contentWindow;
    const previous = layoutListenerRef.current;
    if (previous) previous.window.removeEventListener("hara:presentation-layout", previous.listener);
    if (frameWindow) {
      const listener: EventListener = () => syncPreviewLayoutStatus();
      frameWindow.addEventListener("hara:presentation-layout", listener);
      layoutListenerRef.current = { window: frameWindow, listener };
    }
    window.setTimeout(syncPreviewLayoutStatus, 80);
  };

  useEffect(() => () => {
    const previous = layoutListenerRef.current;
    if (previous) previous.window.removeEventListener("hara:presentation-layout", previous.listener);
  }, []);

  useEffect(showSelectedPreviewSlide, [livePreview, selectedSlideIndex]);

  const updateDraft = (next: PresentationProject) => {
    if (!dirty) dirtyChangeRef.current(true);
    setDraft(next);
    setDirty(true);
    setPreviewError("");
    setLayoutError("");
    setLayoutChecked(false);
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
    if (!selectedSlide || selectedSlide.blocks.length >= 7) return;
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

  const updateChart = (next: EditableChart) => {
    updateBlock({
      literal: {
        chartType: next.chartType,
        title: next.title,
        categories: next.categories,
        series: next.series,
      },
    });
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
      {(rendering || loading || !layoutChecked) && <div className="presentation-render-state"><i />{copy.loading}</div>}
      {(previewError || layoutError) && (
        <div className="presentation-preview-error" role="alert">{previewError || layoutError}</div>
      )}
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
          onLoad={handlePreviewLoad}
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
      <label>
        <span>{copy.template}</span>
        <select
          value={templatePreset}
          onChange={(event) => updateDraft({
            ...draft,
            template: { ...(draft.template ?? {}), preset: event.target.value },
          })}
        >
          <option value="pitch">{copy.templatePitch}</option>
          <option value="report">{copy.templateReport}</option>
          <option value="technical">{copy.templateTechnical}</option>
          <option value="visual">{copy.templateVisual}</option>
        </select>
      </label>
      <label>
        <span>{copy.theme}</span>
        <select
          value={themePreset}
          onChange={(event) => updateDraft({
            ...draft,
            theme: { ...(draft.theme ?? {}), preset: event.target.value },
          })}
        >
          <option value="editorial">{copy.themeEditorial}</option>
          <option value="midnight">{copy.themeMidnight}</option>
          <option value="signal">{copy.themeSignal}</option>
          <option value="calm">{copy.themeCalm}</option>
        </select>
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
            <button type="button" disabled={selectedSlide.blocks.length >= 7} onClick={addBlock}>{copy.addBlock}</button>
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
          {selectedChart ? (
            <div className="presentation-chart-editor">
              <div className="presentation-editor-pair">
                <label>
                  <span>{copy.chartType}</span>
                  <select
                    value={selectedChart.chartType}
                    onChange={(event) => updateChart({
                      ...selectedChart,
                      chartType: event.target.value as EditableChart["chartType"],
                    })}
                  >
                    {CHART_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  <span>{copy.chartTitle}</span>
                  <input
                    value={selectedChart.title}
                    onChange={(event) => updateChart({ ...selectedChart, title: event.target.value })}
                  />
                </label>
              </div>
              <label>
                <span>{copy.chartCategories}</span>
                <textarea
                  value={selectedChart.categories.join("\n")}
                  onChange={(event) => updateChart({
                    ...selectedChart,
                    categories: event.target.value.split("\n")
                      .map((item) => item.trim()).filter(Boolean).slice(0, 12),
                  })}
                />
              </label>
              <div className="presentation-chart-series-head">
                <span>{copy.chartSeries}</span>
                <button
                  type="button"
                  disabled={selectedChart.series.length >= 6}
                  onClick={() => updateChart({
                    ...selectedChart,
                    series: [...selectedChart.series, {
                      name: `Series ${selectedChart.series.length + 1}`,
                      values: selectedChart.categories.map(() => 0),
                    }],
                  })}
                >
                  {copy.addSeries}
                </button>
              </div>
              {selectedChart.series.map((series, index) => (
                <div className="presentation-chart-series" key={`series-${index}`}>
                  <label>
                    <span>{copy.chartSeries} {index + 1}</span>
                    <input
                      value={series.name}
                      onChange={(event) => updateChart({
                        ...selectedChart,
                        series: selectedChart.series.map((item, seriesIndex) => seriesIndex === index
                          ? { ...item, name: event.target.value }
                          : item),
                      })}
                    />
                  </label>
                  <label>
                    <span>{copy.chartValues}</span>
                    <textarea
                      value={series.values.join("\n")}
                      onChange={(event) => updateChart({
                        ...selectedChart,
                        series: selectedChart.series.map((item, seriesIndex) => seriesIndex === index
                          ? {
                              ...item,
                              values: event.target.value.split(/[\n,]/u)
                                .map((itemValue) => Number(itemValue.trim()))
                                .filter(Number.isFinite)
                                .slice(0, 12),
                            }
                          : item),
                      })}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={selectedChart.series.length <= 1}
                    onClick={() => updateChart({
                      ...selectedChart,
                      series: selectedChart.series.filter((_, seriesIndex) => seriesIndex !== index),
                    })}
                  >
                    {copy.removeSeries}
                  </button>
                </div>
              ))}
            </div>
          ) : selectedImage ? (
            <div className="presentation-image-editor">
              <label>
                <span>{copy.imageAlt}</span>
                <input
                  value={typeof selectedImage.alt === "string" ? selectedImage.alt : ""}
                  onChange={(event) => updateBlock({ literal: { ...selectedImage, alt: event.target.value } })}
                />
              </label>
              {typeof selectedImage.src === "string" && selectedImage.src.startsWith("data:image/") && (
                <img src={selectedImage.src} alt="" />
              )}
              <button
                type="button"
                onClick={() => void onChooseImage().then((src) => {
                  if (src) updateBlock({ literal: { ...selectedImage, src } });
                })}
              >
                {copy.chooseImage}
              </button>
            </div>
          ) : (
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
          )}
          {literalError && <p className="presentation-literal-error" role="alert">{literalError}</p>}
          <div className="presentation-block-actions">
            {!STRING_BLOCKS.has(selectedBlock.type)
              && selectedBlock.type !== "list"
              && selectedBlock.type !== "chart"
              && selectedBlock.type !== "image" && (
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
        {mode === "edit" && (
          <button
            type="button"
            className="presentation-inspector-toggle"
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? copy.inspectorHide : copy.inspectorShow}
            onClick={() => setInspectorOpen((value) => !value)}
          >
            <span aria-hidden>▥</span>{inspectorOpen ? copy.inspectorHide : copy.inspectorShow}
          </button>
        )}
        <div className="presentation-mode-switch" role="group" aria-label={copy.presenter}>
          <button type="button" className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}>{copy.edit}</button>
          <button type="button" className={mode === "present" ? "is-active" : ""} onClick={() => setMode("present")}>{copy.present}</button>
        </div>
        <button
          type="button"
          className="presentation-save"
          disabled={!dirty || saving || rendering || !layoutChecked || Boolean(literalError) || Boolean(previewError) || Boolean(layoutError)}
          onClick={() => void onSave(draft).then((saved) => saved && setDirty(false))}
        >
          {saving ? copy.saving : copy.save}
        </button>
        <button
          type="button"
          className="presentation-browser"
          disabled={loading || dirty || !layoutChecked || Boolean(layoutError)}
          onClick={onOpenBrowser}
        >
          <span aria-hidden>▣</span>{copy.openBrowser}
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
          disabled={verifying || exporting || loading || dirty || !layoutChecked || Boolean(layoutError)}
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
        <button
          type="button"
          disabled={exporting || loading || dirty || !livePreview || !layoutChecked || Boolean(layoutError)}
          onClick={() => frameRef.current?.contentWindow?.print()}
        >
          {copy.exportPdf}
        </button>
        <button type="button" disabled={exporting || loading || dirty || !layoutChecked || Boolean(layoutError)} onClick={() => onExport("html")}>{copy.exportHtml}</button>
        <button type="button" className="is-primary" disabled={exporting || loading || dirty || !layoutChecked || Boolean(layoutError)} onClick={() => onExport("pptx")}>
          <span aria-hidden>{exporting ? "◌" : "⇩"}</span>
          {exporting ? copy.exporting : copy.exportPptx}
        </button>
      </div>
    </div>
  );

  return (
    <OfficeEditorShell
      ariaLabel={copy.presenter}
      className={`presentation-workbench${mode === "present" ? " is-presenting" : ""}${inspectorOpen ? " is-inspector-open" : " is-inspector-closed"}`}
      toolbar={toolbar}
      rail={slideRail}
      canvas={presenter}
      inspector={inspector}
      footer={footer}
    />
  );
}
