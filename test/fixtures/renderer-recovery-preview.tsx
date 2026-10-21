// DEV-only pure recovery view: no native bridge, error report, credentials or Core calls.
import React from "react";
import { createRoot } from "react-dom/client";
import { RendererRecoveryView } from "../../src/RendererRecovery";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Synthetic localhost development fixture only");
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(<RendererRecoveryView />);
