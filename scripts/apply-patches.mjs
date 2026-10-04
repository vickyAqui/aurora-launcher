#!/usr/bin/env node
/**
 * Applies local patches to dependencies after install.
 *
 * Idempotent by content, not by exit code: `patch -R --dry-run` is not trustworthy across
 * platforms. GNU patch exits non-zero when it skips a reversed hunk, so Linux re-applies
 * correctly, but the BSD patch on macOS exits 0 there, the script decided the patch was
 * already in place, skipped it, and the build broke on src/views/home.ts (the patched
 * eml-lib types are where `progress.filename` comes from). So the decision is made by
 * looking for a line that only exists once the patch is applied.
 *
 * A patch that cannot be confirmed fails the install by default: eml-lib unpatched means
 * `tsc` fails, and a warning at install time just moves the failure somewhere more
 * confusing. Set PATCH_SOFT=1 to downgrade that to a warning and keep working unpatched.
 *
 * Environment variables:
 *   PATCH_SOFT=1  warn instead of failing the install when a patch cannot be applied/confirmed
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const patchDir = join(root, 'patches')
const nmDir = join(root, 'node_modules')

const patches = [
  {
    name: 'eml-lib',
    version: '2.3.5',
    // Linha que o patch adiciona em types/events.d.ts: a progressão de download por mod.
    verify: { file: 'types/events.d.ts', includes: 'filename?: string' },
  },
]

const run = (command, cwd) =>
  execSync(command, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

/** O patch está aplicado? Pergunta para o arquivo, não para o exit code do patch(1). */
function isApplied({ verify }, pkgDir) {
  try {
    return readFileSync(join(pkgDir, verify.file), 'utf8').includes(verify.includes)
  } catch {
    return false
  }
}

for (const patch of patches) {
  const { name, version } = patch
  const patchFile = join(patchDir, `${name}+${version}.patch`)
  const pkgDir = join(nmDir, name)

  if (!existsSync(patchFile)) {
    console.log(`[apply-patches] No patch file for ${name}, skipping.`)
    continue
  }
  if (!existsSync(pkgDir)) {
    console.log(`[apply-patches] Package ${name} not installed, skipping.`)
    continue
  }
  if (isApplied(patch, pkgDir)) {
    console.log(`[apply-patches] ${name}@${version} is already patched, nothing to do.`)
    continue
  }

  console.log(`[apply-patches] Applying patch for ${name}@${version}...`)
  let output = ''
  try {
    output = run(`patch -p1 --forward --no-backup-if-mismatch < "${patchFile}"`, pkgDir)
    console.log(`[apply-patches] ${name} patched successfully.`)
    if (output.trim()) console.log(output.trim())
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    console.error(`[apply-patches] patch(1) failed for ${name}:\n${output}`)
  }

  if (!isApplied(patch, pkgDir)) {
    const detail = output || `${patch.verify.includes} não apareceu em ${patch.verify.file}`
    console.error(`[apply-patches] ${name}@${version} segue sem patch: ${detail}`)
    if (process.env.PATCH_SOFT === '1') {
      console.warn(
        `[apply-patches] Seguindo sem o patch do ${name} (PATCH_SOFT=1). O build vai falhar em src/views/home.ts.`
      )
      continue
    }
    console.error(
      `[apply-patches] Falhando o install: sem o patch do ${name} o launcher não compila. Re-run com PATCH_SOFT=1 para ignorar.`
    )
    process.exitCode = 1
  }
}