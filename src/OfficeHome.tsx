import {
  IconDocument,
  IconPresentation,
  IconSpreadsheet,
} from "./icons";
import type { ArtifactKind } from "./client";

export type PresentationTemplate = "pitch" | "report" | "technical" | "visual";

interface OfficeHomeCopy {
  eyebrow: string;
  title: string;
  description: string;
  included: string;
  localFirst: string;
  importFile: string;
  newPresentation: string;
  creatingPresentation: string;
  importType: string;
  importing: string;
  templatesTitle: string;
  templatesHint: string;
  templatePitch: string;
  templatePitchHint: string;
  templateReport: string;
  templateReportHint: string;
  templateTechnical: string;
  templateTechnicalHint: string;
  templateVisual: string;
  templateVisualHint: string;
  presentation: string;
  presentationHint: string;
  presentationFormats: string;
  spreadsheet: string;
  spreadsheetHint: string;
  spreadsheetFormats: string;
  document: string;
  documentHint: string;
  documentFormats: string;
  safetyTitle: string;
  safetyHint: string;
  extensionScreen: string;
  extensionShow: string;
  extensionHide: string;
}

interface OfficeHomeProps {
  copy: OfficeHomeCopy;
  importing: boolean;
  creating: boolean;
  extensionCount: number;
  extensionVisible: boolean;
  onImport: (kind?: ArtifactKind) => void;
  onCreatePresentation: (template?: PresentationTemplate) => void;
  onToggleExtension: () => void;
}

const officeKinds = (
  copy: OfficeHomeCopy,
): {
  id: "presentation" | "spreadsheet" | "document";
  title: string;
  description: string;
  formats: string;
}[] => [
  {
    id: "presentation",
    title: copy.presentation,
    description: copy.presentationHint,
    formats: copy.presentationFormats,
  },
  {
    id: "spreadsheet",
    title: copy.spreadsheet,
    description: copy.spreadsheetHint,
    formats: copy.spreadsheetFormats,
  },
  {
    id: "document",
    title: copy.document,
    description: copy.documentHint,
    formats: copy.documentFormats,
  },
];

const presentationTemplates = (copy: OfficeHomeCopy): Array<{
  id: PresentationTemplate;
  title: string;
  description: string;
}> => [
  { id: "pitch", title: copy.templatePitch, description: copy.templatePitchHint },
  { id: "report", title: copy.templateReport, description: copy.templateReportHint },
  { id: "technical", title: copy.templateTechnical, description: copy.templateTechnicalHint },
  { id: "visual", title: copy.templateVisual, description: copy.templateVisualHint },
];

function OfficeKindIcon({
  kind,
}: {
  kind: "presentation" | "spreadsheet" | "document";
}) {
  if (kind === "presentation") return <IconPresentation size={22} />;
  if (kind === "spreadsheet") return <IconSpreadsheet size={22} />;
  return <IconDocument size={22} />;
}

/**
 * Honest entry surface for the local Office runtime. The cards describe the
 * open-core capabilities already present in Serve; they do not pretend that a
 * marketplace package or a connector is installed.
 */
export function OfficeHome({
  copy,
  importing,
  creating,
  extensionCount,
  extensionVisible,
  onImport,
  onCreatePresentation,
  onToggleExtension,
}: OfficeHomeProps) {
  return (
    <main className="office-home" aria-labelledby="office-home-title">
      <div className="office-home-grid" aria-hidden />
      <div className="office-home-shell">
        <header className="office-home-head">
          <div>
            <span className="office-home-eyebrow">{copy.eyebrow}</span>
            <h1 id="office-home-title">{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="office-home-head-actions">
            <button
              className={`is-secondary office-extension-toggle${extensionVisible ? " is-active" : ""}`}
              type="button"
              disabled={extensionCount === 0}
              aria-pressed={extensionVisible}
              title={extensionVisible ? copy.extensionHide : copy.extensionShow}
              onClick={onToggleExtension}
            >
              <span aria-hidden>◫</span>
              {copy.extensionScreen}
              <b>{extensionCount}</b>
            </button>
            <button className="is-secondary" type="button" disabled={importing || creating} onClick={() => onImport()}>
              {importing ? copy.importing : copy.importFile}
            </button>
            <button type="button" disabled={importing || creating} onClick={() => onCreatePresentation()}>
              {creating ? copy.creatingPresentation : copy.newPresentation}
            </button>
          </div>
        </header>

        <div className="office-home-meta">
          <span>{copy.included}</span>
          <span>{copy.localFirst}</span>
        </div>

        <section className="office-template-section" aria-labelledby="office-template-title">
          <div className="office-template-heading">
            <h2 id="office-template-title">{copy.templatesTitle}</h2>
            <p>{copy.templatesHint}</p>
          </div>
          <div className="office-template-grid">
            {presentationTemplates(copy).map((template, index) => (
              <button
                type="button"
                key={template.id}
                disabled={importing || creating}
                onClick={() => onCreatePresentation(template.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{template.title}</strong>
                <small>{template.description}</small>
                <i aria-hidden>↗</i>
              </button>
            ))}
          </div>
        </section>

        <section className="office-kind-grid" aria-label={copy.title}>
          {officeKinds(copy).map((item, index) => (
            <button
              type="button"
              className={`office-kind-card is-${item.id}`}
              key={item.id}
              disabled={importing}
              aria-label={`${copy.importType}: ${item.title}`}
              onClick={() => onImport(item.id)}
            >
              <span className="office-kind-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="office-kind-icon" aria-hidden>
                <OfficeKindIcon kind={item.id} />
              </span>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
              <small>{item.formats}</small>
              <span className="office-kind-action">
                {copy.importType}
                <span aria-hidden>→</span>
              </span>
            </button>
          ))}
        </section>

        <aside className="office-safety">
          <span aria-hidden>◇</span>
          <div>
            <strong>{copy.safetyTitle}</strong>
            <p>{copy.safetyHint}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
