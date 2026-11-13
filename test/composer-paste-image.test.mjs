import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WorkspaceDevModel } from "../src/workspace-dev-state.ts";
import { MAX_PASTE_IMAGE_BYTES, PASTE_CHUNK_BYTES, pasteFailureNotice, pasteImageChunks, pastedImageFile } from "../src/workspace-media.ts";
import { redesignText } from "../src/desktop-redesign-copy.ts";
import { snapshot } from "./support/settings-rpc-scenarios.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const HASH = "a".repeat(64), ID = "b".repeat(64);
const source = readFileSync(new URL("../src/WorkspaceLocalDev.tsx", import.meta.url), "utf8");

async function model({ capable = true, reply } = {}) {
  const calls = [];
  const m = new WorkspaceDevModel({ supportsCapability: name => name !== "workspace.media.import.v1" || capable, async request(method, params) {
    if (method === "workspace.list") return { revision: 1, syntheticOnly: false, executionMode: "workspace", activeWorkspaceId: "A", workspaces: [{ workspaceId: "A", active: true }, { workspaceId: "B", active: false }] };
    if (method === "workspace.select" || method === "workspace.settings.select" || method === "workspace.snapshot") return snapshot(params.workspaceId ?? "A");
    calls.push({ method, params });
    return reply ? reply(params, m) : params.index < params.total - 1 ? { received: params.index + 1 }
      : { path: `/x/project/A/attachments/${HASH}.png`, media: { id: ID, mime: params.mime, bytes: params.bytes } };
  } }, () => "request", false, "workspace");
  await m.selectWorkspace("A"); calls.length = 0;
  return { m, calls };
}

test("chunks stay under the 128 KiB RPC frame and rebuild the exact bytes", () => {
  const bytes = new Uint8Array(MAX_PASTE_IMAGE_BYTES).map((_, i) => i * 7);
  const chunks = pasteImageChunks(bytes);
  assert.equal(chunks.length, Math.ceil(MAX_PASTE_IMAGE_BYTES / PASTE_CHUNK_BYTES));
  assert.ok(chunks.every(c => c.length <= Math.ceil(PASTE_CHUNK_BYTES / 3) * 4 && c.length + 400 < 128 * 1024));
  assert.deepEqual(Buffer.concat(chunks.map(c => Buffer.from(c, "base64"))), Buffer.from(bytes));
  assert.equal(PASTE_CHUNK_BYTES, 64 * 1024, "the same chunk size Core expects");
});

test("only a clipboard image is taken over; anything carrying text pastes as text", () => {
  const file = { name: "image.png" };
  const image = { kind: "file", type: "image/png", getAsFile: () => file }, text = { kind: "string", type: "text/plain", getAsFile: () => null }, html = { kind: "string", type: "text/html", getAsFile: () => null };
  assert.equal(pastedImageFile({ items: [image] }), file);
  assert.equal(pastedImageFile({ items: [html, image] }), file, "an image copied from a web page");
  assert.equal(pastedImageFile({ items: [text, image] }), null, "text from a document keeps pasting as text");
  assert.equal(pastedImageFile({ items: [text] }), null);
  assert.equal(pastedImageFile({ items: [{ kind: "file", type: "application/pdf", getAsFile: () => file }] }), null);
  assert.equal(pastedImageFile(null), null);
});

test("a pasted image goes to Core in ordered chunks of one import, and the reply is checked", async () => {
  const { m, calls } = await model();
  const bytes = Buffer.concat([PNG, Buffer.alloc(PASTE_CHUNK_BYTES * 2)]);
  const result = await m.importPastedImage(new Uint8Array(bytes), "image/png");
  assert.equal(result.path, `/x/project/A/attachments/${HASH}.png`);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.method), Array(3).fill("workspace.media.import"));
  assert.deepEqual(calls.map(c => c.params.index), [0, 1, 2]);
  assert.equal(new Set(calls.map(c => c.params.importId)).size, 1);
  for (const c of calls) assert.deepEqual(Object.keys(c.params).sort(), ["bytes", "chunkBase64", "expectedGeneration", "importId", "index", "mime", "total", "workspaceId"]);
  assert.deepEqual({ ...calls[0].params, chunkBase64: undefined, importId: undefined }, { workspaceId: "A", expectedGeneration: "generation-A", mime: "image/png", index: 0, total: 3, bytes: bytes.length, chunkBase64: undefined, importId: undefined });
  assert.deepEqual(Buffer.concat(calls.map(c => Buffer.from(c.params.chunkBase64, "base64"))), bytes);
  const good = p => ({ path: `/x/attachments/${HASH}.png`, media: { id: ID, mime: "image/png", bytes: p.bytes } });
  for (const [why, reply] of [["outside attachments/", () => ({ path: "/etc/passwd", media: { id: ID, mime: "image/png", bytes: PNG.length } })],
    ["another mime", () => ({ path: `/x/attachments/${HASH}.png`, media: { id: ID, mime: "image/gif", bytes: PNG.length } })],
    ["another size (review of #103, L3 mutation c)", p => ({ ...good(p), media: { ...good(p).media, bytes: p.bytes - 1 } })],
    ["an extension that is not the mime's", p => ({ ...good(p), path: `/x/attachments/${HASH}.gif` })],
    ["a bad id", p => ({ ...good(p), media: { ...good(p).media, id: "x" } })], ["nothing", () => null]]) {
    const bad = await model({ reply });
    await assert.rejects(bad.m.importPastedImage(new Uint8Array(PNG), "image/png"), /Workspace media unavailable/, why);
  }
  // A chunk before the last must be acknowledged with its count (review of #103, L3 mutation a).
  const skewed = await model({ reply: p => p.index < p.total - 1 ? { received: p.index } : good(p) });
  await assert.rejects(skewed.m.importPastedImage(new Uint8Array(bytes), "image/png"), /Workspace media unavailable/);
  assert.equal(skewed.calls.length, 1, "nothing more is sent after a wrong acknowledgement");
});

test("switching workspace mid-upload stops sending at once and adds nothing (review of #103, M1)", async () => {
  const bytes = Buffer.concat([PNG, Buffer.alloc(PASTE_CHUNK_BYTES * 3)]);
  const { m, calls } = await model({ reply: async (p, self) => { if (p.index === 0) await self.selectWorkspace("B"); return p.index < p.total - 1 ? { received: p.index + 1 } : null; } });
  const scope = m.mediaScope;
  await assert.rejects(m.importPastedImage(new Uint8Array(bytes), "image/png", scope), /Workspace media unavailable/);
  assert.notEqual(m.mediaScope, scope);
  assert.deepEqual(calls.filter(c => c.method === "workspace.media.import").map(c => c.params.index), [0], "no chunk after the switch");
  assert.equal(pasteFailureNotice(new Error("Workspace media unavailable"), true), "pasteInterrupted", "said as an interrupted paste, not «try again»");
  assert.equal(pasteFailureNotice(new Error("Workspace resource generation changed; refresh before acting"), false), "pasteInterrupted");
  assert.equal(pasteFailureNotice(new Error("image_too_large: images are limited to 3.6 MB (3600000 bytes)"), false), "pasteTooLarge");
  assert.equal(pasteFailureNotice(new Error("image_type"), false), "pasteType");
  assert.equal(pasteFailureNotice(new Error("import_aborted: chunk out of order"), false), "pasteFailed");
});

test("without the capability, over 3.6 MB, or another type nothing is sent", async () => {
  const old = await model({ capable: false });
  assert.equal(old.m.supportsMediaImport(), false);
  await assert.rejects(old.m.importPastedImage(new Uint8Array(PNG), "image/png"), /unavailable/);
  const { m, calls } = await model();
  await assert.rejects(m.importPastedImage(new Uint8Array(MAX_PASTE_IMAGE_BYTES + 1), "image/png"), /image_too_large/);
  await assert.rejects(m.importPastedImage(new Uint8Array(PNG), "image/svg+xml"), /image_type/);
  assert.deepEqual([...old.calls, ...calls], []);
});

test("the colleague composer pastes images through the import, says every outcome, and keeps text paste", () => {
  assert.match(source, /onPaste=\{event => \{ const image = pastedImageFile\(event\.clipboardData\); if \(!image\) return; event\.preventDefault\(\); void pasteImage\(image\); \}\}/);
  assert.match(source, /if \(!model\.supportsMediaImport\(\)\) \{ tell\("pasteUnsupported"\); return; \}/);
  assert.match(source, /if \(file\.size > MAX_PASTE_IMAGE_BYTES\) \{ tell\("pasteTooLarge"\); return; \}/);
  assert.match(source, /if \(attaching\) \{ tell\("pasteBusy"\); return; \}/, "a paste during an upload is answered, not dropped (L1)");
  assert.doesNotMatch(source, /if \(attaching \|\| disconnected\) return;\n\s+const next/);
  assert.match(source, /draft\.trimEnd\(\)\.length \+ PASTE_PATH_ROOM > 24000\) \{ tell\("pasteDraftFull"\); return; \}\n\s+setAttaching\(true\); tell\("pastingImage"\);/, "a full draft is said before anything is sent (L2)");
  assert.match(source, /catch \(error\) \{ tell\(pasteFailureNotice\(error, selectedScope !== model\.mediaScope\)\); \}/);
  assert.match(source, /const \{ path \} = await model\.importPastedImage\([\s\S]{0,400}model\.setDraft\(next\); input\.current\?\.focus\(\); tell\("pastedImage"\);/, "the path joins the draft like a chosen file");
  assert.match(source, /<span className="sr-only" aria-live="polite" data-paste-status>\{pasteStatus\}<\/span>/, "progress and outcome reach screen readers through a line that is always there");
  assert.match(source, /const tell = \(key: PasteNoticeKey\) => \{ const text = r\(key\); setPasteStatus\(text\); setUndoNotice/);
  for (const locale of ["zh-Hans", "en", "zh-Hant"]) for (const key of ["pasteUnsupported", "pasteTooLarge", "pasteType", "pasteFailed", "pasteBusy", "pasteDraftFull", "pasteInterrupted", "pastingImage", "pastedImage"]) {
    const text = redesignText(locale, key); assert.ok(text && text !== key, `${locale} ${key}`);
    if (key === "pasteTooLarge") assert.match(text, /3\.6 ?MB/);
    if (locale !== "en") assert.doesNotMatch(text, /[\u4e00-\u9fff] [\u4e00-\u9fff]/);
    if (["pasteBusy", "pasteDraftFull", "pasteInterrupted", "pasteTooLarge", "pasteType"].includes(key)) assert.doesNotMatch(text, /重试|重試|Try again/, `${locale} ${key} does not ask for a retry that cannot work`);
  }
  assert.notEqual(redesignText("zh-Hans", "pasteFailed"), redesignText("zh-Hant", "pasteFailed"));
});
