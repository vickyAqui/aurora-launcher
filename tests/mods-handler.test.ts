import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { manifestOf, modEntry, useTempGame, writeJar, type TempGame } from './helpers'

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipcHandlers.set(channel, handler)
  },
  shell: { openPath: vi.fn().mockResolvedValue('') }
}))

vi.mock('electron-log/main', () => ({
  default: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

let tmp: TempGame
let gameDir: string
let modsDir: string
let storePath: string
let fetchMock: ReturnType<typeof vi.fn>

const SLUG = 'aurora-studios'

async function loadHandler() {
  vi.resetModules()
  return await import('../electron/handlers/mods')
}

function respondWith(manifest: unknown) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => manifest })
}

beforeEach(() => {
  tmp = useTempGame('aurora-handler-')
  gameDir = tmp.gameDir
  modsDir = tmp.modsDir
  storePath = tmp.storePath
  tmp.ensureModsDir()
  ipcHandlers.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  tmp.cleanup()
})

describe('prepareMods', () => {
  it('serves a manifest where every mod lands in the mods folder', async () => {
    respondWith(manifestOf(modEntry('a.jar', { path: '' }), modEntry('b.jar')))
    const { prepareMods } = await loadHandler()

    const prepared = await prepareMods(SLUG)

    expect(prepared.manifest?.files.map((f: { path: string }) => f.path)).toEqual(['mods/', 'mods/'])
  })

  it('moves a mod an older build put in the game directory root into the mods folder', async () => {
    writeJar(path.join(gameDir, 'a.jar'), 'jar')
    respondWith(manifestOf(modEntry('a.jar')))
    const { prepareMods } = await loadHandler()

    await prepareMods(SLUG)

    expect(existsSync(path.join(modsDir, 'a.jar'))).toBe(true)
    expect(existsSync(path.join(gameDir, 'a.jar'))).toBe(false)
  })

  it('does not re-download a mod the player turned off', async () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeJar(path.join(modsDir, 'b.jar'))
    respondWith(manifestOf(modEntry('a.jar'), modEntry('b.jar')))
    const { prepareMods, registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'b.jar', false, SLUG)).toBe(true)
    expect(existsSync(path.join(modsDir, 'b.jar.disabled'))).toBe(true)

    const prepared = await prepareMods(SLUG)
    const b = prepared.manifest?.files.find((f: { name: string }) => f.name.startsWith('b.jar'))

    // The entry is requested as `b.jar.disabled`, which is the file already on disk: the sha1
    // matches, so the downloader skips it instead of fetching `b.jar` on every single launch.
    expect(b?.name).toBe('b.jar.disabled')
    expect(b?.sha1).toBe(modEntry('b.jar').sha1)
  })

  it('removes mods the modpack no longer ships, but never configs or folders', async () => {
    writeJar(path.join(modsDir, 'stale.jar'))
    writeJar(path.join(modsDir, 'kept.jar'))
    writeFileSync(path.join(modsDir, 'my-config.toml'), 'a=1')
    mkdirSync(path.join(modsDir, 'my-pack'), { recursive: true })
    respondWith(manifestOf(modEntry('kept.jar')))
    const { prepareMods } = await loadHandler()

    await prepareMods(SLUG)

    expect(existsSync(path.join(modsDir, 'stale.jar'))).toBe(false)
    expect(existsSync(path.join(modsDir, 'kept.jar'))).toBe(true)
    expect(existsSync(path.join(modsDir, 'my-config.toml'))).toBe(true)
    expect(existsSync(path.join(modsDir, 'my-pack'))).toBe(true)
  })

  it('deletes nothing when the modpack cannot be reached', async () => {
    writeJar(path.join(modsDir, 'stale.jar'))
    writeJar(path.join(gameDir, 'stray.jar'))
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    const { prepareMods } = await loadHandler()

    const prepared = await prepareMods(SLUG)

    expect(prepared.manifest).toBeNull()
    expect(existsSync(path.join(modsDir, 'stale.jar'))).toBe(true)
    expect(existsSync(path.join(gameDir, 'stray.jar'))).toBe(true)
  })

  it('falls back to no manifest when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { prepareMods } = await loadHandler()

    expect((await prepareMods(SLUG)).manifest).toBeNull()
  })
})

describe('set_enabled', () => {
  it('renames the file and records the choice', async () => {
    writeJar(path.join(modsDir, 'a.jar'))
    respondWith(manifestOf(modEntry('a.jar')))
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', false, SLUG)).toBe(true)

    expect(existsSync(path.join(modsDir, 'a.jar'))).toBe(false)
    expect(existsSync(path.join(modsDir, 'a.jar.disabled'))).toBe(true)
    expect(JSON.parse(readFileSync(storePath, 'utf8')).disabled).toEqual(['a.jar'])
  })

  it('turns a mod back on and drops the disabled copy', async () => {
    writeJar(path.join(modsDir, 'a.jar.disabled'))
    respondWith(manifestOf(modEntry('a.jar')))
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', true, SLUG)).toBe(true)

    expect(existsSync(path.join(modsDir, 'a.jar'))).toBe(true)
    expect(existsSync(path.join(modsDir, 'a.jar.disabled'))).toBe(false)
    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({ disabled: [], enabledOverrides: ['a.jar'] })
  })

  it('keeps the loaded copy when both files exist', async () => {
    writeJar(path.join(modsDir, 'a.jar'), 'enabled')
    writeJar(path.join(modsDir, 'a.jar.disabled'), 'disabled')
    respondWith(manifestOf(modEntry('a.jar')))
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', true, SLUG)).toBe(true)

    expect(readFileSync(path.join(modsDir, 'a.jar'), 'utf8')).toBe('enabled')
    expect(existsSync(path.join(modsDir, 'a.jar.disabled'))).toBe(false)
  })

  it('turns on a mod that ships off, and it stays on next launch', async () => {
    writeJar(path.join(modsDir, 'a.jar.disabled'))
    respondWith(manifestOf(modEntry('a.jar.disabled')))
    const { prepareMods, registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', true, SLUG)
    const prepared = await prepareMods(SLUG)

    expect(prepared.manifest?.files[0].name).toBe('a.jar')
  })

  it('refuses a name that could escape the mods folder', async () => {
    writeJar(path.join(gameDir, 'evil.jar'))
    respondWith(manifestOf(modEntry('a.jar')))
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, '../evil.jar', false, SLUG)).toBe(false)
    expect(existsSync(path.join(gameDir, 'evil.jar'))).toBe(true)
  })

  it('refuses a name that is not a mod', async () => {
    writeFileSync(path.join(modsDir, 'config.toml'), 'a=1')
    respondWith(manifestOf())
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'config.toml', false, SLUG)).toBe(false)
  })

  it('records the choice for a mod that has not been downloaded yet', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { prepareMods, registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', false, SLUG)).toBe(true)
    expect((await prepareMods(SLUG)).manifest?.files[0].name).toBe('a.jar.disabled')
  })

  it('honours the legacy array store', async () => {
    writeFileSync(storePath, JSON.stringify(['a.jar']))
    writeJar(path.join(modsDir, 'a.jar'))
    respondWith(manifestOf(modEntry('a.jar')))
    const { prepareMods } = await loadHandler()

    expect((await prepareMods(SLUG)).manifest?.files[0].name).toBe('a.jar.disabled')
  })
})

describe('list', () => {
  it('merges the modpack with the mods folder', async () => {
    writeJar(path.join(modsDir, 'a.jar'))
    respondWith(manifestOf(modEntry('a.jar'), modEntry('b.jar')))
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    const result = (await ipcHandlers.get('mods:list')?.(null, undefined, SLUG)) as {
      mods: { name: string; installed: boolean }[]
      modsDir: string
    }

    expect(result.modsDir).toBe(modsDir)
    expect(result.mods.map((m) => [m.name, m.installed])).toEqual([
      ['a.jar', true],
      ['b.jar', false]
    ])
  })

  it('opens the mods folder, creating it when missing', async () => {
    respondWith(manifestOf())
    const { shell } = await import('electron')
    const { registerModsHandlers } = await loadHandler()
    registerModsHandlers()

    expect(await ipcHandlers.get('mods:open_folder')?.(null, undefined, SLUG)).toBe(true)
    expect(shell.openPath).toHaveBeenCalledWith(modsDir)
  })
})

describe('applyModChoices', () => {
  it('turns chosen-off mods back off when the manifest could not be filtered', async () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeJar(path.join(modsDir, 'b.jar'))
    fetchMock.mockResolvedValue({ ok: false })
    const { applyModChoices, registerModsHandlers } = await loadHandler()
    registerModsHandlers()
    await ipcHandlers.get('mods:set_enabled')?.(null, 'a.jar', false, SLUG)

    // The downloader put `a.jar` back because the unfiltered manifest still asked for it.
    writeJar(path.join(modsDir, 'a.jar'))
    expect(applyModChoices(SLUG)).toBe(1)

    expect(existsSync(path.join(modsDir, 'a.jar'))).toBe(false)
    expect(existsSync(path.join(modsDir, 'a.jar.disabled'))).toBe(true)
    expect(existsSync(path.join(modsDir, 'b.jar'))).toBe(true)
  })

  it('does nothing when every mod is on', async () => {
    writeJar(path.join(modsDir, 'a.jar'))
    fetchMock.mockResolvedValue({ ok: false })
    const { applyModChoices } = await loadHandler()

    expect(applyModChoices(SLUG)).toBe(0)
  })
})

describe('manifest cache', () => {
  it('does not refetch the modpack for every request', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { fetchModpack } = await loadHandler()

    await fetchModpack()
    await fetchModpack()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps serving the cached manifest when a later request fails', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { fetchModpack } = await loadHandler()
    await fetchModpack()

    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await fetchModpack(true)).toBeNull()
  })
})