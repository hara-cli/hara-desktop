import test from "node:test";
import assert from "node:assert/strict";
import {
  agentDisplayName,
  agentInitials,
  agentPublicTitle,
  agentVisualTokens,
  MAX_AGENT_AVATAR_BYTES,
  renderableAgentAvatar,
  stableAgentHash,
} from "../src/agent-visual.ts";

test("Agent visual identity is deterministic and honors a safe custom accent", () => {
  const identity = {
    version: 1,
    displayName: "Jony",
    title: "首席设计官",
    accent: "#4f9c8f",
    character: "designer",
    source: "openclaw",
  };
  const first = agentVisualTokens("global:uiux", identity);
  const second = agentVisualTokens("global:uiux", identity);
  assert.deepEqual(first, second);
  assert.equal(first.accent, "#4f9c8f");
  assert.equal(first.archetype, "designer");
  assert.ok(first.variant >= 0 && first.variant < 8);
  assert.equal(stableAgentHash("global:uiux"), stableAgentHash("global:uiux"));
});

test("Agent labels prefer public identity while stable refs remain independent", () => {
  const agent = {
    name: "uiux",
    description: "Owns product design",
    identity: { version: 1, displayName: "Jony", title: "首席设计官", source: "hara" },
  };
  assert.equal(agentDisplayName(agent), "Jony");
  assert.equal(agentPublicTitle(agent), "首席设计官");
  assert.equal(agentInitials("Jony Ive"), "JI");
  assert.equal(agentInitials("乔尼"), "乔尼");
});

test("Agent public titles discard Markdown separators and fall back to meaningful copy", () => {
  assert.equal(agentPublicTitle({ description: "Customer support", identity: { title: " | " } }), "Customer support");
  assert.equal(agentPublicTitle({ description: "---", identity: { title: " | " } }), "");
});

test("Agent portraits never turn arbitrary role URLs or local paths into image requests", () => {
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "https://tracker.example/a.png", source: "plugin" }), undefined);
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "/Users/name/private.png", source: "hara" }), undefined);
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "/avatars/a.webp", source: "hara" }), "/avatars/a.webp");
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "data:image/png;base64,YQ==", source: "hara" }), "data:image/png;base64,YQ==");
});

test("inline Agent portraits enforce decoded bytes rather than inflated base64 characters", () => {
  const atLimit = `data:image/png;base64,${Buffer.alloc(MAX_AGENT_AVATAR_BYTES).toString("base64")}`;
  const overLimit = `data:image/png;base64,${Buffer.alloc(MAX_AGENT_AVATAR_BYTES + 1).toString("base64")}`;
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: atLimit, source: "hara" }), atLimit);
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: overLimit, source: "hara" }), undefined);
});
