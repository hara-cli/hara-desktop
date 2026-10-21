// DEV-only entry view; no native bridge, account, credentials, Core or model calls.
import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceEntryView } from "../../src/WorkspaceEntry";
if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(location.hostname)) throw new Error("Synthetic localhost development fixture only");
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(<WorkspaceEntryView mode={null} failed={params.get("failed") === "1"} />);
