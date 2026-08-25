import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AGENT_BLUEPRINTS,
  AGENCY_AGENTS_LICENSE_NOTICE,
  AGENCY_AGENTS_SOURCE_REVISION,
  COMMUNITY_AGENT_BLUEPRINTS,
  HARA_CURATED_BLUEPRINTS,
  TALENT_DEPARTMENTS,
  filterTalentBlueprints,
  talentBlueprintInstallInput,
  talentBlueprintIdentity,
  talentBlueprintInstructions,
} from "../src/talent-blueprints.ts";
import { agentVisualTokens } from "../src/agent-visual.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("talent catalog is curated, versioned, searchable, and provenance-bound", () => {
  assert.equal(AGENT_BLUEPRINTS.length, 270);
  assert.equal(HARA_CURATED_BLUEPRINTS.length, 31);
  assert.equal(COMMUNITY_AGENT_BLUEPRINTS.length, 239);
  assert.equal(new Set(AGENT_BLUEPRINTS.map((item) => item.id)).size, AGENT_BLUEPRINTS.length);
  assert.equal(new Set(AGENT_BLUEPRINTS.map((item) => item.username)).size, AGENT_BLUEPRINTS.length);
  assert.equal(TALENT_DEPARTMENTS.length, 19);
  assert.match(AGENCY_AGENTS_LICENSE_NOTICE, /Copyright \(c\) 2025 AgentLand Contributors/);
  assert.match(talentBlueprintInstallInput(HARA_CURATED_BLUEPRINTS[0]).publisher, /Hara · curated/);
  assert.match(talentBlueprintInstallInput(COMMUNITY_AGENT_BLUEPRINTS[0]).publisher, /community import/);

  const illustrated = HARA_CURATED_BLUEPRINTS.filter((item) => item.avatar);
  assert.ok(illustrated.length >= 3, "finance, sales, and people heroes carry distinct reviewed portraits");
  for (const blueprint of illustrated) {
    assert.match(blueprint.avatar, /^\/avatars\/talent\/[a-z0-9._-]+\.webp$/);
    const portraitPath = `${root}/public${blueprint.avatar}`;
    assert.equal(existsSync(portraitPath), true);
    assert.ok(statSync(portraitPath).size <= 128 * 1024, "packaged portraits stay lightweight");
    assert.equal(talentBlueprintIdentity(blueprint, "zh").avatar, blueprint.avatar);
  }

  const generatedVisuals = new Set(AGENT_BLUEPRINTS.map((blueprint) => {
    const visual = agentVisualTokens(`talent:${blueprint.id}`, talentBlueprintIdentity(blueprint, "zh"));
    return `${visual.skin}:${visual.hair}:${visual.variant}`;
  }));
  assert.ok(generatedVisuals.size >= 40, "the fallback roster should not collapse into a handful of lookalikes");

  for (const blueprint of AGENT_BLUEPRINTS) {
    assert.equal(blueprint.version, "1.0.0");
    assert.match(blueprint.id, /^agency-agents\/[a-z0-9._/-]+$/);
    assert.match(blueprint.username, /^[a-z0-9][a-z0-9._-]{0,63}$/);
    assert.ok(blueprint.sourcePath.endsWith(".md"));
    assert.ok(blueprint.tasks.en.length >= 3);
    assert.ok(blueprint.tasks.zh.length >= 3);
    assert.ok(blueprint.qualityBar.length >= 3);
    const install = talentBlueprintInstallInput(blueprint);
    assert.equal(install.sourceRevision, AGENCY_AGENTS_SOURCE_REVISION);
    assert.equal(install.license, "MIT");
    assert.ok(install.source.includes(`/${AGENCY_AGENTS_SOURCE_REVISION}/`));
    assert.ok(install.source.endsWith(blueprint.sourcePath));
    const instructions = talentBlueprintInstructions(blueprint);
    assert.ok(instructions.length < 16_000);
    assert.match(instructions, /Take ownership of assigned work/);
    assert.match(instructions, /never grants permissions/);
    assert.match(instructions, /current Personal or Company Space/);
    assert.match(instructions, /approved learning or memory mechanisms/);
  }
});

test("talent search accepts outcomes in Chinese or English without loading candidates into the Agent directory", () => {
  assert.deepEqual(
    filterTalentBlueprints(AGENT_BLUEPRINTS, "飞书 集成", "all").map((item) => item.username),
    ["feishu-integrator"],
  );
  const codeReviewResults = filterTalentBlueprints(AGENT_BLUEPRINTS, "code review", "engineering");
  assert.equal(codeReviewResults[0].username, "code-reviewer", "the curated exact match ranks first");
  assert.ok(codeReviewResults.length > 1, "the full catalog may contain additional matching specialists");
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "发布", "all").some((item) => item.username === "product-manager"));
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "engineering").every((item) => item.department === "engineering"));
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "finance").length >= 8);
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "sales").length >= 12);
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "people").length >= 5);
});

test("Desktop keeps discovery lazy and hiring explicit", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const market = readFileSync(`${root}/src/TalentMarket.tsx`, "utf8");
  const hire = readFileSync(`${root}/src/HireAgentDialog.tsx`, "utf8");
  const lightweightBlueprint = readFileSync(`${root}/src/talent-blueprint.ts`, "utf8");
  const portrait = readFileSync(`${root}/src/AgentPortrait.tsx`, "utf8");
  const css = readFileSync(`${root}/src/TalentMarket.css`, "utf8");

  assert.match(app, /const loadTalentMarket = \(\) => import\("\.\/TalentMarket"\)/);
  assert.match(app, /warmModule\(loadTalentMarket\(\)\)/);
  assert.match(app, /hiredBlueprintIds/);
  assert.match(app, /const AGENT_BLUEPRINT_FEATURE = "agent\.blueprint-provenance\.v1"/);
  assert.match(app, /input\.blueprint && !client\.supportsFeature\(AGENT_BLUEPRINT_FEATURE\)/);
  assert.match(app, /talentMarketOpen && agentBlueprintFeatureReady/);
  assert.match(app, /agentBlueprintFeatureReady \? \(/);
  assert.match(app, /openCustomRecruitment/);
  assert.match(market, /filterTalentBlueprints\(AGENT_BLUEPRINTS/);
  assert.match(market, /disabled=\{isHired\}/);
  assert.match(market, /INITIAL_VISIBLE_TALENT = 48/);
  assert.match(market, /Community import/);
  assert.match(market, /hiring grants nothing automatically/);
  assert.match(market, /inert=\{suspended\}/);
  assert.match(hire, /talentBlueprintInstallInput\(blueprint\)/);
  assert.match(hire, /talentBlueprintInstructions\(blueprint\)/);
  assert.match(hire, /from "\.\/talent-blueprint(?:\.ts)?"/);
  assert.doesNotMatch(hire, /from "\.\/talent-blueprints(?:\.ts)?"/);
  assert.doesNotMatch(lightweightBlueprint, /generated\/agency-agent-records/);
  assert.match(portrait, /agent-character-head\$\{avatar && !avatarFailed/);
  assert.match(css, /Hara Talent Bureau/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(app, /AGENT_BLUEPRINTS/);
});
