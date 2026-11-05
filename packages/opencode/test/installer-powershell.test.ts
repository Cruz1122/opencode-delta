import { expect, test } from "bun:test"
import path from "node:path"

const powershell = process.env.OPENCODE_DELTA_TEST_POWERSHELL ?? Bun.which("powershell.exe") ?? Bun.which("pwsh")

test.skipIf(!powershell)("PowerShell exit checks require explicit, successful native status", async () => {
  const child = Bun.spawn(
    [
      powershell!,
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:DELTA_INSTALLER, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Invalid installer syntax' }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Check-Exit' }, $true)
. ([scriptblock]::Create($definition.Extent.Text))
$calls = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Check-Exit' }, $true)
foreach ($call in $calls) {
  if ($call.CommandElements.Count -ne 3) { throw 'Native check must receive the caller exit status' }
}
Check-Exit 'success' 0
$native = (Get-Process -Id $PID).Path
& $native -NoProfile -NonInteractive -Command 'exit 0'
Check-Exit 'native success' $LASTEXITCODE
& $native -NoProfile -NonInteractive -Command 'exit 7'
$rejected = $false
try { Check-Exit 'native failure' $LASTEXITCODE } catch { $rejected = $true }
if (-not $rejected) { throw 'A native failure was accepted' }
foreach ($code in @(7, $null)) {
  $rejected = $false
  try { Check-Exit 'expected rejection' $code } catch { $rejected = $true }
  if (-not $rejected) { throw 'Missing or failing native status was accepted' }
}
'Native exit checks: OK'
`,
    ],
    {
      env: { ...process.env, DELTA_INSTALLER: path.resolve(import.meta.dir, "../../../install.ps1") },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  expect(stdout).toContain("Native exit checks: OK")
})
