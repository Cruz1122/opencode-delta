import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-delta-installer-"))
const archive = path.join(fixtureRoot, "opencode-delta-fixture.tar.gz")
const archiveBytes = await makeFixture()
const checksum = createHash("sha256").update(archiveBytes).digest("hex")
const maliciousArchive = path.join(fixtureRoot, "opencode-delta-malicious.tar.gz")
const maliciousBytes = await makeMaliciousFixture()
const maliciousChecksum = createHash("sha256").update(maliciousBytes).digest("hex")
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const malicious = new URL(request.url).pathname.includes("/malicious")
    const selectedChecksum = malicious ? maliciousChecksum : checksum
    const selectedArchive = malicious ? maliciousBytes : archiveBytes
    return new Response(
      new URL(request.url).pathname.endsWith(".sha256") ? `${selectedChecksum}  fixture.tar.gz\n` : selectedArchive,
    )
  },
})

afterAll(async () => {
  server.stop(true)
  await fs.rm(fixtureRoot, { recursive: true, force: true })
})

test("installs a release without replacing user data", async () => {
  const home = await fs.mkdtemp(path.join(fixtureRoot, "home-success-"))
  const config = path.join(home, "config", "opencode")
  const data = path.join(home, "data", "opencode")
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(data, { recursive: true })
  await fs.writeFile(path.join(config, "opencode.json"), '{"user":true}\n')
  await fs.writeFile(path.join(data, "opencode.db"), "chat data")
  await fs.mkdir(path.join(home, ".opencode", "bin"), { recursive: true })
  await fs.writeFile(path.join(home, ".opencode", "bin", "opencode"), "upstream")

  const result = await runInstaller(home, config, data)
  expect(result.exitCode).toBe(0)
  expect(await fs.readFile(path.join(data, "opencode.db"), "utf8")).toBe("chat data")
  expect(await fs.readFile(path.join(home, ".local", "bin", "opencode"), "utf8")).toContain("fixture")
  expect(await fs.stat(path.join(home, ".local", "state", "opencode-delta", "install.json"))).toBeTruthy()
  await expect(fs.stat(path.join(home, ".opencode", "bin", "opencode"))).rejects.toThrow()
})

test("restores the previous installation when post-install validation fails", async () => {
  const home = await fs.mkdtemp(path.join(fixtureRoot, "home-rollback-"))
  const config = path.join(home, "config", "opencode")
  const data = path.join(home, "data", "opencode")
  const target = path.join(home, ".local", "bin", "opencode")
  const upstream = path.join(home, ".opencode", "bin", "opencode")
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(data, { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.mkdir(path.dirname(upstream), { recursive: true })
  await fs.writeFile(path.join(config, "opencode.json"), '{"previous":true}\n')
  await fs.writeFile(target, "previous-target")
  await fs.writeFile(upstream, "previous-upstream")

  const result = await runInstaller(home, config, data, { FAKE_STATUS_FAIL: "1" })
  expect(result.exitCode).not.toBe(0)
  expect(await fs.readFile(target, "utf8")).toBe("previous-target")
  expect(await fs.readFile(upstream, "utf8")).toBe("previous-upstream")
  expect(await fs.readFile(path.join(config, "opencode.json"), "utf8")).toBe('{"previous":true}\n')
})

test("rejects unsafe archive entries before changing the installation", async () => {
  const home = await fs.mkdtemp(path.join(fixtureRoot, "home-unsafe-"))
  const config = path.join(home, "config", "opencode")
  const data = path.join(home, "data", "opencode")
  const target = path.join(home, ".local", "bin", "opencode")
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(path.join(config, "opencode.json"), '{"previous":true}\n')
  await fs.writeFile(target, "previous-target")

  const result = await runInstaller(home, config, data, {}, "/malicious")
  expect(result.exitCode).not.toBe(0)
  expect(await fs.readFile(target, "utf8")).toBe("previous-target")
  expect(await fs.readFile(path.join(config, "opencode.json"), "utf8")).toBe('{"previous":true}\n')
})

test("keeps PowerShell rollback guards as an explicit contract", async () => {
  const script = await fs.readFile(path.join(root, "install.ps1"), "utf8")
  expect(script).toContain("$mutating = $false")
  expect(script).toContain("if (-not $mutating) { return }")
  expect(script).toContain("$configBackedUp = $false")
  expect(script).toContain("$pathChanged = $false")
  expect(script).toContain("tar.exe -tvzf")
})

test("restores shell configuration when PATH commit fails", async () => {
  const home = await fs.mkdtemp(path.join(fixtureRoot, "home-path-rollback-"))
  const config = path.join(home, "config", "opencode")
  const data = path.join(home, "data", "opencode")
  const target = path.join(home, ".local", "bin", "opencode")
  await fs.mkdir(config, { recursive: true })
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.mkdir(path.join(home, ".profile"), { recursive: true })
  await fs.writeFile(path.join(config, "opencode.json"), '{"previous":true}\n')
  await fs.writeFile(target, "previous-target")

  const result = await runInstaller(home, config, data)
  expect(result.exitCode).not.toBe(0)
  expect((await fs.stat(path.join(home, ".profile"))).isDirectory()).toBe(true)
  expect(await fs.readFile(target, "utf8")).toBe("previous-target")
})

async function runInstaller(
  home: string,
  config: string,
  data: string,
  extra: Record<string, string> = {},
  basePath = "",
) {
  const env = {
    ...process.env,
    ...extra,
    HOME: home,
    XDG_CONFIG_HOME: path.dirname(config),
    XDG_DATA_HOME: path.dirname(data),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    OPENCODE_CONFIG_DIR: config,
    OPENCODE_DELTA_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}${basePath}`,
    PATH: process.env.PATH,
  }
  const processHandle = Bun.spawn(["sh", path.join(root, "install.sh")], { cwd: root, env })
  const [stdout, stderr] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ])
  return { exitCode: await processHandle.exited, stdout, stderr }
}

async function makeMaliciousFixture() {
  const stage = await fs.mkdtemp(path.join(fixtureRoot, "malicious-stage-"))
  await fs.mkdir(path.join(stage, "bin"), { recursive: true })
  await fs.mkdir(path.join(stage, "suite", "opencode"), { recursive: true })
  await fs.writeFile(path.join(stage, "bin", "opencode"), "#!/bin/sh\n")
  await fs.chmod(path.join(stage, "bin", "opencode"), 0o755)
  await fs.writeFile(path.join(stage, "delta-bundle.json"), '{"version":"malicious"}\n')
  await fs.symlink("/tmp/opencode-delta-outside", path.join(stage, "escape"))
  await runCommand(["tar", "-czf", maliciousArchive, "-C", stage, "."])
  const bytes = await fs.readFile(maliciousArchive)
  await fs.rm(stage, { recursive: true, force: true })
  return bytes
}

async function makeFixture() {
  const stage = await fs.mkdtemp(path.join(fixtureRoot, "stage-"))
  const binary = path.join(stage, "bin", "opencode")
  const suite = path.join(stage, "suite", "opencode")
  await fs.mkdir(path.join(suite, "skills", "fixture"), { recursive: true })
  await fs.mkdir(path.join(suite, "agents"), { recursive: true })
  await fs.mkdir(path.join(suite, "instructions"), { recursive: true })
  await fs.mkdir(path.dirname(binary), { recursive: true })
  const fixtureScript = [
    "#!/bin/sh",
    'if [ "$1" = "delta" ] && [ "$2" = "install-config" ]; then',
    '  while [ "$#" -gt 0 ]; do',
    '    case "$1" in',
    '      --source) source="$2"; shift 2;;',
    '      --target) target="$2"; shift 2;;',
    "      *) shift;;",
    "    esac",
    "  done",
    '  mkdir -p "$(dirname "$target")"',
    '  cp "$source" "$target"',
    "  exit 0",
    "fi",
    'if [ "$1" = "delta" ] && [ "$2" = "status" ] && [ "${FAKE_STATUS_FAIL:-0}" = "1" ]; then exit 1; fi',
    'printf "fixture binary\\n"',
  ].join("\n")
  await fs.writeFile(binary, fixtureScript + "\n")
  await fs.chmod(binary, 0o755)
  await fs.writeFile(path.join(suite, "opencode.json"), '{"delta":true}\n')
  await fs.writeFile(path.join(suite, "AGENTS.md"), "delta agents\n")
  await fs.writeFile(path.join(suite, "package.json"), '{"name":"opencode-delta"}\n')
  await fs.writeFile(path.join(suite, "skills", "fixture", "SKILL.md"), "# fixture\n")
  await fs.writeFile(
    path.join(stage, "delta-bundle.json"),
    '{"version":"test","target":"linux-x64","mascot":true,"autopilot":true}\n',
  )
  await fs.mkdir(path.join(stage, "assets"), { recursive: true })
  await fs.writeFile(path.join(stage, "assets", "mascot.svg"), "<svg />\n")
  await runCommand(["tar", "-czf", archive, "-C", stage, "."])
  const bytes = await fs.readFile(archive)
  await fs.rm(stage, { recursive: true, force: true })
  return bytes
}

async function runCommand(command: string[]) {
  const processHandle = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const stderr = await new Response(processHandle.stderr).text()
  const exitCode = await processHandle.exited
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr}`)
}
