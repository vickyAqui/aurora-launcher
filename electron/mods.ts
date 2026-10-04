import fs from 'node:fs'
import path from 'node:path'
import type { File } from 'eml-lib'

/**
 * Forge only loads files ending in `.jar`, so a mod that is turned off is the same file with this
 * suffix appended. The modpack itself ships two mods using this convention, and the launcher reuses
 * it for the player's own enable/disable choice so both live in the same namespace.
 */
export const DISABLED_SUFFIX = '.disabled'

/**
 * Folder, relative to the game directory, where mods live.
 *
 * `eml-lib` resolves every manifest entry as `join(root, file.path, file.name)` and Forge scans
 * `<gameDir>/mods`, so a manifest entry with an empty `path` lands the jar in the game directory
 * root where nothing ever loads it. Every MOD entry must therefore carry `path: 'mods/'`.
 */
export const MODS_FOLDER = 'mods'

/**
 * One entry of the modpack manifest.
 *
 * The manifest is fetched from the network, so its shape is only trusted after `parseManifest`
 * validates it. Entries use `eml-lib`'s own `File` type: that is what the downloader consumes, so
 * there is one shape from the network to the disk instead of two that can drift apart.
 */
export type IModpackFile = File

export interface IModpackManifest {
  files: IModpackFile[]
}

const FILE_TYPES = new Set<string>([
  'JAVA',
  'ASSET',
  'LIBRARY',
  'NATIVE',
  'MOD',
  'CONFIG',
  'BOOTSTRAP',
  'BACKGROUND',
  'FOLDER',
  'IMAGE',
  'OTHER'
])

/**
 * Validates a manifest fetched from the network.
 *
 * Entries missing a name, a url or a usable type are dropped rather than handed to the downloader:
 * `path.join(root, file.path, file.name)` on a malformed entry can escape the game directory.
 */
export function parseManifest(data: unknown): IModpackManifest | null {
  if (!data || typeof data !== 'object') return null
  const files = (data as { files?: unknown }).files
  if (!Array.isArray(files)) return null

  const valid = files.filter((entry): entry is File => {
    if (!entry || typeof entry !== 'object') return false
    const { name, path: filePath, url, type } = entry as Partial<File>
    if (typeof name !== 'string' || !isSafeName(name)) return false
    if (typeof filePath !== 'string' || filePath.includes('..')) return false
    if (typeof url !== 'string' || !url) return false
    return typeof type === 'string' && FILE_TYPES.has(type)
  })

  return { files: valid }
}

/** How a file the modpack does not ship has to be removed. */
export interface IForeignModFile {
  /** Path relative to the mods folder, using `/` so a log line reads the same on every platform. */
  rel: string
  kind: 'file' | 'symlink' | 'dir'
}

/**
 * How deep the mods folder is walked looking for jars the modpack does not ship.
 *
 * The modpack is a flat list of mods, so anything nested this deep is not part of it and is reported
 * as a whole folder rather than descended into.
 */
export const MAX_MOD_SCAN_DEPTH = 8

export interface IModEntry {
  name: string
  enabled: boolean
  installed: boolean
  size: number
  sha1: string
  inManifest: boolean
}

export interface IDiskMod {
  enabled: boolean
  size: number
}

/**
 * The player's per-mod choices.
 *
 * `disabled` wins over the modpack default, except for names in `enabledOverrides`, which exist so
 * a mod that ships turned off (`.jar.disabled` in the manifest) can still be turned on by hand.
 */
export interface IModChoices {
  disabled: Set<string>
  enabledOverrides: Set<string>
}

export interface IModManifestIndex {
  /** Canonical (`<name>.jar`) mod name to its manifest entry. */
  byName: Map<string, IModpackFile>
  /** Canonical names the modpack ships turned off. */
  shippedDisabled: Set<string>
}

export function toCanonicalName(name: string): string {
  return name.endsWith(DISABLED_SUFFIX) ? name.slice(0, -DISABLED_SUFFIX.length) : name
}

export function disabledPathOf(name: string): string {
  return `${name}${DISABLED_SUFFIX}`
}

/** `true` when the name is a mod file, enabled or not. */
export function isModFileName(name: string): boolean {
  return toCanonicalName(name).toLowerCase().endsWith('.jar')
}

/**
 * Guards against a manifest or IPC payload escaping the mods folder (`../`, absolute paths,
 * separators smuggled into a name).
 */
export function isSafeName(name: string): boolean {
  if (!name || name !== path.basename(name)) return false
  if (name.includes('..')) return false
  if (path.isAbsolute(name)) return false
  if (name.includes('/') || name.includes('\\')) return false
  return true
}

export function emptyChoices(): IModChoices {
  return { disabled: new Set(), enabledOverrides: new Set() }
}

/**
 * Reads the stored choices, accepting both the current object shape and the legacy bare array of
 * disabled names written by older builds.
 */
export function parseChoices(raw: string): IModChoices {
  const choices = emptyChoices()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return choices
  }

  const namesOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string' && isSafeName(name)) : []

  if (Array.isArray(parsed)) {
    namesOf(parsed).forEach((name) => choices.disabled.add(toCanonicalName(name)))
    return choices
  }

  if (parsed && typeof parsed === 'object') {
    namesOf((parsed as IModChoices).disabled).forEach((name) => choices.disabled.add(toCanonicalName(name)))
    namesOf((parsed as IModChoices).enabledOverrides).forEach((name) => choices.enabledOverrides.add(toCanonicalName(name)))
  }

  return choices
}

export function serializeChoices(choices: IModChoices): string {
  return (
    JSON.stringify(
      {
        disabled: [...choices.disabled].sort(),
        enabledOverrides: [...choices.enabledOverrides].sort()
      },
      null,
      2
    ) + '\n'
  )
}

/**
 * Whether a mod should be off for this player.
 *
 * An explicit override always wins, then the player's explicit disable, then the modpack default.
 */
export function isModOff(name: string, shippedDisabled: Set<string>, choices: IModChoices): boolean {
  if (choices.enabledOverrides.has(name)) return false
  if (choices.disabled.has(name)) return true
  return shippedDisabled.has(name)
}

/**
 * Indexes the MOD entries of a manifest by canonical name and records which ones ship turned off.
 */
export function indexManifest(manifest: IModpackManifest | null | undefined): IModManifestIndex {
  const byName = new Map<string, IModpackFile>()
  const shippedDisabled = new Set<string>()

  for (const file of manifest?.files ?? []) {
    if (file.type !== 'MOD') continue
    const name = toCanonicalName(file.name)
    byName.set(name, file)
    if (file.name !== name) shippedDisabled.add(name)
  }

  return { byName, shippedDisabled }
}

/** Reads the mods folder, collapsing `<name>.jar` and `<name>.jar.disabled` into one entry. */
export function listDiskMods(modsDir: string): Map<string, IDiskMod> {
  const found = new Map<string, IDiskMod>()
  if (!fs.existsSync(modsDir)) return found

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(modsDir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const disabled = entry.name.endsWith(DISABLED_SUFFIX)
    const base = toCanonicalName(entry.name)
    if (!base.toLowerCase().endsWith('.jar')) continue

    let size = 0
    try {
      size = fs.statSync(path.join(modsDir, entry.name)).size
    } catch {
      continue
    }

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

/**
 * Merges the modpack with what is on disk into the list shown on the Mods tab: every manifest entry
 * plus every file the player dropped in manually.
 */
export function buildModEntries(
  manifest: IModpackManifest | null | undefined,
  disk: Map<string, IDiskMod>,
  choices: IModChoices
): IModEntry[] {
  const index = indexManifest(manifest)
  const names = new Set([...index.byName.keys(), ...disk.keys()])

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const file = index.byName.get(name)
      const onDisk = disk.get(name)
      const off = isModOff(name, index.shippedDisabled, choices)

      return {
        name,
        // A mod the player never downloaded and that ships off stays off until it is fetched.
        enabled: !!onDisk && !off,
        installed: onDisk !== undefined,
        size: file?.size ?? onDisk?.size ?? 0,
        sha1: file?.sha1 ?? '',
        inManifest: file !== undefined
      }
    })
}

/**
 * Rewrites a manifest for a single launch so `eml-lib` downloads each mod where Forge can load it.
 *
 * Three things happen here:
 * - the MOD `path` is forced to `mods/`. A manifest entry with an empty or wrong path is a jar that
 *   lands in the game directory root and silently never loads, so it is not trusted;
 * - a mod that is off is named `<name>.jar.disabled`, which is where the player already keeps it.
 *   That is what stops the launcher from re-downloading a mod the player just turned off on every
 *   single launch.
 */
export function buildLaunchManifest(
  manifest: IModpackManifest | null | undefined,
  choices: IModChoices
): IModpackManifest {
  const index = indexManifest(manifest)

  return {
    files: (manifest?.files ?? []).map((file): IModpackFile => {
      if (file.type !== 'MOD') return file

      const name = toCanonicalName(file.name)
      const off = isModOff(name, index.shippedDisabled, choices)

      return {
        ...file,
        name: off ? disabledPathOf(name) : name,
        path: `${MODS_FOLDER}/`
      }
    })
  }
}

/**
 * Names in the mods folder that the modpack does not ship, in either file form.
 *
 * The walk is recursive because Forge walks `mods/` recursively too, so a jar tucked in a
 * sub-folder is loaded by the game just the same. A symlink is reported as well: it is the cheap way
 * to point the game at a jar that lives anywhere else on the disk, and it is never something the
 * modpack ships.
 *
 * Only jars are reported: anything else in the folder belongs to the player (configs, resource
 * packs, screenshots) and is never touched.
 */
export function findForeignModFiles(modsDir: string, manifest: IModpackManifest | null | undefined): IForeignModFile[] {
  const index = indexManifest(manifest)
  if (index.byName.size === 0 || !fs.existsSync(modsDir)) return []

  const foreign: IForeignModFile[] = []

  const walk = (dir: string, prefix: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Past this depth the whole folder is reported instead of what is inside it: an unreadable
    // corner of the mods folder must not become a place a jar can hide from the check.
    if (depth > MAX_MOD_SCAN_DEPTH && prefix !== '') {
      foreign.push({ rel: prefix, kind: 'dir' })
      return
    }

    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`

      if (entry.isSymbolicLink()) {
        foreign.push({ rel, kind: 'symlink' })
        continue
      }
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel, depth + 1)
        continue
      }
      if (!entry.isFile() || !isModFileName(entry.name)) continue
      if (index.byName.has(toCanonicalName(entry.name))) continue

      foreign.push({ rel, kind: 'file' })
    }
  }

  walk(modsDir, '', 0)
  return foreign
}

/**
 * Mods left in the game directory root by builds that shipped a manifest without `path`. They are
 * moved into the mods folder instead of being downloaded a second time.
 */
export function findStrayModFiles(gameDir: string, manifest: IModpackManifest | null | undefined): string[] {
  const index = indexManifest(manifest)
  if (index.byName.size === 0 || !fs.existsSync(gameDir)) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(gameDir, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isFile() && isModFileName(entry.name))
    .map((entry) => entry.name)
    .filter((name) => index.byName.has(toCanonicalName(name)))
}