$ErrorActionPreference = "Stop"

$repository = if ($env:OPENCODE_DELTA_REPOSITORY) { $env:OPENCODE_DELTA_REPOSITORY } else { "Cruz1122/opencode-delta" }
$baseUrl = if ($env:OPENCODE_DELTA_RELEASE_BASE_URL) {
  $env:OPENCODE_DELTA_RELEASE_BASE_URL.TrimEnd("/")
} else {
  "https://github.com/$repository/releases/latest/download"
}
$version = $env:OPENCODE_DELTA_VERSION
$installRoot = if ($env:OPENCODE_DELTA_INSTALL_ROOT) { $env:OPENCODE_DELTA_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA "OpenCode-Delta" }
$installDir = Join-Path $installRoot "bin"
$configDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $env:APPDATA "opencode" }
$stateDir = Join-Path $env:LOCALAPPDATA "OpenCode-Delta\state"
$backupDir = Join-Path $stateDir ("backups\{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $PID)
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("opencode-delta-install-{0}" -f $PID)
$targetBinary = Join-Path $installDir "opencode.exe"
$upstreamBinary = Join-Path $HOME ".opencode\bin\opencode.exe"
$committed = $false
$configExisted = Test-Path $configDir
$targetBinaryExisted = Test-Path $targetBinary
$upstreamBinaryExisted = Test-Path $upstreamBinary
$configBackedUp = $false
$targetBinaryBackedUp = $false
$upstreamBinaryBackedUp = $false
$pathChanged = $false
$previousUserPath = $null
$mutating = $false

function Fail([string]$Message) {
  throw $Message
}

function Restore-State {
  if ($committed) { return }
  if (-not $mutating) { return }
  Write-Error "Installation failed; restoring previous state"
  if (Test-Path $configDir) { Remove-Item -LiteralPath $configDir -Recurse -Force }
  if ($configBackedUp) {
    New-Item -ItemType Directory -Path (Split-Path $configDir) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $backupDir "config") -Destination $configDir -Recurse -Force
  }
  if (Test-Path $targetBinary) { Remove-Item -LiteralPath $targetBinary -Force }
  if ($targetBinaryBackedUp) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $backupDir "target-opencode.exe") -Destination $targetBinary -Force
  }
  if ($upstreamBinaryBackedUp -and -not (Test-Path $upstreamBinary)) {
    New-Item -ItemType Directory -Path (Split-Path $upstreamBinary) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $backupDir "upstream-opencode.exe") -Destination $upstreamBinary -Force
  }
  if ($pathChanged) {
    [Environment]::SetEnvironmentVariable("Path", $previousUserPath, "User")
  }
}

try {
  New-Item -ItemType Directory -Path $tempDir, $backupDir -Force | Out-Null
  $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($osArch -eq "Arm64") {
    $arch = "arm64"
  } elseif ($osArch -eq "X64") {
    $arch = "x64"
  } else {
    Fail "Unsupported Windows architecture: $osArch"
  }

  $baseline = $false
  if ($arch -eq "x64") {
    $baseline = -not [System.Runtime.Intrinsics.X86.Avx2]::IsSupported
  }
  $target = "windows-$arch"
  if ($baseline) { $target += "-baseline" }
  $archive = "opencode-delta-$target.tar.gz"
  $releaseBase = $baseUrl
  if ($version) {
    $releaseRoot = if ($env:OPENCODE_DELTA_RELEASE_ROOT_URL) { $env:OPENCODE_DELTA_RELEASE_ROOT_URL.TrimEnd("/") } else { "https://github.com/$repository/releases/download" }
    $releaseBase = "$releaseRoot/delta-v$version"
  }
  $archivePath = Join-Path $tempDir $archive
  $checksumPath = "$archivePath.sha256"

  Write-Host "==> Installing OpenCode Delta ($target)"
  Invoke-WebRequest -Uri "$releaseBase/$archive" -OutFile $archivePath
  Invoke-WebRequest -Uri "$releaseBase/$archive.sha256" -OutFile $checksumPath
  $expected = ((Get-Content -LiteralPath $checksumPath -Raw) -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected.Length -ne 64 -or $expected -ne $actual) { Fail "Checksum mismatch for $archive" }

  $packageDir = Join-Path $tempDir "package"
  New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
  $archiveTypes = Join-Path $tempDir "archive.types"
  $archiveListing = & tar.exe -tvzf $archivePath
  if ($LASTEXITCODE -ne 0) { Fail "Could not inspect release entry types" }
  $archiveListing | Set-Content -LiteralPath $archiveTypes
  foreach ($entry in (Get-Content -LiteralPath $archiveTypes)) {
    $entryType = $entry.Substring(0, 1)
    if ($entryType -ne "-" -and $entryType -ne "d") {
      Fail "Release contains a symlink, hardlink, or special file"
    }
  }
  foreach ($entry in (& tar.exe -tzf $archivePath)) {
    if ([IO.Path]::IsPathRooted($entry) -or $entry -match "(^|[\\/])\.\.([\\/]|$)") {
      Fail "Release contains an unsafe archive path: $entry"
    }
  }
  & tar.exe -xzf $archivePath -C $packageDir
  if ($LASTEXITCODE -ne 0) { Fail "Could not extract $archive" }
  $bundle = $packageDir
  $binary = Join-Path $bundle "bin\opencode.exe"
  if (-not (Test-Path $binary)) {
    $binary = Join-Path $bundle "bin\opencode"
  }
  if (-not (Test-Path $binary)) { Fail "Release does not contain an OpenCode executable" }
  if (-not (Test-Path (Join-Path $bundle "delta-bundle.json"))) { Fail "Release metadata is missing" }
  if (-not (Test-Path (Join-Path $bundle "suite\opencode\opencode.json"))) { Fail "OpenCode suite is missing" }
  if (-not (Test-Path (Join-Path $bundle "suite\opencode\skills"))) { Fail "OpenCode skills are missing" }

  if ($configExisted) {
    Copy-Item -LiteralPath $configDir -Destination (Join-Path $backupDir "config") -Recurse -Force
    $configBackedUp = $true
  }
  if ($targetBinaryExisted) {
    Copy-Item -LiteralPath $targetBinary -Destination (Join-Path $backupDir "target-opencode.exe") -Force
    $targetBinaryBackedUp = $true
  }
  if ($upstreamBinaryExisted) {
    Copy-Item -LiteralPath $upstreamBinary -Destination (Join-Path $backupDir "upstream-opencode.exe") -Force
    $upstreamBinaryBackedUp = $true
  }

  $mutating = $true
  New-Item -ItemType Directory -Path $configDir, $installDir -Force | Out-Null
  foreach ($directory in @("agents", "instructions", "plugins", "tools", "lib", "brain-templates", "cursor", "bin", "skills")) {
    $source = Join-Path $bundle "suite\opencode\$directory"
    if (Test-Path $source) {
      $destination = Join-Path $configDir $directory
      New-Item -ItemType Directory -Path $destination -Force | Out-Null
      Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
    }
  }
  $nodeModules = Join-Path $bundle "suite\opencode\node_modules"
  if (Test-Path $nodeModules) {
    $destination = Join-Path $configDir "node_modules"
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $nodeModules "*") -Destination $destination -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $bundle "suite\opencode\package.json") -Destination (Join-Path $configDir "package.json") -Force

  & $binary delta install-config `
    --source (Join-Path $bundle "suite\opencode\opencode.json") `
    --target (Join-Path $configDir "opencode.json") `
    --agents-source (Join-Path $bundle "suite\opencode\AGENTS.md") `
    --agents-target (Join-Path $configDir "AGENTS.md")
  if ($LASTEXITCODE -ne 0) { Fail "Delta configuration merge failed" }

  $newBinary = Join-Path $installDir (".opencode-delta-{0}.exe" -f $PID)
  Copy-Item -LiteralPath $binary -Destination $newBinary -Force
  Move-Item -LiteralPath $newBinary -Destination $targetBinary -Force

  $metadata = Get-Content -LiteralPath (Join-Path $bundle "delta-bundle.json") -Raw | ConvertFrom-Json
  $marker = [ordered]@{
    product = "opencode-delta"
    version = [string]$metadata.version
    installedAt = (Get-Date).ToUniversalTime().ToString("o")
    mascot = $true
    autopilot = $true
    target = $target
    installDir = $installDir
    backupDir = $backupDir
  }
  $marker | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $configDir "delta.json") -Encoding UTF8

  if (Test-Path $upstreamBinary) {
    Move-Item -LiteralPath $upstreamBinary -Destination (Join-Path $backupDir "upstream-opencode.exe") -Force
  }
  & $targetBinary delta status --json | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Installed Delta binary failed its status check" }

  $installState = [ordered]@{
    product = "opencode-delta"
    version = [string]$metadata.version
    target = $target
    installDir = $installDir
    configDir = $configDir
    backupDir = $backupDir
    dataPreserved = $true
  }
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $installState | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir "install.json") -Encoding UTF8
  try {
    $previousUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $userPath = $previousUserPath
    $parts = @($userPath -split ";" | Where-Object { $_ -and $_.TrimEnd("\") -ne $installDir.TrimEnd("\") })
    [Environment]::SetEnvironmentVariable("Path", (($installDir) + $parts -join ";"), "User")
    $pathChanged = $true
    $env:Path = "$installDir;$env:Path"
  } catch {
    if ($pathChanged) {
      [Environment]::SetEnvironmentVariable("Path", $previousUserPath, "User")
      $pathChanged = $false
    }
    Fail "Could not update the user PATH: $_"
  }
  $committed = $true
  Write-Host ""
  Write-Host "OpenCode Delta installation complete."
  Write-Host "Open a new terminal, then run: opencode delta status --json"
  Write-Host "Backup: $backupDir"
} catch {
  Restore-State
  Write-Error $_
  exit 1
} finally {
  if (Test-Path $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}
