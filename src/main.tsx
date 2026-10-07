import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ProviderSettingsPreview } from "./ProviderSettingsPreview";
import { WorkStarter } from "./WorkStarter";
import { initializeThemePreference } from "./theme";
import { RendererBootSignal, RendererErrorBoundary } from "./RendererRecovery";
import { CrashReportHost } from "./CrashReportPrompt";
import { installAppContextMenuBoundary } from "./context-menu";
import "./theme-light.css";

initializeThemePreference();
installAppContextMenuBoundary();
const params = new URLSearchParams(window.location.search);
const workbenchPreview = import.meta.env.DEV && params.get("preview") === "workbench";
const providersPreview = import.meta.env.DEV && params.get("preview") === "providers";
const talentPreview = import.meta.env.DEV && params.get("preview") === "talent";
const automationPreview = import.meta.env.DEV && params.get("preview") === "automation";
const TalentMarketPreview = React.lazy(() => import("./TalentMarket"));
const AutomationPreview = React.lazy(() => import("./AutomationPreview"));
const crashReportEnabled = !workbenchPreview && !providersPreview && !talentPreview && !automationPreview;

const root = document.getElementById("root");
if (!root) throw new Error("Hara renderer root is unavailable");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {crashReportEnabled && <CrashReportHost />}
    <RendererErrorBoundary>
      <RendererBootSignal>
        {automationPreview ? (
          <React.Suspense fallback={<div>Opening Automations…</div>}>
            <AutomationPreview
              locale={params.get("locale") === "en" ? "en" : "zh"}
              layout={params.get("layout") === "settings" ? "settings" : undefined}
              section={params.get("section") === "appearance" ? "appearance" : undefined}
              sidebarExpanded={params.get("advanced") === "1"}
            />
          </React.Suspense>
        ) : talentPreview ? (
          <React.Suspense fallback={<div>Opening Talent Bureau…</div>}>
            <TalentMarketPreview
              locale={params.get("locale") === "en" ? "en" : "zh"}
              hiredBlueprintIds={[]}
              onClose={() => {}}
              onCustomHire={() => {}}
              onHire={() => {}}
            />
          </React.Suspense>
        ) : providersPreview ? (
          <ProviderSettingsPreview
            locale={params.get("locale") === "en" ? "en" : "zh"}
            scenario={params.get("scenario")}
          />
        ) : workbenchPreview ? (
          <div className="app">
            <main className="chat im">
              <div className="anchor">Hara · visual QA preview</div>
              <div className="workstarter-scroll">
                <WorkStarter
                  locale={params.get("locale") === "en" ? "en" : "zh"}
                  busy={false}
                  onStart={async () => {}}
                  onPickFiles={async () => []}
                  onPickDirectory={async () => []}
                  onPasteImages={async () => []}
                  onDropPaths={async () => []}
                />
              </div>
            </main>
          </div>
        ) : (
          <App />
        )}
      </RendererBootSignal>
    </RendererErrorBoundary>
  </React.StrictMode>,
);
