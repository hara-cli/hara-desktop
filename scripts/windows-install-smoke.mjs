// Windows post-install smoke (HARA-FB-001698), hosted runner only: install the NSIS package that this
// prepackage run just built, launch the real Desktop with an isolated HOME/USERPROFILE, and require the
// formal Workspace engine to start and publish its discovery. File and process assertions decide; the
// evidence stays in the job log (prepackage uploads nothing). Never runs outside GitHub Actions on Windows.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fail = message => { console.error(`windows-install-smoke: ${message}`); process.exit(1); };
if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) fail("hosted Windows runner only");
const [releaseBase, output] = process.argv.slice(2);
if (!releaseBase || !output) fail("usage: node scripts/windows-install-smoke.mjs <target release dir> <evidence dir>");
mkdirSync(output, { recursive: true });
const log = [];
const note = line => { log.push(`${new Date().toISOString()} ${line}`); console.log(line); };
const finish = code => { writeFileSync(join(output, "windows-install-smoke.log"), `${log.join("\n")}\n`); process.exit(code); };

const nsisDir = join(releaseBase, "bundle", "nsis");
const setups = existsSync(nsisDir) ? readdirSync(nsisDir).filter(name => name.endsWith("-setup.exe")) : [];
if (setups.length !== 1) fail(`expected exactly one NSIS installer in ${nsisDir}, found ${setups.length}`);
const install = spawnSync(join(nsisDir, setups[0]), ["/S"], { stdio: "inherit", timeout: 300_000 });
if (install.status !== 0) fail(`silent install failed: ${install.status ?? install.error}`);
const installRoot = join(process.env.LOCALAPPDATA, "Hara");
const app = join(installRoot, "hara-desktop.exe");
if (!existsSync(app) || !existsSync(join(installRoot, "hara.exe"))) fail(`installed Desktop or engine missing under ${installRoot}`);
note(`installed ${setups[0]} -> ${installRoot}`);

// A fresh account Home in the plain C:\Users\... form, exactly as a first launch sees it.
const home = join(process.env.USERPROFILE, `hara-install-smoke-${process.pid}`);
mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home };
const desktop = spawn(app, [], { env, detached: true, stdio: "ignore" });
note(`launched Desktop pid=${desktop.pid} with isolated home ${home}`);

const discovery = join(home, ".hara", "workspaces-v1", "home", ".hara", "workspace-runtime", "serve-v2.json");
const deadline = Date.now() + 180_000;
let record = null;
while (Date.now() < deadline) {
  if (existsSync(discovery)) { try { record = JSON.parse(readFileSync(discovery, "utf8")); break; } catch { /* still being written */ } }
  if (desktop.exitCode !== null) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
const tasks = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout ?? "";
const engineAlive = record && tasks.split(/\r?\n/).some(row => row.startsWith('"hara.exe"') && row.includes(`"${record.pid}"`));
for (const name of ["workspace-startup.log", "workspace-core-stderr.log"]) {
  const file = join(home, ".hara", name);
  if (existsSync(file)) { writeFileSync(join(output, name), readFileSync(file)); note(`${name}: ${readFileSync(file, "utf8").trim().split(/\r?\n/).slice(-5).join(" | ")}`); }
}
for (const pid of [record?.pid, desktop.pid].filter(Boolean)) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
if (!record) { note(`FAIL no Workspace discovery within 180s (Desktop exit=${desktop.exitCode})`); finish(1); }
if (record.schemaVersion !== 2 || record.executionMode !== "workspace" || !(record.port > 0)) { note(`FAIL unexpected discovery schema`); finish(1); }
if (!engineAlive) { note(`FAIL engine pid ${record.pid} was not a live hara.exe`); finish(1); }
note(`OK formal Workspace engine hara.exe pid=${record.pid} published port ${record.port}`);
finish(0);
