import { promises as fs } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"

type Entry = { file: string; backup?: string; hash: string }
type Journal = { entries: Entry[]; directory: string }
export type ProfileOptions = {
  bundle: string
  home: string
  config: string
  claude: string
  bin: string
  state: string
  only: "opencode" | "claude" | "both"
  windows?: boolean
}

/** All managed writes, including the executable, share one recoverable transaction. */
export async function installProfile(input: ProfileOptions) {
  const files = new Map<string, Uint8Array>()
  const text = (file: string, value: string) => files.set(file, Buffer.from(value))
  if (input.only !== "claude") {
    await collect(path.join(input.bundle, "suite/opencode"), input.config, files)
    const source = JSON.parse(await fs.readFile(path.join(input.bundle, "suite/opencode/opencode.json"), "utf8"))
    const configFile = path.join(
      input.config,
      (await fs.lstat(path.join(input.config, "opencode.jsonc")).catch(missing)) ? "opencode.jsonc" : "opencode.json",
    )
    files.delete(path.join(input.config, "opencode.json"))
    text(configFile, json(merge(await readJSON(configFile), source)))
    text(
      path.join(input.config, "AGENTS.md"),
      block(
        await readText(path.join(input.config, "AGENTS.md")),
        await fs.readFile(path.join(input.bundle, "suite/opencode/AGENTS.md"), "utf8"),
      ),
    )
    const binary = path.join(input.bundle, "bin", input.windows ? "opencode.exe" : "opencode")
    files.set(path.join(input.bin, input.windows ? "opencode.exe" : "opencode"), await fs.readFile(binary))
    const metadata = await readJSON(path.join(input.bundle, "delta-bundle.json"))
    text(path.join(input.config, "delta.json"), json({ ...metadata, installedAt: new Date().toISOString() }))
  }
  if (input.only !== "opencode") {
    await collect(path.join(input.bundle, "suite/claude"), input.claude, files)
    text(
      path.join(input.claude, "settings.json"),
      json(
        merge(
          await readJSON(path.join(input.claude, "settings.json")),
          await readJSON(path.join(input.bundle, "suite/claude/settings.json")),
        ),
      ),
    )
    text(
      path.join(input.claude, "CLAUDE.md"),
      block(
        await readText(path.join(input.claude, "CLAUDE.md")),
        await fs.readFile(path.join(input.bundle, "suite/claude/CLAUDE.md"), "utf8"),
      ),
    )
  }
  if (!input.windows) {
    const quoted = `'${input.bin.replaceAll("'", "'\\''")}'`
    for (const file of [".profile", ".bashrc", ".zshrc"])
      text(
        path.join(input.home, file),
        shellBlock(
          await readText(path.join(input.home, file)),
          `case ":$PATH:" in *:${quoted}:*) ;; *) export PATH=${quoted}:"$PATH" ;; esac`,
        ),
      )
    text(
      path.join(input.home, ".config/fish/conf.d/opencode-delta.fish"),
      `# OpenCode Delta PATH\nif not contains -- ${quoted} $PATH\n  set -gx PATH ${quoted} $PATH\nend\n`,
    )
  }
  const history = await readHistory(input.state)
  const directory = path.join(input.state, "backups", randomUUID())
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const entries: Entry[] = []
  // Back up every destination before the first mutation; never follow destination symlinks.
  for (const [file, bytes] of files) {
    await requireRegularParents(file)
    const stat = await fs.lstat(file).catch(missing)
    if (stat && !stat.isFile()) throw new Error(`Not a regular managed destination: ${file}`)
    const backup = stat ? path.join(directory, String(entries.length)) : undefined
    if (backup) await fs.copyFile(file, backup)
    entries.push({ file, backup, hash: digest(bytes) })
  }
  const journal = { entries, directory }
  await fs.writeFile(path.join(directory, "journal.json"), json(journal), { mode: 0o600 })
  const written: Entry[] = []
  try {
    for (const entry of entries) {
      written.push(entry)
      await atomicWrite(entry.file, files.get(entry.file)!)
      if (entry.file === path.join(input.bin, "opencode")) await fs.chmod(entry.file, 0o755)
    }
    await atomicWrite(path.join(input.state, "history.json"), Buffer.from(json([...history, journal])))
  } catch (error) {
    await restore(written)
    throw error
  }
  return directory
}

/** Refuse to discard post-install changes. Undo restores one generation; uninstall restores all. */
export async function removeProfile(state: string, undo = false) {
  const history = await readHistory(state)
  if (!history.length) throw new Error("No managed installation found")
  const selected = undo ? history.slice(-1) : history
  const original = new Map<string, Entry>()
  const latest = new Map<string, Entry>()
  for (const journal of selected)
    for (const entry of journal.entries) {
      if (!original.has(entry.file)) original.set(entry.file, entry)
      latest.set(entry.file, entry)
    }
  for (const entry of latest.values()) {
    await requireRegularParents(entry.file)
    const stat = await fs.lstat(entry.file).catch(missing)
    if (!stat?.isFile() || digest(await fs.readFile(entry.file)) !== entry.hash)
      throw new Error(`Managed file changed since installation; preserve or reconcile it before removal: ${entry.file}`)
  }
  for (const entry of original.values()) if (entry.backup) await fs.access(entry.backup)
  await restore([...original.values()])
  await atomicWrite(path.join(state, "history.json"), Buffer.from(json(undo ? history.slice(0, -1) : [])))
}

async function restore(entries: Entry[]) {
  for (const entry of [...entries].reverse()) {
    if (entry.backup) {
      const mode = (await fs.stat(entry.backup)).mode
      await atomicWrite(entry.file, await fs.readFile(entry.backup))
      await fs.chmod(entry.file, mode)
      continue
    }
    await fs.rm(entry.file, { force: true })
  }
}

async function collect(source: string, target: string, files: Map<string, Uint8Array>) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Suite contains a symlink: ${entry.name}`)
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) await collect(from, to, files)
    if (entry.isFile()) files.set(to, await fs.readFile(from))
  }
}

async function requireRegularParents(file: string) {
  const stat = await fs.lstat(file).catch(missing)
  if (stat?.isSymbolicLink()) throw new Error(`Refusing managed symlink: ${file}`)
  const parent = path.dirname(file)
  if (parent !== file) await requireRegularParents(parent)
}

async function atomicWrite(file: string, bytes: Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    // Merged settings may contain credentials; never widen their filesystem permissions.
    const mode = (await fs.stat(file).catch(missing))?.mode ?? 0o600
    await fs.writeFile(temporary, bytes, { mode })
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function readHistory(state: string): Promise<Journal[]> {
  const text = await readText(path.join(state, "history.json"))
  return text ? JSON.parse(text) : []
}

async function readText(file: string) {
  return fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return ""
    throw error
  })
}

async function readJSON(file: string): Promise<Record<string, unknown>> {
  const text = await readText(file)
  if (!text) return {}
  const errors: ParseError[] = []
  const value: unknown = parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true })
  if (errors.length || !record(value)) throw new Error(`Expected a JSON object: ${file}`)
  return value
}

function merge(existing: Record<string, unknown>, overlay: Record<string, unknown>) {
  const result = { ...existing }
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key]
    result[key] =
      record(current) && record(value)
        ? merge(current, value)
        : Array.isArray(current) && Array.isArray(value)
          ? [...new Set([...current, ...value])]
          : value
  }
  return result
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function block(current: string, managed: string) {
  const begin = "<!-- BEGIN OPENCODE DELTA -->"
  const end = "<!-- END OPENCODE DELTA -->"
  const content = `${begin}\n${managed.trim()}\n${end}\n`
  if (current.includes(begin) !== current.includes(end)) throw new Error("Incomplete managed instructions block")
  return current.includes(begin)
    ? current.replace(/<!-- BEGIN OPENCODE DELTA -->[\s\S]*?<!-- END OPENCODE DELTA -->\n?/, content)
    : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${content}`
}

function shellBlock(current: string, managed: string) {
  const content = `# BEGIN OPENCODE DELTA PATH\n${managed}\n# END OPENCODE DELTA PATH\n`
  return current.includes("# BEGIN OPENCODE DELTA PATH")
    ? current.replace(/# BEGIN OPENCODE DELTA PATH[\s\S]*?# END OPENCODE DELTA PATH\n?/, content)
    : `${current.trimEnd()}\n${content}`
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2) + "\n"
}
function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}
function missing(error: NodeJS.ErrnoException) {
  if (error.code !== "ENOENT") throw error
  return undefined
}
