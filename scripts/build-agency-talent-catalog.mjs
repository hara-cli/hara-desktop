#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENCY_AGENTS_UPSTREAM_ZH_TITLES,
  AGENCY_AGENTS_ZH_DIVISIONS,
  AGENCY_AGENTS_ZH_EXPECTED_COUNT,
  AGENCY_AGENTS_ZH_NEW_ROLE_ENGLISH,
  AGENCY_AGENTS_ZH_RENAMED_PATHS,
  AGENCY_AGENTS_ZH_REVISION,
  AGENCY_AGENTS_ZH_SEMANTIC_DUPLICATES,
} from "./agency-agents-zh-catalog.mjs";

const UPSTREAM_REVISION = "ebe9c99acb5c96f9468de368d8bead775387d1a7";
const EXPECTED_UPSTREAM_COUNT = 270;
const EXPECTED_EXACT_LOCALIZATIONS = 226;
const EXPECTED_RENAMED_LOCALIZATIONS = 2;
const EXPECTED_SEMANTIC_DUPLICATES = 10;
const EXPECTED_DOMESTIC_ADDITIONS = 38;
const EXPECTED_COMBINED_COUNT = EXPECTED_UPSTREAM_COUNT + EXPECTED_DOMESTIC_ADDITIONS;
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceOption = option("--source");
const zhSourceOption = option("--zh-source");
const sourceRoot = resolve(sourceOption ?? "");
const zhSourceRoot = resolve(zhSourceOption ?? "");
const outputFile = resolve(option("--output") ?? join(scriptRoot, "src", "generated", "agency-agent-records.ts"));
if (!sourceOption) throw new Error("--source <agency-agents checkout> is required");
if (!zhSourceOption) throw new Error("--zh-source <agency-agents-zh checkout> is required");

function repositoryRevision(root, label, expected) {
  const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (revision !== expected) throw new Error(`${label} checkout must be pinned to ${expected}; received ${revision}`);
  return revision;
}

const upstreamRevision = repositoryRevision(sourceRoot, "Agency Agents", UPSTREAM_REVISION);
const zhRevision = repositoryRevision(zhSourceRoot, "Agency Agents 中文版", AGENCY_AGENTS_ZH_REVISION);

function bounded(value, cap) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap);
}

function scalar(raw) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line || /^\s/.test(line)) continue;
    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (pair) metadata[pair[1]] = scalar(pair[2]);
  }
  return metadata;
}

function markdownFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
}

function sourceRecord(root, division, sourceFile) {
  const filename = basename(sourceFile);
  const metadata = frontmatter(readFileSync(sourceFile, "utf8"));
  const rawStem = basename(filename, ".md");
  const stem = rawStem.startsWith(`${division}-`) ? rawStem.slice(division.length + 1) : rawStem;
  const sourcePath = relative(root, sourceFile).split(sep).join("/");
  const divisionRoot = join(root, division);
  const nestedPath = relative(divisionRoot, dirname(sourceFile)).split(sep).filter((part) => part && part !== ".");
  const name = bounded(metadata.name || stem.replace(/[-_]+/g, " "), 100);
  const description = bounded(metadata.description, 800);
  const vibe = bounded(metadata.vibe, 400);
  if (!name || (!description && !vibe)) throw new Error(`Agent metadata is incomplete: ${sourcePath}`);
  return {
    id: `${division}/${[...nestedPath, stem].join("/")}`.toLowerCase(),
    sourcePath,
    division,
    stem: rawStem,
    name,
    description,
    color: bounded(metadata.color, 32),
    emoji: bounded(metadata.emoji, 24) || "✦",
    vibe,
  };
}

function recordsFromDivisions(root, divisions) {
  return divisions.flatMap((division) => markdownFiles(join(root, division))
    .map((sourceFile) => sourceRecord(root, division, sourceFile)));
}

const divisionManifest = JSON.parse(readFileSync(join(sourceRoot, "divisions.json"), "utf8"));
const upstreamDivisionIds = Object.keys(divisionManifest.divisions ?? {}).sort();
if (!upstreamDivisionIds.length) throw new Error("Agency Agents divisions manifest has no divisions map");

const upstreamRecords = recordsFromDivisions(sourceRoot, upstreamDivisionIds);
if (upstreamRecords.length !== EXPECTED_UPSTREAM_COUNT) {
  throw new Error(`Expected ${EXPECTED_UPSTREAM_COUNT} Agency Agents, received ${upstreamRecords.length}`);
}
const upstreamByPath = new Map(upstreamRecords.map((record) => [record.sourcePath, record]));

const catalogOrigins = new Map();
for (const line of readFileSync(join(zhSourceRoot, "AGENT-LIST.md"), "utf8").split(/\r?\n/)) {
  const match = /^\|\s*`([^`]+)`(?:\s*\|.*){2}\|\s*(原创|翻译)\s*\|\s*$/.exec(line);
  if (match) catalogOrigins.set(match[1], match[2] === "原创" ? "original" : "translation");
}
if (catalogOrigins.size !== AGENCY_AGENTS_ZH_EXPECTED_COUNT) {
  throw new Error(`Expected ${AGENCY_AGENTS_ZH_EXPECTED_COUNT} classified Chinese Agent rows, received ${catalogOrigins.size}`);
}

const zhRecords = recordsFromDivisions(zhSourceRoot, AGENCY_AGENTS_ZH_DIVISIONS)
  .map((record) => ({ ...record, origin: catalogOrigins.get(record.stem) }));
if (zhRecords.length !== AGENCY_AGENTS_ZH_EXPECTED_COUNT) {
  throw new Error(`Expected ${AGENCY_AGENTS_ZH_EXPECTED_COUNT} Chinese Agents, received ${zhRecords.length}`);
}
if (zhRecords.some((record) => !record.origin)) throw new Error("Every Chinese Agent must be classified as original or translation");

const consumedZhPaths = new Set();
const localizationByUpstreamPath = new Map();
let exactLocalizationCount = 0;
let renamedLocalizationCount = 0;

for (const record of zhRecords) {
  if (!upstreamByPath.has(record.sourcePath)) continue;
  consumedZhPaths.add(record.sourcePath);
  localizationByUpstreamPath.set(record.sourcePath, record);
  exactLocalizationCount += 1;
}

for (const record of zhRecords) {
  if (consumedZhPaths.has(record.sourcePath)) continue;
  const targetPath = AGENCY_AGENTS_ZH_RENAMED_PATHS.get(record.sourcePath);
  if (!targetPath) continue;
  if (!upstreamByPath.has(targetPath)) throw new Error(`Renamed localization target is missing: ${targetPath}`);
  consumedZhPaths.add(record.sourcePath);
  localizationByUpstreamPath.set(targetPath, record);
  renamedLocalizationCount += 1;
}

for (const record of zhRecords) {
  if (consumedZhPaths.has(record.sourcePath)) continue;
  const targetPath = AGENCY_AGENTS_ZH_SEMANTIC_DUPLICATES.get(record.sourcePath);
  if (!targetPath) continue;
  if (!upstreamByPath.has(targetPath)) throw new Error(`Semantic duplicate target is missing: ${targetPath}`);
  consumedZhPaths.add(record.sourcePath);
  if (!localizationByUpstreamPath.has(targetPath)) localizationByUpstreamPath.set(targetPath, record);
}

const domesticRecords = zhRecords.filter((record) => !consumedZhPaths.has(record.sourcePath));
if (exactLocalizationCount !== EXPECTED_EXACT_LOCALIZATIONS) {
  throw new Error(`Expected ${EXPECTED_EXACT_LOCALIZATIONS} exact localizations, received ${exactLocalizationCount}`);
}
if (renamedLocalizationCount !== EXPECTED_RENAMED_LOCALIZATIONS) {
  throw new Error(`Expected ${EXPECTED_RENAMED_LOCALIZATIONS} renamed localizations, received ${renamedLocalizationCount}`);
}
if (AGENCY_AGENTS_ZH_SEMANTIC_DUPLICATES.size !== EXPECTED_SEMANTIC_DUPLICATES) {
  throw new Error(`Expected ${EXPECTED_SEMANTIC_DUPLICATES} reviewed semantic duplicates`);
}
if (domesticRecords.length !== EXPECTED_DOMESTIC_ADDITIONS) {
  throw new Error(`Expected ${EXPECTED_DOMESTIC_ADDITIONS} domestic additions after dedupe, received ${domesticRecords.length}`);
}

const missingUpstreamLocalizations = upstreamRecords
  .filter((record) => !localizationByUpstreamPath.has(record.sourcePath));
for (const record of missingUpstreamLocalizations) {
  if (!AGENCY_AGENTS_UPSTREAM_ZH_TITLES[record.sourcePath]) {
    throw new Error(`A newer upstream Agent needs reviewed Chinese fallback copy: ${record.sourcePath}`);
  }
}

function localizedRecord(record) {
  const localization = localizationByUpstreamPath.get(record.sourcePath);
  const fallbackZhName = AGENCY_AGENTS_UPSTREAM_ZH_TITLES[record.sourcePath];
  const zhName = localization?.name || fallbackZhName || record.name;
  const zhDescription = localization?.description
    || (fallbackZhName ? `${fallbackZhName}，负责把明确目标推进为有依据、可验证的专业交付。` : record.description);
  const zhVibe = localization?.vibe || zhDescription;
  return {
    id: `agency-agents/${record.id}`,
    sourceCatalog: "agency-agents",
    sourcePath: record.sourcePath,
    ...(localization ? { localizationSourcePath: localization.sourcePath } : {}),
    division: record.division,
    name: { en: record.name, zh: zhName },
    description: { en: record.description, zh: zhDescription },
    color: record.color,
    emoji: record.emoji,
    vibe: { en: record.vibe || record.description, zh: zhVibe },
  };
}

function domesticRecord(record) {
  const english = AGENCY_AGENTS_ZH_NEW_ROLE_ENGLISH[record.sourcePath];
  if (!english) throw new Error(`Domestic Agent needs reviewed English catalog copy: ${record.sourcePath}`);
  if (record.origin !== "original") throw new Error(`A translated role cannot be added as a domestic original: ${record.sourcePath}`);
  return {
    id: `agency-agents-zh/${record.id}`,
    sourceCatalog: "agency-agents-zh",
    sourcePath: record.sourcePath,
    division: record.division,
    name: { en: english.name, zh: record.name },
    description: { en: english.description, zh: record.description },
    color: record.color,
    emoji: record.emoji,
    vibe: { en: english.description, zh: record.vibe || record.description },
  };
}

const records = [
  ...upstreamRecords.map(localizedRecord),
  ...domesticRecords.map(domesticRecord),
];

if (records.length !== EXPECTED_COMBINED_COUNT) {
  throw new Error(`Expected ${EXPECTED_COMBINED_COUNT} deduplicated Agents, received ${records.length}`);
}
if (new Set(records.map((record) => record.id)).size !== records.length) {
  throw new Error("Generated Agency Agent ids are not unique");
}
if (records.some((record) => !record.name.en || !record.name.zh || !record.description.en || !record.description.zh)) {
  throw new Error("Every generated Agent must include English and Chinese catalog copy");
}

const stats = {
  upstream: EXPECTED_UPSTREAM_COUNT,
  chineseCatalog: AGENCY_AGENTS_ZH_EXPECTED_COUNT,
  exactLocalizations: EXPECTED_EXACT_LOCALIZATIONS,
  renamedLocalizations: EXPECTED_RENAMED_LOCALIZATIONS,
  semanticDuplicatesRemoved: EXPECTED_SEMANTIC_DUPLICATES,
  domesticAdditions: EXPECTED_DOMESTIC_ADDITIONS,
  combined: EXPECTED_COMBINED_COUNT,
};
const header = `// Generated by scripts/build-agency-talent-catalog.mjs from Agency Agents ${upstreamRevision}\n// and Agency Agents 中文版 ${zhRevision}. Do not hand-edit; both pinned sources are MIT licensed.\n\n`;
const body = `export type GeneratedAgencyAgentSourceCatalog = "agency-agents" | "agency-agents-zh";\n\nexport interface GeneratedAgencyAgentRecord {\n  id: string;\n  sourceCatalog: GeneratedAgencyAgentSourceCatalog;\n  sourcePath: string;\n  localizationSourcePath?: string;\n  division: string;\n  name: { en: string; zh: string };\n  description: { en: string; zh: string };\n  color: string;\n  emoji: string;\n  vibe: { en: string; zh: string };\n}\n\nexport const AGENCY_AGENT_CATALOG_STATS = ${JSON.stringify(stats, null, 2)} as const;\n\nexport const AGENCY_AGENT_RECORDS: readonly GeneratedAgencyAgentRecord[] = ${JSON.stringify(records, null, 2)};\n`;
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, header + body, { encoding: "utf8", mode: 0o644 });
process.stdout.write(`Generated ${records.length} deduplicated bilingual Agent records at ${outputFile}\n`);
