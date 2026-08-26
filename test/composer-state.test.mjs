import assert from "node:assert/strict";
import test from "node:test";
import {
  appendComposerAttachments,
  composerAttachment,
  composerAttachmentIssue,
  composerCanSend,
  emptyComposerDraft,
} from "../src/composer-state.ts";

const capabilities = (mode) => ({
  image: { mode, maxBytes: 3_600_000 },
  textFile: "inline-text",
  directory: "bounded-inventory-and-tools",
  binaryFile: "agent-tool",
});

test("composer attachments preserve spaces, classify images, and deduplicate per session draft", () => {
  const image = composerAttachment("/tmp/界面 截图.webp", "file", "a-1");
  const folder = composerAttachment("/tmp/参考 目录", "directory", "a-2");
  assert.equal(image.kind, "image");
  assert.equal(image.name, "界面 截图.webp");
  assert.equal(folder.name, "参考 目录");
  assert.deepEqual(
    appendComposerAttachments([image], [image, folder]).map((attachment) => attachment.id),
    ["a-1", "a-2"],
  );
});

test("files and directories remain local context while incompatible images block send", () => {
  const file = composerAttachment("/tmp/brief.pdf", "file", "a-1");
  const image = composerAttachment("/tmp/screen.png", "image", "a-2");

  assert.equal(composerAttachmentIssue([file], undefined, true), null);
  assert.equal(composerAttachmentIssue([image], capabilities("unsupported"), true), "image-unsupported");
  assert.equal(composerAttachmentIssue([image], capabilities("unknown"), true), "image-unknown");
  assert.equal(composerAttachmentIssue([image], capabilities("vision-sidecar"), true), "image-unsupported");
  assert.equal(composerAttachmentIssue([image], capabilities("native"), true), null);
  assert.equal(composerAttachmentIssue([file], capabilities("native"), false), "engine-update-required");
});

test("oversized images are blocked before capability loading or model dispatch", () => {
  const huge = composerAttachment("/tmp/六十四卦.png", "image", "a-42", "image/png", 42_000_000);
  const regular = composerAttachment("/tmp/screen.png", "image", "a-2", "image/png", 3_600_000);

  assert.equal(huge.byteSize, 42_000_000);
  assert.equal(composerAttachmentIssue([huge], undefined, true), "image-too-large");
  assert.equal(composerAttachmentIssue([huge], capabilities("native"), true), "image-too-large");
  assert.equal(composerAttachmentIssue([regular], capabilities("native"), true), null);
});

test("attachment-only turns are sendable when the model route is compatible", () => {
  const draft = emptyComposerDraft();
  draft.attachments.push(composerAttachment("/tmp/screen.png", "image", "a-1"));
  assert.equal(composerCanSend(draft, null), true);
  assert.equal(composerCanSend(draft, "image-unsupported"), false);
  assert.equal(composerCanSend(emptyComposerDraft(), null), false);
});
