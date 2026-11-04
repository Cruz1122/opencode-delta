import { expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { exportUserSuite } from "../../../script/export-user-suite"

test("explicit export adapts roles and omits excluded skills, providers and secrets", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "delta-export-"))
  const source = path.join(temporary, "source")
  const output = path.join(temporary, "suite")
  try {
    for (const directory of [
      "agents",
      "skills/example",
      "skills/pentest-evidence-analysis",
      "instructions",
      "commands",
      "tools",
      "lib",
      "plugins",
      "brain-templates",
    ])
      await fs.mkdir(path.join(source, directory), { recursive: true })
    const original = JSON.stringify({
      instructions: [],
      shell: "fish",
      subagent_model: "personal/model",
      mcp: { lab: {} },
    })
    await fs.writeFile(path.join(source, "opencode.json"), original)
    await fs.writeFile(path.join(source, "package.json"), '{"dependencies":{"@mermaid-js/mermaid-cli":"11.16.0"}}')
    await fs.writeFile(path.join(source, "AGENTS.md"), "# Personal contract\n")
    await fs.writeFile(
      path.join(source, "agents/ask.md"),
      "---\ndescription: Answers questions\nmode: primary\npermission:\n  edit: deny\n---\nUse `brain_search`.\n",
    )
    await fs.writeFile(path.join(source, "agents/dummy.md"), "excluded")
    await fs.writeFile(path.join(source, "skills/example/SKILL.md"), "example")
    await fs.writeFile(path.join(source, "skills/example/reference.md"), "companion")
    await fs.writeFile(path.join(source, "skills/example/.env"), "fixture-secret-never-export")
    await fs.writeFile(
      path.join(source, "lib/common.ts"),
      'const shell = process.env.SHELL?.includes("fish") ? process.env.SHELL : "fish"',
    )
    await exportUserSuite(source, output)
    expect(await fs.readFile(path.join(source, "opencode.json"), "utf8")).toBe(original)
    expect(await fs.readdir(path.join(output, "opencode/agents"))).toEqual(["ask.md"])
    expect((await fs.readdir(path.join(output, "claude/skills/example"))).sort()).toEqual(["SKILL.md", "reference.md"])
    expect(await fs.readdir(path.join(output, "claude/skills"))).toEqual(["example"])
    const config = await Bun.file(path.join(output, "opencode/opencode.json")).json()
    expect(config).not.toHaveProperty("subagent_model")
    expect(config).not.toHaveProperty("mcp")
    expect(config.autoupdate).toBe(false)
    expect(await Bun.file(path.join(output, "claude/agents/ask.md")).text()).toContain("Read/Glob/Grep")
    expect(await Bun.file(path.join(output, "opencode/lib/common.ts")).text()).toContain('"powershell.exe"')
    const settings = await Bun.file(path.join(output, "claude/settings.json")).json()
    expect(settings.permissions.deny).toContain("Edit(**/.env)")
    expect(settings.permissions.deny).not.toContain("Write(**/.env)")
    // Re-export removes obsolete managed snapshot entries rather than leaking old roles.
    await fs.writeFile(path.join(output, "claude/agents/obsolete.md"), "obsolete")
    await exportUserSuite(source, output)
    expect(await fs.readdir(path.join(output, "claude/agents"))).toEqual(["ask.md"])
    await fs.rm(path.join(output, "opencode"), { recursive: true })
    await fs.symlink(source, path.join(output, "opencode"))
    const error = await exportUserSuite(source, output).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(await fs.readFile(path.join(source, "opencode.json"), "utf8")).toBe(original)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
