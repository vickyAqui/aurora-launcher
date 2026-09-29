import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { MODPACK_URL, DEFAULT_PROFILE } from '../const'
import { getGameDir, getModsDir } from '../gamedir'

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

export interface IModEntry {
  name: string
  enabled: boolean
  installed: boolean
  size: number
  sha1: string
  inManifest: boolean
}

/**
 * Forge only loads files ending in `.jar`, so a disabled mod is the same file
 * with this suffix appended — the convention the modpack itself already uses
 * for mods shipped turned off.
 */
export const DISABLED_SUFFIX = '.disabled'

const DISABLED_STORE = 'disabled-mods.json'

function toCanonicalName(name: string): string {
  return name.endsWith(DISABLED_SUFFIX) ? name.slice(0, -DISABLED_SUFFIX.length) : name
}

function disabledPathOf(name: string): string {
  return `${name}${DISABLED_SUFFIX}`
}

function isSafeName(name: string): boolean {
  return !!name && name === path.basename(name) && !name.includes('..')
}

function getDisabledStorePath(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), DISABLED_STORE)
}

/**
 * The launcher re-downloads every modpack entry whose file is missing, so a mod
 * renamed to `.jar.disabled` comes back on the next launch. The player's choice
 * is kept here and re-applied right before the game boots.
 */
function readDisabledMods(slug: string = DEFAULT_PROFILE.slug): Set<string> {
  try {
    const raw = fs.readFileSync(getDisabledStorePath(slug), 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((name): name is string => typeof name === 'string' && isSafeName(name)))
  } catch {
    return new Set()
  }
}

function writeDisabledMods(disabled: Set<string>, slug: string = DEFAULT_PROFILE.slug): boolean {
  try {
    const storePath = getDisabledStorePath(slug)
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, JSON.stringify([...disabled].sort(), null, 2) + '\n')
    return true
  } catch (err) {
    logger.error('Error saving disabled mods:', err)
    return false
  }
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

function listDiskMods(modsDir: string): Map<string, { enabled: boolean; size: number }> {
  const found = new Map<string, { enabled: boolean; size: number }>()
  if (!fs.existsSync(modsDir)) return found

  for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue

    const disabled = entry.name.endsWith(DISABLED_SUFFIX)
    const base = toCanonicalName(entry.name)
    if (!base.toLowerCase().endsWith('.jar')) continue

    const size = fs.statSync(path.join(modsDir, entry.name)).size
    const current = found.get(base)

    if (current) {
      current.size = Math.max(current.size, size)
      if (disabled) current.enabled = false
      continue
    }
    found.set(base, { enabled: !disabled, size })
  }

  return found
}

async function listMods(slug: string = DEFAULT_PROFILE.slug): Promise<{ mods: IModEntry[]; modsDir: string }> {
  const modsDir = getModsDir(slug)
  const manifest = await fetchModpack()
  const disk = listDiskMods(modsDir)

  const manifestByName = new Map<string, IModpackFile>()
  for (const file of manifest?.files ?? []) {
    if (file.type !== 'MOD') continue
    manifestByName.set(toCanonicalName(file.name), file)
  }

  const names = new Set([...manifestByName.keys(), ...disk.keys()])
  const disabledByUser = readDisabledMods(slug)
  const mods: IModEntry[] = []

  for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
    const file = manifestByName.get(name)
    const onDisk = disk.get(name)

    mods.push({
      name,
      enabled: !!onDisk && onDisk.enabled && !disabledByUser.has(name),
      installed: onDisk !== undefined,
      size: file?.size ?? onDisk?.size ?? 0,
      sha1: file?.sha1 ?? '',
      inManifest: file !== undefined
    })
  }

  return { mods, modsDir }
}

function setModEnabled(name: string, enabled: boolean, slug: string = DEFAULT_PROFILE.slug): boolean {
  if (!isSafeName(name)) return false

  const modsDir = getModsDir(slug)
  const enabledPath = path.join(modsDir, name)
  const disabledPath = path.join(modsDir, disabledPathOf(name))
  const hasEnabled = fs.existsSync(enabledPath)
  const hasDisabled = fs.existsSync(disabledPath)

  if (!hasEnabled && !hasDisabled) return false

  const disabledByUser = readDisabledMods(slug)
  const next = new Set(disabledByUser)
  enabled ? next.delete(name) : next.add(name)

  try {
    if (enabled) {
      // `<name>.jar` is the copy the game loads, and the downloader keeps it
      // up to date, so it always wins over a leftover disabled copy.
      if (hasDisabled && !hasEnabled) {
        fs.renameSync(disabledPath, enabledPath)
      } else {
        fs.rmSync(disabledPath, { force: true })
      }
    } else if (hasEnabled) {
      fs.rmSync(disabledPath, { force: true })
      fs.renameSync(enabledPath, disabledPath)
    }

    if (!writeDisabledMods(next, slug)) {
      // Undo the file move so disk and stored state stay in agreement.
      if (enabled && hasDisabled && !hasEnabled) {
        fs.renameSync(enabledPath, disabledPath)
      } else if (!enabled && hasEnabled) {
        fs.renameSync(disabledPath, enabledPath)
      }
      return false
    }
    logger.log(`${enabled ? 'Enabled' : 'Disabled'} mod: ${name}`)
    return true
  } catch (err) {
    logger.error(`Error toggling mod ${name}:`, err)
    return false
  }
}

/**
 * Re-applies the player's disabled mods right before the game boots, undoing the
 * re-download the launcher does for any modpack entry it cannot find on disk.
 */
export function applyDisabledMods(slug: string = DEFAULT_PROFILE.slug): number {
  const disabledByUser = readDisabledMods(slug)
  if (disabledByUser.size === 0) return 0

  const modsDir = getModsDir(slug)
  let applied = 0

  for (const name of disabledByUser) {
    const enabledPath = path.join(modsDir, name)
    const disabledPath = path.join(modsDir, disabledPathOf(name))

    if (!fs.existsSync(enabledPath)) continue

    try {
      // The downloader re-fetches a mod as soon as its `<name>.jar` is missing, so
      // both files can exist. Keep the freshly downloaded one as the disabled copy
      // instead of leaving a live `<name>.jar` behind.
      if (fs.existsSync(disabledPath)) fs.rmSync(disabledPath, { force: true })
      fs.renameSync(enabledPath, disabledPath)
      applied++
      logger.log(`Re-applied disabled mod before launch: ${name}`)
    } catch (err) {
      logger.error(`Error re-applying disabled mod ${name}:`, err)
    }
  }

  return applied
}

export function registerModsHandlers() {
  ipcMain.handle('mods:list', async (_event, slug?: string) => {
    try {
      return await listMods(slug)
    } catch (err) {
      logger.error('Error listing mods:', err)
      return { mods: [], modsDir: getModsDir(slug) }
    }
  })

  ipcMain.handle('mods:set_enabled', async (_event, name: string, enabled: boolean, slug?: string) => {
    try {
      return setModEnabled(name, enabled, slug)
    } catch (err) {
      logger.error('Error toggling mod:', err)
      return false
    }
  })

  ipcMain.handle('mods:open_folder', async (_event, slug?: string) => {
    try {
      const modsDir = getModsDir(slug)
      if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true })
      await shell.openPath(modsDir)
      return true
    } catch (err) {
      logger.error('Error opening mods folder:', err)
      return false
    }
  })
}

export async function syncModsWithManifest(slug: string = DEFAULT_PROFILE.slug): Promise<number> {
  const manifest = await fetchModpack()
  if (!manifest) return 0

  const modsDir = getModsDir(slug)
  const validNames = new Set(manifest.files.filter((f) => f.type === 'MOD').map((f) => toCanonicalName(f.name)))
  for (const name of [...validNames]) validNames.add(disabledPathOf(name))

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
