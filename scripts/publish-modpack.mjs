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
 * The script:
 *   1. Scans the folder, computes `size` + `sha1` per file
 *   2. Generates modpack.json with stable download URLs (tag is fixed)
 *   3. Creates the release if needed, deletes old assets, uploads all files + JSON
 */
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

const API = 'https://api.github.com'
const token = process.env.GH_TOKEN
if (!token) {
  console.error('ERROR: GH_TOKEN environment variable is required (GitHub PAT with `repo` scope).')
  process.exit(1)
}

const repo = process.env.GH_REPO || 'vickyAqui/aurora-launcher'
const tag = process.env.MODPACK_TAG || 'modpack'
const modpackDir = path.resolve(process.env.MODPACK_DIR || './modpack')
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

function sha1(filePath) {
  const hash = createHash('sha1')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const folders = []
  const files = []

  for (const entry of entries) {
    if (entry.name === 'modpack.json') continue
    const full = path.join(dir, entry.name)
    const rel = path.posix.join(prefix, entry.name)

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, rel })
      const nested = await walk(full, rel)
      folders.push(...nested.folders)
      files.push(...nested.files)
    } else if (entry.isFile()) {
      files.push({ name: entry.name, rel, full })
    }
  }

  return { folders, files }
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

async function deleteAssets(release) {
  const assets = release.assets || []
  for (const asset of assets) {
    console.log(`Deleting old asset: ${asset.name}`)
    await api(`${API}/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE' })
  }
}

async function uploadAsset(releaseId, filePath, name) {
  const data = await fs.readFile(filePath)
  const url = `${API}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`
  await api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data)
  })
  console.log(`Uploaded: ${name}`)
}

async function main() {
  if (!(await fs.stat(modpackDir).catch(() => null))) {
    console.error(`ERROR: modpack folder not found at "${modpackDir}". Set MODPACK_DIR to point to your local modpack.`)
    process.exit(1)
  }

  console.log(`Scanning ${modpackDir}...`)
  const { folders, files } = await walk(modpackDir)

  const modpackFiles = []
  for (const folder of folders) {
    const parent = folder.rel.includes('/') ? `${folder.rel.substring(0, folder.rel.lastIndexOf('/'))}/` : ''
    modpackFiles.push({
      name: folder.name,
      path: parent,
      url: `${baseUrl}/${folder.rel}`,
      type: 'FOLDER'
    })
  }

  for (const file of files) {
    const parent = file.rel.includes('/') ? `${file.rel.substring(0, file.rel.lastIndexOf('/'))}/` : ''
    const size = (await fs.stat(file.full)).size
    const hash = await sha1(file.full)
    modpackFiles.push({
      name: file.name,
      path: parent,
      size,
      sha1: hash,
      url: `${baseUrl}/${file.rel}`,
      type: 'MOD'
    })
  }

  const jsonPath = path.join(modpackDir, 'modpack.json')
  await fs.writeFile(jsonPath, JSON.stringify({ files: modpackFiles }, null, 2))
  console.log(`Generated ${jsonPath} (${modpackFiles.length} entries)`)

  const release = await getOrCreateRelease()
  await deleteAssets(release)

  for (const file of files) {
    await uploadAsset(release.id, file.full, file.name)
  }
  await uploadAsset(release.id, jsonPath, 'modpack.json')

  console.log(`\nDone! ${modpackFiles.length} files published to ${baseUrl}/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
