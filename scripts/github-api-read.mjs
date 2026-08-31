#!/usr/bin/env node
// Bounded, read-only GitHub API access for release policy checks. This deliberately exposes no
// mutation flags and inherits credentials only through gh's normal environment.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ATTEMPTS = 3;
const API_TIMEOUT_MS = 45_000;
const LOOPBACK_PROXY = /^(?:http|socks5|socks5h):\/\/127\.0\.0\.1:[0-9]{2,5}$/;

function wait(milliseconds) {
  execFileSync("/bin/sleep", [String(milliseconds / 1000)], {
    stdio: "ignore",
    timeout: milliseconds + 2_000,
  });
}

function validateEndpoint(endpoint) {
  if (
    typeof endpoint !== "string" ||
    !/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./?=&%*-]+$/.test(endpoint) ||
    endpoint.includes("..")
  ) {
    throw new Error("only a repository-relative GitHub API endpoint is allowed");
  }
}

function validateArguments(args) {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--paginate") continue;
    if (args[index] === "--jq" && index + 1 < args.length) {
      index++;
      continue;
    }
    throw new Error(`unsupported read-only gh api argument: ${JSON.stringify(args[index])}`);
  }
}

function releaseProxyRoutes(environment) {
  const configured = [
    environment.HARA_GITHUB_RELEASE_PROXY,
    environment.HARA_GITHUB_RELEASE_FALLBACK_PROXY,
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const proxy of configured) {
    if (!LOOPBACK_PROXY.test(proxy)) {
      throw new Error("release GitHub proxies must use a loopback HTTP/SOCKS endpoint");
    }
  }
  return configured;
}

function apiEnvironment(environment, proxy) {
  const childEnvironment = {
    ...environment,
    GH_HOST: "github.com",
    GH_PROMPT_DISABLED: "true",
  };
  delete childEnvironment.HARA_GITHUB_RELEASE_PROXY;
  delete childEnvironment.HARA_GITHUB_RELEASE_FALLBACK_PROXY;
  if (proxy) {
    childEnvironment.HTTP_PROXY = proxy;
    childEnvironment.HTTPS_PROXY = proxy;
    childEnvironment.http_proxy = proxy;
    childEnvironment.https_proxy = proxy;
    childEnvironment.NO_PROXY = "";
    childEnvironment.no_proxy = "";
  }
  return childEnvironment;
}

export function readGitHubApi(
  endpoint,
  args = [],
  {
    attempts = API_ATTEMPTS,
    timeoutMs = API_TIMEOUT_MS,
    execute = execFileSync,
    sleep = wait,
    environment = process.env,
  } = {},
) {
  validateEndpoint(endpoint);
  validateArguments(args);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > API_ATTEMPTS) {
    throw new Error(`attempts must be between 1 and ${API_ATTEMPTS}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > API_TIMEOUT_MS) {
    throw new Error(`timeout must be between 1 and ${API_TIMEOUT_MS}ms`);
  }
  const proxies = releaseProxyRoutes(environment);

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const proxy = proxies.length > 0 ? proxies[Math.min(attempt - 1, proxies.length - 1)] : undefined;
    try {
      return execute("gh", ["api", endpoint, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        env: apiEnvironment(environment, proxy),
      }).trimEnd();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.error(
        `warning: GitHub API read failed (${attempt}/${attempts}); retrying after a bounded delay`,
      );
      sleep(attempt * 1_000);
    }
  }

  throw new Error(
    `GitHub API read failed after ${attempts} attempts`,
    lastError ? { cause: lastError } : undefined,
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  const [, , endpoint, ...args] = process.argv;
  if (!endpoint) {
    console.error("usage: node scripts/github-api-read.mjs <repo-endpoint> [--paginate] [--jq <filter>]");
    process.exit(2);
  }
  try {
    process.stdout.write(`${readGitHubApi(endpoint, args)}\n`);
  } catch (error) {
    console.error(`github-api-read: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
