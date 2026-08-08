import assert from "node:assert/strict";
import test from "node:test";

import {
  activateExtensionTab,
  activeExtensionTab,
  activeExtensionTabForContext,
  artifactExtensionTabId,
  classifyPanelSurface,
  closeExtensionTab,
  emptyExtensionDockState,
  extensionContextKey,
  extensionDockWidth,
  extensionItemContextKey,
  extensionMatchesContext,
  extensionTabsForContext,
  localWebPreviewUrl,
  messageWithActiveWorkObject,
  nativePresentationRevisionFromTurn,
  presentationBrowserTabId,
  publicPanelOrigin,
  reviewTabId,
  upsertExtensionTab,
  webPreviewTabId,
  workbenchToolTabId,
} from "../src/extension-dock-state.ts";
import { userVisibleTaskText, userVisibleText } from "../src/user-visible-text.ts";

test("renderer routing envelopes never enter visible conversation or progress text", () => {
  const wrapped = [
    "[HARA_DESKTOP_ACTIVE_WORK_OBJECT",
    "kind=presentation",
    "intent=apply_user_request_to_active_visible_object",
    "artifact_id=art_0123456789abcdef",
    "revision_id=rev_0123456789abcdef",
    "]",
    "",
    "把第三页标题改短",
  ].join("\n");

  assert.equal(userVisibleText(wrapped), "把第三页标题改短");
  assert.equal(userVisibleTaskText(wrapped, "正在执行"), "把第三页标题改短");
  assert.equal(
    userVisibleTaskText("[HARA_DESKTOP_ACTIVE_WORK_OBJECT\nkind=presentation", "正在执行"),
    "正在执行",
  );
  assert.doesNotMatch(userVisibleTaskText(wrapped, "正在执行"), /HARA_DESKTOP|revision_id/);
});

test("surface recovery accepts only the current native revision authored by this session", () => {
  const startedAt = Date.parse("2026-08-08T10:00:00.000Z");
  const artifact = {
    kind: "presentation",
    extension: ".hpres",
    mediaType: "application/vnd.nanhara.presentation+json",
    currentRevisionId: "rev-current",
    updatedAt: "2026-08-08T10:00:02.000Z",
  };
  const revisions = [{
    revisionId: "rev-current",
    taskRunId: "session-current",
    createdAt: "2026-08-08T10:00:01.000Z",
  }];
  assert.equal(
    nativePresentationRevisionFromTurn(artifact, revisions, "session-current", startedAt),
    revisions[0],
  );
  assert.equal(nativePresentationRevisionFromTurn(artifact, revisions, "other-session", startedAt), null);
  assert.equal(nativePresentationRevisionFromTurn({ ...artifact, extension: ".pptx" }, revisions, "session-current", startedAt), null);
  assert.equal(nativePresentationRevisionFromTurn({ ...artifact, currentRevisionId: "rev-other" }, revisions, "session-current", startedAt), null);
});

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
  assert.equal(extensionContextKey({ place: "projects", sessionId: "s1" }), "projects:s1");
  assert.equal(extensionContextKey({ place: "chat", sessionId: null }), null);
  assert.equal(extensionContextKey({ place: "office" }), "office");
  assert.equal(extensionItemContextKey(panel), "projects:s1");
  assert.equal(extensionItemContextKey(artifact), "office");
});

test("the same Artifact keeps independent Office and session-owned tab identities", () => {
  const artifactId = "art_0123456789abcdef0123456789abcdef";
  const revisionId = "rev_0123456789abcdef0123456789abcdef";
  const office = artifactExtensionTabId(artifactId, { place: "office", artifactId, revisionId });
  const projectA = artifactExtensionTabId(artifactId, {
    place: "projects", sessionId: "session-a", cwd: "/project/a", artifactId, revisionId,
  });
  const projectB = artifactExtensionTabId(artifactId, {
    place: "projects", sessionId: "session-b", cwd: "/project/b", artifactId, revisionId,
  });
  assert.equal(new Set([office, projectA, projectB]).size, 3);
  assert.equal(
    projectA,
    artifactExtensionTabId(artifactId, {
      place: "projects", sessionId: "session-a", cwd: "/project/a", artifactId, revisionId: "rev_other",
    }),
  );
  assert.notEqual(
    presentationBrowserTabId(artifactId, revisionId, { place: "office", artifactId, revisionId }),
    office,
  );
});

test("localhost WebView previews require HTTP, loopback, credentials-free, explicit ports", () => {
  for (const url of [
    "http://localhost:5173/",
    "http://127.0.0.1:3000/app",
    "http://[::1]:4173/preview",
  ]) assert.equal(localWebPreviewUrl(url)?.toString(), url);
  for (const url of [
    "https://localhost:5173/",
    "http://localhost/",
    "http://example.com:5173/",
    "http://user:secret@127.0.0.1:5173/",
    "file:///tmp/index.html",
  ]) assert.equal(localWebPreviewUrl(url), null);
  assert.equal(webPreviewTabId("session-a", "http://localhost:5173/a?private=1").includes("private"), false);
  assert.equal(
    webPreviewTabId("session-a", "http://localhost:5173/a"),
    webPreviewTabId("session-a", "http://localhost:5173/a"),
  );
});

test("Workbench tool and Review tabs stay scoped to one session", () => {
  assert.equal(workbenchToolTabId("session-a", "terminal"), "tool:session-a:terminal");
  assert.equal(workbenchToolTabId("session-a", "browser"), "tool:session-a:browser");
  assert.equal(workbenchToolTabId("session-a", "files"), "tool:session-a:files");
  assert.notEqual(workbenchToolTabId("session-a", "files"), workbenchToolTabId("session-b", "files"));
  assert.equal(reviewTabId("session-a"), "review:session-a:changes");
});

test("chat targets the selected work object with bounded private metadata", () => {
  const presentation = {
    type: "artifact",
    id: "artifact:project:session-a:art_safe",
    title: "Private board title",
    surfaceKind: "presentation",
    owner: {
      place: "projects",
      sessionId: "session-a",
      cwd: "/private/customer-project",
      artifactId: "art_0123456789abcdef",
      revisionId: "rev_0123456789abcdef",
    },
    mode: "docked",
  };
  const message = messageWithActiveWorkObject(presentation, "把第二页标题改短");
  assert.match(message, /^\[HARA_DESKTOP_ACTIVE_WORK_OBJECT\nkind=presentation\n/);
  assert.match(message, /artifact_id=art_0123456789abcdef/);
  assert.match(message, /revision_id=rev_0123456789abcdef/);
  assert.match(message, /\]\n\n把第二页标题改短$/);
  assert.doesNotMatch(message, /Private board title|customer-project/);

  const browserTab = {
    type: "presentation-browser",
    id: presentationBrowserTabId(
      presentation.owner.artifactId,
      presentation.owner.revisionId,
      presentation.owner,
    ),
    title: "Private board title · Browser",
    surfaceKind: "browser",
    owner: presentation.owner,
    mode: "docked",
  };
  assert.equal(extensionMatchesContext(browserTab, { place: "projects", sessionId: "session-a" }), true);
  assert.match(messageWithActiveWorkObject(browserTab, "全屏播放"), /kind=browser[\s\S]*artifact_id=art_/);

  const browser = {
    type: "web-preview",
    id: "preview:session-a:safe",
    title: "Local app",
    surfaceKind: "browser",
    url: "http://localhost:5173/private/path?token=redacted#state",
    owner: { place: "projects", sessionId: "session-a", cwd: "/project/a" },
    mode: "docked",
  };
  const browserMessage = messageWithActiveWorkObject(browser, "让按钮更明显");
  assert.match(browserMessage, /origin=http:\/\/localhost:5173/);
  assert.doesNotMatch(browserMessage, /private\/path|token=|#state/);

  assert.equal(
    messageWithActiveWorkObject({
      ...presentation,
      owner: { ...presentation.owner, artifactId: "bad\nid" },
    }, "keep exact text"),
    "keep exact text",
  );
});

test("Visual Dock tabs deduplicate, activate, close adjacently, and remain owner-bound", () => {
  const preview = (id, sessionId, dirty = false) => ({
    type: "web-preview",
    id,
    title: id,
    url: `http://127.0.0.1:5173/${id}`,
    surfaceKind: "browser",
    owner: { place: "projects", sessionId, cwd: `/project/${sessionId}` },
    mode: "docked",
    dirty,
  });
  let state = emptyExtensionDockState();
  state = upsertExtensionTab(state, preview("one", "s1"));
  state = upsertExtensionTab(state, preview("two", "s1"));
  state = upsertExtensionTab(state, preview("other", "s2"));
  assert.equal(activeExtensionTab(state)?.id, "other");
  assert.deepEqual(extensionTabsForContext(state, { place: "projects", sessionId: "s1" }).map((tab) => tab.id), ["one", "two"]);
  assert.equal(activeExtensionTabForContext(state, { place: "projects", sessionId: "s1" })?.id, "two");
  state = activateExtensionTab(state, "one");
  assert.equal(activeExtensionTabForContext(state, { place: "projects", sessionId: "s1" })?.id, "one");
  state = upsertExtensionTab(state, { ...preview("one", "s1"), title: "updated" });
  assert.equal(state.tabs.filter((tab) => tab.id === "one").length, 1);
  assert.equal(activeExtensionTab(state)?.title, "updated");
  state = closeExtensionTab(state, "one");
  assert.equal(activeExtensionTab(state)?.id, "two");
});

test("the tab limit evicts oldest clean tabs but never discards unsaved editor state", () => {
  const tab = (id, dirty = false) => ({
    type: "web-preview",
    id,
    title: id,
    url: `http://localhost:5173/${id}`,
    surfaceKind: "browser",
    owner: { place: "chat", sessionId: "s1", cwd: "/assistant" },
    mode: "docked",
    dirty,
  });
  let state = emptyExtensionDockState();
  state = upsertExtensionTab(state, tab("dirty", true), 2);
  state = upsertExtensionTab(state, tab("clean"), 2);
  state = upsertExtensionTab(state, tab("new"), 2);
  assert.deepEqual(state.tabs.map((item) => item.id), ["dirty", "new"]);
});
