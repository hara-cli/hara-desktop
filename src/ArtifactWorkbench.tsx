import type {
  ArtifactDetails,
  ArtifactExportReceipt,
  ArtifactKind,
  ArtifactRevision,
  ArtifactValidationReport,
} from "./client";

export interface ArtifactWorkbenchCopy {
  workbench: string;
  local: string;
  safeImport: string;
  safeImportHint: string;
  previewPending: string;
  verify: string;
  verifying: string;
  unverified: string;
  importAnother: string;
  currentVersion: string;
  fileType: string;
  size: string;
  integrity: string;
  verified: string;
  validationReport: string;
  export: string;
  exporting: string;
  exported: string;
  exportReceipt: string;
  roundtrip: string;
  noOverwrite: string;
  history: string;
  nextStage: string;
  nextStageHint: string;
  typePresentation: string;
  typeSpreadsheet: string;
  typeDocument: string;
}

interface ArtifactWorkbenchProps {
  details: ArtifactDetails;
  revisions: ArtifactRevision[];
  copy: ArtifactWorkbenchCopy;
  embedded?: boolean;
  verifying: boolean;
  exporting: boolean;
  validationReport: ArtifactValidationReport | null;
  exportReceipt: ArtifactExportReceipt | null;
  onVerify: () => void;
  onExport: () => void;
  onImportAnother: () => void;
}

const spreadsheetCells = Object.freeze(Array.from({ length: 42 }, (_, index) => index));
const presentationBars = Object.freeze([72, 54, 83, 44]);
const documentLines = Object.freeze([92, 84, 96, 68, 88, 76, 91]);

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function typeLabel(kind: ArtifactKind, copy: ArtifactWorkbenchCopy): string {
  if (kind === "presentation") return copy.typePresentation;
  if (kind === "spreadsheet") return copy.typeSpreadsheet;
  return copy.typeDocument;
}

function revisionLabel(revisionId: string): string {
  return revisionId.slice(-8).toUpperCase();
}

function ArtifactPreview({ kind }: { kind: ArtifactKind }) {
  if (kind === "presentation") {
    return (
      <div className="artifact-paper artifact-paper-presentation" aria-hidden="true">
        <div className="artifact-slide-label">HARA / 01</div>
        <div className="artifact-slide-title" />
        <div className="artifact-slide-subtitle" />
        <div className="artifact-slide-chart">
          {presentationBars.map((height, index) => (
            <span key={height} style={{ height: `${height}%`, opacity: 0.56 + index * 0.1 }} />
          ))}
        </div>
        <div className="artifact-slide-note" />
      </div>
    );
  }
  if (kind === "spreadsheet") {
    return (
      <div className="artifact-paper artifact-paper-sheet" aria-hidden="true">
        <div className="artifact-sheet-formula">fx&nbsp;&nbsp;= SUM(B4:E4)</div>
        <div className="artifact-sheet-grid">
          {spreadsheetCells.map((cell) => (
            <span
              className={cell === 10 ? "selected" : cell % 7 === 0 ? "header" : ""}
              key={cell}
            />
          ))}
        </div>
        <div className="artifact-sheet-tabs"><span>SUMMARY</span><i /></div>
      </div>
    );
  }
  return (
    <div className="artifact-paper artifact-paper-document" aria-hidden="true">
      <div className="artifact-doc-overline">HARA DOCUMENT</div>
      <div className="artifact-doc-title" />
      <div className="artifact-doc-rule" />
      {documentLines.map((width, index) => (
        <span className={index === 3 ? "artifact-doc-gap" : ""} key={`${width}-${index}`} style={{ width: `${width}%` }} />
      ))}
      <div className="artifact-doc-signoff" />
    </div>
  );
}

export function ArtifactWorkbench({
  details,
  revisions,
  copy,
  embedded = false,
  verifying,
  exporting,
  validationReport,
  exportReceipt,
  onVerify,
  onExport,
  onImportAnother,
}: ArtifactWorkbenchProps) {
  const { artifact, currentRevision, content } = details;
  const digest = `${content.sha256.slice(0, 12)}…${content.sha256.slice(-8)}`;
  const validated = validationReport?.revisionId === currentRevision.revisionId
    && validationReport.snapshotDigest === content.sha256
    && validationReport.status === "pass";
  const exported = exportReceipt?.revisionId === currentRevision.revisionId
    && exportReceipt.output.sha256 === content.sha256;
  return (
    <section className={`artifact-workbench${embedded ? " is-embedded" : ""}`} aria-label={copy.workbench}>
      <header className="artifact-workbench-head">
        <div>
          <div className="artifact-kicker">
            <span className={`artifact-kind-dot ${artifact.kind}`} />
            {copy.workbench}
            <span className="artifact-local-chip">{copy.local}</span>
          </div>
          <h1>{artifact.title}</h1>
          <p>{typeLabel(artifact.kind, copy)} · {content.extension.toUpperCase().slice(1)}</p>
        </div>
        <button className="artifact-secondary-action" type="button" onClick={onImportAnother}>
          {copy.importAnother}
        </button>
      </header>

      <div className="artifact-workbench-grid">
        <div className="artifact-preview-stage">
          <div className={`artifact-preview-halo ${artifact.kind}`} />
          <ArtifactPreview kind={artifact.kind} />
          <div className="artifact-preview-disclaimer">{copy.previewPending}</div>
          <div className="artifact-safety-note">
            <span className="artifact-safety-mark">✓</span>
            <div>
              <strong>{copy.safeImport}</strong>
              <p>{copy.safeImportHint}</p>
            </div>
          </div>
        </div>

        <aside className="artifact-inspector">
          <section>
            <div className="artifact-section-label">{copy.currentVersion}</div>
            <div className="artifact-version-card">
              <span className="artifact-version-index">01</span>
              <div>
                <strong>{revisionLabel(currentRevision.revisionId)}</strong>
                <small>{new Date(currentRevision.createdAt).toLocaleString()}</small>
              </div>
              <span className="artifact-current-mark">●</span>
            </div>
          </section>

          <dl className="artifact-facts">
            <div><dt>{copy.fileType}</dt><dd>{content.extension.toUpperCase().slice(1)}</dd></div>
            <div><dt>{copy.size}</dt><dd>{formatBytes(content.byteSize)}</dd></div>
            <div><dt>{copy.integrity}</dt><dd title={content.sha256}>{digest}</dd></div>
            <div>
              <dt>{copy.validationReport}</dt>
              <dd className={validated ? "artifact-state-pass" : "artifact-state-pending"}>
                {validated ? copy.verified : copy.unverified}
              </dd>
            </div>
          </dl>

          <div className="artifact-action-stack">
            <button
              className={`artifact-verify-action${validated ? " is-verified" : ""}`}
              type="button"
              disabled={verifying || exporting}
              onClick={onVerify}
            >
              <span>{verifying ? "◌" : validated ? "✓" : "○"}</span>
              {verifying ? copy.verifying : validated ? copy.verified : copy.verify}
            </button>
            <button
              className="artifact-export-action"
              type="button"
              disabled={verifying || exporting}
              onClick={onExport}
            >
              <span>{exporting ? "◌" : "↗"}</span>
              {exporting ? copy.exporting : copy.export}
            </button>
            <p className="artifact-export-note">{copy.noOverwrite}</p>
          </div>

          {(validated || exported) && (
            <section className="artifact-proof" aria-live="polite">
              {validated && validationReport && (
                <div>
                  <span>{copy.validationReport}</span>
                  <strong>{validationReport.reportId.slice(-8).toUpperCase()}</strong>
                  <small>{new Date(validationReport.createdAt).toLocaleString()}</small>
                </div>
              )}
              {exported && exportReceipt && (
                <div>
                  <span>{copy.exportReceipt}</span>
                  <strong>{copy.exported} · {exportReceipt.receiptId.slice(-8).toUpperCase()}</strong>
                  <small>{copy.roundtrip} · {exportReceipt.format.toUpperCase()}</small>
                </div>
              )}
            </section>
          )}

          <section className="artifact-history">
            <div className="artifact-section-label">{copy.history}</div>
            {revisions.map((revision, index) => (
              <div className="artifact-history-row" key={revision.revisionId}>
                <span>{String(revisions.length - index).padStart(2, "0")}</span>
                <div>
                  <strong>{revisionLabel(revision.revisionId)}</strong>
                  <small>{new Date(revision.createdAt).toLocaleString()}</small>
                </div>
              </div>
            ))}
          </section>

          <section className="artifact-next">
            <div className="artifact-section-label">{copy.nextStage}</div>
            <p>{copy.nextStageHint}</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
