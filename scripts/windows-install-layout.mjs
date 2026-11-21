// Install layout checks for the GitHub-hosted Windows smoke.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, win32 } from "node:path";
import { SmokeError } from "./windows-install-workspace.mjs";

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

function readMsiRegistration(artifact) {
  const encoded = Buffer.from(readRegistrationScript, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    env: { ...process.env, HARA_INSTALL_SMOKE_MSI_PATH: artifact },
    encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  // The raw registry path is private. Never use subprocess output in an error or receipt.
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function runMsi(action, artifact, root) {
  const args = [action, artifact, "/qn", "/norestart"];
  if (action === "/i") args.push(`INSTALLDIR=${root}`);
  const result = spawnSync("msiexec.exe", args, { timeout: 300_000, windowsHide: true, stdio: "ignore" });
  return result.error ? null : result.status;
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

export async function withMsiInstallation(artifact, root, observation, exercise, {
  readRegistration = readMsiRegistration, invoke = runMsi, binaries = installedBinaries,
} = {}) {
  Object.assign(observation, {
    registrationClearBefore: null, installExitCode: null, directory: null,
    uninstallExitCode: null, registrationClearAfter: null, reason: null, cleanupReason: null,
  });
  const require = (condition, reason, field = "reason") => {
    if (condition) return;
    observation[field] = reason;
    throw new SmokeError(reason);
  };
  const read = (field) => {
    const state = readRegistration(artifact);
    require(Number.isInteger(state?.productState) && typeof state.defaultPresent === "boolean"
      && typeof state.installDirPresent === "boolean", "msi_registration_unavailable", field);
    return state;
  };
  const exitCode = action => {
    const value = invoke(action, artifact, root);
    return Number.isSafeInteger(value) ? value : null;
  };
  const clear = state => state.productState === -1 && !state.defaultPresent && !state.installDirPresent;

  require(!existsSync(root), "msi_destination_exists");
  observation.registrationClearBefore = clear(read());
  require(observation.registrationClearBefore, "msi_preexisting_registration");
  const status = observation.installExitCode = exitCode("/i");
  require(status === 0 || status === 3010, "msi_install_failed");
  let failed = false;
  try {
    Object.assign(observation, binaries(root));
    require(status !== 3010, "msi_reboot_required");
    const installed = read();
    observation.directory = classifyMsiDirectory(installed.installDir, root, process.env.ProgramW6432 ?? process.env.ProgramFiles);
    require(installed.productState === 5, "msi_product_not_installed");
    require(installed.installDirPresent && observation.directory === "requested", "msi_install_dir_redirected");
    return await exercise();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      const status = observation.uninstallExitCode = exitCode("/x");
      require(status !== 3010, "msi_reboot_required", "cleanupReason");
      require(status === 0, "msi_uninstall_failed", "cleanupReason");
      observation.registrationClearAfter = clear(read("cleanupReason"));
      require(observation.registrationClearAfter, "msi_residue_before_nsis", "cleanupReason");
    } catch (error) {
      // The receipt records cleanup failure too. Preserve the original failure when there is one.
      if (!failed) throw error;
    }
  }
}
