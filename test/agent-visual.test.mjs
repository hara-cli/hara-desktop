import test from "node:test";
import assert from "node:assert/strict";
import {
  agentDisplayName,
  agentInitials,
  agentPublicTitle,
  agentVisualTokens,
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

test("Agent portraits never turn arbitrary role URLs or local paths into image requests", () => {
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "https://tracker.example/a.png", source: "plugin" }), undefined);
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "/Users/name/private.png", source: "hara" }), undefined);
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "/avatars/a.webp", source: "hara" }), "/avatars/a.webp");
  assert.equal(renderableAgentAvatar({ version: 1, displayName: "A", avatar: "data:image/png;base64,YQ==", source: "hara" }), "data:image/png;base64,YQ==");
});
