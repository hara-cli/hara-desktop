import type {
  ArtifactExportReceipt,
  ArtifactValidationReport,
  PresentationArtifactDetails,
  PresentationExportFormat,
} from "./client";
import "./PresentationWorkbench.css";

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
}

interface PresentationWorkbenchProps {
  details: PresentationArtifactDetails;
  previewHtml: string | null;
  copy: PresentationWorkbenchCopy;
  loading: boolean;
  verifying: boolean;
  exporting: boolean;
  openingBrowser: boolean;
  validationReport: ArtifactValidationReport | null;
  exportReceipt: ArtifactExportReceipt | null;
  onVerify: () => void;
  onExport: (format: PresentationExportFormat) => void;
  onOpenBrowser: () => void;
  onImportAnother: () => void;
}

function shortRevision(value: string): string {
  return value.slice(-8).toUpperCase();
}

export default function PresentationWorkbench({
  details,
  previewHtml,
  copy,
  loading,
  verifying,
  exporting,
  openingBrowser,
  validationReport,
  exportReceipt,
  onVerify,
  onExport,
  onOpenBrowser,
  onImportAnother,
}: PresentationWorkbenchProps) {
  const revisionId = details.currentRevision.revisionId;
  const validated = validationReport?.revisionId === revisionId
    && validationReport.snapshotDigest === details.content.sha256
    && validationReport.status === "pass";
  return (
    <section className="presentation-workbench" aria-label={copy.presenter}>
      <header className="presentation-workbench-bar">
        <div className="presentation-workbench-title">
          <span><i />{copy.presenter} / {copy.exactPreview}</span>
          <strong title={details.project.title}>{details.project.title}</strong>
        </div>
        <div className="presentation-workbench-meta" aria-label={copy.slides}>
          <span>{details.project.slides.length} {copy.slides}</span>
          <span>{shortRevision(revisionId)}</span>
          <span>{copy.local}</span>
        </div>
        <div className="presentation-workbench-actions">
          <button type="button" className="presentation-quiet" disabled={loading || exporting} onClick={onImportAnother}>
            {copy.importAnother}
          </button>
          <button type="button" className="presentation-browser" disabled={openingBrowser || loading} onClick={onOpenBrowser}>
            <span aria-hidden>↗</span>{openingBrowser ? copy.loading : copy.openBrowser}
          </button>
        </div>
      </header>

      <div className="presentation-stage">
        {previewHtml ? (
          <iframe
            key={revisionId}
            className="presentation-presenter-frame"
            srcDoc={previewHtml}
            title={`${details.project.title} · ${copy.exactPreview}`}
            sandbox="allow-scripts allow-modals"
            allow="fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="presentation-preview-loading" role="status">
            <i />
            <span>{copy.loading}</span>
          </div>
        )}
      </div>

      <footer className="presentation-export-bar">
        <div className="presentation-proof">
          <button
            type="button"
            className={validated ? "is-verified" : ""}
            disabled={verifying || exporting || loading}
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
          <button type="button" disabled={exporting || loading} onClick={() => onExport("json")}>
            {copy.exportJson}
          </button>
          <button type="button" disabled={exporting || loading} onClick={() => onExport("html")}>
            {copy.exportHtml}
          </button>
          <button type="button" className="is-primary" disabled={exporting || loading} onClick={() => onExport("pptx")}>
            <span aria-hidden>{exporting ? "◌" : "⇩"}</span>
            {exporting ? copy.exporting : copy.exportPptx}
          </button>
        </div>
      </footer>
    </section>
  );
}
