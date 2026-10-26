import React from "react";
import ReactDOM from "react-dom/client";
import WorkspaceEntry from "./WorkspaceEntry";
import { initializeThemePreference } from "./theme";
import { applyAppearance, loadAppearance } from "./violet-appearance";
import { RendererBootSignal, RendererErrorBoundary } from "./RendererRecovery";
import { CrashReportHost } from "./CrashReportPrompt";
import { installAppContextMenuBoundary } from "./context-menu";
import "./theme-light.css";

initializeThemePreference();
applyAppearance(loadAppearance());
installAppContextMenuBoundary();

const root = document.getElementById("root");
if (!root) throw new Error("Hara renderer root is unavailable");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <CrashReportHost />
    <RendererErrorBoundary>
      <RendererBootSignal>
        <WorkspaceEntry />
      </RendererBootSignal>
    </RendererErrorBoundary>
  </React.StrictMode>,
);
