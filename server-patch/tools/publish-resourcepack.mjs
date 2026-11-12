#!/usr/bin/env node
/**
 * Publishes server-patch/aurora_caldeirao.zip to a dedicated GitHub release so the
 * game server can serve it with `resource-pack=`.
 *
 * A separate release (tag `server-pack`) is used on purpose: `publish-modpack.mjs`
 * deletes every asset of the `modpack` release that is not in `modpack/`, so the pack
 * would disappear on the next modpack publish.
 *
 * Usage: node server-patch/tools/publish-resourcepack.mjs [--dry-run]
 *
 * Environment variables (read from .env):
 *   GH_TOKEN    GitHub Personal Access Token with `repo` scope (required)
 *   GH_REPO     default: vickyAqui/aurora-launcher
 *   PACK_TAG    default: server-pack
 */
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

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
  console.error('ERROR: GH_TOKEN is required (GitHub PAT with `repo` scope).')
  process.exit(1)
}

const repo = process.env.GH_REPO || 'vickyAqui/aurora-launcher'
const tag = process.env.PACK_TAG || 'server-pack'
const packFile = path.resolve(process.env.PACK_FILE || 'server-patch/aurora_caldeirao.zip')
const assetName = path.basename(packFile)
const baseUrl = `https://github.com/${repo}/releases/download/${tag}`

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub API ${res.status}: ${url}\n${body}`)
  }
  if (res.status === 204) return null
  return await res.json()
}

async function getOrCreateRelease() {
  try {
    return await api(`${API}/repos/${repo}/releases/tags/${tag}`)
  } catch (err) {
    if (!String(err).includes('404')) throw err
    console.log(`Release "${tag}" not found, creating...`)
    if (dryRun) return { id: 0, upload_url: '' }
    return await api(`${API}/repos/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: 'Server resource pack',
        body: 'Pacote de recursos servido pelo servidor (Caldeirao Futuro). Gerado por `server-patch/tools/build-resourcepack.ps1`.'
      })
    })
  }
}

async function listAssets(release) {
  const all = []
  for (let page = 1; ; page++) {
    const batch = await api(`${API}/repos/${repo}/releases/${release.id}/assets?per_page=100&page=${page}`)
    all.push(...batch)
    if (batch.length < 100) break
  }
  return all
}

async function main() {
  const data = await fs.readFile(packFile)
  const size = data.length
  console.log(`Pack: ${packFile} (${size} bytes)`)

  const release = await getOrCreateRelease()
  const existing = release.id ? (await listAssets(release)).find((a) => a.name === assetName) : undefined

  if (existing && existing.size === size) {
    console.log(`Asset "${assetName}" is already up to date.`)
    console.log(`URL: ${baseUrl}/${assetName}`)
    return
  }

  if (dryRun) {
    console.log(`Dry run: would ${existing ? 'replace' : 'upload'} "${assetName}".`)
    return
  }

  if (existing) {
    console.log(`Replacing "${assetName}" (size changed)...`)
    await api(`${API}/repos/${repo}/releases/assets/${existing.id}`, { method: 'DELETE' })
  }

  const url = `${UPLOADS}/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`
  const asset = await api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data)
  })
  console.log(`Uploaded: ${asset.name} (${(size / 1024).toFixed(1)} KB)`)
  console.log(`URL: ${asset.browser_download_url}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
