#!/usr/bin/env node
/**
 * Applies local patches to dependencies after install.
 *
 * Idempotent: a patch already in place is detected with a reverse dry-run and skipped, so
 * re-running the script never produces rejects or a non-zero exit code.
 *
 * Environment variables:
 *   PATCH_STRICT=1  fail the install when a patch cannot be applied
 *                   (default: warn and continue, since the launcher still runs unpatched)
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const patchDir = join(root, 'patches')
const nmDir = join(root, 'node_modules')

const patches = [{ name: 'eml-lib', version: '2.3.5' }]

const run = (command, cwd) =>
  execSync(command, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

/** Collects leftover `.rej` files, without descending into nested dependencies. */
function findRejects(dir, depth = 0) {
  if (depth > 6) return []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name.endsWith('.rej')) found.push(full)
    else if (entry.isDirectory() && entry.name !== 'node_modules') found.push(...findRejects(full, depth + 1))
  }
  return found
}

for (const { name, version } of patches) {
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
  if (process.platform === 'win32') {
    console.warn(`[apply-patches] Skipping ${name}: the "patch" command is not available on Windows.`)
    continue
  }

  // A reverse dry-run that succeeds means the patch is already in place. Running `patch --forward`
  // anyway would exit non-zero and litter the package with `.rej` files.
  try {
    run(`patch -p1 -R --dry-run --no-backup-if-mismatch < "${patchFile}"`, pkgDir)
    console.log(`[apply-patches] ${name}@${version} is already patched, nothing to do.`)
    continue
  } catch {
    // Not applied yet (or drifted): fall through and apply it.
  }

  console.log(`[apply-patches] Applying patch for ${name}@${version}...`)
  try {
    const output = run(`patch -p1 --no-backup-if-mismatch < "${patchFile}"`, pkgDir)
    console.log(`[apply-patches] ${name} patched successfully.`)
    if (output.trim()) console.log(output.trim())
  } catch (err) {
    console.error(`[apply-patches] Failed to patch ${name}:\n${err.stdout ?? ''}${err.stderr ?? ''}`.trim())
    if (process.env.PATCH_STRICT === '1') {
      process.exitCode = 1
      continue
    }
    console.warn(
      `[apply-patches] Continuing without the ${name} patch. The launcher still runs, but downloads lose the extra integrity checks the patch adds. Re-run with PATCH_STRICT=1 to make this fatal.`
    )
  }

  // A reject means some hunks did not fit: a silently half-patched dependency is worse than a
  // known-unpatched one, so name the files that still need attention.
  const rejects = findRejects(pkgDir)
  if (rejects.length > 0) {
    console.warn(`[apply-patches] Warning: ${rejects.length} hunk(s) of ${name} could not be applied:`)
    for (const reject of rejects) console.warn(`  - ${reject}`)
  }
}