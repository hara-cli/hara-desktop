#!/usr/bin/env node
// Choose the protected signer's GitHub route by measured large-file throughput (1.2.3). A small
// HTTPS 200 proved nothing in v1.2.2: every route answered api.github.com while moving 19-250 KB/s.
// Each loopback candidate downloads the same fixed 8 MiB range of a public release asset (no token
// ever crosses a probe). The fastest route at or above the floor wins; when none qualifies the caller
// stops before uploading anything.
//
//   node scripts/release-proxy-select.mjs [--exclude <proxy>] <proxy>...
//   stdout: the chosen proxy; stderr: the measured table. Exit 1 when no route reaches the floor.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROBE_URL = "https://github.com/hara-cli/hara-desktop/releases/download/v1.2.1/Hara_1.2.1_x64.dmg";
export const PROBE_BYTES = 8 * 1024 * 1024;
export const PROBE_MAX_SECONDS = 30;
export const DEFAULT_FLOOR_BYTES_PER_SECOND = 1024 * 1024;
export const MIN_FLOOR_BYTES_PER_SECOND = 256 * 1024;
const LOOPBACK_PROXY = /^(?:http|socks5|socks5h):\/\/127\.0\.0\.1:\d{2,5}$/u;

export function isLoopbackProxy(value) {
  return LOOPBACK_PROXY.test(value ?? "");
}

export function floorFromEnvironment(value) {
  if (value === undefined || value === "") return DEFAULT_FLOOR_BYTES_PER_SECOND;
  if (!/^\d+$/u.test(value)) throw new Error("HARA_GITHUB_RELEASE_MIN_BYTES_PER_SECOND must be an integer");
  const floor = Number(value);
  if (floor < MIN_FLOOR_BYTES_PER_SECOND) {
    throw new Error(`HARA_GITHUB_RELEASE_MIN_BYTES_PER_SECOND must be at least ${MIN_FLOOR_BYTES_PER_SECOND}`);
  }
  return floor;
}

export function probeArguments(proxy) {
  if (!isLoopbackProxy(proxy)) throw new Error(`release proxy must be a loopback HTTP/SOCKS proxy: ${proxy}`);
  return [
    "--disable", "--proxy", proxy, "--proto", "=https", "--proto-redir", "=https",
    "--location", "--fail", "--silent", "--show-error",
    "--range", `0-${PROBE_BYTES - 1}`,
    "--connect-timeout", "10", "--max-time", String(PROBE_MAX_SECONDS),
    "--output", "/dev/null",
    "--write-out", "%{http_code} %{size_download} %{time_total}",
    PROBE_URL,
  ];
}

// curl exits non-zero on a timeout but still reports the bytes it received; the speed is then
// measured over the full probe window so a stalled route can never look fast.
export function parseProbe(stdout, status) {
  const match = /^(\d{3}) (\d+) ([\d.]+)$/u.exec(String(stdout ?? "").trim());
  if (!match) return { bytes: 0, seconds: PROBE_MAX_SECONDS, bytesPerSecond: 0, ok: false };
  const [, code, bytesText, secondsText] = match;
  const bytes = Number(bytesText);
  const complete = status === 0 && (code === "206" || code === "200") && bytes >= PROBE_BYTES;
  const seconds = complete ? Math.max(Number(secondsText), 0.001) : PROBE_MAX_SECONDS;
  return { bytes, seconds, bytesPerSecond: Math.floor(bytes / seconds), ok: complete };
}

function curlProbe(proxy) {
  const environment = { ...process.env, NO_PROXY: "", no_proxy: "" };
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) delete environment[key];
  const result = spawnSync("/usr/bin/curl", probeArguments(proxy), {
    encoding: "utf8", env: environment, timeout: (PROBE_MAX_SECONDS + 15) * 1_000,
  });
  return parseProbe(result.stdout, result.status);
}

export function selectProxy(candidates, { probe = curlProbe, floor = DEFAULT_FLOOR_BYTES_PER_SECOND, exclude = [] } = {}) {
  const unique = [...new Set(candidates.filter(Boolean))];
  if (unique.length === 0) throw new Error("no GitHub release proxy candidates are configured");
  for (const proxy of unique) {
    if (!isLoopbackProxy(proxy)) throw new Error(`release proxy must be a loopback HTTP/SOCKS proxy: ${proxy}`);
  }
  const results = unique.filter((proxy) => !exclude.includes(proxy)).map((proxy) => ({ proxy, ...probe(proxy) }));
  const qualified = results
    .filter((result) => result.ok && result.bytesPerSecond >= floor)
    .sort((a, b) => b.bytesPerSecond - a.bytesPerSecond);
  return { chosen: qualified[0]?.proxy ?? null, results, floor };
}

export function formatTable({ results, floor, chosen }) {
  const rows = results.map(({ proxy, bytes, seconds, bytesPerSecond, ok }) =>
    `  ${proxy === chosen ? "*" : " "} ${proxy.padEnd(28)} ${String(bytes).padStart(9)} B in ${seconds.toFixed(1).padStart(5)} s = ${(bytesPerSecond / 1024).toFixed(0).padStart(6)} KiB/s${ok ? "" : " (incomplete)"}`);
  return [`release-proxy-select: 8 MiB public probe per route; floor ${(floor / 1024).toFixed(0)} KiB/s`, ...rows].join("\n");
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) {
  try {
    const args = process.argv.slice(2);
    const exclude = [];
    while (args[0] === "--exclude") { exclude.push(args[1]); args.splice(0, 2); }
    const floor = floorFromEnvironment(process.env.HARA_GITHUB_RELEASE_MIN_BYTES_PER_SECOND);
    const selection = selectProxy(args, { floor, exclude });
    console.error(formatTable(selection));
    if (!selection.chosen) {
      console.error(`release-proxy-select: no GitHub route reached ${(floor / 1024).toFixed(0)} KiB/s; stopping before any release transfer`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${selection.chosen}\n`);
    }
  } catch (error) {
    console.error(`release-proxy-select: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
