import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

test("long task guidance scrolls with the transcript without displacing the composer", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const styles = readFileSync(`${root}/src/App.css`, "utf8");

  const timelineScroll = timeline.match(
    /return \(\s*<div className="scroll">([\s\S]*?)<div ref=\{bottomRef\} \/>/,
  )?.[1] ?? "";
  const chat = styles.match(/^\.chat \{([\s\S]*?)\n\}/m)?.[1] ?? "";
  const transcript = styles.match(/^\.scroll \{([\s\S]*?)\n\}/m)?.[1] ?? "";
  const inputbar = styles.match(/^\.inputbar \{([\s\S]*?)\n\}/m)?.[1] ?? "";

  assert.match(timeline, /const taskProgressCard = visibleTask \? \(/);
  assert.match(timelineScroll, /\{taskProgressCard\}/,
    "task status belongs to the transcript scroller instead of a fixed row above it");
  assert.match(chat, /min-height:\s*0\s*;/);
  assert.match(chat, /overflow:\s*hidden\s*;/);
  assert.match(transcript, /overflow-y:\s*auto\s*;/);
  assert.match(inputbar, /flex:\s*0\s+0\s+auto\s*;/,
    "the composer keeps a reserved row when the window height shrinks");
  assert.match(app, /<ConversationTimeline[\s\S]*?<div className="inputbar">/,
    "the transcript remains before the independently sized composer");
});

test("manual task commands are disclosed on demand and bounded when expanded", () => {
  const timeline = readFileSync(`${root}/src/ConversationTimeline.tsx`, "utf8");
  const styles = readFileSync(`${root}/src/App.css`, "utf8");
  const actionBody = styles.match(/^\.task-manual-action-body \{([\s\S]*?)\n\}/m)?.[1] ?? "";

  assert.match(timeline, /<details className="task-manual-action">/,
    "large external-action instructions start as an accessible disclosure");
  assert.match(timeline, /<summary>[\s\S]*?task-manual-summary-mark[\s\S]*?showDetails[\s\S]*?<\/summary>/);
  assert.match(actionBody, /max-height:\s*min\(34vh,\s*320px\)\s*;/);
  assert.match(actionBody, /overflow-y:\s*auto\s*;/,
    "expanded command details own their overflow instead of growing past the window");
  assert.match(actionBody, /overscroll-behavior:\s*contain\s*;/);
});
