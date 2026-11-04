<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/opencode-delta-mascot-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/opencode-delta-mascot-light.svg">
    <img src="assets/opencode-delta-mascot-dark.svg" alt="OpenCode Delta mascot" width="280">
  </picture>
  <h1>opencode-delta</h1>
  <p>A personal OpenCode fork with QoL improvements and portable engineering agents and skills for OpenCode and Claude Code.</p>
</div>

## Install without administrator privileges

The installers download **prebuilt binaries from this fork's GitHub releases**.
No Git, Node, Bun, Python, Fish, compiler, `sudo`, or administrator account is
required for the release path. You need internet access and the ordinary OS
tools listed below. Cloning the repository is optional; cloning does not build
the application. The source archive alone is not an executable release.

The release workflow must have published a `delta-v*` release containing the new
installers and both suites before these commands can install this profile.
Do not use old release assets with a new installer.

### Windows

Use native Windows PowerShell 5.1 or newer, with Windows `tar.exe` (Windows 10
1809+). x64 uses the conservative baseline binary; ARM64 is detected separately.
Download [install.ps1](https://github.com/Cruz1122/opencode/releases/latest/download/install.ps1)
and inspect it before running:

```powershell
Invoke-WebRequest -UseBasicParsing https://github.com/Cruz1122/opencode/releases/latest/download/install.ps1 -OutFile install.ps1
Get-Content .\install.ps1
.\install.ps1 -Check
.\install.ps1
```

The default installs OpenCode and Claude Code. Use `-Only opencode` or
`-Only claude` to select one. Binaries default to `$HOME\.local\bin`; OpenCode
configuration uses `$HOME\.config\opencode` (or `XDG_CONFIG_HOME`) and Claude uses
`$HOME\.claude`. Only the **user** PATH is updated. Open a new terminal afterward.

If execution policy, antivirus, SmartScreen, or application control blocks the
script or the unsigned fork binary, stop and use your organization's approval
process. These installers do not change execution policy, bypass checks, or
elevate privileges. PowerShell's download command does not itself authorize the
downloaded code. The fork's Windows binary is not currently code-signed.

### Linux

Use `sh` with `curl`, `tar`, `mktemp`, a SHA-256 tool (`sha256sum` or `shasum`),
and standard Unix utilities. Installing Claude additionally needs Bash.
The installer selects x64/ARM64, AVX2/baseline, and glibc/musl. Missing system
libraries are reported, never installed with a package manager. Claude's
[additional musl dependencies](https://code.claude.com/docs/en/setup#alpine-linux-and-musl-based-distributions)
may need administrator provisioning; zero prerequisites is not a universal
promise across minimal distributions. The script also retains macOS detection.

```sh
curl -fLSs https://github.com/Cruz1122/opencode/releases/latest/download/install.sh -o install.sh
less install.sh
sh install.sh --check
sh install.sh
```

Use `--only opencode` or `--only claude` to select one. OpenCode defaults to
`~/.local/bin/opencode` and `${XDG_CONFIG_HOME:-~/.config}/opencode`; Claude
configuration defaults to `~/.claude`. A managed PATH block is added to the
user's shell startup files, with a separate Fish `conf.d` file. No system shell
configuration is modified. Do not run concurrent installers for the same user.

### From a clone, versions, and updates

If Git is already available:

```sh
git clone https://github.com/Cruz1122/opencode.git
cd opencode
sh install.sh --check
sh install.sh
```

On Windows, run `.\install.ps1` from the clone instead. Both paths download a
release, not dependencies for a source build. The repository contains the
installers, configuration, and release pipeline; it does not contain compiled
executables.

Updates are **manual**: rerun the installer. OpenCode's upstream updater and
Claude's background updater are disabled by the profile. Claude's own explicit
`claude update` remains available. To choose versions before running:

```powershell
$env:OPENCODE_DELTA_VERSION = "<Delta version without delta-v>"
$env:CLAUDE_CODE_VERSION = "<Claude version or stable>"
.\install.ps1
```

```sh
OPENCODE_DELTA_VERSION='<Delta version without delta-v>' CLAUDE_CODE_VERSION=stable sh install.sh
```

An existing Claude executable is reused rather than upgraded automatically;
pass `--update-claude` / `-UpdateClaude` to request an explicit native installation
of `CLAUDE_CODE_VERSION` (default `stable`) through the installer. This can migrate
a package-manager installation to Anthropic's native installation; leave the
flag off if that installation is managed elsewhere. `claude update` also remains
available separately. A missing Claude is
installed from Anthropic's official HTTPS installer, **not redistributed by this
fork**. No Git Bash or WSL is required for native Windows Claude Code according
to its [current official requirements](https://code.claude.com/docs/en/setup).
`--skip-claude-install` / `-SkipClaudeInstall` configures the selected profiles
without installing or checking the Claude executable.

## Your agents and skills

The checked-in `suite/opencode` and `suite/claude` snapshots contain 15 personal
roles and 33 skills (32 selected personal skills plus the optional-tool Playwright
guide). They exclude `cybersecurity`, `dummy`, and the cybersecurity tutor,
privilege-escalation, and pentest-analysis skills. Defensive `security-auditor`
and `secure-development` remain. Exclusions apply to the distribution; the
installer does not delete unrelated agents already installed by the user.

In OpenCode select `ask` (default), `plan`, `agent`, `debug`, or `quality`.
In Claude Code start the desired primary role explicitly:

```sh
claude --agent ask
claude --agent plan
claude --agent agent
claude --agent debug
claude --agent quality
```

Other custom roles are available through agent delegation and `/agents`.
Claude's default session without `--agent` receives the global contract, not
OpenCode's `ask` agent selection. Models inherit the application's selected
model: no personal provider or subagent model is forced. Authenticate separately
in each application; no credentials, sessions, or shell profiles from the source
workstation are shipped.

OpenCode custom tools and its workflow plugin remain OpenCode-only. Claude's
adapter uses native file, search, shell, and agent tools where available and
requires explicit quality handoff. Do not assume identical nested delegation or
automatic orchestration. The portable planning role is read-only and presents
plans **in chat**, rather than relying on a Linux-only writable temporary path.
Claude's archivist proposes candidates in its response rather than bypassing
the missing `brain_write_candidate` boundary.

Settings preserve secret-reading restrictions. Claude's `.env.*` deny rule is
intentionally stricter than OpenCode's `.env.example` exception. Shell and edit
approval remain enabled; role prompts and user settings are **not a sandbox or
enterprise-managed enforcement** and cannot override corporate policies.

### Optional browser and diagram tooling

Suitable, permitted native browser capabilities come first. Playwright is used
only when those cannot perform or verify the required action; Chrome DevTools
is an optional diagnostic fallback. Neither is installed or configured as an
MCP by default. No tool is assumed to exist, and a fallback must never bypass a
permission denial. Install/configure these separately with approval if needed.
GNS3 and Packet Tracer MCPs are not bundled. Domain skills do not install their
referenced applications. Mermaid rendering is also optional and reports a
missing dependency rather than downloading a browser during base installation.

## Backups, rollback, and removal

Managed writes are backed up individually, including original instructions,
settings, executable, and shell PATH files. Settings are merged; an existing
OpenCode `opencode.jsonc` takes precedence and is updated instead of creating a
competing JSON file (its comments are normalized away; the exact original is
backed up). Instruction
blocks are replaced idempotently; unrelated files are left alone. Existing
OpenCode history/authentication and upstream binaries are not removed.

```powershell
.\install.ps1 -Undo       # restore the previous managed generation
.\install.ps1 -Uninstall  # restore the state before all managed generations
```

```sh
sh install.sh --undo
sh install.sh --uninstall
```

Removal is offline through a cached maintenance executable. If a managed file
was edited afterward, removal stops **before writing** and identifies the file.
Preserve/reconcile that edit first; there is deliberately no force-delete flag.
Backups remain under `${XDG_STATE_HOME:-~/.local/state}/opencode-delta` on Unix
and `%LOCALAPPDATA%\OpenCode-Delta\state` on Windows. Keep them for recovery.
Do not relocate or edit the journals.

Anthropic's installer is a separate transaction: failures may leave Claude's own
installation files, and removing this profile deliberately does not uninstall
Claude or delete its login/history. See the [official removal instructions](https://code.claude.com/docs/en/setup#uninstall-claude-code)
if you also want to remove that executable. The kit does not promise atomic
rollback of external installers or recovery from power loss during restoration.

The offline `--check` / `-Check` detects basic prerequisites only; it does not
prove network reachability, executable-policy approval, or successful login.
Release SHA-256 files detect corruption, not a compromised release publisher.

## Maintaining the snapshot and releases

Build-time tools are needed only for contributors. To explicitly refresh the
personal snapshot (not a prerequisite for release builds):

```sh
bun script/export-user-suite.ts --source /path/to/opencode-config --output suite --playwright-skill /path/to/playwright-cli-skill
```

Review the exported diff for secrets and machine-specific assumptions before
publishing. The output must be a dedicated directory named `suite`. Do not point
the exporter at a repository root or at its own output.
The release workflow uses the checked-in snapshot, builds platform binaries,
packages both suites, and publishes installers plus checksums on a `delta-v*`
tag or manual workflow dispatch. Publishing requires an explicit Git action;
running an installer never publishes anything.

Run focused checks from the package, not the repository root:

```sh
cd packages/opencode
bun test test/installer.test.ts test/user-suite.test.ts test/user-suite-export.test.ts test/release-output.test.ts
bun typecheck
```

Installer tests use temporary homes, a local HTTP fixture, and the real profile
transaction implementation. They do not install Claude, log in, or prove native
Windows compatibility. Validate an actual release on a standard Windows user
and a Linux user before treating it as ready for workplace deployment.
