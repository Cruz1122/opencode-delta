import { afterAll, expect, test } from "bun:test"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../../..")
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "delta-release-safety-"))
afterAll(() => fs.rm(temporary, { recursive: true, force: true }))

test("packager rejects repository and ancestor outputs without deleting data", async () => {
  for (const output of [root, path.dirname(root), path.parse(root).root, path.join(root, "packages")]) {
    const result = await run(output)
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("dedicated")
    expect(await Bun.file(path.join(root, "package.json")).exists()).toBe(true)
  }
})

test("packager refuses an occupied external output directory", async () => {
  const marker = path.join(temporary, "unrelated.txt")
  await fs.writeFile(marker, "must survive")
  const result = await run(temporary)
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain("must be empty")
  expect(await fs.readFile(marker, "utf8")).toBe("must survive")
})

async function run(output: string) {
  const child = Bun.spawn([process.execPath, path.join(root, "script/package-delta-release.ts")], {
    cwd: root,
    env: { ...process.env, OPENCODE_DELTA_RELEASE_DIR: output },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stderr, code }
}
