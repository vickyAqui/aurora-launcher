import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempGame, type TempGame } from './helpers'

/** Folder returned by `app.getPath('userData')`; each test points it at its own folder. */
let userDataDir = ''

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? userDataDir : '') },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler)
  }
}))

vi.mock('electron-log/main', () => ({
  default: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

let tmp: TempGame
let settingsPath = ''

async function loadHandler() {
  vi.resetModules()
  return await import('../electron/handlers/performance')
}

function writeSettings(memory: { min: number; max: number }) {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    settingsPath,
    JSON.stringify({
      memory,
      resolution: { width: 1280, height: 720, fullscreen: false },
      launcherAction: 'close',
      java: 'bundled'
    })
  )
}

function readSettings(): Record<string, any> {
  return JSON.parse(readFileSync(settingsPath, 'utf8'))
}

function seedOptions() {
  mkdirSync(tmp.gameDir, { recursive: true })
  writeFileSync(path.join(tmp.gameDir, 'options.txt'), 'renderDistance:8\n')
}

beforeEach(() => {
  tmp = useTempGame('aurora-perf-handler-')
  userDataDir = mkdtempSync(path.join(tmpdir(), 'aurora-perf-userdata-'))
  settingsPath = path.join(userDataDir, 'settings.json')
})

afterEach(() => {
  tmp.cleanup()
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('performance:get', () => {
  it('reports the hardware, the RAM currently in settings and an empty state', async () => {
    writeSettings({ min: 1, max: 4 })

    const handler = await loadHandler()
    handler.registerPerformanceHandlers()

    const response = (await ipcHandlers.get('performance:get')!(null)) as any

    expect(response.state).toBeNull()
    expect(response.currentMemory).toEqual({ min: 1, max: 4 })
    expect(response.hardware.suggestedMemory).toBeGreaterThanOrEqual(1)
    expect(response.hardware.suggestedMemory).toBeLessThanOrEqual(8)
    expect(response.gameDir).toBe(tmp.gameDir)
  })
})

describe('performance:apply', () => {
  it('writes the profile, resizes the heap and remembers the RAM from before the first apply', async () => {
    writeSettings({ min: 1, max: 4 })
    seedOptions()

    const handler = await loadHandler()
    handler.registerPerformanceHandlers()

    const result = (await ipcHandlers.get('performance:apply')!(null, 'balanced', 6)) as any

    expect(result.ok).toBe(true)
    expect(readSettings().memory).toEqual({ min: 3, max: 6 })
    expect(readFileSync(path.join(tmp.gameDir, 'options.txt'), 'utf8')).toContain('renderDistance:10')

    const state = (await ipcHandlers.get('performance:get')!(null)) as any
    expect(state.state.previousMemory).toEqual({ min: 1, max: 4 })
  })

  it('keeps the original RAM when the player switches profiles', async () => {
    writeSettings({ min: 1, max: 4 })
    seedOptions()

    const handler = await loadHandler()
    handler.registerPerformanceHandlers()

    await ipcHandlers.get('performance:apply')!(null, 'eco', 4)
    await ipcHandlers.get('performance:apply')!(null, 'quality', 8)

    expect(readSettings().memory).toEqual({ min: 4, max: 8 })
    const state = (await ipcHandlers.get('performance:get')!(null)) as any
    expect(state.state.previousMemory).toEqual({ min: 1, max: 4 })
  })

  it('refuses an unknown profile without touching the files', async () => {
    writeSettings({ min: 1, max: 4 })
    seedOptions()

    const handler = await loadHandler()
    handler.registerPerformanceHandlers()

    const result = (await ipcHandlers.get('performance:apply')!(null, 'turbo', 8)) as any

    expect(result.ok).toBe(false)
    expect(readSettings().memory).toEqual({ min: 1, max: 4 })
    expect(readFileSync(path.join(tmp.gameDir, 'options.txt'), 'utf8')).toBe('renderDistance:8\n')
  })
})

describe('performance:restore', () => {
  it('puts the files back, clears the profile and restores the previous RAM', async () => {
    writeSettings({ min: 1, max: 4 })
    seedOptions()

    const handler = await loadHandler()
    handler.registerPerformanceHandlers()

    await ipcHandlers.get('performance:apply')!(null, 'eco', 4)
    const result = (await ipcHandlers.get('performance:restore')!(null)) as any

    expect(result.ok).toBe(true)
    expect(result.restored).toContain('options.txt')
    expect(readFileSync(path.join(tmp.gameDir, 'options.txt'), 'utf8')).toBe('renderDistance:8\n')
    expect(readSettings().memory).toEqual({ min: 1, max: 4 })

    const state = (await ipcHandlers.get('performance:get')!(null)) as any
    expect(state.state).toBeNull()
  })
})
