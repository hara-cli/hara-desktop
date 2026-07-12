import { readFileSync } from "node:fs";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const cargo = readText("src-tauri/Cargo.toml");
const sidecarVersion = readText("src-tauri/binaries/SIDECAR_VERSION").trim();
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const errors = [];

const expectEqual = (label, actual, expected) => {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual ?? "<missing>"}`);
};

expectEqual("package-lock.json version", lock.version, manifest.version);
expectEqual("package-lock.json root package version", lock.packages?.[""]?.version, manifest.version);
expectEqual("tauri.conf.json version", tauri.version, manifest.version);
expectEqual("Cargo.toml package version", cargoVersion, manifest.version);

if (!semver.test(sidecarVersion)) {
  errors.push(`SIDECAR_VERSION is not a valid release version: ${sidecarVersion || "<empty>"}`);
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  expectEqual("Git tag", process.env.GITHUB_REF_NAME, `v${manifest.version}`);
}

if (errors.length > 0) {
  console.error("release metadata is inconsistent:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`release metadata ok: desktop ${manifest.version}, hara sidecar ${sidecarVersion}`);
