import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { MODPACK_SIGNATURE_URL, MODPACK_URL, DEFAULT_PROFILE } from '../const'
import { getGameDir, getModsDir } from '../gamedir'
import { verifyManifestSignature } from '../manifest-signature'
import {
  buildLaunchManifest,
  buildModEntries,
  disabledPathOf,
  emptyChoices,
  findForeignModFiles,
  findStrayModFiles,
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

/**
 * Why the launch cannot continue, phrased for the player.
 *
 * Distinct from an unexpected error on purpose: this is the launch being refused because the
 * modpack could not be proven to come from Aurora Studios, and the message has to say so instead of
 * reading like a crash.
 */
export class ModpackUnavailableError extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = 'ModpackUnavailableError'
  }
}

async function fetchVerifiedManifest(force = false): Promise<IModpackManifest> {
  if (!force && manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.manifest

  let manifest: IModpackManifest | null = null
  let failure: string | null = null

  try {
    // Both responses come from the same place but travel separately, so neither one can be swapped
    // for the other: what gets verified is the manifest body against the published digest.
    const [manifestRes, signatureRes] = await Promise.all([
      fetch(MODPACK_URL),
      fetch(MODPACK_SIGNATURE_URL).catch(() => null)
    ])

    if (!manifestRes.ok) {
      failure = `manifesto indisponível (HTTP ${manifestRes.status})`
    } else if (!signatureRes || !signatureRes.ok) {
      // A 404 means nobody published a signature; no response at all means the request never landed.
      failure = signatureRes
        ? `assinatura indisponível (HTTP ${signatureRes.status})`
        : 'não foi possível baixar a assinatura do modpack'
    } else {
      const bytes = Buffer.from(await manifestRes.arrayBuffer())
      const verified = verifyManifestSignature(bytes, await signatureRes.json())

      if (!verified.ok) {
        failure = verified.reason
      } else {
        const parsed = parseManifest(JSON.parse(bytes.toString('utf8')))
        if (!parsed) failure = 'formato inesperado'
        else manifest = parsed
      }
    }
  } catch (err) {
    logger.error('Failed to fetch modpack:', err)
    failure = `não foi possível baixar o modpack: ${(err as Error).message}`
  }

  // Only a verified manifest is ever cached, which is what makes it safe to fall back to it below.
  if (manifest) manifestCache = { at: Date.now(), manifest }
  else if (manifestCache) {
    // Offline or a release mid-publish: the last manifest whose signature was checked still decides
    // the files, so a hiccup costs a moment of waiting instead of blocking the launch outright.
    logger.warn(`Using the last verified modpack manifest (${failure}).`)
    return manifestCache.manifest
  }

  if (!manifest) throw new ModpackUnavailableError(failure ?? 'modpack indisponível')

  return manifest
}

/**
 * Signed manifest for the Mods tab.
 *
 * Returns `null` when the modpack cannot be verified, unlike `prepareMods`: the tab only lists what
 * the launcher would install, so with nothing verified it has nothing to show.
 */
export async function fetchModpack(force = false): Promise<IModpackManifest | null> {
  try {
    return await fetchVerifiedManifest(force)
  } catch (err) {
    logger.error('Modpack manifest unavailable:', err)
    return null
  }
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

function migrateStrayMods(manifest: IModpackManifest, slug: string = DEFAULT_PROFILE.slug): number {
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

function pruneForeignMods(manifest: IModpackManifest, slug: string = DEFAULT_PROFILE.slug): number {
  const modsDir = getModsDir(slug)
  const foreign = findForeignModFiles(modsDir, manifest)
  if (foreign.length === 0) return 0

  let removed = 0
  for (const { rel, kind } of foreign) {
    const full = path.join(modsDir, rel)
    try {
      // A symlink is unlinked rather than deleted through: `rmSync` on a link to a folder removes
      // the link, but reading what it points at is never part of the decision to remove it.
      if (kind === 'symlink') fs.unlinkSync(full)
      else fs.rmSync(full, { recursive: kind === 'dir', force: true })

      removed++
      logger.log(`Removed ${kind === 'dir' ? 'folder' : 'mod'} not in the modpack: ${rel}`)
    } catch (err) {
      logger.error(`Failed to remove ${rel}:`, err)
    }
  }
  return removed
}

export interface IPreparedMods {
  /**
   * Manifest to hand to `eml-lib`.
   *
   * Not optional: an unverified manifest is never returned, so a launch either gets a manifest whose
   * signature was checked against the keys the launcher trusts, or it does not launch at all.
   */
  manifest: IModpackManifest
}

/**
 * Puts the mods folder in the expected state and builds the manifest for this launch.
 *
 * Runs before the downloader so a jar that the player turned off is never fetched again, a jar left
 * in the game directory root by an older build is reused instead of re-downloaded, and a jar the
 * modpack no longer ships is dropped.
 *
 * Throws `ModpackUnavailableError` when the manifest cannot be fetched and verified, which is what
 * stops the launch rather than letting the game start on a manifest of unknown origin.
 */
export async function prepareMods(slug: string = DEFAULT_PROFILE.slug): Promise<IPreparedMods> {
  const manifest = await fetchVerifiedManifest()

  migrateStrayMods(manifest, slug)
  pruneForeignMods(manifest, slug)

  return { manifest: buildLaunchManifest(manifest, readChoices(slug)) }
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
