#!/usr/bin/env node
// Submit a macOS release artifact without coupling the remote notarization lifetime to one
// `notarytool --wait` process. Apple may keep processing after that process times out or crashes,
// so submission and status polling are deliberately separate, bounded operations.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBMIT_ATTEMPTS = 3;
const INFO_ATTEMPTS = 3;
const SUBMIT_TIMEOUT_MS = 20 * 60_000;
const INFO_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 15_000;
const TOTAL_WAIT_MS = 30 * 60_000;
const TRANSIENT_NOTARY_FAILURE =
  /SIGBUS|bus error|exit (?:code )?138|NSURLErrorDomain|kCFErrorDomainCFNetwork|request timed out|timed out|network connection was lost|could not connect to (?:the )?server|Internet connection appears to be offline|TLS handshake|HTTP 5\d\d|service unavailable|connection reset/i;

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function cleanDetail(value, redactions = []) {
  let detail = String(value ?? "");
  for (const item of redactions) {
    if (item) detail = detail.replaceAll(String(item), "<redacted>");
  }
  return detail.replaceAll(/\s+/g, " ").trim().slice(0, 1600);
}

export function isTransientNotaryFailure(value) {
  const signal = value && typeof value === "object" ? value.signal : "";
  const status = value && typeof value === "object" ? value.status : "";
  const stderr = value && typeof value === "object" ? value.stderr : "";
  const error = value && typeof value === "object" ? value.error?.message : "";
  return (
    status === 138 ||
    TRANSIENT_NOTARY_FAILURE.test(
      `${signal ?? ""} ${status ?? ""} ${stderr ?? ""} ${error ?? ""} ${value ?? ""}`,
    )
  );
}

export function parseNotaryResponse(value, operation) {
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new Error(`${operation} returned malformed JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${operation} returned an invalid response`);
  }
  if (!UUID_PATTERN.test(String(parsed.id ?? ""))) {
    throw new Error(`${operation} did not return a valid submission id`);
  }
  const status = parsed.status == null ? null : String(parsed.status);
  if (status != null && !["Accepted", "In Progress", "Invalid", "Rejected"].includes(status)) {
    throw new Error(`${operation} returned an unknown status`);
  }
  return { id: String(parsed.id), status };
}

function runNotarytool(args, { timeout, redactions }) {
  const result = spawnSync("/usr/bin/xcrun", ["notarytool", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0) return result.stdout;

  const detail = cleanDetail(
    [result.stderr, result.stdout, result.error?.message, result.signal, result.status]
      .filter(Boolean)
      .join(" "),
    redactions,
  );
  const error = new Error(detail || "notarytool failed without diagnostic output");
  error.signal = result.signal;
  error.status = result.status;
  error.stderr = detail;
  throw error;
}

async function runWithTransientRetries(operation, attempts, callback, wait = sleep) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return callback();
    } catch (error) {
      if (!isTransientNotaryFailure(error) || attempt === attempts) throw error;
      console.warn(`  ⚠ ${operation} had a transient process/service failure (${attempt}/${attempts}); retrying`);
      await wait(attempt * 3_000);
    }
  }
  throw new Error(`${operation} exhausted retries`);
}

export async function notarizeArtifact(
  artifact,
  { key, keyId, issuer },
  {
    pollIntervalMs = POLL_INTERVAL_MS,
    totalWaitMs = TOTAL_WAIT_MS,
    now = () => Date.now(),
    wait = sleep,
    run = runNotarytool,
  } = {},
) {
  const path = resolve(artifact);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`notarization artifact is missing or not a regular file: ${path}`);
  }
  if (!key || !existsSync(resolve(key)) || !statSync(resolve(key)).isFile()) {
    throw new Error("notarization API key file is missing");
  }
  if (!keyId || !issuer) throw new Error("notarization API key id and issuer are required");

  const credentials = ["--key", resolve(key), "--key-id", keyId, "--issuer", issuer];
  const redactions = [resolve(key), keyId, issuer];
  const submitted = await runWithTransientRetries(
    "notary submission",
    SUBMIT_ATTEMPTS,
    () =>
      parseNotaryResponse(
        run(
          ["submit", path, ...credentials, "--no-wait", "--output-format", "json"],
          { timeout: SUBMIT_TIMEOUT_MS, redactions },
        ),
        "notary submission",
      ),
    wait,
  );

  console.log(`  submission accepted for processing: ${submitted.id} (${basename(path)})`);
  const deadline = now() + totalWaitMs;
  while (now() < deadline) {
    const info = await runWithTransientRetries(
      "notary status query",
      INFO_ATTEMPTS,
      () => {
        const remainingMs = deadline - now();
        if (remainingMs <= 0) throw new Error("notary processing deadline reached");
        return parseNotaryResponse(
          run(
            ["info", submitted.id, ...credentials, "--output-format", "json"],
            { timeout: Math.max(1_000, Math.min(INFO_TIMEOUT_MS, remainingMs)), redactions },
          ),
          "notary status query",
        );
      },
      wait,
    );
    if (info.id !== submitted.id) throw new Error("notary status response changed submission id");
    if (info.status === "Accepted") {
      console.log(`  notarization accepted: ${submitted.id}`);
      return submitted.id;
    }
    if (info.status === "Invalid" || info.status === "Rejected") {
      throw new Error(`notarization failed with status ${info.status} for submission ${submitted.id}`);
    }
    if (info.status !== "In Progress") {
      throw new Error(`notary status response omitted the processing status for submission ${submitted.id}`);
    }
    await wait(pollIntervalMs);
  }
  throw new Error(
    `notarization did not finish within ${Math.round(totalWaitMs / 60_000)} minutes for submission ${submitted.id}`,
  );
}

function parseArguments(argv) {
  const [artifact, ...args] = argv;
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!["--key", "--key-id", "--issuer"].includes(flag) || !value) {
      throw new Error(
        "usage: node scripts/notarize-artifact.mjs <artifact> --key <p8> --key-id <id> --issuer <uuid>",
      );
    }
    if (Object.hasOwn(values, flag)) throw new Error(`duplicate notarization option: ${flag}`);
    values[flag] = value;
  }
  if (!artifact || Object.keys(values).length !== 3) {
    throw new Error(
      "usage: node scripts/notarize-artifact.mjs <artifact> --key <p8> --key-id <id> --issuer <uuid>",
    );
  }
  return {
    artifact,
    credentials: {
      key: values["--key"],
      keyId: values["--key-id"],
      issuer: values["--issuer"],
    },
  };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const { artifact, credentials } = parseArguments(process.argv.slice(2));
    await notarizeArtifact(artifact, credentials);
  } catch (error) {
    console.error(`notarize-artifact: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
