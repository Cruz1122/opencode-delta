<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/opencode-delta-mascot-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/opencode-delta-mascot-light.svg">
    <img src="assets/opencode-delta-mascot-dark.svg" alt="OpenCode Delta mascot" width="280">
  </picture>

  <h1>opencode-delta</h1>

  <p>A personal OpenCode fork with QoL improvements, custom agents and skills, risk-based quality gates, and optional Codex integration.</p>
</div>

## Install

### Linux and macOS

The release installer downloads a prebuilt Delta binary. Users do not need Bun,
Python, Fish, Git, or a local build toolchain.

```sh
curl -fsSL https://raw.githubusercontent.com/Cruz1122/opencode-delta/dev/install.sh | sh
```

To install a specific release:

```sh
export OPENCODE_DELTA_VERSION=1.18.30
curl -fsSL https://raw.githubusercontent.com/Cruz1122/opencode-delta/dev/install.sh | sh
```

### Windows

Run the installer from PowerShell. It downloads the matching Windows binary,
updates the user PATH, and does not require Bun, Python, Fish, or Git.

```powershell
irm https://raw.githubusercontent.com/Cruz1122/opencode-delta/dev/install.ps1 | iex
```

The first release is distributed as a PowerShell installer rather than an MSI.
Unsigned Windows builds may show a SmartScreen warning until code signing is
configured.

### Local development install

The source installer remains available for contributors who intentionally want
to build OpenCode locally:

```bash
git clone https://github.com/Cruz1122/opencode-delta.git opencode-delta
cd opencode-delta
./install-opencode-delta.sh
```

With Codex integration:

```bash
./install-opencode-delta.sh --codex
```

The release installers install the Delta binary before the upstream curl
installation path and move the known `~/.opencode/bin/opencode` executable into
the backup directory after validation. OpenCode data is not removed: chats,
projects, authentication, and MCP credentials remain in their existing data
directories. Existing configuration is backed up before the managed Delta
overlay is applied.

After installation, verify the selected binary and bundled capabilities with:

```sh
opencode delta status --json
```

If a download, checksum, extraction, configuration merge, or smoke check fails,
the installer restores the previous executable and configuration from the
reported backup directory.
