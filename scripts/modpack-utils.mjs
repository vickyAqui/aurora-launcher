import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

/** Folder, relative to the game directory, that mods must be downloaded into. */
export const MODS_FOLDER = 'mods'

/**
 * Characters GitHub replaces with a dot when it stores a release asset name.
 *
 * A jar called `MOAdecor ART 1.20.1.jar` is kept by GitHub as `MOAdecor.ART.1.20.1.jar`,
 * `[1.20.1] SecurityCraft v1.10.1.jar` as `1.20.1.SecurityCraft.v1.10.1.jar` and
 * `everlasting_leaves-1.20.1-1.0.0 (1).jar` as `everlasting_leaves-1.20.1-1.0.0.1.jar`. Applying
 * the same substitution locally is what lets a publish run recognise the asset it uploaded last time
 * instead of uploading a second copy under a name it cannot predict.
 * `publish-modpack.mjs` still compares against the name GitHub hands back.
 */
const GITHUB_REPLACED = /[\s()[\]]/g

export function sanitizeAssetName(name) {
  return name
    .replace(GITHUB_REPLACED, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '')
}

export function sha1(filePath) {
  const hash = createHash('sha1')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const folders = []
  const files = []

  for (const entry of entries) {
    if (entry.name === 'modpack.json') continue
    const full = path.join(dir, entry.name)
    const rel = path.posix.join(prefix, entry.name)

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, rel, full })
      const nested = await walk(full, rel)
      folders.push(...nested.folders)
      files.push(...nested.files)
    } else if (entry.isFile()) {
      files.push({ name: entry.name, rel, full })
    }
  }

  return { folders, files }
}

/**
 * The manifest `path` of an entry: its parent folder, with a trailing slash (`'mods/'`), or `''`
 * for a file sitting in the modpack root.
 *
 * This must match how the game reads the file. `eml-lib` downloads an entry to
 * `join(root, file.path, file.name)`, so a MOD entry with an empty path puts the jar in the game
 * directory root, where Forge never looks for it.
 */
export function toManifestPath(rel) {
  if (!rel.includes('/')) return ''
  return `${rel.substring(0, rel.lastIndexOf('/'))}/`
}

/**
 * Builds the manifest for a scanned modpack folder.
 *
 * `urlFor` maps a scanned file to its public download URL. When omitted, the URL is derived from
 * `baseUrl` and the file name as GitHub will store it. Folders have no asset of their own: they are
 * declared so `eml-lib` creates the directory, and their `url` is never fetched, so it points at the
 * manifest itself — the one URL a release always has.
 */
export async function buildManifestEntries({ folders, files, baseUrl, urlFor }) {
  const entries = []
  const urlOf = (entry) => urlFor?.(entry) ?? `${baseUrl}/${encodeURIComponent(sanitizeAssetName(entry.name))}`

  for (const folder of folders) {
    entries.push({
      name: folder.name,
      path: toManifestPath(folder.rel),
      url: `${baseUrl}/modpack.json`,
      type: 'FOLDER'
    })
  }

  for (const file of files) {
    entries.push({
      name: file.name,
      path: toManifestPath(file.rel),
      size: (await fs.stat(file.full)).size,
      sha1: await sha1(file.full),
      url: urlOf(file),
      type: 'MOD'
    })
  }

  return entries
}

/**
 * Checks a manifest before it is published or served.
 *
 * Returns a list of human-readable problems; an empty list means the manifest is usable.
 */
export function validateManifest(manifest) {
  const problems = []
  const files = Array.isArray(manifest) ? manifest : manifest?.files

  if (!Array.isArray(files)) return ['manifest has no "files" array']

  const seen = new Map()
  const assetNames = new Map()
  const hashes = new Map()

  for (const file of files) {
    const label = file?.name ?? '<unnamed>'
    if (!file?.name) problems.push('entry without a name')
    if (!file?.url) problems.push(`${label}: missing url`)

    if (file?.type === 'MOD') {
      const expected = `${MODS_FOLDER}/`
      if (file.path !== expected) {
        problems.push(
          `${label}: MOD path must be "${expected}" (found ${JSON.stringify(file.path)}) — the jar would not load`
        )
      }

      // Two local names that GitHub folds into one asset name would overwrite each other on every
      // publish, leaving the release serving one mod under two manifest entries.
      const asset = sanitizeAssetName(file.name)
      const owner = assetNames.get(asset)
      if (owner && owner !== file.name) {
        problems.push(`${label}: GitHub stores it as "${asset}", same as "${owner}" — rename one of them`)
      } else {
        assetNames.set(asset, file.name)
      }

      // Identical bytes under two names is the same mod twice: the game would load both copies.
      if (file.sha1) {
        const twin = hashes.get(file.sha1)
        if (twin && twin !== file.name) {
          problems.push(`${label}: same file already declared as "${twin}" (identical sha1) — the mod is duplicated`)
        } else {
          hashes.set(file.sha1, file.name)
        }
      }
    }

    if (typeof file?.name === 'string' && typeof file?.path === 'string') {
      const key = `${file.path}${file.name}`
      if (seen.has(key)) problems.push(`${label}: duplicated entry (also declared earlier)`)
      else seen.set(key, true)
    }

    if (typeof file?.size === 'number' && file.size <= 0) problems.push(`${label}: size must be greater than zero`)
    if (file?.sha1 && !/^[0-9a-f]{40}$/i.test(file.sha1)) problems.push(`${label}: sha1 is not a 40-char hex digest`)
  }

  return problems
}
