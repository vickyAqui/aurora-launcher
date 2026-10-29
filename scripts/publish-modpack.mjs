#!/usr/bin/env node
/**
 * Publishes the local modpack folder to a GitHub release with a fixed tag.
 *
 * Environment variables:
 *   GH_TOKEN     (required) GitHub Personal Access Token with `repo` scope
 *   MODPACK_DIR  (default: ./modpack) local folder with the modpack files
 *   GH_REPO      (default: vickyAqui/aurora-launcher)
 *   MODPACK_TAG  (default: modpack)
 *
 * Usage: node scripts/publish-modpack.mjs [--dry-run]
 *
 * With `--dry-run` nothing is uploaded, deleted or written: the script only reports what a real run
 * would do.
 *
 * The script:
 *   1. Scans the folder, computes `size` + `sha1` per file, and refuses to touch the release if the
 *      manifest it would publish has problems (wrong mod path, duplicated mod, name collision)
 *   2. Reconciles the release asset by asset: an asset that is already there with the same size is
 *      left alone, one with a different size is replaced, a missing one is uploaded
 *   3. Uploads `modpack.json` before removing anything, so the manifest players download is never
 *      missing from the release
 *   4. Deletes only what the folder no longer holds, which is what keeps a mod that changed version
 *      from piling up next to the version that replaced it
 */
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { buildManifestEntries, sanitizeAssetName, validateManifest, walk } from './modpack-utils.mjs'

const loadEnv = (file = '.env') => {
  const abs = path.resolve(file)
  if (!existsSync(abs)) return
  for (const line of readFileSync(abs, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

loadEnv()

const dryRun = process.argv.includes('--dry-run')
const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'
const token = process.env.GH_TOKEN
if (!token) {
  console.error('ERROR: GH_TOKEN environment variable is required (GitHub PAT with `repo` scope).')
  process.exit(1)
}

const repo = process.env.GH_REPO || 'vickyAqui/aurora-launcher'
const tag = process.env.MODPACK_TAG || 'modpack'
const modpackDir = path.resolve(process.env.MODPACK_DIR || './modpack')
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`
const MANIFEST_ASSET = 'modpack.json'

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

async function api(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after')) || attempt * 2
      console.warn(`Rate limited (${res.status}), retrying in ${retryAfter}s...`)
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub API ${res.status}: ${url}\n${body}`)
    }
    if (res.status === 204) return null
    return await res.json()
  }
  throw new Error(`GitHub API failed after ${retries} retries`)
}

async function getOrCreateRelease() {
  try {
    return await api(`${API}/repos/${repo}/releases/tags/${tag}`)
  } catch (err) {
    if (String(err).includes('404')) {
      console.log(`Release "${tag}" not found, creating...`)
      return await api(`${API}/repos/${repo}/releases`, {
        method: 'POST',
        body: JSON.stringify({
          tag_name: tag,
          name: 'Modpack',
          body: 'Arquivos do modpack Aurora Studios. Não edite manualmente — use `npm run modpack:publish`.'
        })
      })
    }
    throw err
  }
}

/**
 * Every asset of a release, following the pages of `GET /releases/{id}/assets`.
 *
 * The asset list inside a release payload is capped, so a release holding hundreds of mods cannot be
 * reconciled from it: assets past the cap would look absent and be uploaded again, under a name
 * GitHub rejects as a duplicate.
 */
async function listAssets(release) {
  const all = []
  for (let page = 1; ; page++) {
    const batch = await api(`${API}/repos/${repo}/releases/${release.id}/assets?per_page=100&page=${page}`)
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

async function deleteAsset(asset) {
  console.log(`  Deleting: ${asset.name}`)
  await api(`${API}/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' })
}

async function uploadAsset(releaseId, filePath, name) {
  const data = await fs.readFile(filePath)
  const url = `${UPLOADS}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`
  const asset = await api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data)
  })
  console.log(`  Uploaded: ${asset.name} (${(data.length / 1024 / 1024).toFixed(1)} MB)`)
  return asset
}

async function main() {
  if (!(await fs.stat(modpackDir).catch(() => null))) {
    console.error(`ERROR: modpack folder not found at "${modpackDir}". Set MODPACK_DIR to point at your local modpack.`)
    process.exit(1)
  }

  console.log(`Scanning ${modpackDir}...`)
  const { folders, files } = await walk(modpackDir)

  // Computed from the local files alone, so the manifest can be validated before the release is
  // touched at all: a bad manifest must never leave players without a manifest to download.
  let entries = await buildManifestEntries({ folders, files, baseUrl })

  const problems = validateManifest({ files: entries })
  if (problems.length > 0) {
    console.error(`\nERROR: refusing to publish, manifest has ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nMods must live in "modpack/mods/": the game loads them from the mods folder.')
    process.exit(1)
  }

  const wanted = new Map()
  for (const file of files) {
    const name = sanitizeAssetName(file.name)
    const clash = wanted.get(name)
    if (clash) {
      console.error(`\nERROR: "${file.name}" and "${clash.name}" are both stored by GitHub as "${name}".`)
      console.error('Rename one of them in the modpack folder, otherwise one mod replaces the other on every publish.')
      process.exit(1)
    }
    wanted.set(name, file)
  }

  const release = await getOrCreateRelease()
  const remote = new Map((await listAssets(release)).map((asset) => [asset.name, asset]))

  const toUpload = []
  const toReplace = []
  for (const [name, file] of wanted) {
    const asset = remote.get(name)
    const size = (await fs.stat(file.full)).size
    if (!asset) toUpload.push({ name, file })
    else if (asset.size !== size) toReplace.push({ name, file, asset })
    else console.log(`  Up to date: ${name}`)
  }

  const keep = new Set([...wanted.keys(), MANIFEST_ASSET])
  const leftovers = [...remote.values()].filter((asset) => !keep.has(asset.name))

  console.log(
    `\nPlan: ${toUpload.length} to upload, ${toReplace.length} to replace, ${leftovers.length} stale to delete.`
  )
  if (leftovers.length > 0) {
    console.log('Stale assets (in the release, not in the folder):')
    for (const asset of leftovers) console.log(`  - ${asset.name}`)
  }
  if (dryRun) {
    console.log('\nDry run: nothing was uploaded, deleted or written.')
    return
  }

  // GitHub rejects a second asset with a name that is already taken, so a stale copy of the same
  // name goes first.
  for (const { name, asset } of toReplace) {
    console.log(`Replacing ${name} (size changed)...`)
    await deleteAsset(asset)
  }

  const urls = new Map()
  for (const [name, asset] of remote) {
    if (wanted.has(name) && !toReplace.some((r) => r.name === name)) urls.set(name, asset.browser_download_url)
  }
  for (const { name, file } of [...toUpload, ...toReplace]) {
    const asset = await uploadAsset(release.id, file.full, name)
    if (asset.name !== name) console.warn(`  WARNING: GitHub stored it as "${asset.name}", not "${name}".`)
    urls.set(name, asset.browser_download_url)
  }

  // The URL GitHub reports wins over the computed one, so the manifest points at a file that exists
  // even if GitHub folds a name differently than we expect.
  entries = entries.map((entry) => {
    const url = entry.type === 'MOD' ? urls.get(sanitizeAssetName(entry.name)) : undefined
    return url ? { ...entry, url } : entry
  })

  const finalProblems = validateManifest({ files: entries })
  if (finalProblems.length > 0) {
    console.error(`\nERROR: refusing to upload the manifest, it has ${finalProblems.length} problem(s):`)
    for (const problem of finalProblems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const jsonPath = path.join(modpackDir, MANIFEST_ASSET)
  await fs.writeFile(jsonPath, JSON.stringify({ files: entries }, null, 2))
  console.log(`\nGenerated ${jsonPath} (${entries.length} entries)`)

  // Manifest first: everything below only removes assets the new manifest does not reference.
  const staleManifest = remote.get(MANIFEST_ASSET)
  if (staleManifest) await deleteAsset(staleManifest)
  await uploadAsset(release.id, jsonPath, MANIFEST_ASSET)

  for (const asset of leftovers) await deleteAsset(asset)

  console.log(`\nDone! ${entries.length} entries live at ${baseUrl}/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
