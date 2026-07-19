import React from "react";
import ReactDOM from "react-dom/client";
import PetChat from "./PetChat";

document.documentElement.classList.add("pet-chat-mode");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PetChat />
  </React.StrictMode>,
);
