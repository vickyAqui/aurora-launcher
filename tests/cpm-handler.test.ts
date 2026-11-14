import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempGame, type TempGame } from './helpers'

/**
 * Folder returned by `app.getPath('userData')`. The handler reads it on every call, so each test
 * can point it at its own temporary folder.
 */
let userDataDir = ''

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? userDataDir : '') },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler) },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

vi.mock('electron-log/main', () => ({
  default: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

let tmp: TempGame
let modelsDir: string
let configPath: string
let selectionPath: string

async function loadHandler() {
  vi.resetModules()
  return await import('../electron/handlers/cpm')
}

function writeModel(name: string) {
  mkdirSync(modelsDir, { recursive: true })
  writeFileSync(path.join(modelsDir, name), 'model')
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

function writeConfig(value: Record<string, unknown>) {
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(value))
}

beforeEach(() => {
  tmp = useTempGame('aurora-cpm-handler-')
  userDataDir = mkdtempSync(path.join(tmpdir(), 'aurora-cpm-userdata-'))
  modelsDir = path.join(tmp.gameDir, 'player_models')
  configPath = path.join(tmp.gameDir, 'config', 'cpm.json')
  selectionPath = path.join(userDataDir, 'cpm-selection.json')
})

afterEach(() => {
  tmp.cleanup()
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('cpm:set_model', () => {
  it('writes the game config and keeps the choice in the launcher', async () => {
    writeModel('a.cpmmodel')
    writeConfig({ selectedModel: 'old.cpmmodel', keybinds: {} })

    const handler = await loadHandler()
    handler.registerCpmHandlers()

    const setModel = ipcHandlers.get('cpm:set_model')!
    await expect(setModel(null, 'a.cpmmodel')).resolves.toBe(true)

    expect(readConfig()).toEqual({ selectedModel: 'a.cpmmodel', keybinds: {} })
    expect(JSON.parse(readFileSync(selectionPath, 'utf8'))).toEqual({ 'aurora-studios': 'a.cpmmodel' })
  })

  it('stores the vanilla skin as null and removes selectedModel from the game config', async () => {
    writeConfig({ selectedModel: 'a.cpmmodel', keybinds: {} })

    const handler = await loadHandler()
    handler.registerCpmHandlers()

    await expect(ipcHandlers.get('cpm:set_model')!(null, null)).resolves.toBe(true)

    expect(readConfig()).toEqual({ keybinds: {} })
    expect(JSON.parse(readFileSync(selectionPath, 'utf8'))).toEqual({ 'aurora-studios': null })
  })

  it('refuses a model that is not in player_models', async () => {
    const handler = await loadHandler()
    handler.registerCpmHandlers()

    await expect(ipcHandlers.get('cpm:set_model')!(null, 'missing.cpmmodel')).resolves.toBe(false)
  })
})

describe('applySelectedModel', () => {
  it('puts the launcher choice back into config/cpm.json before the game starts', async () => {
    writeModel('a.cpmmodel')
    writeConfig({ selectedModel: 'a.cpmmodel', keybinds: {} })

    const handler = await loadHandler()
    handler.registerCpmHandlers()
    await ipcHandlers.get('cpm:set_model')!(null, 'a.cpmmodel')

    // CPM rewrote the config when the game closed.
    writeConfig({ selectedModel: 'other.cpmmodel', keybinds: { jump: 'space' } })

    expect(handler.applySelectedModel()).toBe(true)
    expect(readConfig()).toEqual({ selectedModel: 'a.cpmmodel', keybinds: { jump: 'space' } })
  })

  it('does nothing when the player never chose a model in the launcher', async () => {
    writeConfig({ selectedModel: 'game.cpmmodel' })

    const handler = await loadHandler()

    expect(handler.applySelectedModel()).toBe(false)
    expect(readConfig()).toEqual({ selectedModel: 'game.cpmmodel' })
  })

  it('keeps the current config when the chosen model file is gone', async () => {
    writeModel('a.cpmmodel')
    writeConfig({ selectedModel: 'a.cpmmodel' })

    const handler = await loadHandler()
    handler.registerCpmHandlers()
    await ipcHandlers.get('cpm:set_model')!(null, 'a.cpmmodel')

    rmSync(path.join(modelsDir, 'a.cpmmodel'))
    writeConfig({ selectedModel: 'still-here.cpmmodel' })

    expect(handler.applySelectedModel()).toBe(false)
    expect(readConfig()).toEqual({ selectedModel: 'still-here.cpmmodel' })
  })
})

describe('cpm:list', () => {
  it('shows what CPM left in the game config before the first launcher choice', async () => {
    writeConfig({ selectedModel: 'game.cpmmodel' })

    const handler = await loadHandler()
    handler.registerCpmHandlers()

    const state = (await ipcHandlers.get('cpm:list')!(null)) as { selected: string | null; savedInLauncher: boolean }

    expect(state.selected).toBe('game.cpmmodel')
    expect(state.savedInLauncher).toBe(false)
  })

  it('shows the launcher choice once the player picks a model', async () => {
    writeModel('a.cpmmodel')
    writeConfig({ selectedModel: 'game.cpmmodel' })

    const handler = await loadHandler()
    handler.registerCpmHandlers()
    await ipcHandlers.get('cpm:set_model')!(null, 'a.cpmmodel')

    const state = (await ipcHandlers.get('cpm:list')!(null)) as { selected: string | null; savedInLauncher: boolean }

    expect(state.selected).toBe('a.cpmmodel')
    expect(state.savedInLauncher).toBe(true)
  })
})
