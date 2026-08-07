import type { ReactNode } from "react";
import "./OfficeEditorShell.css";

interface OfficeEditorShellProps {
  ariaLabel: string;
  className?: string;
  toolbar: ReactNode;
  rail: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  footer: ReactNode;
}

/** Shared native work surface for Presentation, Spreadsheet, and Document capabilities. */
export function OfficeEditorShell({
  ariaLabel,
  className = "",
  toolbar,
  rail,
  canvas,
  inspector,
  footer,
}: OfficeEditorShellProps) {
  return (
    <section className={`office-editor-shell ${className}`.trim()} aria-label={ariaLabel}>
      <header className="office-editor-toolbar">{toolbar}</header>
      <div className="office-editor-workspace">
        <aside className="office-editor-rail">{rail}</aside>
        <main className="office-editor-canvas">{canvas}</main>
        <aside className="office-editor-inspector">{inspector}</aside>
      </div>
      <footer className="office-editor-footer">{footer}</footer>
    </section>
  );
}
