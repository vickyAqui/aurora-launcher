import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyOptions,
  applyPerformanceProfile,
  applyStoredPerformanceProfile,
  backupPath,
  hasSelectedShaderPack,
  mergeJson,
  mergeProperties,
  mergeTomlSection,
  normalizeMemory,
  readPerformanceState,
  restorePerformanceProfile
} from '../electron/performance'
import {
  PERFORMANCE_PROFILES,
  buildJvmArgs,
  suggestMemoryGB,
  type PerformanceProfileId
} from '../src/performancePresets'

let gameDir = ''
let userDataDir = ''
const slug = 'aurora-studios'

function write(rel: string, content: string) {
  const filePath = path.join(gameDir, rel)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function read(rel: string): string {
  return readFileSync(path.join(gameDir, rel), 'utf8')
}

function readJson(rel: string): Record<string, any> {
  return JSON.parse(read(rel))
}

function seedGameFiles() {
  write('options.txt', 'version:3465\nrenderDistance:8\ngraphicsMode:1\nrenderClouds:"true"\n')
  write(
    'config/embeddium-options.json',
    JSON.stringify({
      quality: { weather_quality: 'DEFAULT', enable_vignette: true },
      notifications: { has_seen_donation_prompt: true }
    })
  )
  write(
    'config/sodium-extra-options.json',
    JSON.stringify({ animation_settings: { water: true }, extra_settings: { show_fps: false } })
  )
  write('config/chloride-client.json', JSON.stringify({ fastChests: false, maxZoom: 50 }))
  write('config/entityculling.json', JSON.stringify({ tracingDistance: 128, debugMode: false }))
  write('config/betterfpsdist.json', JSON.stringify({ horizontalScaling: 1.1, debugMode: false }))
  write('config/cull-less-leaves.json', JSON.stringify({ enabled: true, depth: 2 }))
  write('config/alltheleaks.json', JSON.stringify({ ingredientDedupe: false, logIntervalInMinutes: 10 }))
  write('config/oculus.properties', '#config\nshaderPack=\nenableShaders=true\n')
  write(
    'config/sodiumdynamiclights-client.toml',
    '\n[sodiumdynamiclights]\n\tmode = "REALTIME"\n\tentities = true\n'
  )
}

function apply(profileId: PerformanceProfileId, memory = 4, previousMemory?: { min: number; max: number }) {
  return applyPerformanceProfile({
    gameDir,
    userDataDir,
    slug,
    profileId,
    memory,
    previousMemory
  })
}

beforeEach(() => {
  gameDir = mkdtempSync(path.join(tmpdir(), 'aurora-perf-game-'))
  userDataDir = mkdtempSync(path.join(tmpdir(), 'aurora-perf-user-'))
})

afterEach(() => {
  rmSync(gameDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('performance presets', () => {
  it('exposes the three profiles with distinct render distances', () => {
    expect(PERFORMANCE_PROFILES.map((profile) => profile.id)).toEqual(['eco', 'balanced', 'quality'])
    expect(PERFORMANCE_PROFILES.map((profile) => profile.options.renderDistance)).toEqual([6, 10, 12])
  })

  it('suggests a heap that fits the machine and never exceeds half the RAM', () => {
    expect(suggestMemoryGB(4)).toBe(2)
    expect(suggestMemoryGB(8)).toBe(4)
    expect(suggestMemoryGB(12)).toBe(5)
    expect(suggestMemoryGB(16)).toBe(6)
    expect(suggestMemoryGB(32)).toBe(8)
    expect(suggestMemoryGB(0)).toBe(4)
  })

  it('builds Aikar flags without duplicating the heap size', () => {
    const args = buildJvmArgs('balanced', 6)

    expect(args).toContain('-XX:+UseG1GC')
    expect(args).toContain('-XX:+AlwaysPreTouch')
    expect(args).toContain('-XX:+UseStringDeduplication')
    expect(args.some((arg) => arg.startsWith('-Xmx') || arg.startsWith('-Xms'))).toBe(false)
  })

  it('leaves the expensive flags off on the economy profile', () => {
    const args = buildJvmArgs('eco', 4)

    expect(args).toContain('-XX:+UseG1GC')
    expect(args).not.toContain('-XX:+AlwaysPreTouch')
    expect(args).not.toContain('-XX:+UseStringDeduplication')
  })

  it('only enables string deduplication when the heap is large enough', () => {
    expect(buildJvmArgs('balanced', 4)).not.toContain('-XX:+UseStringDeduplication')
    expect(buildJvmArgs('balanced', 6)).toContain('-XX:+UseStringDeduplication')
  })

  it('normalizes memory to half-gigabyte steps inside the supported range', () => {
    expect(normalizeMemory(6.3)).toBe(6.5)
    expect(normalizeMemory(0)).toBe(1)
    expect(normalizeMemory(64)).toBe(16)
    expect(normalizeMemory(Number.NaN)).toBe(4)
  })
})

describe('options.txt merge', () => {
  it('replaces known keys, appends missing ones and keeps every other line', () => {
    const raw = 'version:3465\nrenderDistance:8\ncustomKey:value\n'
    const merged = applyOptions(raw, {
      renderDistance: 6,
      renderClouds: 'false',
      ao: false,
      entityDistanceScaling: 0.5
    })

    expect(merged).toContain('version:3465')
    expect(merged).toContain('customKey:value')
    expect(merged).toContain('renderDistance:6')
    expect(merged).toContain('renderClouds:"false"')
    expect(merged).toContain('ao:false')
    expect(merged).toContain('entityDistanceScaling:0.5')
    expect(merged).not.toContain('renderDistance:8')
  })

  it('preserves CRLF line endings', () => {
    const merged = applyOptions('renderDistance:8\r\n', { renderDistance: 6 })
    expect(merged).toBe('renderDistance:6\r\n')
  })

  it('creates the whole file when it does not exist yet', () => {
    expect(applyOptions('', { renderDistance: 6, maxFps: 90 })).toBe('renderDistance:6\nmaxFps:90\n')
  })
})

describe('JSON config merge', () => {
  it('merges nested keys and keeps everything the profile does not control', () => {
    const raw = JSON.stringify({
      quality: { weather_quality: 'DEFAULT', enable_vignette: true },
      notifications: { has_seen_donation_prompt: true }
    })

    const merged = JSON.parse(
      mergeJson(raw, { quality: { weather_quality: 'FAST', enable_vignette: false } })
    )

    expect(merged).toEqual({
      quality: { weather_quality: 'FAST', enable_vignette: false },
      notifications: { has_seen_donation_prompt: true }
    })
  })

  it('replaces a corrupt config with just the profile keys', () => {
    const merged = JSON.parse(mergeJson('not json', { fastChests: true }))
    expect(merged).toEqual({ fastChests: true })
  })
})

describe('properties and TOML merge', () => {
  it('replaces a properties key without touching comments or other keys', () => {
    const merged = mergeProperties('#config\nshaderPack=\nenableShaders=true\n', {
      enableShaders: 'false'
    })

    expect(merged).toBe('#config\nshaderPack=\nenableShaders=false\n')
  })

  it('replaces a TOML key inside the right section only', () => {
    const raw = '[sodiumdynamiclights]\n\tmode = "REALTIME"\n\tentities = true\n\n[other]\n\tmode = "KEEP"\n'
    const merged = mergeTomlSection(raw, 'sodiumdynamiclights', { mode: 'OFF' })

    expect(merged).toContain('\tmode = "OFF"')
    expect(merged).toContain('\tentities = true')
    expect(merged).toContain('\tmode = "KEEP"')
  })

  it('appends the section when the config does not have it', () => {
    const merged = mergeTomlSection('', 'sodiumdynamiclights', { mode: 'FAST' })
    expect(merged).toBe('[sodiumdynamiclights]\nmode = "FAST"\n')
  })
})

describe('hasSelectedShaderPack', () => {
  it('is false for a missing file, an empty selection or a missing shaderPack key', () => {
    expect(hasSelectedShaderPack(gameDir)).toBe(false)

    write('config/oculus.properties', 'shaderPack=\nenableShaders=true\n')
    expect(hasSelectedShaderPack(gameDir)).toBe(false)

    write('config/oculus.properties', 'enableShaders=true\n')
    expect(hasSelectedShaderPack(gameDir)).toBe(false)
  })

  it('is true when Oculus already has a pack selected', () => {
    write('config/oculus.properties', 'shaderPack=Complementary.zip\nenableShaders=true\n')
    expect(hasSelectedShaderPack(gameDir)).toBe(true)
  })
})

describe('apply and restore', () => {
  it('writes the profile into the game files, backs them up and records the state', () => {
    seedGameFiles()

    const result = apply('eco', 4, { min: 1, max: 4 })

    expect(result.ok).toBe(true)
    expect(result.memory).toBe(4)
    expect(result.files).toContain('options.txt')
    expect(result.files).toContain('config/embeddium-options.json')
    expect(result.files).toContain('config/oculus.properties')

    const options = read('options.txt')
    expect(options).toContain('renderDistance:6')
    expect(options).toContain('graphicsMode:0')
    expect(options).toContain('particles:2')
    expect(options).toContain('renderClouds:"false"')

    const embeddium = readJson('config/embeddium-options.json')
    expect(embeddium.quality).toEqual({
      weather_quality: 'FAST',
      leaves_quality: 'FAST',
      enable_vignette: false,
      use_quad_normals_for_shading: false
    })
    expect(embeddium.notifications).toEqual({ has_seen_donation_prompt: true })

    const chloride = readJson('config/chloride-client.json')
    expect(chloride.fastChests).toBe(true)
    expect(chloride.fastBeds).toBe(true)
    expect(chloride.maxZoom).toBe(50)

    expect(read('config/oculus.properties')).toContain('enableShaders=false')
    expect(read('config/oculus.properties')).toContain('shaderPack=')

    expect(read('config/sodiumdynamiclights-client.toml')).toContain('mode = "OFF"')

    for (const rel of result.files ?? []) {
      expect(existsSync(backupPath(path.join(gameDir, rel)))).toBe(true)
    }

    const state = readPerformanceState(userDataDir, slug)
    expect(state).toMatchObject({ profile: 'eco', memory: 4, previousMemory: { min: 1, max: 4 } })
  })

  it('keeps the original backup when another profile is applied', () => {
    seedGameFiles()
    apply('eco', 4)

    const optionsBackup = readFileSync(backupPath(path.join(gameDir, 'options.txt')), 'utf8')
    expect(optionsBackup).toContain('renderDistance:8')

    apply('balanced', 6)

    // The backup must still be the pre-profile file, not the economy profile's output.
    expect(readFileSync(backupPath(path.join(gameDir, 'options.txt')), 'utf8')).toBe(optionsBackup)
    expect(read('options.txt')).toContain('renderDistance:10')
    expect(readPerformanceState(userDataDir, slug)).toMatchObject({ profile: 'balanced', memory: 6 })
  })

  it('restores every backed-up file and clears the stored profile', () => {
    seedGameFiles()
    apply('eco', 4)

    const restored = restorePerformanceProfile(gameDir, userDataDir, slug)

    expect(restored.ok).toBe(true)
    expect(restored.restored).toContain('options.txt')
    expect(restored.restored).toContain('config/embeddium-options.json')

    expect(read('options.txt')).toBe('version:3465\nrenderDistance:8\ngraphicsMode:1\nrenderClouds:"true"\n')
    expect(readJson('config/embeddium-options.json')).toEqual({
      quality: { weather_quality: 'DEFAULT', enable_vignette: true },
      notifications: { has_seen_donation_prompt: true }
    })
    expect(read('config/oculus.properties')).toContain('enableShaders=true')
    expect(read('config/sodiumdynamiclights-client.toml')).toContain('mode = "REALTIME"')

    expect(readPerformanceState(userDataDir, slug)).toBeNull()
    expect(existsSync(backupPath(path.join(gameDir, 'options.txt')))).toBe(false)
  })

  it('removes an options.txt that the profile created, instead of leaving a partial file', () => {
    write('config/embeddium-options.json', JSON.stringify({ quality: { enable_vignette: true } }))

    expect(apply('eco').ok).toBe(true)
    expect(existsSync(path.join(gameDir, 'options.txt'))).toBe(true)

    expect(restorePerformanceProfile(gameDir, userDataDir, slug).ok).toBe(true)
    expect(existsSync(path.join(gameDir, 'options.txt'))).toBe(false)
  })

  it('enables Oculus shaders on the quality profile only when a pack is selected', () => {
    seedGameFiles()

    expect(apply('quality', 6).ok).toBe(true)
    expect(read('config/oculus.properties')).toContain('enableShaders=false')

    write('config/oculus.properties', 'shaderPack=Complementary.zip\nenableShaders=false\n')
    expect(apply('quality', 6).ok).toBe(true)
    expect(read('config/oculus.properties')).toContain('enableShaders=true')
  })

  it('reapplies the stored profile before a launch, using the RAM slider as the heap size', () => {
    seedGameFiles()
    apply('eco', 4)

    // The game rewrote the options when it closed.
    write('options.txt', 'renderDistance:12\n')
    write('config/oculus.properties', 'shaderPack=\nenableShaders=true\n')

    const result = applyStoredPerformanceProfile(gameDir, userDataDir, slug, 8)

    expect(result?.ok).toBe(true)
    expect(result?.memory).toBe(8)
    expect(read('options.txt')).toContain('renderDistance:6')
    expect(read('config/oculus.properties')).toContain('enableShaders=false')
    expect(result?.javaArgs).toContain('-XX:+UseG1GC')
    expect(result?.javaArgs).not.toContain('-XX:+AlwaysPreTouch')
    expect(readPerformanceState(userDataDir, slug)).toMatchObject({ profile: 'eco', memory: 8 })
  })

  it('does nothing before a launch when no profile was ever applied', () => {
    seedGameFiles()
    expect(applyStoredPerformanceProfile(gameDir, userDataDir, slug)).toBeNull()
    expect(read('options.txt')).toContain('renderDistance:8')
  })
})
