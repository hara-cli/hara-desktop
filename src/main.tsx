import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PetOverlay from "./PetOverlay";

const petMode = new URLSearchParams(window.location.search).get("pet") === "1";
document.documentElement.classList.toggle("pet-mode", petMode);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {petMode ? <PetOverlay /> : <App />}
  </React.StrictMode>,
);
