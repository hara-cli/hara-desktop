import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AGENT_BLUEPRINTS,
  AGENCY_AGENT_CATALOG_STATS,
  AGENCY_AGENTS_LICENSE_NOTICE,
  AGENCY_AGENTS_SOURCE_REVISION,
  AGENCY_AGENTS_ZH_LICENSE_NOTICE,
  AGENCY_AGENTS_ZH_SOURCE_REVISION,
  COMMUNITY_AGENT_BLUEPRINTS,
  HARA_CURATED_BLUEPRINTS,
  TALENT_DEPARTMENTS,
  filterTalentBlueprints,
  talentBlueprintAvatar,
  talentBlueprintInstallInput,
  talentBlueprintIdentity,
  talentBlueprintInstructions,
  talentBlueprintIsCurated,
  talentBlueprintIsDomestic,
  talentBlueprintLicenseNotice,
  talentBlueprintLocalizationSource,
} from "../src/talent-blueprints.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

test("talent catalog is curated, versioned, searchable, and provenance-bound", () => {
  assert.equal(AGENT_BLUEPRINTS.length, 308);
  assert.equal(HARA_CURATED_BLUEPRINTS.length, 31);
  assert.equal(COMMUNITY_AGENT_BLUEPRINTS.length, 277);
  assert.equal(AGENCY_AGENT_CATALOG_STATS.chineseCatalog, 276);
  assert.equal(AGENCY_AGENT_CATALOG_STATS.semanticDuplicatesRemoved, 10);
  assert.equal(AGENCY_AGENT_CATALOG_STATS.domesticAdditions, 38);
  assert.equal(AGENT_BLUEPRINTS.filter(talentBlueprintIsDomestic).length, 38);
  assert.equal(new Set(AGENT_BLUEPRINTS.map((item) => item.id)).size, AGENT_BLUEPRINTS.length);
  assert.equal(new Set(AGENT_BLUEPRINTS.map((item) => item.username)).size, AGENT_BLUEPRINTS.length);
  assert.equal(TALENT_DEPARTMENTS.length, 22);
  assert.match(AGENCY_AGENTS_LICENSE_NOTICE, /Copyright \(c\) 2025 AgentLand Contributors/);
  assert.match(AGENCY_AGENTS_ZH_LICENSE_NOTICE, /Copyright \(c\) 2026 jnMetaCode/);
  assert.match(talentBlueprintInstallInput(HARA_CURATED_BLUEPRINTS[0]).publisher, /Hara · curated/);
  assert.match(talentBlueprintInstallInput(COMMUNITY_AGENT_BLUEPRINTS[0]).publisher, /community import/);
  assert.match(
    talentBlueprintInstallInput(AGENT_BLUEPRINTS.find((item) => talentBlueprintIsDomestic(item))).publisher,
    /Agency Agents 中文版/,
  );

  const portraitPaths = new Set();
  for (const blueprint of AGENT_BLUEPRINTS) {
    const avatar = talentBlueprintAvatar(blueprint);
    assert.match(avatar, /^\/avatars\/talent\/(?:v2\/)?[a-z0-9._-]+\.webp$/);
    assert.equal(portraitPaths.has(avatar), false, `portrait path must be unique: ${avatar}`);
    portraitPaths.add(avatar);
    const portraitPath = `${root}/public${avatar}`;
    if (talentBlueprintIsCurated(blueprint)) {
      assert.equal(existsSync(portraitPath), true, `curated portrait must exist: ${blueprint.username}`);
    }
    if (existsSync(portraitPath)) {
      assert.ok(statSync(portraitPath).size <= 64 * 1024, `packaged portrait stays lightweight: ${blueprint.username}`);
    }
    assert.equal(talentBlueprintIdentity(blueprint, "zh").avatar, avatar);
  }
  assert.equal(portraitPaths.size, AGENT_BLUEPRINTS.length);

  for (const blueprint of AGENT_BLUEPRINTS) {
    assert.equal(blueprint.version, "1.0.0");
    assert.match(blueprint.id, /^agency-agents(?:-zh)?\/[a-z0-9._/-]+$/);
    assert.match(blueprint.username, /^[a-z0-9][a-z0-9._-]{0,63}$/);
    assert.ok(blueprint.sourcePath.endsWith(".md"));
    assert.ok(blueprint.tasks.en.length >= 3);
    assert.ok(blueprint.tasks.zh.length >= 3);
    assert.ok(blueprint.name.en.trim());
    assert.ok(blueprint.name.zh.trim());
    assert.ok(blueprint.bio.en.trim());
    assert.ok(blueprint.bio.zh.trim());
    assert.match(blueprint.title.zh, /\p{Script=Han}/u);
    assert.ok(blueprint.qualityBar.length >= 3);
    const install = talentBlueprintInstallInput(blueprint);
    const expectedRevision = talentBlueprintIsDomestic(blueprint)
      ? AGENCY_AGENTS_ZH_SOURCE_REVISION
      : AGENCY_AGENTS_SOURCE_REVISION;
    assert.equal(install.sourceRevision, expectedRevision);
    assert.equal(install.license, "MIT");
    assert.ok(install.source.includes(`/${expectedRevision}/`));
    assert.ok(install.source.endsWith(blueprint.sourcePath));
    const instructions = talentBlueprintInstructions(blueprint);
    assert.ok(instructions.length < 16_000);
    assert.match(instructions, /Take ownership of assigned work/);
    assert.match(instructions, /never grants permissions/);
    assert.match(instructions, /current Personal or Company Space/);
    assert.match(instructions, /approved learning or memory mechanisms/);
    assert.match(talentBlueprintLicenseNotice(blueprint), /MIT License/);
  }

  const localizedCommunity = COMMUNITY_AGENT_BLUEPRINTS.find((item) => item.localizationSourcePath);
  assert.ok(localizedCommunity);
  assert.match(talentBlueprintLocalizationSource(localizedCommunity), /agency-agents-zh\/blob/);
  assert.notEqual(localizedCommunity.title.en, localizedCommunity.title.zh);

  const removedDuplicateIds = [
    "agency-agents-zh/company/chief-financial-officer",
    "agency-agents-zh/company/chief-of-staff",
    "agency-agents-zh/engineering/security-engineer",
    "agency-agents-zh/engineering/threat-detection-engineer",
    "agency-agents-zh/marketing/ecommerce-operator",
    "agency-agents-zh/marketing/wechat-operator",
    "agency-agents-zh/marketing/xiaohongshu-operator",
    "agency-agents-zh/specialized/prompt-engineer",
    "agency-agents-zh/specialized/technical-translator-agent",
    "agency-agents-zh/support/recruitment-specialist",
  ];
  assert.deepEqual(AGENT_BLUEPRINTS.filter((item) => removedDuplicateIds.includes(item.id)), []);
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
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "香港 合规", "finance").some((item) => item.username === "hk-stock-compliance-reviewer"));
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "钉钉 集成", "engineering").some((item) => item.username === "dingtalk-integration-developer"));
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "leadership").length >= 5);
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "legal").length >= 2);
  assert.ok(filterTalentBlueprints(AGENT_BLUEPRINTS, "", "supply-chain").length >= 4);
});

test("Desktop keeps discovery lazy and hiring explicit", () => {
  const app = readFileSync(`${root}/src/App.tsx`, "utf8");
  const market = readFileSync(`${root}/src/TalentMarket.tsx`, "utf8");
  const hire = readFileSync(`${root}/src/HireAgentDialog.tsx`, "utf8");
  const lightweightBlueprint = readFileSync(`${root}/src/talent-blueprint.ts`, "utf8");
  const portrait = readFileSync(`${root}/src/AgentPortrait.tsx`, "utf8");
  const portraitCss = readFileSync(`${root}/src/AgentPortrait.css`, "utf8");
  const portraitGate = readFileSync(`${root}/scripts/talent-avatar-queue.mjs`, "utf8");
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
  assert.match(portrait, /agent-character-monogram/);
  assert.doesNotMatch(portrait, /function Face/);
  assert.doesNotMatch(portraitCss, /agent-art-(?:face|hair|eye|mouth|glasses|outfit)/);
  assert.match(portraitGate, /unexpected\.length/);
  assert.match(portraitGate, /duplicate group\(s\)/);
  assert.match(portraitGate, /PORTRAIT_EDGE = 256/);
  assert.match(css, /Hara Talent Bureau/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(
    css,
    /\.talent-market-stats \{[\s\S]*?width:\s*min\(100%, 400px\);[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    "market statistics use bounded tracks instead of overflowing the hero",
  );
  assert.match(
    css,
    /@media \(max-width: 560px\) \{[\s\S]*?\.talent-market-card-grid \{ grid-template-columns: 1fr; \}/,
    "compact windows use readable single-column candidate cards",
  );
  assert.doesNotMatch(css, /talent-market-stats > span:nth-child\(2\)[^{]*\{[^}]*display:\s*none/, "compact layouts keep every catalog statistic available");
  assert.doesNotMatch(app, /AGENT_BLUEPRINTS/);
});
