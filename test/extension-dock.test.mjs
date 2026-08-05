import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPanelSurface,
  extensionDockWidth,
  extensionMatchesContext,
  publicPanelOrigin,
} from "../src/extension-dock-state.ts";

test("extension surfaces classify presentation, spreadsheet, document, design, and browser panels", () => {
  assert.equal(classifyPanelSurface("design", "design-preview", "Design"), "design");
  assert.equal(classifyPanelSurface("browser", "chrome", "Live browser"), "browser");
  assert.equal(classifyPanelSurface("office", "pptx-preview", "Slides"), "presentation");
  assert.equal(classifyPanelSurface("office", "xlsx-editor", "Excel"), "spreadsheet");
  assert.equal(classifyPanelSurface("writer", "docx", "Document"), "document");
  assert.equal(classifyPanelSurface("video", "timeline", "Render"), "capability");
});

test("panel provenance exposes only a credential-free HTTP origin", () => {
  assert.equal(
    publicPanelOrigin("http://127.0.0.1:4312/preview?token=private#slide-2"),
    "http://127.0.0.1:4312",
  );
  assert.equal(publicPanelOrigin("https://preview.example.com/path?q=private"), "https://preview.example.com");
  assert.equal(publicPanelOrigin("https://user:secret@example.com/path"), null);
  assert.equal(publicPanelOrigin("file:///private/tmp/report.html"), null);
  assert.equal(publicPanelOrigin("not a url"), null);
});

test("dock width is bounded and corrupt preferences fall back safely", () => {
  assert.equal(extensionDockWidth("55.5"), 55.5);
  assert.equal(extensionDockWidth(2), 36);
  assert.equal(extensionDockWidth(99), 72);
  assert.equal(extensionDockWidth("broken"), 48);
  assert.equal(extensionDockWidth(undefined, 60), 60);
});

test("an extension never migrates to a different project session or Artifact revision", () => {
  const panel = {
    type: "legacy-panel",
    id: "panel:s1:design:preview",
    title: "Design",
    plugin: "design",
    panelId: "preview",
    url: "http://127.0.0.1:4312",
    surfaceKind: "design",
    owner: { place: "projects", sessionId: "s1", cwd: "/project/a" },
    mode: "docked",
  };
  const artifact = {
    type: "artifact",
    id: "artifact:a1:r2",
    title: "Quarterly review",
    surfaceKind: "presentation",
    owner: { place: "office", artifactId: "a1", revisionId: "r2" },
    mode: "maximized",
  };

  assert.equal(extensionMatchesContext(panel, { place: "projects", sessionId: "s1" }), true);
  assert.equal(extensionMatchesContext(panel, { place: "projects", sessionId: "s2" }), false);
  assert.equal(extensionMatchesContext(artifact, { place: "office", artifactId: "a1", revisionId: "r2" }), true);
  assert.equal(extensionMatchesContext(artifact, { place: "office", artifactId: "a1", revisionId: "r3" }), false);
  assert.equal(extensionMatchesContext(artifact, { place: "projects", sessionId: "s1" }), false);
});
