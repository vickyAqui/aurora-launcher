import fs from 'node:fs'
import path from 'node:path'
import {
  buildJvmArgs,
  getPerformanceProfile,
  isPerformanceProfileId,
  type IPerformanceProfile,
  type OptionValue,
  type PerformanceProfileId
} from '../src/performancePresets'

/**
 * Pure file layer for the Performance tab.
 *
 * The game and the mods own their config files and rewrite them when Minecraft closes. This module
 * only merges the keys a profile controls into the current contents, never replaces a whole file,
 * so a config the player edited keeps every other setting. The launcher reapplies the profile right
 * before each launch, the same way it already does with the CPM model.
 */

/** Launcher-side file that remembers which profile is active, per game profile. */
export const PERFORMANCE_STATE_FILE = 'performance.json'

/** Suffix of the copy taken before the first write to a file. */
export const BACKUP_SUFFIX = '.aurora-backup'

const OPTIONS_FILE = 'options.txt'
const OCULUS_FILE = path.posix.join('config', 'oculus.properties')
const DYNAMIC_LIGHTS_SECTION = 'sodiumdynamiclights'

export interface IPreviousMemory {
  min: number
  max: number
}

export interface IPerformanceState {
  profile: PerformanceProfileId
  memory: number
  appliedAt: string
  /** Files written by the launcher, relative to the game directory. */
  files: string[]
  /** Files that did not exist before the profile and were created by it. */
  created: string[]
  /** Memory that was configured before the first apply, so Undo can put it back. */
  previousMemory?: IPreviousMemory
}

export interface IPerformanceApplyOptions {
  gameDir: string
  userDataDir: string
  slug: string
  profileId: PerformanceProfileId
  memory: number
  previousMemory?: IPreviousMemory
}

export interface IPerformanceApplyResult {
  ok: boolean
  error?: string
  profile?: PerformanceProfileId
  memory?: number
  files?: string[]
  javaArgs?: string[]
  appliedAt?: string
}

export interface IPerformanceRestoreResult {
  ok: boolean
  restored: string[]
  error?: string
}

type JsonObject = Record<string, unknown>

type TargetKind = 'options' | 'json' | 'properties' | 'toml'

interface IFileTarget {
  rel: string
  kind: TargetKind
  patch: JsonObject
  /** Only `options.txt` is created from scratch; a missing mod config means the mod is not installed. */
  create: boolean
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes through a temporary file, so the game never reads a half-written config.
 */
function writeAtomic(filePath: string, contents: string): boolean {
  const tmpPath = `${filePath}.tmp`

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmpPath, contents)
    fs.renameSync(tmpPath, filePath)
    return true
  } catch {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // The original file was left untouched.
    }
    return false
  }
}

export function backupPath(filePath: string): string {
  return `${filePath}${BACKUP_SUFFIX}`
}

/** Copies a file once, before the first profile write. Returns false when it is already backed up. */
export function backupFile(filePath: string): boolean {
  const backup = backupPath(filePath)
  if (fs.existsSync(backup) || !fs.existsSync(filePath)) return false

  try {
    fs.copyFileSync(filePath, backup)
    return true
  } catch {
    return false
  }
}

export function restoreBackup(filePath: string): boolean {
  const backup = backupPath(filePath)
  if (!fs.existsSync(backup)) return false

  try {
    fs.copyFileSync(backup, filePath)
    fs.rmSync(backup, { force: true })
    return true
  } catch {
    return false
  }
}

function formatOptionValue(value: OptionValue): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  // Minecraft stores strings such as `renderClouds` quoted in `options.txt`.
  return JSON.stringify(value)
}

/**
 * Merges `patch` into the contents of `options.txt`, keeping every unknown line.
 *
 * The game writes `key:value` one per line. Values are not escaped, so a string is quoted the way
 * the game itself quotes `renderClouds`.
 */
export function applyOptions(raw: string, patch: Record<string, OptionValue>): string {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()

  const remaining = new Map(Object.entries(patch))

  for (let i = 0; i < lines.length; i++) {
    const colon = lines[i].indexOf(':')
    if (colon <= 0) continue

    const key = lines[i].slice(0, colon)
    if (!remaining.has(key)) continue

    lines[i] = `${key}:${formatOptionValue(remaining.get(key)!)}`
    remaining.delete(key)
  }

  for (const [key, value] of remaining) lines.push(`${key}:${formatOptionValue(value)}`)

  return `${lines.join(newline)}${lines.length ? newline : ''}`
}

function deepMerge(target: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...target }

  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key]
    merged[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value
  }

  return merged
}

/** Nested merge of a JSON config, keeping every key the profile does not control. */
export function mergeJson(raw: string | null, patch: JsonObject): string {
  let data: JsonObject = {}

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isPlainObject(parsed)) data = parsed
    } catch {
      // A corrupt config is replaced by a minimal one; the mod fills in the rest on the next start.
    }
  }

  return `${JSON.stringify(deepMerge(data, patch), null, 2)}\n`
}

/**
 * Merges `key=value` entries into a `.properties` file, keeping comments and every other key.
 */
export function mergeProperties(raw: string, patch: Record<string, string>): string {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()

  const remaining = new Map(Object.entries(patch))

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) continue

    const equals = lines[i].indexOf('=')
    if (equals <= 0) continue

    const key = lines[i].slice(0, equals).trim()
    if (!remaining.has(key)) continue

    const indent = lines[i].match(/^\s*/)?.[0] ?? ''
    lines[i] = `${indent}${key}=${remaining.get(key)!}`
    remaining.delete(key)
  }

  for (const [key, value] of remaining) lines.push(`${key}=${value}`)

  return `${lines.join(newline)}${lines.length ? newline : ''}`
}

function formatToml(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

/**
 * Merges keys inside a TOML section, keeping comments, ordering and other sections intact.
 */
export function mergeTomlSection(
  raw: string,
  section: string,
  patch: Record<string, string | number | boolean>
): string {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()

  const header = `[${section}]`
  const start = lines.findIndex((line) => line.trim() === header)

  if (start === -1) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
    lines.push(header)
    for (const [key, value] of Object.entries(patch)) lines.push(`${key} = ${formatToml(value)}`)
    return `${lines.join(newline)}${newline}`
  }

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      end = i
      break
    }
  }

  const remaining = new Map(Object.entries(patch))

  for (let i = start + 1; i < end; i++) {
    const match = /^(\s*)([A-Za-z0-9_.-]+)\s*=\s*.*$/.exec(lines[i])
    if (!match) continue

    const key = match[2]
    if (!remaining.has(key)) continue

    lines[i] = `${match[1]}${key} = ${formatToml(remaining.get(key)!)}`
    remaining.delete(key)
  }

  if (remaining.size > 0) {
    const inserts: string[] = []
    for (const [key, value] of remaining) inserts.push(`${key} = ${formatToml(value)}`)
    lines.splice(end, 0, ...inserts)
  }

  return `${lines.join(newline)}${newline}`
}

/**
 * Whether Oculus already has a shader pack selected. The quality profile only enables shaders when
 * this is true: turning on an empty shader pipeline adds work and changes nothing visually.
 */
export function hasSelectedShaderPack(gameDir: string): boolean {
  const raw = readFile(path.join(gameDir, OCULUS_FILE))
  if (!raw) return false

  const match = /^shaderPack[ \t]*=[ \t]*(.+)$/m.exec(raw)
  return Boolean(match && match[1].trim())
}

function buildTargets(profile: IPerformanceProfile, hasShaderPack: boolean): IFileTarget[] {
  const shaders = profile.oculusShaders === 'auto' ? hasShaderPack : profile.oculusShaders

  return [
    { rel: OPTIONS_FILE, kind: 'options', patch: profile.options, create: true },
    {
      rel: path.posix.join('config', 'embeddium-options.json'),
      kind: 'json',
      patch: profile.embeddium,
      create: false
    },
    {
      rel: path.posix.join('config', 'sodium-extra-options.json'),
      kind: 'json',
      patch: profile.sodiumExtra,
      create: false
    },
    {
      rel: path.posix.join('config', 'chloride-client.json'),
      kind: 'json',
      patch: profile.chloride,
      create: false
    },
    {
      rel: path.posix.join('config', 'entityculling.json'),
      kind: 'json',
      patch: profile.entityCulling,
      create: false
    },
    {
      rel: path.posix.join('config', 'betterfpsdist.json'),
      kind: 'json',
      patch: profile.betterFpsDist,
      create: false
    },
    {
      rel: path.posix.join('config', 'cull-less-leaves.json'),
      kind: 'json',
      patch: profile.cullLessLeaves,
      create: false
    },
    {
      rel: path.posix.join('config', 'alltheleaks.json'),
      kind: 'json',
      patch: profile.allTheLeaks,
      create: false
    },
    {
      rel: OCULUS_FILE,
      kind: 'properties',
      patch: { enableShaders: shaders ? 'true' : 'false' },
      create: false
    },
    {
      rel: path.posix.join('config', 'sodiumdynamiclights-client.toml'),
      kind: 'toml',
      patch: { mode: profile.dynamicLights },
      create: false
    }
  ]
}

function transform(target: IFileTarget, raw: string | null): string | null {
  switch (target.kind) {
    case 'options':
      return applyOptions(raw ?? '', target.patch as Record<string, OptionValue>)
    case 'json':
      return mergeJson(raw, target.patch)
    case 'properties':
      return mergeProperties(raw ?? '', target.patch as Record<string, string>)
    case 'toml':
      return mergeTomlSection(raw ?? '', DYNAMIC_LIGHTS_SECTION, target.patch as Record<string, string | number | boolean>)
  }
}

export function normalizeMemory(value: number): number {
  if (!Number.isFinite(value)) return 4
  return Math.min(16, Math.max(1, Math.round(value * 2) / 2))
}

function stateFilePath(userDataDir: string): string {
  return path.join(userDataDir, PERFORMANCE_STATE_FILE)
}

function readStateMap(userDataDir: string): JsonObject {
  const raw = readFile(stateFilePath(userDataDir))
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function parseState(value: unknown): IPerformanceState | null {
  if (!isPlainObject(value)) return null

  const { profile, memory, appliedAt, files, created, previousMemory } = value
  if (!isPerformanceProfileId(profile)) return null
  if (typeof memory !== 'number' || !Number.isFinite(memory)) return null
  if (typeof appliedAt !== 'string') return null
  if (!isStringArray(files) || !isStringArray(created)) return null

  let previous: IPreviousMemory | undefined
  if (isPlainObject(previousMemory)) {
    const min = previousMemory.min
    const max = previousMemory.max
    if (typeof min === 'number' && Number.isFinite(min) && typeof max === 'number' && Number.isFinite(max)) {
      previous = { min, max }
    }
  }

  return { profile, memory, appliedAt, files, created, previousMemory: previous }
}

export function readPerformanceState(userDataDir: string, slug: string): IPerformanceState | null {
  return parseState(readStateMap(userDataDir)[slug])
}

function writePerformanceState(userDataDir: string, slug: string, state: IPerformanceState): boolean {
  const map = readStateMap(userDataDir)
  map[slug] = state
  return writeAtomic(stateFilePath(userDataDir), `${JSON.stringify(map, null, 2)}\n`)
}

function clearPerformanceState(userDataDir: string, slug: string): boolean {
  const map = readStateMap(userDataDir)
  if (!(slug in map)) return true

  delete map[slug]

  if (Object.keys(map).length === 0) {
    try {
      fs.rmSync(stateFilePath(userDataDir), { force: true })
      return true
    } catch {
      return false
    }
  }

  return writeAtomic(stateFilePath(userDataDir), `${JSON.stringify(map, null, 2)}\n`)
}

/** Every file the launcher has a backup for, relative to the game directory. */
export function listBackupFiles(gameDir: string): string[] {
  const found = new Set<string>()

  if (fs.existsSync(backupPath(path.join(gameDir, OPTIONS_FILE)))) found.add(OPTIONS_FILE)

  const configDir = path.join(gameDir, 'config')
  try {
    for (const entry of fs.readdirSync(configDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(BACKUP_SUFFIX)) continue
      found.add(path.posix.join('config', entry.name.slice(0, -BACKUP_SUFFIX.length)))
    }
  } catch {
    // No config folder yet: nothing to restore there.
  }

  return [...found].sort()
}

/**
 * Applies a profile to the game files and remembers the choice in the launcher.
 *
 * Files that do not exist are skipped (a missing mod config means the mod is not installed), except
 * `options.txt`, which is created with just the profile keys and completed by the game itself.
 */
export function applyPerformanceProfile(options: IPerformanceApplyOptions): IPerformanceApplyResult {
  if (!isPerformanceProfileId(options.profileId)) {
    return { ok: false, error: 'Perfil de desempenho inválido' }
  }

  const profile = getPerformanceProfile(options.profileId)
  const memory = normalizeMemory(options.memory)
  const hasShaderPack = hasSelectedShaderPack(options.gameDir)
  const files: string[] = []
  const created: string[] = []

  for (const target of buildTargets(profile, hasShaderPack)) {
    const filePath = path.join(options.gameDir, target.rel)
    const raw = readFile(filePath)

    if (raw === null && !target.create) continue

    const next = transform(target, raw)
    if (next === null) continue

    if (raw !== null) backupFile(filePath)

    if (!writeAtomic(filePath, next)) {
      return { ok: false, error: `Não foi possível gravar ${target.rel}` }
    }

    files.push(target.rel)
    if (raw === null) created.push(target.rel)
  }

  const appliedAt = new Date().toISOString()
  const state: IPerformanceState = {
    profile: options.profileId,
    memory,
    appliedAt,
    files,
    created,
    previousMemory: options.previousMemory
  }

  if (!writePerformanceState(options.userDataDir, options.slug, state)) {
    return { ok: false, error: 'Não foi possível salvar o perfil de desempenho' }
  }

  return {
    ok: true,
    profile: options.profileId,
    memory,
    files,
    javaArgs: buildJvmArgs(options.profileId, memory),
    appliedAt
  }
}

/**
 * Reapplies the stored profile right before a launch.
 *
 * `memoryOverride` lets the RAM slider win over the value stored with the profile: if the player
 * changed the heap size after applying a profile, that explicit choice is what should run.
 */
export function applyStoredPerformanceProfile(
  gameDir: string,
  userDataDir: string,
  slug: string,
  memoryOverride?: number
): IPerformanceApplyResult | null {
  const state = readPerformanceState(userDataDir, slug)
  if (!state) return null

  return applyPerformanceProfile({
    gameDir,
    userDataDir,
    slug,
    profileId: state.profile,
    memory: memoryOverride ?? state.memory,
    previousMemory: state.previousMemory
  })
}

/** Puts every backed-up file back and clears the stored profile. */
export function restorePerformanceProfile(
  gameDir: string,
  userDataDir: string,
  slug: string
): IPerformanceRestoreResult {
  const state = readPerformanceState(userDataDir, slug)
  const restored = new Set<string>()

  // A file the profile created has no backup; remove it instead of leaving a partial config behind.
  if (state) {
    for (const rel of state.created) {
      const filePath = path.join(gameDir, rel)
      if (fs.existsSync(backupPath(filePath))) continue

      try {
        fs.rmSync(filePath, { force: true })
        restored.add(rel)
      } catch {
        // Nothing else to do; the rest of the undo still runs.
      }
    }
  }

  const candidates = new Set(listBackupFiles(gameDir))
  if (state) {
    for (const rel of state.files) candidates.add(rel)
  }

  for (const rel of candidates) {
    if (restoreBackup(path.join(gameDir, rel))) restored.add(rel)
  }

  if (!clearPerformanceState(userDataDir, slug)) {
    return { ok: false, restored: [...restored].sort(), error: 'Não foi possível remover o perfil salvo' }
  }

  return { ok: true, restored: [...restored].sort() }
}
