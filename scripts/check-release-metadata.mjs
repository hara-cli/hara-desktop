import { readFileSync } from "node:fs";
import { GIT_COMMIT_PATTERN, STABLE_VERSION_PATTERN } from "./release-policy.mjs";

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = (path) => JSON.parse(readText(path));

const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const tauri = readJson("src-tauri/tauri.conf.json");
const cargo = readText("src-tauri/Cargo.toml");
const sidecarVersion = readText("src-tauri/binaries/SIDECAR_VERSION").trim();
const sidecarCommit = readText("src-tauri/binaries/SIDECAR_COMMIT").trim();
const nodeVersion = readText(".node-version").trim();
const bunVersion = readText(".bun-version").trim();
const rustVersion = readText(".rust-version").trim();
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const errors = [];

const expectEqual = (label, actual, expected) => {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual ?? "<missing>"}`);
};

expectEqual("package-lock.json version", lock.version, manifest.version);
expectEqual("package-lock.json root package version", lock.packages?.[""]?.version, manifest.version);
expectEqual("tauri.conf.json version", tauri.version, manifest.version);
expectEqual("Cargo.toml package version", cargoVersion, manifest.version);
expectEqual("package.json Node engine", manifest.engines?.node, ">=22.12.0");

if (!STABLE_VERSION_PATTERN.test(sidecarVersion)) {
  errors.push(`SIDECAR_VERSION is not a valid release version: ${sidecarVersion || "<empty>"}`);
}
if (!GIT_COMMIT_PATTERN.test(sidecarCommit)) {
  errors.push(`SIDECAR_COMMIT is not a full Git commit: ${sidecarCommit || "<empty>"}`);
}
if (!/^\d+\.\d+\.\d+$/.test(bunVersion)) {
  errors.push(`.bun-version is not an exact stable version: ${bunVersion || "<empty>"}`);
}
if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
  errors.push(`.node-version is not an exact stable version: ${nodeVersion || "<empty>"}`);
}
if (!/^\d+\.\d+\.\d+$/.test(rustVersion)) {
  errors.push(`.rust-version is not an exact stable version: ${rustVersion || "<empty>"}`);
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  if (!STABLE_VERSION_PATTERN.test(manifest.version)) {
    errors.push(`stable desktop releases cannot use a prerelease version: ${manifest.version || "<empty>"}`);
  }
  expectEqual("Git tag", process.env.GITHUB_REF_NAME, `v${manifest.version}`);
}

if (errors.length > 0) {
  console.error("release metadata is inconsistent:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `release metadata ok: desktop ${manifest.version}, hara sidecar ${sidecarVersion}@${sidecarCommit.slice(0, 12)}, Node ${nodeVersion}, Bun ${bunVersion}, Rust ${rustVersion}`,
);
