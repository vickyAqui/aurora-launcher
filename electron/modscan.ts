import fs from 'node:fs'
import path from 'node:path'
import { fromBuffer as openZipBuffer, open as openZip, type Entry, type ZipFile } from 'yauzl'
import { parse as parseToml } from 'smol-toml'

/**
 * Reads the metadata Forge and Fabric store inside each mod jar and turns it into a diagnosis.
 *
 * The launcher never guesses what a jar is: it opens the archive, reads `META-INF/mods.toml`
 * (or `fabric.mod.json`), and only reports what the mod itself declares. That is what lets the
 * Mods tab point at a duplicate `modId` or a mod built for another Minecraft version instead of
 * waiting for the game to crash on startup.
 */

/** Entries a Forge or Fabric jar can use to describe itself. */
const METADATA_ENTRIES = ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'fabric.mod.json']

const MANIFEST_ENTRY = 'META-INF/MANIFEST.MF'

/** A mods.toml is a few KB; anything this large is not metadata and is not worth loading. */
const MAX_ENTRY_BYTES = 2 * 1024 * 1024

/** Dependencies every Forge/Fabric install already provides; never report them as missing. */
const BUILTIN_MOD_IDS = new Set([
  'minecraft',
  'forge',
  'neoforge',
  'fml',
  'javafml',
  'lowcodefml',
  'java',
  'fabricloader',
  'fabric',
  'fabric-api',
  'fabric_api'
])

export type ModLoaderKind = 'forge' | 'fabric' | 'unknown'

export interface IModDependency {
  modId: string
  mandatory: boolean
  versionRange?: string
  side?: string
}

export interface IModMetadata {
  /** Canonical file name, without the `.disabled` suffix. */
  file: string
  enabled: boolean
  modId: string
  name: string
  version: string
  loader: ModLoaderKind
  loaderVersion?: string
  dependencies: IModDependency[]
}

/** A jar the scanner could not describe, kept so the UI can still show and disable it. */
export interface IScannedMod {
  file: string
  enabled: boolean
  metadata: IModMetadata | null
  /**
   * Mod ids carried inside the jar (`META-INF/jarjar` or `META-INF/jars`). Forge loads those
   * nested jars with the mod, so they satisfy other mods' dependencies even though they have no
   * file of their own in the mods folder.
   */
  provides?: string[]
  error?: string
}

export type ModIssueKind =
  | 'duplicate'
  | 'wrong-version'
  | 'missing-dependency'
  | 'disabled-dependency'
  | 'unreadable'
  | 'no-metadata'
  | 'filename-version'

export type ModIssueSeverity = 'error' | 'warning' | 'info'

export type ModIssueAction = 'disable' | 'enable' | null

export interface IModIssue {
  kind: ModIssueKind
  severity: ModIssueSeverity
  /** File the action applies to. */
  file: string
  modId?: string
  modName?: string
  message: string
  action: ModIssueAction
}

export interface IModScanResult {
  mods: IScannedMod[]
  issues: IModIssue[]
  scanned: number
}

export interface IDiagnoseOptions {
  minecraftVersion: string
  loaderVersion: string
}

/**
 * Arclight names the loader `<minecraft>-<loader>` (`1.20.1-47.4.10`), while a mod's metadata only
 * ever talks about the loader part (`[47,)`). Comparing the two as-is fails every Forge mod, so the
 * Minecraft prefix is dropped before the ranges are checked.
 */
export function normalizeLoaderVersion(loaderVersion: string, minecraftVersion: string): string {
  const prefix = `${minecraftVersion}-`
  if (loaderVersion.startsWith(prefix)) return loaderVersion.slice(prefix.length)

  const prefixed = loaderVersion.match(/^\d+\.\d+(?:\.\d+)?-(.+)$/)
  return prefixed ? prefixed[1] : loaderVersion
}

interface IParsedToml {
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Splits a version into its numeric parts, ignoring the qualifier.
 *
 * Forge compares versions with Maven rules; for deciding whether `1.20.1` is inside `[1.20,1.21)`
 * the numbers are all that matters. `1.0.0-beta` is treated as lower than `1.0.0`.
 */
function versionParts(version: string): { numbers: number[]; qualifier: boolean } {
  const trimmed = version.trim()
  const [core] = trimmed.split('+')
  const dash = core.indexOf('-')
  const numeric = dash === -1 ? core : core.slice(0, dash)

  const numbers = numeric
    .split(/[._]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))

  return { numbers, qualifier: dash !== -1 }
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  const length = Math.max(left.numbers.length, right.numbers.length)

  for (let i = 0; i < length; i++) {
    const l = left.numbers[i] ?? 0
    const r = right.numbers[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }

  if (left.qualifier === right.qualifier) return 0
  return left.qualifier ? -1 : 1
}

export interface IVersionRangeOptions {
  /**
   * Only the lower bound is enforced. Forge/NeoForge loader dependencies commonly carry an upper
   * bound from the loader version of the day (`[46,47.3.12]`); a newer loader still runs them.
   */
  minimumOnly?: boolean
}

function isInsideBounds(version: string, group: string, minimumOnly: boolean): boolean {
  const lowerInclusive = group.startsWith('[')
  const upperInclusive = group.endsWith(']')
  const inner = group.slice(1, -1).trim()

  if (!inner.includes(',')) {
    // `[1.20.1]` is an exact version, not a range.
    return compareVersions(version, inner) === 0
  }

  const comma = inner.indexOf(',')
  const lower = inner.slice(0, comma).trim()
  const upper = inner.slice(comma + 1).trim()

  if (lower) {
    const cmp = compareVersions(version, lower)
    if (lowerInclusive ? cmp < 0 : cmp <= 0) return false
  }

  if (upper && !minimumOnly) {
    const cmp = compareVersions(version, upper)
    if (upperInclusive ? cmp > 0 : cmp >= 0) return false
  }

  return true
}

/**
 * Comparator syntax Fabric mods use (`>=1.20 <1.20.2`, `>=1.16.5`, `>= 1.20, < 1.20.2`).
 * Returns `null` when the range is not written that way.
 */
function satisfiesComparators(version: string, range: string, minimumOnly: boolean): boolean | null {
  const comparators = [...range.matchAll(/(>=|<=|>|<|=)\s*([0-9][0-9A-Za-z.+_-]*)/g)]

  if (comparators.length === 0) {
    // A bare version means "at least this version" in Forge; treating it as a minimum is right
    // for the Forge metadata this scanner reads most.
    if (/[[\]()]/.test(range) || !/^[0-9]/.test(range)) return null
    return compareVersions(version, range) >= 0
  }

  for (const [, operator, target] of comparators) {
    const cmp = compareVersions(version, target)

    if (operator === '>=' && cmp < 0) return false
    if (operator === '>' && cmp <= 0) return false
    if (operator === '=' && cmp !== 0) return false
    if (minimumOnly) continue
    if (operator === '<=' && cmp > 0) return false
    if (operator === '<' && cmp >= 0) return false
  }

  return true
}

/**
 * Whether `version` satisfies a Maven range such as `[1.20.1,)`, `[1.20,1.21)` or `[47,)`.
 *
 * Forge also accepts a bare version (`1.20.1`) meaning "at least this version", and a `*`
 * wildcard; Fabric mods use comparators (`>=1.20 <1.20.2`). Unions (`[1,2),[3,4)`) are checked
 * group by group.
 */
export function satisfiesVersionRange(
  version: string,
  range: string | undefined,
  options: IVersionRangeOptions = {}
): boolean {
  if (!range) return true

  const trimmed = range.trim()
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'any') return true

  const minimumOnly = options.minimumOnly ?? false
  const comparators = satisfiesComparators(version, trimmed, minimumOnly)
  if (comparators !== null) return comparators

  const groups = trimmed.match(/[[(][^[\]()]*[\])]/g)
  if (!groups || groups.length === 0) return compareVersions(version, trimmed) >= 0

  return groups.some((group) => isInsideBounds(version, group, minimumOnly))
}

/** A jar opened from disk or from a nested entry of another jar. */
type ZipSource = { path: string } | { buffer: Buffer }

interface IArchiveContents {
  /** Requested metadata entries, by name. */
  files: Map<string, Buffer>
  /** Nested jars (`META-INF/jarjar/*.jar`, `META-INF/jars/*.jar`), by entry name. */
  nested: Map<string, Buffer>
}

/** A nested jar is a full mod; cap it so a malformed archive cannot balloon memory. */
const MAX_NESTED_JAR_BYTES = 32 * 1024 * 1024

/** Reads the requested entries and every nested jar from an archive without extracting to disk. */
function readArchive(source: ZipSource, names: string[]): Promise<IArchiveContents> {
  return new Promise((resolve, reject) => {
    const options = { lazyEntries: true, autoClose: true }

    const onOpen = (openError: Error | null, zipFile: ZipFile) => {
      if (openError) return reject(openError)

      const files = new Map<string, Buffer>()
      const nested = new Map<string, Buffer>()
      let settled = false

      const finish = (error?: Error) => {
        if (settled) return
        settled = true

        try {
          zipFile.close()
        } catch {
          // Already closed by `autoClose`.
        }

        if (error) reject(error)
        else resolve({ files, nested })
      }

      const readNext = (entry: Entry) => {
        const wanted = names.includes(entry.fileName)
        const isNested = entry.fileName.endsWith('.jar') && entry.uncompressedSize <= MAX_NESTED_JAR_BYTES

        if (!wanted && !isNested) {
          zipFile.readEntry()
          return
        }

        const limit = wanted ? MAX_ENTRY_BYTES : MAX_NESTED_JAR_BYTES

        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return finish(streamError)

          const chunks: Buffer[] = []
          let size = 0

          stream.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > limit) {
              finish(new Error(`${entry.fileName} é grande demais para ser metadado`))
              return
            }
            chunks.push(chunk)
          })

          stream.on('error', (error) => finish(error))
          stream.on('end', () => {
            if (settled) return
            const buffer = Buffer.concat(chunks)
            if (wanted) files.set(entry.fileName, buffer)
            else nested.set(entry.fileName, buffer)
            zipFile.readEntry()
          })
        })
      }

      zipFile.on('entry', readNext)
      zipFile.on('end', () => finish())
      zipFile.on('error', (error) => finish(error))
      zipFile.readEntry()
    }

    if ('path' in source) openZip(source.path, options, onOpen)
    else openZipBuffer(source.buffer, options, onOpen)
  })
}

/** Version stored in `META-INF/MANIFEST.MF`, used when the TOML asks for `${file.jarVersion}`. */
function manifestVersion(manifest: Buffer | undefined): string | undefined {
  if (!manifest) return undefined

  const text = manifest.toString('utf8').replace(/\r\n/g, '\n').replace(/\n /g, '')
  const match = /^Implementation-Version:\s*(.+)$/m.exec(text)
  return match?.[1].trim()
}

function parseDependencies(value: unknown, declaredIds: Set<string>): IModDependency[] {
  if (!isRecord(value)) return []

  const dependencies: IModDependency[] = []

  // Forge only reads the dependencies declared under each mod id it actually ships; a jar that
  // copied the template and left `[[dependencies.examplemod]]` in place has no dependency at all.
  for (const [owner, entries] of Object.entries(value)) {
    if (!declaredIds.has(owner) || !Array.isArray(entries)) continue

    for (const entry of entries) {
      if (!isRecord(entry)) continue

      const modId = asString(entry.modId)
      if (!modId) continue

      dependencies.push({
        modId,
        mandatory: entry.mandatory === true,
        versionRange: asString(entry.versionRange),
        side: asString(entry.side)?.toUpperCase()
      })
    }
  }

  return dependencies
}

function parseForgeMetadata(toml: IParsedToml, file: string, enabled: boolean, manifest: Buffer | undefined): IModMetadata | null {
  const mods = Array.isArray(toml.mods) ? toml.mods : []
  const declared = mods.filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.modId === 'string')
  const first = declared[0]
  if (!first) return null

  let version = asString(first.version) ?? 'desconhecida'
  if (version.includes('${file.jarVersion}')) version = manifestVersion(manifest) ?? version.replace('${file.jarVersion}', '')

  return {
    file,
    enabled,
    modId: first.modId as string,
    name: asString(first.displayName) ?? (first.modId as string),
    version,
    loader: 'forge',
    loaderVersion: asString(toml.loaderVersion),
    dependencies: parseDependencies(toml.dependencies, new Set(declared.map((entry) => entry.modId as string)))
  }
}

function parseFabricMetadata(json: IParsedToml, file: string, enabled: boolean): IModMetadata | null {
  const modId = asString(json.id)
  if (!modId) return null

  const dependencies: IModDependency[] = []
  if (isRecord(json.depends)) {
    for (const [depId, range] of Object.entries(json.depends)) {
      dependencies.push({
        modId: depId,
        mandatory: true,
        versionRange: Array.isArray(range) ? range.map(String).join(' || ') : typeof range === 'string' ? range : undefined,
        side: 'BOTH'
      })
    }
  }

  return {
    file,
    enabled,
    modId,
    name: asString(json.name) ?? modId,
    version: typeof json.version === 'string' ? json.version : 'desconhecida',
    loader: 'fabric',
    dependencies
  }
}

function parseMetadataFiles(
  entries: Map<string, Buffer>,
  file: string,
  enabled: boolean
): { metadata: IModMetadata | null; error?: string } {
  const manifest = entries.get(MANIFEST_ENTRY)

  for (const name of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
    const raw = entries.get(name)
    if (!raw) continue

    try {
      const parsed = parseToml(raw.toString('utf8')) as IParsedToml
      const metadata = parseForgeMetadata(parsed, file, enabled, manifest)
      if (metadata) return { metadata }
      return { metadata: null, error: `${name} não declara um modId` }
    } catch (err) {
      return { metadata: null, error: `${name} inválido: ${(err as Error).message}` }
    }
  }

  const fabric = entries.get('fabric.mod.json')
  if (fabric) {
    try {
      const parsed = JSON.parse(fabric.toString('utf8')) as IParsedToml
      const metadata = parseFabricMetadata(parsed, file, enabled)
      if (metadata) return { metadata }
      return { metadata: null, error: 'fabric.mod.json não declara um id' }
    } catch (err) {
      return { metadata: null, error: `fabric.mod.json inválido: ${(err as Error).message}` }
    }
  }

  return { metadata: null }
}

/** How deep nested jars are followed: `fantasyfurniture` -> `apexcore` -> `commonality`. */
const MAX_NESTING_DEPTH = 3

export interface IModMetadataRead {
  metadata: IModMetadata | null
  error?: string
  /** Every mod id the jar makes available, including the ones inside nested jars. */
  provides: string[]
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function readMetadataFrom(
  source: ZipSource,
  file: string,
  enabled: boolean,
  depth: number
): Promise<IModMetadataRead> {
  const contents = await readArchive(source, [...METADATA_ENTRIES, MANIFEST_ENTRY])
  const root = parseMetadataFiles(contents.files, file, enabled)

  const provides = new Set<string>()
  const nestedMetadata: IModMetadata[] = []

  if (depth < MAX_NESTING_DEPTH) {
    for (const [entryName, buffer] of contents.nested) {
      try {
        const child = await readMetadataFrom({ buffer }, entryName.split('/').pop() ?? entryName, enabled, depth + 1)
        if (child.metadata) {
          nestedMetadata.push(child.metadata)
          provides.add(child.metadata.modId)
        }
        for (const id of child.provides) provides.add(id)
      } catch {
        // Forge ignores a nested jar it cannot read too.
      }
    }
  }

  if (root.metadata || root.error) return { ...root, provides: [...provides] }

  // Wrapper jars (`kotlinforforge-*-all`, `Connector-*`) carry no root metadata: the mod they add
  // lives in a nested jar, usually the one whose name matches the wrapper's.
  if (nestedMetadata.length > 0) {
    const normalizedFile = normalizeId(file)
    const main = nestedMetadata.find((entry) => normalizedFile.includes(normalizeId(entry.modId))) ?? nestedMetadata[0]
    return { metadata: { ...main, file, enabled }, provides: [...provides] }
  }

  return { metadata: null, provides: [...provides] }
}

export function canonicalModName(file: string): string {
  return file.endsWith('.disabled') ? file.slice(0, -'.disabled'.length) : file
}

/** Reads the metadata of one jar. Never throws: a broken jar comes back as `{ metadata: null }`. */
export async function readModMetadata(jarPath: string): Promise<IModMetadataRead> {
  const file = canonicalModName(path.basename(jarPath))
  const enabled = !jarPath.endsWith('.disabled')

  try {
    const parsed = await readMetadataFrom({ path: jarPath }, file, enabled, 0)

    if (!parsed.metadata && !parsed.error) {
      return { metadata: null, provides: parsed.provides, error: 'o jar não tem META-INF/mods.toml nem fabric.mod.json' }
    }

    return parsed
  } catch (err) {
    return { metadata: null, provides: [], error: `não foi possível abrir o jar: ${(err as Error).message}` }
  }
}

/**
 * A version written in the file name (`...-mc1.20.2.jar`) is a hint the metadata sometimes does
 * not carry: several mods accept a range that happens to include 1.20.1 even when the build was
 * made for 1.20.2. Only an exact `1.<minor>.<patch>` that is not the pack version is reported.
 */
export function filenameMinecraftVersion(file: string, minecraftVersion: string): string | null {
  const target = versionParts(minecraftVersion).numbers.slice(0, 3)
  const matches: { label: string; minor: number; numbers: number[] }[] = []

  // `(?!\.\d)` keeps the tail of a longer mod version (`1.0.5.1`) from looking like a Minecraft
  // version; the other negative lookahead stops `1.20` from matching the start of `1.201`.
  for (const match of file.matchAll(/(?:^|[^0-9])1\.(\d{1,2})(?:\.(\d{1,2}))?(?![0-9])(?!\.\d)/g)) {
    const minor = Number(match[1])
    if (minor < 14 || minor > 21) continue

    const patch = match[2] === undefined ? 0 : Number(match[2])
    matches.push({
      label: match[2] === undefined ? `1.${minor}` : `1.${minor}.${patch}`,
      minor,
      numbers: [1, minor, patch]
    })
  }

  // Only the generations around this pack are worth reporting: a mod's own version can also start
  // with `1.` (Alex's Mobs is 1.22.9), and that is not a Minecraft version.
  const relevant = matches.filter((entry) => entry.minor === 19 || entry.minor === 20 || entry.minor === 21)
  if (relevant.length === 0) return null

  // `1.20` and `1.20.0` are the same generation as 1.20.1 for Forge mods.
  const isPackVersion = (numbers: number[]) => numbers[1] === target[1] && (numbers[2] === 0 || numbers[2] === target[2])

  // A name often lists the pack version next to the mod's own version (`...-1.20.1-17.1.21`) or a
  // supported range (`...-1.18-1.20.4`). Either way, the pack version is covered.
  if (matches.some((entry) => isPackVersion(entry.numbers))) return null

  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  const sorted = [...matches].sort((a, b) => compare(a.numbers, b.numbers))
  const pack = [1, target[1] ?? 0, target[2] ?? 0]

  if (matches.length >= 2 && compare(pack, sorted[0].numbers) >= 0 && compare(pack, sorted[sorted.length - 1].numbers) <= 0) {
    return null
  }

  return relevant[0].label
}

function findDuplicates(mods: IScannedMod[]): IModIssue[] {
  const byModId = new Map<string, IScannedMod[]>()

  for (const mod of mods) {
    // A `.jar.disabled` file is not loaded by the game, so it cannot conflict with an active jar.
    // Reporting it would keep the warning on screen after the player follows the advice.
    if (!mod.metadata || !mod.enabled) continue
    const list = byModId.get(mod.metadata.modId) ?? []
    list.push(mod)
    byModId.set(mod.metadata.modId, list)
  }

  const issues: IModIssue[] = []

  for (const [modId, entries] of byModId) {
    if (entries.length < 2) continue

    // Keep the newest mod version, then the first name alphabetically: deterministic, so the same
    // jar is reported every time the tab is opened.
    const sorted = [...entries].sort((a, b) => {
      const byVersion = compareVersions(b.metadata?.version ?? '0', a.metadata?.version ?? '0')
      if (byVersion !== 0) return byVersion
      return a.file.localeCompare(b.file)
    })
    const keeper = sorted[0]

    for (const duplicate of sorted.slice(1)) {
      issues.push({
        kind: 'duplicate',
        severity: 'error',
        file: duplicate.file,
        modId,
        modName: duplicate.metadata?.name,
        message: `${duplicate.metadata?.name ?? modId} aparece em mais de um jar. O jogo carrega apenas um e pode travar; mantenha ${keeper.file}.`,
        action: 'disable'
      })
    }
  }

  return issues
}

/**
 * Builds the list of problems the player can act on.
 *
 * Pure on purpose: the UI tests and the unit tests feed it hand-written metadata instead of
 * 300 real jars.
 */
export function diagnoseMods(mods: IScannedMod[], options: IDiagnoseOptions): IModIssue[] {
  const issues: IModIssue[] = []
  const loaderVersion = normalizeLoaderVersion(options.loaderVersion, options.minecraftVersion)

  const enabledIds = new Set<string>()
  const disabledIds = new Map<string, IScannedMod>()

  for (const mod of mods) {
    const ids = [mod.metadata?.modId, ...(mod.provides ?? [])].filter((id): id is string => Boolean(id))
    if (ids.length === 0) continue

    if (mod.enabled) {
      for (const id of ids) enabledIds.add(id)
      continue
    }

    // A disabled jar also disables every mod nested in it, so the fix is to enable this file.
    for (const id of ids) if (!disabledIds.has(id)) disabledIds.set(id, mod)
  }

  for (const mod of mods) {
    if (!mod.metadata) {
      issues.push({
        kind: mod.error?.startsWith('não foi possível abrir') ? 'unreadable' : 'no-metadata',
        severity: mod.error?.startsWith('não foi possível abrir') ? 'error' : 'warning',
        file: mod.file,
        message: mod.error ?? 'Este jar não declara um mod.',
        action: mod.enabled ? 'disable' : null
      })
      continue
    }

    const { metadata } = mod
    if (!mod.enabled) continue

    const wrongRange = metadata.dependencies.find((dep) => {
      if (!dep.mandatory) return false
      if (dep.modId === 'minecraft') return !satisfiesVersionRange(options.minecraftVersion, dep.versionRange)
      if (dep.modId === 'forge' || dep.modId === 'neoforge') {
        // A loader newer than the upper bound still runs the mod; only a minimum the installed
        // loader does not reach is fatal.
        return !satisfiesVersionRange(loaderVersion, dep.versionRange, { minimumOnly: true })
      }
      return false
    })

    if (wrongRange) {
      const target = wrongRange.modId === 'minecraft' ? options.minecraftVersion : loaderVersion
      issues.push({
        kind: 'wrong-version',
        severity: 'error',
        file: metadata.file,
        modId: metadata.modId,
        modName: metadata.name,
        message: `${metadata.name} exige ${wrongRange.modId} ${wrongRange.versionRange}, mas o pack usa ${target}. Desative este jar e procure a versão 1.20.1.`,
        action: 'disable'
      })
    }

    if (
      metadata.loader === 'forge' &&
      metadata.loaderVersion &&
      !satisfiesVersionRange(loaderVersion, metadata.loaderVersion, { minimumOnly: true })
    ) {
      issues.push({
        kind: 'wrong-version',
        severity: 'error',
        file: metadata.file,
        modId: metadata.modId,
        modName: metadata.name,
        message: `${metadata.name} exige Forge ${metadata.loaderVersion}, mas o pack usa ${loaderVersion}.`,
        action: 'disable'
      })
    }

    for (const dep of metadata.dependencies) {
      if (!dep.mandatory || BUILTIN_MOD_IDS.has(dep.modId)) continue
      if (dep.side === 'SERVER') continue

      if (enabledIds.has(dep.modId)) continue

      const disabled = disabledIds.get(dep.modId)
      if (disabled) {
        issues.push({
          kind: 'disabled-dependency',
          severity: 'warning',
          file: disabled.file,
          modId: dep.modId,
          modName: disabled.metadata?.name,
          message: `${metadata.name} precisa de ${disabled.metadata?.name ?? dep.modId}, que está desativado.`,
          action: 'enable'
        })
        continue
      }

      issues.push({
        kind: 'missing-dependency',
        severity: 'error',
        file: metadata.file,
        modId: metadata.modId,
        modName: metadata.name,
        message: `${metadata.name} exige ${dep.modId}, que não está instalado. O jogo não vai abrir com este mod ativo.`,
        action: 'disable'
      })
    }

    const filenameVersion = filenameMinecraftVersion(metadata.file, options.minecraftVersion)
    if (filenameVersion) {
      issues.push({
        kind: 'filename-version',
        severity: 'warning',
        file: metadata.file,
        modId: metadata.modId,
        modName: metadata.name,
        message: `O nome do arquivo cita Minecraft ${filenameVersion}, mas o pack usa ${options.minecraftVersion}. Confira se existe uma build 1.20.1.`,
        action: 'disable'
      })
    }
  }

  issues.push(...findDuplicates(mods))

  const order: Record<ModIssueSeverity, number> = { error: 0, warning: 1, info: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file))
}

/** Lists and diagnoses every jar in the mods folder, enabled or not. */
export async function scanModsDir(modsDir: string, options: IDiagnoseOptions): Promise<IModScanResult> {
  let names: string[] = []

  try {
    names = fs
      .readdirSync(modsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.jar') || entry.name.endsWith('.jar.disabled')))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return { mods: [], issues: [], scanned: 0 }
  }

  const mods: IScannedMod[] = []

  for (const name of names) {
    const { metadata, error, provides } = await readModMetadata(path.join(modsDir, name))
    mods.push({
      file: canonicalModName(name),
      enabled: !name.endsWith('.disabled'),
      metadata,
      provides,
      error
    })
  }

  return { mods, issues: diagnoseMods(mods, options), scanned: mods.length }
}
