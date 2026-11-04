import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { installProfile, removeProfile, type ProfileOptions } from "../src/cli/profile"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "delta installer "))
const stage = path.join(temporary, "stage")
const driver = path.join(temporary, "driver.ts")
await fs.mkdir(path.join(stage, "bin"), { recursive: true })
await fs.mkdir(path.join(stage, "suite/opencode/skills/fixture"), { recursive: true })
await fs.mkdir(path.join(stage, "suite/claude/agents"), { recursive: true })
await fs.writeFile(path.join(stage, "suite/opencode/opencode.json"), '{"autoupdate":false}')
await fs.writeFile(path.join(stage, "suite/opencode/AGENTS.md"), "managed engineering rules")
await fs.writeFile(path.join(stage, "suite/opencode/skills/fixture/SKILL.md"), "fixture skill")
await fs.writeFile(path.join(stage, "suite/claude/settings.json"), '{"env":{"DISABLE_AUTOUPDATER":"1"}}')
await fs.writeFile(path.join(stage, "suite/claude/CLAUDE.md"), "managed claude rules")
await fs.writeFile(path.join(stage, "suite/claude/agents/ask.md"), "read-only role")
await fs.writeFile(path.join(stage, "delta-bundle.json"), '{"product":"opencode-delta","version":"test"}')
// Test the real transaction implementation, with only the large release binary replaced by a launcher.
await fs.writeFile(
  driver,
  `
import {installProfile,removeProfile} from ${JSON.stringify(path.join(root, "packages/opencode/src/cli/profile.ts"))}
const args=process.argv.slice(2)
if(args[0]==="--version"){ console.log("fixture version"); process.exit(0) }
if(args[0]!=="delta" || args[1]!=="profile") throw Error("unexpected fixture command")
const value=(name)=>args[args.indexOf("--"+name)+1]
if(args[2]!=="install"){await removeProfile(value("state"),args[2]==="undo");process.exit(0)}
await installProfile({bundle:value("bundle"),home:value("home"),config:value("config"),claude:value("claude"),bin:value("bin"),state:value("state"),only:value("only")})
`,
)
const binary = path.join(stage, "bin/opencode")
await fs.writeFile(
  binary,
  `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${driver.replaceAll("'", "'\\''")}' "$@"\n`,
)
await fs.chmod(binary, 0o755)
const archive = path.join(temporary, "fixture.tar.gz")
await command(["tar", "-czf", archive, "-C", stage, "."])
const bytes = await fs.readFile(archive)
await fs.symlink("/tmp/delta-unsafe-target", path.join(stage, "unsafe"))
const malicious = path.join(temporary, "unsafe.tar.gz")
await command(["tar", "-czf", malicious, "-C", stage, "."])
const unsafeBytes = await fs.readFile(malicious)
await fs.unlink(path.join(stage, "unsafe"))
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.includes("missing")) return new Response("not found", { status: 404 })
    const selected = url.pathname.includes("unsafe") ? unsafeBytes : bytes
    const checksum = url.pathname.includes("bad-hash")
      ? "0".repeat(64)
      : createHash("sha256").update(selected).digest("hex")
    return new Response(url.pathname.endsWith(".sha256") ? `${checksum}  fixture.tar.gz\n` : selected)
  },
})
afterAll(async () => {
  await server.stop(true)
  await fs.rm(temporary, { recursive: true, force: true })
})

async function fixture(): Promise<ProfileOptions> {
  const home = await fs.mkdtemp(path.join(temporary, "user home "))
  return {
    bundle: stage,
    home,
    config: path.join(home, ".config/opencode"),
    claude: path.join(home, ".claude"),
    bin: path.join(home, ".local/bin"),
    state: path.join(home, ".local/state/opencode-delta"),
    only: "both",
  }
}

async function installer(input: ProfileOptions, args: string[] = [], prefix = "") {
  const child = Bun.spawn(["sh", path.join(root, "install.sh"), ...args], {
    env: {
      ...process.env,
      HOME: input.home,
      OPENCODE_CONFIG_DIR: input.config,
      CLAUDE_CONFIG_DIR: input.claude,
      XDG_STATE_HOME: path.join(input.home, ".local/state"),
      OPENCODE_DELTA_INSTALL_DIR: input.bin,
      PATH: `${input.bin}:/usr/bin:/bin`,
      OPENCODE_DELTA_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}/${prefix}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

test("offline preflight does not write any files", async () => {
  const input = await fixture()
  const result = await installer(input, ["--check"])
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("Preflight OK")
  expect(await fs.readdir(input.home)).toEqual([])
})

test("shell installs both profiles with spaces and preserves upstream/data", async () => {
  const input = await fixture()
  await fs.mkdir(path.join(input.home, ".opencode/bin"), { recursive: true })
  await fs.writeFile(path.join(input.home, ".opencode/bin/opencode"), "upstream")
  await fs.mkdir(path.join(input.home, ".local/share/opencode"), { recursive: true })
  await fs.writeFile(path.join(input.home, ".local/share/opencode/auth.json"), "fixture unrelated data")
  const result = await installer(input, ["--skip-claude-install"])
  expect(result.stderr).toBe("")
  expect(result.code).toBe(0)
  expect(await fs.readFile(path.join(input.claude, "agents/ask.md"), "utf8")).toBe("read-only role")
  expect(await fs.readFile(path.join(input.home, ".opencode/bin/opencode"), "utf8")).toBe("upstream")
  expect(await fs.readFile(path.join(input.home, ".local/share/opencode/auth.json"), "utf8")).toBe(
    "fixture unrelated data",
  )
  expect((await fs.stat(path.join(input.bin, "opencode"))).mode & 0o111).not.toBe(0)
})

for (const only of ["opencode", "claude"] as const)
  test(`selection ${only} installs only the selected application profile`, async () => {
    const input = await fixture()
    const result = await installer(input, ["--only", only, "--skip-claude-install"])
    expect(result.code).toBe(0)
    expect(
      await fs.access(only === "opencode" ? input.claude : input.config).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

for (const prefix of ["bad-hash", "unsafe", "missing"])
  test(`rejects ${prefix} before managed writes`, async () => {
    const input = await fixture()
    const result = await installer(input, ["--only", "opencode"], prefix)
    expect(result.code).not.toBe(0)
    expect(await fs.readdir(input.home)).toEqual([])
  })

test("Claude updates are explicit and selected through the installer", async () => {
  const input = await fixture()
  await fs.mkdir(input.bin, { recursive: true })
  const claude = path.join(input.bin, "claude")
  await fs.writeFile(claude, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/claude-invocations"\n')
  await fs.chmod(claude, 0o755)
  expect((await installer(input, ["--only", "claude"])).code).toBe(0)
  expect(await fs.readFile(path.join(input.home, "claude-invocations"), "utf8")).toBe("--version\n")
  expect((await installer(input, ["--only", "claude", "--update-claude"])).code).toBe(0)
  expect(await fs.readFile(path.join(input.home, "claude-invocations"), "utf8")).toBe(
    "--version\ninstall stable\n--version\n",
  )
})

test("reinstall merges settings and replaces one instructions/PATH block", async () => {
  const input = await fixture()
  await fs.mkdir(input.claude, { recursive: true })
  await fs.writeFile(path.join(input.claude, "settings.json"), '{"theme":"custom","env":{"USER_SETTING":"kept"}}', {
    mode: 0o600,
  })
  await fs.writeFile(path.join(input.claude, "CLAUDE.md"), "user instructions\n")
  await installProfile(input)
  await installProfile(input)
  const settings = JSON.parse(await fs.readFile(path.join(input.claude, "settings.json"), "utf8"))
  expect(settings.theme).toBe("custom")
  expect(settings.env).toEqual({ USER_SETTING: "kept", DISABLE_AUTOUPDATER: "1" })
  expect((await fs.stat(path.join(input.claude, "settings.json"))).mode & 0o777).toBe(0o600)
  expect((await fs.readFile(path.join(input.claude, "CLAUDE.md"), "utf8")).match(/BEGIN OPENCODE DELTA/g)).toHaveLength(
    1,
  )
  expect(
    (await fs.readFile(path.join(input.home, ".profile"), "utf8")).match(/BEGIN OPENCODE DELTA PATH/g),
  ).toHaveLength(1)
})

test("merges into the higher-priority JSONC config without replacing a separate JSON config", async () => {
  const input = await fixture()
  await fs.mkdir(input.config, { recursive: true })
  const json = '{"model":"company/model"}'
  const jsonc = '{\n // user comment\n "custom": true, "autoupdate": true,\n}'
  await fs.writeFile(path.join(input.config, "opencode.json"), json)
  await fs.writeFile(path.join(input.config, "opencode.jsonc"), jsonc)
  await installProfile(input)
  expect(await fs.readFile(path.join(input.config, "opencode.json"), "utf8")).toBe(json)
  expect(await Bun.file(path.join(input.config, "opencode.jsonc")).json()).toEqual({ custom: true, autoupdate: false })
  await removeProfile(input.state)
  expect(await fs.readFile(path.join(input.config, "opencode.jsonc"), "utf8")).toBe(jsonc)
})

test("uninstall restores the original files and preserves files outside the manifest", async () => {
  const input = await fixture()
  await fs.mkdir(input.claude, { recursive: true })
  await fs.writeFile(path.join(input.claude, "CLAUDE.md"), "original")
  await fs.writeFile(path.join(input.claude, "unrelated"), "keep")
  await installProfile(input)
  await installProfile(input)
  await removeProfile(input.state)
  expect(await fs.readFile(path.join(input.claude, "CLAUDE.md"), "utf8")).toBe("original")
  expect(await fs.readFile(path.join(input.claude, "unrelated"), "utf8")).toBe("keep")
  expect(await rejected(fs.access(path.join(input.bin, "opencode")))).toBeInstanceOf(Error)
})

test("uninstall refuses post-install edits before removing any files", async () => {
  const input = await fixture()
  await installProfile(input)
  await fs.writeFile(path.join(input.claude, "CLAUDE.md"), "subsequent user changes")
  expect((await rejected(removeProfile(input.state))).message).toContain("changed since installation")
  expect(await fs.readFile(path.join(input.claude, "CLAUDE.md"), "utf8")).toBe("subsequent user changes")
  expect(await fs.stat(path.join(input.bin, "opencode"))).toBeTruthy()
})

test("undo restores the previous executable and keeps the older uninstall journal", async () => {
  const input = await fixture()
  await installProfile(input)
  const versionTwo = path.join(temporary, "version-two")
  await fs.cp(stage, versionTwo, { recursive: true })
  await fs.writeFile(path.join(versionTwo, "bin/opencode"), "version two")
  await installProfile({ ...input, bundle: versionTwo })
  await removeProfile(input.state, true)
  expect(await fs.readFile(path.join(input.bin, "opencode"), "utf8")).toContain("#!/bin/sh")
  await removeProfile(input.state)
})

test("invalid settings and symlink destinations are rejected without overwriting", async () => {
  const input = await fixture()
  await fs.mkdir(input.claude, { recursive: true })
  await fs.writeFile(path.join(input.claude, "settings.json"), "invalid json")
  expect(await rejected(installProfile(input))).toBeInstanceOf(Error)
  expect(await rejected(fs.access(path.join(input.bin, "opencode")))).toBeInstanceOf(Error)
  await fs.rm(path.join(input.claude, "settings.json"))
  const outside = path.join(input.home, "outside")
  await fs.writeFile(outside, "{}")
  await fs.symlink(outside, path.join(input.claude, "settings.json"))
  expect((await rejected(installProfile(input))).message).toContain("symlink")
  expect(await fs.readFile(outside, "utf8")).toBe("{}")
})

test("shell uninstall uses the cached helper without network", async () => {
  const input = await fixture()
  expect((await installer(input, ["--only", "opencode"])).code).toBe(0)
  const result = await installer(input, ["--uninstall"])
  expect(result.stderr).toBe("")
  expect(result.code).toBe(0)
  expect(await rejected(fs.access(path.join(input.bin, "opencode")))).toBeInstanceOf(Error)
})

async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const stderr = await new Response(child.stderr).text()
  if (await child.exited) throw new Error(stderr)
}

async function rejected(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("Expected rejection")
    },
    (error: unknown) => {
      if (!(error instanceof Error)) throw new Error("Expected an Error")
      return error
    },
  )
}

test.skipIf(process.getuid?.() === 0)("rolls back managed files after a mid-install write failure", async () => {
  const input = await fixture()
  await fs.mkdir(input.config, { recursive: true })
  await fs.writeFile(path.join(input.config, "opencode.json"), '{"user":true}')
  await fs.mkdir(input.claude, { recursive: true })
  await fs.chmod(input.claude, 0o500)
  try {
    expect(await rejected(installProfile(input))).toBeInstanceOf(Error)
    expect(await fs.readFile(path.join(input.config, "opencode.json"), "utf8")).toBe('{"user":true}')
    expect(await rejected(fs.access(path.join(input.bin, "opencode")))).toBeInstanceOf(Error)
  } finally {
    await fs.chmod(input.claude, 0o700)
  }
})
