[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v\d+\.\d+\.\d+$')]
  [string]$ReleaseTag,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$DesktopCommit,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$CliCommit,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ExpectedPublisher,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Fa-f0-9 ]{40,64}$')]
  [string]$ExpectedThumbprint,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string[]]$ArtifactSpec,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Output,

  [ValidateNotNullOrEmpty()]
  [string]$SignTool = 'signtool.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$version = $ReleaseTag.Substring(1)
$requiredRoles = [ordered]@{
  'installer-nsis' = "Hara_${version}_x64-setup.exe"
  'installer-msi' = "Hara_${version}_x64_en-US.msi"
  'nsis-desktop-executable' = 'hara-desktop.exe'
  'nsis-sidecar-executable' = 'hara.exe'
  'msi-desktop-executable' = 'hara-desktop.exe'
  'msi-sidecar-executable' = 'hara.exe'
}
$expectedThumbprint = $ExpectedThumbprint.Replace(' ', '').ToUpperInvariant()
if ($expectedThumbprint -notmatch '^[A-F0-9]{40}$') {
  throw 'ExpectedThumbprint must normalize to one 40-character certificate thumbprint.'
}
if ($ArtifactSpec.Count -ne $requiredRoles.Count) {
  throw "ArtifactSpec must contain exactly $($requiredRoles.Count) role=path entries."
}

$rolePaths = @{}
$resolvedPaths = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($spec in $ArtifactSpec) {
  $separator = $spec.IndexOf('=')
  if ($separator -le 0 -or $separator -eq ($spec.Length - 1)) {
    throw "ArtifactSpec entry must use role=path: $spec"
  }
  $role = $spec.Substring(0, $separator)
  $candidate = $spec.Substring($separator + 1)
  if (-not $requiredRoles.Contains($role)) {
    throw "Unexpected Authenticode artifact role: $role"
  }
  if ($rolePaths.ContainsKey($role)) {
    throw "Duplicate Authenticode artifact role: $role"
  }
  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  $item = Get-Item -LiteralPath $resolved -Force
  if (
    $item.PSProvider.Name -ne 'FileSystem' -or
    $item.PSIsContainer -or
    (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  ) {
    throw "Authenticode artifact must be a regular non-reparse file: $role"
  }
  if (-not [string]::Equals($item.Name, $requiredRoles[$role], [System.StringComparison]::Ordinal)) {
    throw "Authenticode artifact filename mismatch for ${role}: $($item.Name)"
  }
  if (-not $resolvedPaths.Add($resolved)) {
    throw "Each installer extraction must provide a distinct artifact path: $role"
  }
  $rolePaths[$role] = $resolved
}
foreach ($role in $requiredRoles.Keys) {
  if (-not $rolePaths.ContainsKey($role)) {
    throw "Missing Authenticode artifact role: $role"
  }
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
if (Test-Path -LiteralPath $outputPath) {
  throw "Refusing to replace an existing Authenticode receipt: $outputPath"
}
$outputParent = Split-Path -Parent $outputPath
if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
  throw "Authenticode receipt parent directory does not exist: $outputParent"
}
if ($resolvedPaths.Contains($outputPath)) {
  throw 'Authenticode receipt path must not replace a verified artifact.'
}

$signToolCommand = Get-Command -Name $SignTool -CommandType Application -ErrorAction Stop
$verifiedAt = [DateTime]::UtcNow
$artifacts = @()
foreach ($role in $requiredRoles.Keys) {
  $artifactPath = $rolePaths[$role]
  $initialItem = Get-Item -LiteralPath $artifactPath -Force
  $initialSize = [long]$initialItem.Length
  $initialHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode status is not Valid for ${role}: $($signature.Status)"
  }
  if ($null -eq $signature.SignerCertificate) {
    throw "Signer certificate is missing for $role"
  }
  if ($signature.SignatureType.ToString() -ne 'Authenticode') {
    throw "Signature type is not Authenticode for ${role}: $($signature.SignatureType)"
  }
  $signer = $signature.SignerCertificate
  $signerThumbprint = $signer.Thumbprint.Replace(' ', '').ToUpperInvariant()
  if (-not [string]::Equals($signer.Subject, $ExpectedPublisher, [System.StringComparison]::Ordinal)) {
    throw "Publisher subject mismatch for $role"
  }
  if ($signerThumbprint -ne $expectedThumbprint) {
    throw "Signer thumbprint mismatch for $role"
  }
  if ($verifiedAt -lt $signer.NotBefore.ToUniversalTime() -or $verifiedAt -gt $signer.NotAfter.ToUniversalTime()) {
    throw "Signer certificate is not currently valid for $role"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Trusted timestamp certificate is missing for $role"
  }

  $signToolOutput = @(& $signToolCommand.Source verify /pa /all /v $artifactPath 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "signtool trust-policy verification failed for $role"
  }
  $signToolText = $signToolOutput -join "`n"
  if ($signToolText -notmatch '(?im)^\s*Hash of file \(sha256\):') {
    throw "signtool did not report a SHA-256 file signature for $role"
  }

  $timestamp = $signature.TimeStamperCertificate
  $item = Get-Item -LiteralPath $artifactPath -Force
  $hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([long]$item.Length -ne $initialSize -or $hash -ne $initialHash) {
    throw "Authenticode artifact changed while it was being verified: $role"
  }
  $artifacts += [ordered]@{
    role = $role
    name = $item.Name
    size = $initialSize
    sha256 = $hash
    authenticodeStatus = 'Valid'
    signatureType = 'Authenticode'
    signatureDigestAlgorithm = 'sha256'
    signtoolPolicyVerified = $true
    signer = [ordered]@{
      subject = $signer.Subject
      thumbprint = $signerThumbprint
      notBefore = $signer.NotBefore.ToUniversalTime().ToString('o')
      notAfter = $signer.NotAfter.ToUniversalTime().ToString('o')
    }
    timestamp = [ordered]@{
      trustedCertificatePresent = $true
      subject = $timestamp.Subject
      thumbprint = $timestamp.Thumbprint.Replace(' ', '').ToUpperInvariant()
      notBefore = $timestamp.NotBefore.ToUniversalTime().ToString('o')
      notAfter = $timestamp.NotAfter.ToUniversalTime().ToString('o')
    }
  }
}

$receipt = [ordered]@{
  schema = 1
  releaseTag = $ReleaseTag
  target = 'x86_64-pc-windows-msvc'
  desktopCommit = $DesktopCommit
  cliCommit = $CliCommit
  verifiedAt = $verifiedAt.ToString('o')
  publisher = $ExpectedPublisher
  signerThumbprint = $expectedThumbprint
  signtoolPolicy = '/pa /all /v'
  artifacts = $artifacts
}
$temporaryOutput = Join-Path $outputParent ".$(Split-Path -Leaf $outputPath).$([Guid]::NewGuid().ToString('N')).tmp"
try {
  $json = $receipt | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText(
    $temporaryOutput,
    "$json`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporaryOutput -Destination $outputPath
} finally {
  if (Test-Path -LiteralPath $temporaryOutput) {
    Remove-Item -LiteralPath $temporaryOutput -Force
  }
}
Write-Output "windows-authenticode: verified $($artifacts.Count) signed roles and wrote $outputPath"
