#!/usr/bin/env node
// The protected Apple Silicon signing host can inspect Intel release bytes without executing them.
// Intel packages are already built and execute-smoked on GitHub's native macos-15-intel runner;
// this mode keeps the signing host responsible for structure, architecture, signatures, notarization,
// and staples without making release availability depend on Rosetta's machine-wide health.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STATIC_VALIDATION_ENV = "HARA_FOREIGN_MAC_STATIC_VALIDATION";

export function useForeignMacStaticValidation({
  expectedTarget,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (env[STATIC_VALIDATION_ENV] !== "1") return false;
  if (platform !== "darwin" || arch !== "arm64" || expectedTarget !== "x86_64-apple-darwin") {
    throw new Error(
      `${STATIC_VALIDATION_ENV}=1 is allowed only for x86_64-apple-darwin validation on an Apple Silicon macOS host`,
    );
  }
  const tag = env.GITHUB_REF_NAME || "";
  const runId = env.GITHUB_RUN_ID || "";
  const sha = env.GITHUB_SHA || "";
  const protectedRelease =
    /^(?:1|true)$/iu.test(env.GITHUB_ACTIONS || "")
    && env.GITHUB_REPOSITORY === "hara-cli/hara-desktop"
    && env.GITHUB_EVENT_NAME === "push"
    && env.GITHUB_REF_TYPE === "tag"
    && /^(?:1|true)$/iu.test(env.GITHUB_REF_PROTECTED || "")
    && /^v\d+\.\d+\.\d+$/u.test(tag)
    && /^[0-9a-f]{40}$/iu.test(sha)
    && env.GITHUB_WORKFLOW_SHA === sha
    && env.GITHUB_WORKFLOW_REF === `hara-cli/hara-desktop/.github/workflows/build.yml@refs/tags/${tag}`
    && runId.length > 0
    && env.HARA_PROTECTED_SIGNING_JOB === runId;
  if (!protectedRelease) {
    throw new Error(
      `${STATIC_VALIDATION_ENV}=1 is allowed only inside the protected tag signing job for this exact workflow revision`,
    );
  }
  return true;
}

export function inspectForeignMacExecutable(binary, expectedTarget, label = "foreign macOS executable") {
  if (!useForeignMacStaticValidation({ expectedTarget })) {
    throw new Error(`${STATIC_VALIDATION_ENV}=1 is required before foreign-architecture static inspection`);
  }
  const targetPath = resolve(binary);
  if (!existsSync(targetPath) || !statSync(targetPath).isFile() || statSync(targetPath).size === 0) {
    throw new Error(`${label} is missing or empty: ${targetPath}`);
  }
  if ((statSync(targetPath).mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${targetPath}`);
  }
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", targetPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  })
    .trim()
    .split(/\s+/);
  if (!architectures.includes("x86_64")) {
    throw new Error(`${label} architecture mismatch: expected x86_64, got ${architectures.join(", ")}`);
  }
  return architectures;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , binary, expectedTarget, label] = process.argv;
  if (binary === "--preflight") {
    try {
      if (!useForeignMacStaticValidation({ expectedTarget })) {
        throw new Error(`${STATIC_VALIDATION_ENV}=1 is required for foreign-architecture validation`);
      }
      console.log(`  ✓ protected foreign-architecture validation enabled (${expectedTarget})`);
    } catch (error) {
      console.error(`foreign-mac-validation: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!binary || !expectedTarget) {
    console.error("usage: node scripts/foreign-mac-validation.mjs <binary> <target> [label] | --preflight <target>");
    process.exit(2);
  }
  try {
    inspectForeignMacExecutable(binary, expectedTarget, label);
    console.log(`  ✓ ${label || "foreign macOS executable"} inspected without Rosetta execution (${expectedTarget})`);
  } catch (error) {
    console.error(`foreign-mac-validation: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
