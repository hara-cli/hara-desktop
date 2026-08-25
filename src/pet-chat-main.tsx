import React from "react";
import ReactDOM from "react-dom/client";
import PetChat from "./PetChat";
import { initializeThemePreference } from "./theme";
import "./theme-light.css";

initializeThemePreference();
document.documentElement.classList.add("pet-chat-mode");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PetChat />
  </React.StrictMode>,
);
