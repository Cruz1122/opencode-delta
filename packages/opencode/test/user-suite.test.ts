import { expect, test } from "bun:test"
import path from "node:path"
import { promises as fs } from "node:fs"

const suite = path.resolve(import.meta.dir, "../../../suite")
for (const product of ["opencode", "claude"]) {
  test(`${product} exports the selected personal roles and skills without host paths`, async () => {
    const agents = await fs.readdir(path.join(suite, product, "agents"))
    expect(agents).toHaveLength(15)
    expect(agents).toContain("slave.md")
    expect(agents).toContain("security-auditor.md")
    expect(agents).not.toContain("dummy.md")
    expect(agents).not.toContain("cybersecurity.md")
    const skills = await fs.readdir(path.join(suite, product, "skills"))
    expect(skills).toHaveLength(33)
    expect(skills).toContain("grill-me")
    expect(skills).toContain("secure-development")
    expect(skills).toContain("playwright-cli")
    for (const name of ["cybersecurity-tutoring", "pentest-evidence-analysis", "linux-privilege-escalation-analysis"])
      expect(skills).not.toContain(name)
    for (const file of agents) {
      const text = await fs.readFile(path.join(suite, product, "agents", file), "utf8")
      expect(text).not.toContain("/home/cruz1122")
      expect(text).not.toContain("opencode-plans-cruz1122")
      const frontmatter = metadata(text)
      expect(frontmatter.description).toBeTruthy()
      if (product === "claude") {
        expect(frontmatter.name).toBe(path.basename(file, ".md"))
        expect(frontmatter.model).toBe("inherit")
        expect(frontmatter.permissionMode).toBe("default")
      }
    }
  })
}

test("portable settings preserve restrictions without machine dependencies", async () => {
  const config = await Bun.file(path.join(suite, "opencode/opencode.json")).json()
  expect(config.autoupdate).toBe(false)
  expect(config).not.toHaveProperty("auto_update")
  expect(config).not.toHaveProperty("shell")
  expect(config).not.toHaveProperty("subagent_model")
  expect(config).not.toHaveProperty("mcp")
  expect(config.permission.read["**/.env"]).toBe("deny")
  const plan = metadata(await Bun.file(path.join(suite, "opencode/agents/plan.md")).text())
  if (!record(plan.permission) || !record(plan.permission.read)) throw new Error("Missing plan read restrictions")
  expect(plan.permission.read["**/.env"]).toBe("deny")
  for (const file of config.instructions) expect(await Bun.file(path.join(suite, "opencode", file)).exists()).toBe(true)
  const claude = await Bun.file(path.join(suite, "claude/settings.json")).json()
  expect(claude.env.DISABLE_AUTOUPDATER).toBe("1")
  expect(claude.permissions.deny).toContain("Read(**/.env)")
  expect(claude.permissions.ask).toContain("PowerShell")
  const instructions = await Bun.file(path.join(suite, "claude/CLAUDE.md")).text()
  expect(instructions).toContain("native browser capabilities first")
  expect(instructions).toContain("not a sandbox")
})

test("read-only Claude roles cannot edit through native file tools", async () => {
  for (const role of ["ask", "plan", "quality", "researcher", "archivist", "test-engineer"]) {
    const text = await Bun.file(path.join(suite, `claude/agents/${role}.md`)).text()
    const frontmatter = metadata(text)
    expect(frontmatter.disallowedTools).toEqual(["Write", "Edit", "NotebookEdit"])
  }
})

function metadata(text: string): Record<string, unknown> {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)?.[1]
  if (!frontmatter) throw new Error("Missing frontmatter")
  const value: unknown = Bun.YAML.parse(frontmatter)
  if (!record(value)) throw new Error("Invalid frontmatter")
  return value
}

test("agent frontmatter accepts both LF and Windows CRLF checkouts", () => {
  for (const newline of ["\n", "\r\n"])
    expect(metadata(["---", "description: portable role", "---", "prompt"].join(newline))).toEqual({
      description: "portable role",
    })
})

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
