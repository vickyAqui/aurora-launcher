import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { MODPACK_URL, DEFAULT_PROFILE } from '../const'
import { getGameDir, getModsDir } from '../gamedir'
import {
  buildLaunchManifest,
  buildModEntries,
  disabledPathOf,
  emptyChoices,
  findForeignModFiles,
  findStrayModFiles,
  indexManifest,
  isModFileName,
  isSafeName,
  listDiskMods,
  parseChoices,
  parseManifest,
  serializeChoices,
  toCanonicalName,
  type IModChoices,
  type IModEntry,
  type IModpackManifest
} from '../mods'

export type { IModEntry }

const DISABLED_STORE = 'disabled-mods.json'

/** The modpack manifest changes only when a new modpack is published; a short cache avoids refetching it on every tab open. */
const MANIFEST_TTL_MS = 60_000

/** Cached successful fetch; `null` means nothing is cached yet. */
let manifestCache: { at: number; manifest: IModpackManifest } | null = null

function getDisabledStorePath(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), DISABLED_STORE)
}

function readChoices(slug: string = DEFAULT_PROFILE.slug): IModChoices {
  try {
    return parseChoices(fs.readFileSync(getDisabledStorePath(slug), 'utf8'))
  } catch {
    return emptyChoices()
  }
}

function writeChoices(choices: IModChoices, slug: string = DEFAULT_PROFILE.slug): boolean {
  try {
    const storePath = getDisabledStorePath(slug)
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, serializeChoices(choices))
    return true
  } catch (err) {
    logger.error('Error saving mod choices:', err)
    return false
  }
}

export async function fetchModpack(force = false): Promise<IModpackManifest | null> {
  if (!force && manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.manifest

  let manifest: IModpackManifest | null = null
  try {
    const res = await fetch(MODPACK_URL)
    if (res.ok) {
      const parsed = parseManifest(await res.json())
      if (parsed) manifest = parsed
      else logger.error('Modpack manifest is not in the expected format.')
    }
  } catch (err) {
    logger.error('Failed to fetch modpack:', err)
  }

  // A failed fetch keeps the previous manifest in place, so a hiccup never empties the Mods tab.
  if (manifest) manifestCache = { at: Date.now(), manifest }

  return manifest
}

async function listMods(slug: string = DEFAULT_PROFILE.slug): Promise<{ mods: IModEntry[]; modsDir: string }> {
  const manifest = await fetchModpack()
  return { mods: buildModEntries(manifest, listDiskMods(getModsDir(slug)), readChoices(slug)), modsDir: getModsDir(slug) }
}

/**
 * Renames a mod between its enabled and disabled file name.
 *
 * Returns whether the folder ended up in the requested state; when it already was, the rename is
 * skipped but the stored choice is still updated, which is what lets the player turn on a mod that
 * has not been downloaded yet.
 */
function applyFileState(modsDir: string, name: string, enabled: boolean): boolean {
  const enabledPath = path.join(modsDir, name)
  const disabledPath = path.join(modsDir, disabledPathOf(name))
  const hasEnabled = fs.existsSync(enabledPath)
  const hasDisabled = fs.existsSync(disabledPath)

  if (enabled) {
    if (hasEnabled) {
      // The enabled copy is the one the game loads; drop any leftover disabled copy.
      if (hasDisabled) fs.rmSync(disabledPath, { force: true })
      return true
    }
    if (hasDisabled) {
      fs.renameSync(disabledPath, enabledPath)
      return true
    }
    return false
  }

  if (hasDisabled) {
    if (hasEnabled) fs.rmSync(enabledPath, { force: true })
    return true
  }
  if (hasEnabled) {
    fs.renameSync(enabledPath, disabledPath)
    return true
  }
  return false
}

function setModEnabled(name: string, enabled: boolean, slug: string = DEFAULT_PROFILE.slug): boolean {
  if (!isSafeName(name) || !isModFileName(name)) return false

  const modsDir = getModsDir(slug)
  const canonical = toCanonicalName(name)
  const choices = readChoices(slug)

  const next: IModChoices = {
    disabled: new Set(choices.disabled),
    enabledOverrides: new Set(choices.enabledOverrides)
  }

  if (enabled) {
    next.disabled.delete(canonical)
    next.enabledOverrides.add(canonical)
  } else {
    next.disabled.add(canonical)
    next.enabledOverrides.delete(canonical)
  }

  try {
    applyFileState(modsDir, canonical, enabled)
  } catch (err) {
    logger.error(`Error toggling mod ${name}:`, err)
    return false
  }

  if (!writeChoices(next, slug)) return false

  logger.log(`${enabled ? 'Enabled' : 'Disabled'} mod: ${canonical}`)
  return true
}

/**
 * Re-applies the player's choices to the folder right before the game boots.
 *
 * Only needed when the launch manifest could not be filtered (the modpack manifest is unreachable),
 * because `eml-lib` downloads every entry it is given, ignoring this store.
 */
export function applyModChoices(slug: string = DEFAULT_PROFILE.slug, shippedDisabled?: Set<string>): number {
  const choices = readChoices(slug)
  const off = new Set<string>()
  for (const name of shippedDisabled ?? []) {
    if (!choices.enabledOverrides.has(name)) off.add(name)
  }
  for (const name of choices.disabled) off.add(name)
  if (off.size === 0) return 0

  const modsDir = getModsDir(slug)
  let applied = 0

  for (const name of off) {
    const enabledPath = path.join(modsDir, name)
    if (!fs.existsSync(enabledPath)) continue

    try {
      // The downloader may have re-fetched a mod as soon as its `<name>.jar` was missing, so both
      // files can exist. Keep the freshly downloaded one as the disabled copy instead of leaving a
      // live `<name>.jar` behind.
      const disabledPath = path.join(modsDir, disabledPathOf(name))
      if (fs.existsSync(disabledPath)) fs.rmSync(disabledPath, { force: true })
      fs.renameSync(enabledPath, disabledPath)
      applied++
      logger.log(`Re-applied mod choice before launch: ${name}`)
    } catch (err) {
      logger.error(`Error re-applying mod choice ${name}:`, err)
    }
  }

  return applied
}

function migrateStrayMods(manifest: IModpackManifest | null, slug: string = DEFAULT_PROFILE.slug): number {
  const gameDir = getGameDir(slug)
  const modsDir = getModsDir(slug)
  const strays = findStrayModFiles(gameDir, manifest)
  if (strays.length === 0) return 0

  let moved = 0
  for (const name of strays) {
    try {
      fs.mkdirSync(modsDir, { recursive: true })
      fs.renameSync(path.join(gameDir, name), path.join(modsDir, name))
      moved++
    } catch (err) {
      logger.error(`Failed to move stray mod ${name} into the mods folder:`, err)
    }
  }

  if (moved > 0) logger.log(`Moved ${moved} mod(s) into the mods folder (they were in the game directory root).`)
  return moved
}

function pruneForeignMods(manifest: IModpackManifest | null, slug: string = DEFAULT_PROFILE.slug): number {
  const modsDir = getModsDir(slug)
  const foreign = findForeignModFiles(modsDir, manifest)
  if (foreign.length === 0) return 0

  let removed = 0
  for (const name of foreign) {
    try {
      fs.rmSync(path.join(modsDir, name), { force: true })
      removed++
      logger.log(`Removed mod not in the modpack: ${name}`)
    } catch (err) {
      logger.error(`Failed to remove ${name}:`, err)
    }
  }
  return removed
}

export interface IPreparedMods {
  /** Manifest to hand to `eml-lib`, or `null` when the modpack could not be fetched. */
  manifest: IModpackManifest | null
  shippedDisabled: Set<string>
}

/**
 * Puts the mods folder in the expected state and builds the manifest for this launch.
 *
 * Runs before the downloader so a jar that the player turned off is never fetched again, a jar left
 * in the game directory root by an older build is reused instead of re-downloaded, and a jar the
 * modpack no longer ships is dropped.
 */
export async function prepareMods(slug: string = DEFAULT_PROFILE.slug): Promise<IPreparedMods> {
  const manifest = await fetchModpack()
  const index = indexManifest(manifest)

  if (!manifest) {
    logger.warn('Modpack manifest unavailable; falling back to the remote manifest without filtering.')
    return { manifest: null, shippedDisabled: index.shippedDisabled }
  }

  migrateStrayMods(manifest, slug)
  pruneForeignMods(manifest, slug)

  return { manifest: buildLaunchManifest(manifest, readChoices(slug)), shippedDisabled: index.shippedDisabled }
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
