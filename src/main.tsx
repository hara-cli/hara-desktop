import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PetOverlay from "./PetOverlay";
import { WorkStarter } from "./WorkStarter";

const params = new URLSearchParams(window.location.search);
const petMode = params.get("pet") === "1";
const workbenchPreview = import.meta.env.DEV && params.get("preview") === "workbench";
document.documentElement.classList.toggle("pet-mode", petMode);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {petMode ? (
      <PetOverlay />
    ) : workbenchPreview ? (
      <div className="app">
        <main className="chat im">
          <div className="anchor">Hara · visual QA preview</div>
          <div className="workstarter-scroll">
            <WorkStarter
              locale={params.get("locale") === "en" ? "en" : "zh"}
              busy={false}
              onStart={async () => {}}
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
