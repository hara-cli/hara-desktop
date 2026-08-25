import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PetOverlay from "./PetOverlay";
import { ProviderSettingsPreview } from "./ProviderSettingsPreview";
import { WorkStarter } from "./WorkStarter";
import { initializeThemePreference } from "./theme";
import "./theme-light.css";

initializeThemePreference();
const params = new URLSearchParams(window.location.search);
const petMode = params.get("pet") === "1";
const workbenchPreview = import.meta.env.DEV && params.get("preview") === "workbench";
const providersPreview = import.meta.env.DEV && params.get("preview") === "providers";
const talentPreview = import.meta.env.DEV && params.get("preview") === "talent";
const TalentMarketPreview = React.lazy(() => import("./TalentMarket"));
document.documentElement.classList.toggle("pet-mode", petMode);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {petMode ? (
      <PetOverlay />
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
              apps={[
                {
                  id: "office",
                  title: params.get("locale") === "en" ? "Office" : "办公",
                  description: params.get("locale") === "en" ? "Presentations, sheets, and documents" : "演示文稿、表格与文档",
                  icon: "office",
                  source: "Hara",
                },
                {
                  id: "project",
                  title: params.get("locale") === "en" ? "Projects" : "项目",
                  description: params.get("locale") === "en" ? "Code, files, and live preview" : "代码、文件与实时预览",
                  icon: "project",
                  source: "Hara",
                },
                {
                  id: "browser",
                  title: params.get("locale") === "en" ? "Web preview" : "网页预览",
                  description: "localhost · HMR",
                  icon: "browser",
                  source: "browser",
                },
                {
                  id: "design",
                  title: params.get("locale") === "en" ? "Design" : "设计",
                  description: params.get("locale") === "en" ? "Visual results and assets" : "视觉结果与素材",
                  icon: "design",
                  source: "design",
                },
              ]}
              onOpenApp={() => {}}
              onStart={async () => {}}
              onPickFiles={async () => []}
              onPickDirectory={async () => []}
              onPasteImages={async () => []}
              onDropPaths={async () => []}
              onOpenProject={() => {}}
            />
          </div>
        </main>
      </div>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
