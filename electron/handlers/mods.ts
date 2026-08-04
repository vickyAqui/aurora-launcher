import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import { MODPACK_URL, DEFAULT_PROFILE } from '../const'
import { getGameDir } from '../gamedir'

export interface IModpackFile {
  name: string
  path: string
  size: number
  sha1: string
  url: string
  type: string
}

export interface IModpackManifest {
  files: IModpackFile[]
}

export async function fetchModpack(): Promise<IModpackManifest | null> {
  try {
    const res = await fetch(MODPACK_URL)
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    logger.error('Failed to fetch modpack:', err)
    return null
  }
}

export async function syncModsWithManifest(slug: string = DEFAULT_PROFILE.slug): Promise<number> {
  const manifest = await fetchModpack()
  if (!manifest) return 0

  const modsDir = path.join(getGameDir(slug), 'mods')
  const validNames = new Set(manifest.files.filter((f) => f.type === 'MOD').map((f) => f.name))

  if (!fs.existsSync(modsDir)) return 0

  let removed = 0
  for (const entry of fs.readdirSync(modsDir)) {
    if (validNames.has(entry)) continue
    try {
      fs.rmSync(path.join(modsDir, entry), { recursive: true, force: true })
      removed++
      logger.log(`Removed mod not in the modpack: ${entry}`)
    } catch (err) {
      logger.error(`Failed to remove ${entry}:`, err)
    }
  }
  return removed
}
