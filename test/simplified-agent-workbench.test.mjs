import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("the core Desktop build excludes the desktop pet and game-like Agent Office", () => {
  const removed = [
    "pet-chat.html",
    "src/PetChat.tsx",
    "src/PetOverlay.tsx",
    "src/WorkforceSurface.tsx",
    "src/WorkforceThreeScene.tsx",
    "src/companion/useDesktopCompanion.ts",
    "src-tauri/capabilities/pet.json",
    "src-tauri/capabilities/pet-chat.json",
  ];
  for (const relative of removed) {
    assert.equal(existsSync(`${root}/${relative}`), false, `${relative} must stay outside the product build`);
  }

  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const vite = readFileSync(`${root}/vite.config.ts`, "utf8");
  const nativeHost = readFileSync(`${root}/src-tauri/src/lib.rs`, "utf8");
  const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));

  assert.doesNotMatch(app, /PetChat|PetOverlay|DesktopCompanion|WorkforceSurface|WorkforceThree|AGENT_OFFICE/);
  assert.doesNotMatch(vite, /pet-chat/);
  assert.doesNotMatch(nativeHost, /pet_chat|pet_window|show_pet|hide_pet|set_pet/);
  assert.equal(packageJson.dependencies?.three, undefined);
  assert.equal(packageJson.devDependencies?.["@types/three"], undefined);
});

test("the simplified workbench keeps persistent Agents and focused work surfaces", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const sessions = readFileSync(`${root}/src/agent-session.ts`, "utf8");

  assert.match(app, /<AgentPicker/);
  assert.match(app, /id: "terminal" as const[\s\S]*id: "browser" as const[\s\S]*id: "files" as const/);
  assert.doesNotMatch(app, /id: "workforce" as const/);
  assert.match(sessions, /export const mainAgentRef/);
  assert.match(sessions, /export function latestAgentSession/);
});
