// Install layout checks for the GitHub-hosted Windows smoke.
import { copyFileSync, existsSync } from "node:fs";
import { join, win32 } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { SmokeError, check } from "./windows-install-workspace.mjs";

const readRegistrationScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$installer = New-Object -ComObject WindowsInstaller.Installer
function Invoke-Msi($object, $name, $kind, $arguments) {
    return $object.GetType().InvokeMember($name, $kind, $null, $object, $arguments)
}
$database = Invoke-Msi $installer 'OpenDatabase' 'InvokeMethod' @($env:HARA_INSTALL_SMOKE_MSI_PATH, 0)
function Read-MsiProperty($name) {
    $sql = 'SELECT {0}Value{0} FROM {0}Property{0} WHERE {0}Property{0}=''{1}''' -f ([char]96), $name
    $view = Invoke-Msi $database 'OpenView' 'InvokeMethod' @($sql)
    Invoke-Msi $view 'Execute' 'InvokeMethod' $null | Out-Null
    $record = Invoke-Msi $view 'Fetch' 'InvokeMethod' $null
    $value = Invoke-Msi $record 'StringData' 'GetProperty' @(1)
    Invoke-Msi $view 'Close' 'InvokeMethod' $null | Out-Null
    return $value
}
$productCode = Read-MsiProperty 'ProductCode'
$manufacturer = Read-MsiProperty 'Manufacturer'
$product = Read-MsiProperty 'ProductName'
if (!$productCode -or !$manufacturer -or !$product) { throw 'Missing MSI identity' }
if ($env:HARA_INSTALL_SMOKE_MSI_QUERY -eq 'migration') {
    $hasMatch = $false
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $hklm = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $view)
        try {
            $uninstall = $hklm.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
            if ($null -eq $uninstall) { continue }
            try {
                foreach ($name in $uninstall.GetSubKeyNames()) {
                    $entry = $uninstall.OpenSubKey($name)
                    if ($null -eq $entry) { continue }
                    try {
                        if ($entry.GetValue('DisplayName') -eq $product -and $entry.GetValue('Publisher') -eq $manufacturer -and
                            $entry.GetValue('UninstallString') -match 'msiexec') {
                            $hasMatch = $true
                            break
                        }
                    } finally { $entry.Dispose() }
                }
            } finally { $uninstall.Dispose() }
        } finally { $hklm.Dispose() }
        if ($hasMatch) { break }
    }
    @{ legacyMsiPresent = $hasMatch } | ConvertTo-Json -Compress
    exit
}
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\$manufacturer\$product")
$defaultPresent = $false
$installDirPresent = $false
$installDir = $null
if ($null -ne $key) {
    try {
        $names = $key.GetValueNames()
        $defaultPresent = $names -contains ''
        $installDirPresent = $names -contains 'InstallDir'
        if ($installDirPresent -and $key.GetValueKind('InstallDir') -eq [Microsoft.Win32.RegistryValueKind]::String) {
            $installDir = $key.GetValue('InstallDir', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
    } finally { $key.Dispose() }
}
@{
    productState = [int](Invoke-Msi $installer 'ProductState' 'GetProperty' @($productCode))
    defaultPresent = $defaultPresent
    installDirPresent = $installDirPresent
    installDir = $installDir
} | ConvertTo-Json -Compress
`;

async function readMsiRegistration(artifact, runtime, operation, cleanup = false) {
  const nsis = operation === "nsis.migration_check";
  const migration = nsis || operation === "msi.migration_removal_check";
  const encoded = Buffer.from(readRegistrationScript, "utf16le").toString("base64");
  const { stdout } = await runtime.command(nsis ? "nsis" : "msi", operation, "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      env: { ...process.env, HARA_INSTALL_SMOKE_MSI_PATH: artifact, HARA_INSTALL_SMOKE_MSI_QUERY: migration ? "migration" : "layout" },
      cleanup, capture: true,
    });
  // Raw registry paths stay in process memory and never reach a receipt.
  try { return JSON.parse(stdout); } catch { return null; }
}

export async function assertNoLegacyMsi(artifact, runtime, read = readMsiRegistration) {
  const result = await read(artifact, runtime, "nsis.migration_check");
  if (typeof result?.legacyMsiPresent !== "boolean") throw new SmokeError("nsis_migration_registration_unavailable");
  if (result.legacyMsiPresent) throw new SmokeError("nsis_legacy_msi_present");
}

export function windowsSmokeInstallers(required, mode) {
  if (mode === undefined) return required ? ["msi", "nsis"] : ["nsis"];
  if (mode === "--release-only") return required ? ["msi", "nsis"] : [];
  check(required, "Split installer smoke requires Windows credential storage");
  if (mode === "--nsis-only" || mode === "--nsis-precheck-only") return ["nsis"];
  if (mode === "--msi-only" || mode === "--msi-precheck-only") return ["msi"];
  throw new SmokeError("Invalid Windows install smoke arguments");
}

function validMsiRegistration(state) {
  return Number.isInteger(state?.productState) && typeof state.defaultPresent === "boolean"
    && typeof state.installDirPresent === "boolean";
}

function msiRegistrationClear(state) {
  return state.productState === -1 && !state.defaultPresent && !state.installDirPresent;
}

export async function assertMsiRegistrationClear(artifact, runtime, read = readMsiRegistration) {
  const state = await read(artifact, runtime, "msi.precheck");
  check(validMsiRegistration(state), "msi_registration_unavailable");
  check(msiRegistrationClear(state), "msi_preexisting_registration");
}

async function runMsi(action, artifact, root, runtime) {
  const install = action === "/i";
  const args = [action, artifact, "/qn", "/norestart", "REBOOT=ReallySuppress"];
  if (install) args.push(`INSTALLDIR=${root}`);
  try {
    return (await runtime.command("msi", install ? "msi.install" : "msi.uninstall", "msiexec.exe", args,
      { cleanup: !install, accepted: [0, 3010] })).exitCode;
  } catch (error) {
    if (error.outcome === "nonzero" && Number.isSafeInteger(error.exitCode)) return error.exitCode;
    throw error;
  }
}

function absoluteDirectory(value) {
  if (typeof value !== "string" || !/^[a-z]:[\\/]/iu.test(value) || value.includes("\0")) return null;
  return win32.resolve(value).toLowerCase();
}

export function classifyMsiDirectory(value, requested, programFiles) {
  const actual = absoluteDirectory(value);
  if (actual === null) return "unknown";
  if (actual === absoluteDirectory(requested)) return "requested";
  if (actual === absoluteDirectory(win32.join(win32.dirname(requested), "installed-nsis"))) return "previous_nsis";
  if (programFiles && actual === absoluteDirectory(win32.join(programFiles, "Hara"))) return "default_program_files";
  return "other";
}

export function installedBinaries(root) {
  return {
    desktopPresent: existsSync(join(root, "hara-desktop.exe")),
    corePresent: existsSync(join(root, "hara.exe")),
    workerPresent: existsSync(join(root, "hara-credential-worker.exe")),
  };
}

export async function installNsis(runtime, artifact, dest, profile) {
  check(!existsSync(dest), "Refusing to install into an existing location");
  // NSIS requires the /D argument to be last and unquoted, even with spaces.
  await runtime.command("nsis", "nsis.install", artifact, ["/S", `/D=${dest}`], { windowsVerbatimArguments: true });
  return async () => {
    check(runtime.canInstallOrRemove(), "exit_unconfirmed");
    const uninstaller = join(dest, "uninstall.exe"), copy = join(profile, "nsis-uninstall.exe");
    check(existsSync(uninstaller), "Installed NSIS uninstaller missing");
    copyFileSync(uninstaller, copy);
    // _?= disables the asynchronous temporary-copy relaunch. Its unquoted path is last.
    await runtime.command("nsis", "nsis.uninstall", copy, ["/S", `_?=${dest}`],
      { cleanup: true, windowsVerbatimArguments: true });
    await runtime.phase("nsis", "nsis.removal_check", async () => {
      const deadline = Math.min(5000, runtime.remaining({ cleanup: true })) + performance.now();
      const present = () => Object.values(installedBinaries(dest)).some(Boolean) || existsSync(join(dest, "herdr.exe"));
      while (present() && performance.now() < deadline) await wait(100);
      check(!present(), "nsis_uninstall_files_remain");
    }, { cleanup: true });
  };
}

export async function withMsiInstallation(artifact, root, observation, exercise, {
  runtime, readRegistration = readMsiRegistration, invoke = runMsi, binaries = installedBinaries, mode,
} = {}) {
  Object.assign(observation, {
    registrationClearBefore: null, installExitCode: null, directory: null,
    uninstallExitCode: null, registrationClearAfter: null, reason: null, cleanupReason: null,
  });
  if (mode === "--msi-only") observation.legacyMsiClearAfter = null;
  const require = (condition, reason, field = "reason") => {
    if (condition) return;
    observation[field] = reason;
    throw new SmokeError(reason);
  };
  const read = async (operation, field) => {
    const state = await readRegistration(artifact, runtime, operation, field === "cleanupReason");
    require(validMsiRegistration(state), "msi_registration_unavailable", field);
    return state;
  };
  const exitCode = async action => {
    const value = await invoke(action, artifact, root, runtime);
    return Number.isSafeInteger(value) ? value : null;
  };
  require(!existsSync(root), "msi_destination_exists");
  observation.registrationClearBefore = msiRegistrationClear(await read("msi.precheck"));
  require(observation.registrationClearBefore, "msi_preexisting_registration");
  const status = observation.installExitCode = await exitCode("/i");
  require(status === 0 || status === 3010, "msi_install_failed");
  let failed = false;
  try {
    Object.assign(observation, binaries(root));
    require(status !== 3010, "msi_reboot_required");
    const installed = await read("msi.layout");
    observation.directory = classifyMsiDirectory(installed.installDir, root, process.env.ProgramW6432 ?? process.env.ProgramFiles);
    require(installed.productState === 5, "msi_product_not_installed");
    require(installed.installDirPresent && observation.directory === "requested", "msi_install_dir_redirected");
    return await exercise();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      require(!runtime || runtime.canInstallOrRemove(), "exit_unconfirmed", "cleanupReason");
      const status = observation.uninstallExitCode = await exitCode("/x");
      require(status !== 3010, "msi_reboot_required", "cleanupReason");
      require(status === 0, "msi_uninstall_failed", "cleanupReason");
      observation.registrationClearAfter = msiRegistrationClear(await read("msi.removal_check", "cleanupReason"));
      require(observation.registrationClearAfter, "msi_residue_before_nsis", "cleanupReason");
      if (mode === "--msi-only") {
        // The NSIS leg uses a different VM. Keep the migration gate on the MSI VM as well.
        let migration;
        try {
          migration = await readRegistration(artifact, runtime, "msi.migration_removal_check", true);
        } catch (error) {
          observation.cleanupReason = "msi_legacy_registration_unavailable";
          throw error;
        }
        require(typeof migration?.legacyMsiPresent === "boolean", "msi_legacy_registration_unavailable", "cleanupReason");
        observation.legacyMsiClearAfter = !migration.legacyMsiPresent;
        require(observation.legacyMsiClearAfter, "msi_legacy_registration_remaining", "cleanupReason");
      }
    } catch (error) {
      // The receipt records cleanup failure too. Preserve the original failure when there is one.
      if (!failed) throw error;
    }
  }
}
