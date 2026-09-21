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

test("streaming chat follows only while the reader stays near the latest message", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const styles = readFileSync(`${root}/src/App.css`, "utf8");

  assert.match(app, /const activeTimeline = active \? transcripts\[active\] : undefined/,
    "background sessions cannot trigger the active conversation's follow-scroll effect");
  assert.match(app, /scroller\.scrollHeight - scroller\.scrollTop - scroller\.clientHeight/);
  assert.match(app, /remaining <= 96/,
    "the reader keeps control after scrolling away from the latest message");
  assert.match(app, /scroller\.scrollTop = scroller\.scrollHeight/,
    "streaming updates use one animation-frame-coalesced container scroll");
  assert.doesNotMatch(app, /bottomRef\.current\?\.scrollIntoView\(\{ behavior: "smooth" \}\)/,
    "every streamed delta must not restart a smooth-scroll animation");
  assert.match(app, /timelineHasNewContent[\s\S]*?查看新消息/,
    "paused follow-scroll exposes an explicit return-to-latest action");
  assert.match(styles, /\.timeline-new-content-anchor/);
  assert.match(styles, /\.chat\.im \.assistant-message > \.msg\s*\{[\s\S]*?background:\s*transparent/,
    "Agent replies read as open conversation text instead of stacked control cards");
  assert.match(styles, /\.chat\.im \.msg\.user\s*\{[\s\S]*?max-width:\s*min\(72%, 600px\)/,
    "user bubbles stay readable on wide Desktop windows");
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
