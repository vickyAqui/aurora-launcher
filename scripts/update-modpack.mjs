#!/usr/bin/env node
/**
 * Refreshes modpack.json against the live modpack server.
 *
 * For each MOD entry it re-downloads the file from `file.url`, recomputes
 * `sha1` + `size` and rewrites the manifest. Entries that can no longer be
 * downloaded are reported (and removed when MODPACK_REMOVE_MISSING=1).
 *
 * Environment variables:
 *   MODPACK_FILE           (default: ./modpack.json) path to the manifest
 *   MODPACK_CONC           (default: 4) parallel downloads
 *   MODPACK_REMOVE_MISSING set to 1 to drop entries that 404 on the server
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const modpackFile = path.resolve(process.env.MODPACK_FILE || './modpack.json')
const conc = Math.max(1, Number(process.env.MODPACK_CONC) || 4)
const removeMissing = process.env.MODPACK_REMOVE_MISSING === '1'

async function readManifest() {
  let raw
  try {
    raw = await fs.readFile(modpackFile, 'utf8')
  } catch {
    console.error(`ERROR: manifest not found at "${modpackFile}".`)
    process.exit(1)
  }
  const data = JSON.parse(raw)
  if (Array.isArray(data)) return { files: data }
  if (data && Array.isArray(data.files)) return data
  console.error('ERROR: invalid manifest — expected an array or {"files": [...]}.')
  process.exit(1)
}

async function downloadHash(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
  }
  const hash = createHash('sha1')
  let size = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      size += value.length
    }
  } finally {
    reader.releaseLock()
  }
  return { sha1: hash.digest('hex'), size }
}

async function main() {
  const manifest = await readManifest()
  const mods = manifest.files.filter((f) => f.type === 'MOD')

  console.log(`Refreshing ${mods.length} files from the server...`)

  let changed = 0
  let unchanged = 0
  let processed = 0
  const missing = []

  async function worker(file) {
    try {
      const { sha1, size } = await downloadHash(file.url)
      if (file.sha1 !== sha1 || file.size !== size) {
        console.log(`[changed]  ${file.name}`)
        file.sha1 = sha1
        file.size = size
        changed++
      } else {
        unchanged++
      }
    } catch (err) {
      console.log(`[missing ${err.status || 'ERR'}]  ${file.name}`)
      missing.push({ file, status: err.status || 'ERR' })
    } finally {
      processed++
      process.stdout.write(`\r${processed}/${mods.length} ...`)
    }
  }

  let cursor = 0
  async function run() {
    const workers = []
    for (let i = 0; i < conc && cursor < mods.length; i++) {
      workers.push(worker(mods[cursor++]))
    }
    if (workers.length === 0) return
    await Promise.all(workers)
    await run()
  }
  await run()

  console.log('')

  if (missing.length > 0) {
    console.log(`\n${missing.length} file(s) not found on the server:`)
    for (const { file, status } of missing) console.log(`  - ${file.name} (${status})`)
    if (removeMissing) {
      const missingSet = new Set(missing.map((m) => m.file))
      manifest.files = manifest.files.filter((f) => !missingSet.has(f))
      console.log(`Removed ${missing.length} missing entries.`)
    } else {
      console.log('Kept them in the manifest. Use MODPACK_REMOVE_MISSING=1 to remove 404 entries.')
    }
  }

  await fs.writeFile(modpackFile, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nDone. ${changed} updated, ${unchanged} unchanged, ${missing.length} missing.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
