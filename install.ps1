param(
  [ValidateSet("opencode", "claude", "both")][string]$Only = "both",
  [switch]$Check,
  [switch]$Uninstall,
  [switch]$Undo,
  [switch]$SkipClaudeInstall,
  [switch]$UpdateClaude
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$userHome = if ($env:OPENCODE_TEST_HOME) { $env:OPENCODE_TEST_HOME } else { $HOME }
$repository = if ($env:OPENCODE_DELTA_REPOSITORY) { $env:OPENCODE_DELTA_REPOSITORY } else { "Cruz1122/opencode" }
$installDir = if ($env:OPENCODE_DELTA_INSTALL_ROOT) { Join-Path $env:OPENCODE_DELTA_INSTALL_ROOT "bin" } else { Join-Path $userHome ".local\bin" }
$configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $userHome ".config" }
$configDir = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } else { Join-Path $configHome "opencode" }
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $userHome ".claude" }
$stateDir = Join-Path $env:LOCALAPPDATA "OpenCode-Delta\state"
$tempDir = $null
$profileInstalled = $false
$pathChanged = $false
$previousUserPath = [Environment]::GetEnvironmentVariable("Path", "User")

function Check-Exit([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw "$Message (exit code: $LASTEXITCODE)" }
}

function Set-UserPath([bool]$Add) {
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($current -split ";" | Where-Object { $_ -and $_.TrimEnd("\") -ine $installDir.TrimEnd("\") })
  $value = if ($Add) { (@($installDir) + $parts) -join ";" } else { $parts -join ";" }
  [Environment]::SetEnvironmentVariable("Path", $value, "User")
}

try {
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw "Windows tar.exe is required. No system packages will be installed." }
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $target = switch ($architecture) {
    "ARM64" { "windows-arm64" }
    "AMD64" { "windows-x64-baseline" }
    default { throw "Unsupported Windows architecture: $architecture" }
  }
  if ($Check) {
    Write-Host "Preflight OK (offline): $target; selection=$Only"
    Write-Host "User bin: $installDir; OpenCode: $configDir; Claude: $claudeDir"
    Write-Host "No elevation or development toolchain required. Network and executable policy are checked during installation."
    return
  }
  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ("opencode-delta-" + [guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tempDir | Out-Null
  $helper = Join-Path $stateDir "maintenance\opencode.exe"
  if ($Uninstall -or $Undo) {
    if (-not (Test-Path -LiteralPath $helper)) { throw "No managed installation helper found" }
    $binary = Join-Path $tempDir "opencode.exe"
    Copy-Item -LiteralPath $helper -Destination $binary
    $action = if ($Undo) { "undo" } else { "uninstall" }
    & $binary delta profile $action --state $stateDir
    Check-Exit "Profile removal refused or failed; inspect the reported managed file"
    if (-not (Test-Path (Join-Path $installDir "opencode.exe")) -and -not (Test-Path (Join-Path $installDir "claude.exe"))) { Set-UserPath $false }
    Write-Host "Managed profile $action complete. Claude executable, authentication, history and backups are preserved."
    return
  }
  $base = if ($env:OPENCODE_DELTA_RELEASE_BASE_URL) { $env:OPENCODE_DELTA_RELEASE_BASE_URL.TrimEnd("/") } else { "https://github.com/$repository/releases/latest/download" }
  if ($env:OPENCODE_DELTA_VERSION) {
    $root = if ($env:OPENCODE_DELTA_RELEASE_ROOT_URL) { $env:OPENCODE_DELTA_RELEASE_ROOT_URL.TrimEnd("/") } else { "https://github.com/$repository/releases/download" }
    $base = "$root/delta-v$env:OPENCODE_DELTA_VERSION"
  }
  $archive = "opencode-delta-$target.tar.gz"
  $archivePath = Join-Path $tempDir $archive
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile $archivePath
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive.sha256" -OutFile "$archivePath.sha256"
  $expected = ((Get-Content -LiteralPath "$archivePath.sha256" -Raw).Trim() -split "\s+")[0]
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($expected -notmatch "^[a-fA-F0-9]{64}$" -or $expected -ine $actual) { throw "Checksum mismatch: expected $expected; received $actual" }
  $tarErrors = Join-Path $tempDir "tar-errors.txt"
  $types = @(& tar.exe -tvzf $archivePath 2> $tarErrors)
  Check-Exit "Could not inspect archive types: $(Get-Content -LiteralPath $tarErrors -Raw)"
  foreach ($entry in $types) {
    if (-not $entry -or $entry.Substring(0, 1) -notin @("-", "d")) { throw "Archive contains links or special files" }
  }
  $paths = @(& tar.exe -tzf $archivePath)
  Check-Exit "Could not inspect archive paths"
  foreach ($entry in $paths) {
    if ([IO.Path]::IsPathRooted($entry) -or $entry -match "(^|[\\/])\.\.([\\/]|$)|:") { throw "Unsafe archive path: $entry" }
  }
  $bundle = Join-Path $tempDir "package"
  New-Item -ItemType Directory -Path $bundle | Out-Null
  & tar.exe -xzf $archivePath -C $bundle
  Check-Exit "Could not extract archive"
  $binary = Join-Path $bundle "bin\opencode.exe"
  if (-not (Test-Path -LiteralPath $binary)) { throw "Release executable is missing" }
  & $binary --version
  Check-Exit "Release executable failed to start; executable policy may block it"
  if ($Only -ne "opencode" -and -not $SkipClaudeInstall) {
    $claudeVersion = if ($env:CLAUDE_CODE_VERSION) { $env:CLAUDE_CODE_VERSION } else { "stable" }
    $claude = Get-Command claude -ErrorAction SilentlyContinue
    $nativeClaude = Join-Path $userHome ".local\bin\claude.exe"
    if ($claude) {
      if ($UpdateClaude) { & $claude.Source install $claudeVersion; Check-Exit "Explicit Claude update failed" }
      & $claude.Source --version
      Check-Exit "Existing Claude executable failed to start"
    } elseif (Test-Path -LiteralPath $nativeClaude) {
      if ($UpdateClaude) { & $nativeClaude install $claudeVersion; Check-Exit "Explicit Claude update failed" }
      & $nativeClaude --version
      Check-Exit "Existing native Claude executable failed to start"
    } else {
      Write-Host "Installing Claude from Anthropic (separate installer; may leave its own files on failure)."
      $claudeInstaller = Join-Path $tempDir "claude-install.ps1"
      Invoke-WebRequest -UseBasicParsing -Uri "https://claude.ai/install.ps1" -OutFile $claudeInstaller
      & powershell.exe -NoProfile -NonInteractive -File $claudeInstaller $claudeVersion
      Check-Exit "Anthropic installer failed; managed profile has not been changed"
      & $nativeClaude --version
      Check-Exit "Native Claude executable failed to start"
    }
  }
  New-Item -ItemType Directory -Path (Split-Path $helper) -Force | Out-Null
  Copy-Item -LiteralPath $binary -Destination $helper -Force
  & $binary delta profile install --bundle $bundle --home $userHome --config $configDir --claude $claudeDir --bin $installDir --state $stateDir --only $Only
  Check-Exit "Managed profile installation failed"
  $profileInstalled = $true
  Set-UserPath $true
  $pathChanged = $true
  $env:Path = "$installDir;$env:Path"
  Write-Host "Installation complete. Open a new terminal, authenticate separately, and use claude --agent ask (or plan, agent, debug, quality)."
  Write-Host "Rerun to update. Use -Undo to restore the previous generation or -Uninstall to remove managed generations."
} catch {
  if ($profileInstalled) {
    & $binary delta profile undo --state $stateDir
    if ($LASTEXITCODE -ne 0) { Write-Warning "Rollback failed. Backups remain in $stateDir" }
  }
  if ($pathChanged) { [Environment]::SetEnvironmentVariable("Path", $previousUserPath, "User") }
  Write-Error $_
  exit 1
} finally {
  if ($tempDir -and (Test-Path -LiteralPath $tempDir)) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}
