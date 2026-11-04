import { expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

// Opt-in: a real native release bundle, not the small fixture used by installer.test.ts.
test.skipIf(!process.env.OPENCODE_DELTA_TEST_RELEASE_DIR)(
  "native release installs and removes both profiles without a development runtime",
  async () => {
    const root = path.resolve(import.meta.dir, "../../..")
    const release = process.env.OPENCODE_DELTA_TEST_RELEASE_DIR!
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "delta native home "))
    const windows = process.platform === "win32"
    const env = {
      HOME: home,
      OPENCODE_TEST_HOME: home,
      LOCALAPPDATA: path.join(home, "AppData/Local"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
      XDG_DATA_HOME: path.join(home, ".local/share"),
      XDG_CACHE_HOME: path.join(home, ".cache"),
      XDG_STATE_HOME: path.join(home, ".local/state"),
      OPENCODE_CONFIG_DIR: path.join(home, "portable-opencode"),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      // A native release must not need the Bun/Node executable used by this test process.
      PATH: windows
        ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`
        : "/usr/bin:/bin",
      ...(windows ? { SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home } : {}),
    }
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const name = path.basename(new URL(request.url).pathname)
        return new Response(Bun.file(path.join(release, name)))
      },
    })
    try {
      await fs.mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true })
      const originalSettings = '{"env":{"FIXTURE_SETTING":"preserved"}}'
      const settingsFile = path.join(env.CLAUDE_CONFIG_DIR, "settings.json")
      await fs.writeFile(settingsFile, originalSettings, { mode: 0o600 })
      const run = async (args: string[], executable?: string) => {
        const command = executable
          ? [executable, ...args]
          : windows
            ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", path.join(root, "install.ps1"), ...args]
            : ["/bin/sh", path.join(root, "install.sh"), ...args]
        const child = Bun.spawn(command, {
          cwd: root,
          env: {
            ...env,
            OPENCODE_DELTA_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}`,
          },
          stdout: "pipe",
          stderr: "pipe",
        })
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        if (code) throw new Error(`${command.join(" ")} exited ${code}: ${stderr}\n${stdout}`)
        return stdout
      }
      await run(windows ? ["-SkipClaudeInstall"] : ["--skip-claude-install"])
      const binary = path.join(home, ".local/bin", windows ? "opencode.exe" : "opencode")
      const status = JSON.parse(await run(["delta", "status", "--json"], binary))
      expect(status.agents).toBe(15)
      expect(status.skills).toBe(33)
      expect(status.configDir).toBe(env.OPENCODE_CONFIG_DIR)
      if (!windows) expect((await fs.stat(settingsFile)).mode & 0o777).toBe(0o600)
      expect(await Bun.file(path.join(home, ".claude/agents/ask.md")).exists()).toBe(true)
      const agents = await run(["agent", "list"], binary)
      expect(agents).toContain("ask")
      expect(agents).toContain("quality")
      expect(agents).not.toContain("cybersecurity")
      await run(windows ? ["-Uninstall"] : ["--uninstall"])
      expect(await Bun.file(binary).exists()).toBe(false)
      expect(await Bun.file(path.join(home, ".claude/agents/ask.md")).exists()).toBe(false)
      expect(await fs.readFile(settingsFile, "utf8")).toBe(originalSettings)
    } finally {
      await server.stop(true)
      await fs.rm(home, { recursive: true, force: true })
    }
  },
  120_000,
)
