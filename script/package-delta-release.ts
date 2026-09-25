#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { $ } from "bun"
import opencodePackage from "../packages/opencode/package.json"

const root = path.resolve(import.meta.dirname, "..")
const dist = path.join(root, "packages/opencode/dist")
const output = path.resolve(process.env.OPENCODE_DELTA_RELEASE_DIR ?? path.join(root, "release"))
const stageRoot = path.join(output, ".stage")
const version = process.env.OPENCODE_DELTA_VERSION ?? opencodePackage.version

await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })

const suiteStage = path.join(stageRoot, "suite", "opencode")
await fs.mkdir(path.dirname(suiteStage), { recursive: true })
await fs.cp(path.join(root, "suite/opencode"), suiteStage, { recursive: true })
await fs.cp(path.join(root, "assets"), path.join(stageRoot, "assets"), { recursive: true })
await $`bun install --cwd ${suiteStage} --production`

const targets = [
  "linux-x64",
  "linux-x64-baseline",
  "linux-x64-musl",
  "linux-x64-baseline-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-x64-baseline",
  "darwin-arm64",
  "windows-x64",
  "windows-x64-baseline",
  "windows-arm64",
]

const artifacts: Record<string, { file: string; sha256: string; bytes: number }> = {}
for (const target of targets) {
  const binaryCandidates = [
    path.join(dist, `opencode-${target}`, "bin", "opencode"),
    path.join(dist, `opencode-${target}`, "bin", "opencode.exe"),
  ]
  const binary = await firstExisting(binaryCandidates)
  if (!binary) continue

  const stage = path.join(stageRoot, target)
  await fs.rm(stage, { recursive: true, force: true })
  await fs.mkdir(path.join(stage, "bin"), { recursive: true })
  await fs.copyFile(binary, path.join(stage, "bin", path.basename(binary)))
  await fs.cp(path.join(stageRoot, "suite"), path.join(stage, "suite"), { recursive: true })
  await fs.cp(path.join(stageRoot, "assets"), path.join(stage, "assets"), { recursive: true })
  await fs.writeFile(
    path.join(stage, "delta-bundle.json"),
    JSON.stringify(
      {
        product: "opencode-delta",
        version,
        target,
        binary: path.posix.join("bin", path.basename(binary)),
        suite: "suite/opencode",
        mascot: true,
        autopilot: true,
      },
      null,
      2,
    ) + "\n",
  )

  const archiveName = `opencode-delta-${target}.tar.gz`
  const archive = path.join(output, archiveName)
  // Release archives must be safe to extract with no link traversal. Materialize
  // Bun's node_modules links while packaging instead of shipping symlinks/hardlinks.
  await $`tar --dereference --hard-dereference -czf ${archive} -C ${stage} .`
  const bytes = (await fs.stat(archive)).size
  const sha256 = await hashFile(archive)
  await fs.writeFile(path.join(output, `${archiveName}.sha256`), `${sha256}  ${archiveName}\n`)
  artifacts[target] = { file: archiveName, sha256, bytes }
}

if (!Object.keys(artifacts).length) {
  throw new Error(`No OpenCode binaries found in ${dist}`)
}

await fs.writeFile(
  path.join(output, "release.json"),
  JSON.stringify(
    {
      schema_version: 1,
      product: "opencode-delta",
      version,
      generated_at: new Date().toISOString(),
      artifacts,
    },
    null,
    2,
  ) + "\n",
)
await fs.rm(stageRoot, { recursive: true, force: true })
console.log(`Packaged ${Object.keys(artifacts).length} OpenCode Delta artifacts in ${output}`)

async function fileExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function firstExisting(filePaths: string[]) {
  for (const filePath of filePaths) {
    if (await fileExists(filePath)) return filePath
  }
  return undefined
}

async function hashFile(filePath: string) {
  const hash = createHash("sha256")
  hash.update(await fs.readFile(filePath))
  return hash.digest("hex")
}
