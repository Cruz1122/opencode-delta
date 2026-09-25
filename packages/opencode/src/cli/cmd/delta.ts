import { promises as fs } from "node:fs"
import path from "node:path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import type { CommandModule } from "yargs"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

type DeltaStatusArgs = {
  json?: boolean
}

type DeltaInstallConfigArgs = {
  source: string
  target: string
  agentsSource?: string
  agentsTarget?: string
}

type DeltaStatus = {
  product: "opencode-delta"
  version: string
  mascot: boolean
  autopilot: boolean
  configDir: string
  agents: number
  skills: number
  installedAt?: string
}

const DeltaStatusSubcommand: CommandModule<{}, DeltaStatusArgs> = {
  command: "status",
  describe: "show OpenCode Delta installation status",
  builder: (yargs) =>
    yargs.option("json", {
      describe: "print machine-readable JSON",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const status = await readStatus()
    if (args.json) {
      await writeOutput(JSON.stringify(status, null, 2) + "\n")
      return
    }
    await writeOutput(
      [
        `OpenCode Delta ${status.version}`,
        `Config: ${status.configDir}`,
        `Mascot: ${status.mascot ? "yes" : "no"}`,
        `Autopilot: ${status.autopilot ? "yes" : "no"}`,
        `Agents: ${status.agents}`,
        `Skills: ${status.skills}`,
      ].join("\n") + "\n",
    )
  },
}

async function writeOutput(value: string) {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(value, (error) => (error ? reject(error) : resolve()))
  })
}

const DeltaInstallConfigSubcommand: CommandModule<{}, DeltaInstallConfigArgs> = {
  command: "install-config",
  describe: "install the managed Delta configuration",
  builder: (yargs) =>
    yargs
      .option("source", { describe: "Delta configuration source", type: "string", demandOption: true })
      .option("target", { describe: "user configuration target", type: "string", demandOption: true })
      .option("agents-source", { describe: "managed AGENTS.md source", type: "string" })
      .option("agents-target", { describe: "user AGENTS.md target", type: "string" }),
  handler: async (args) => {
    await installConfig(args.source, args.target, args.agentsSource, args.agentsTarget)
  },
}

export const DeltaCommand: CommandModule = {
  command: "delta <action>",
  describe: "OpenCode Delta maintenance commands",
  builder: (yargs) =>
    yargs.command(DeltaStatusSubcommand).command(DeltaInstallConfigSubcommand).demandCommand(),
  handler: () => {},
}

async function readStatus(): Promise<DeltaStatus> {
  const markerPath = path.join(Global.Path.config, "delta.json")
  const marker = await readJson(markerPath)
  const agents = await countEntries(path.join(Global.Path.config, "agents"))
  const skills = await countSkillFiles(path.join(Global.Path.config, "skills"))
  return {
    product: "opencode-delta",
    version: typeof marker?.version === "string" ? marker.version : InstallationVersion,
    mascot: marker?.mascot === true,
    autopilot: marker?.autopilot === true,
    configDir: Global.Path.config,
    agents,
    skills,
    installedAt: typeof marker?.installedAt === "string" ? marker.installedAt : undefined,
  }
}

async function installConfig(sourcePath: string, targetPath: string, agentsSource?: string, agentsTarget?: string) {
  const source = parseJson(await fs.readFile(sourcePath, "utf8"), sourcePath)
  const existing = await readJson(targetPath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, JSON.stringify(merge(existing, source), null, 2) + "\n")

  if (agentsSource && agentsTarget) {
    const managed = await fs.readFile(agentsSource, "utf8")
    const current = await fs.readFile(agentsTarget, "utf8").catch(() => "")
    const begin = "<!-- BEGIN OPENCODE DELTA -->"
    const end = "<!-- END OPENCODE DELTA -->"
    const block = `${begin}\n${managed.trimEnd()}\n${end}\n`
    const escapedBegin = escapeRegExp(begin)
    const escapedEnd = escapeRegExp(end)
    const replaced = current.includes(begin) && current.includes(end)
      ? current.replace(new RegExp(`${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`), block)
      : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}`
    await fs.mkdir(path.dirname(agentsTarget), { recursive: true })
    await fs.writeFile(agentsTarget, replaced)
  }
}

async function readJson(filePath: string) {
  const text = await fs.readFile(filePath, "utf8").catch(() => "")
  if (!text.trim()) return {}
  return parseJson(text, filePath)
}

function parseJson(text: string, source: string) {
  const errors: ParseError[] = []
  const value = parseJsonc(text, errors)
  if (errors.length || !isRecord(value)) throw new Error(`Invalid JSON configuration: ${source}`)
  return value
}

function merge(existing: Record<string, unknown>, overlay: Record<string, unknown>) {
  const result = { ...existing }
  for (const [key, value] of Object.entries(overlay)) {
    if (isRecord(result[key]) && isRecord(value)) {
      result[key] = merge(result[key], value)
      continue
    }
    if (Array.isArray(result[key]) && Array.isArray(value)) {
      result[key] = [...new Set([...result[key], ...value])]
      continue
    }
    result[key] = value
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function countEntries(directory: string) {
  return (await fs.readdir(directory).catch(() => [])).length
}

async function countSkillFiles(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries.reduce(async (totalPromise, entry) => {
    const total = await totalPromise
    if (entry.isDirectory()) return total + (await countSkillFiles(path.join(directory, entry.name)))
    return total + (entry.name === "SKILL.md" ? 1 : 0)
  }, Promise.resolve(0))
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
