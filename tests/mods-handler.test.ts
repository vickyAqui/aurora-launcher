import { createHash, createPublicKey, generateKeyPairSync, sign as signDetached, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MANIFEST_URL, SIGNATURE_URL } from './helpers'
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

/**
 * The keys the handler under test trusts, swapped for a throwaway pair generated per test.
 *
 * The factory reads the array at call time, which happens when `loadHandler` first imports the
 * module, so filling it in `beforeEach` is enough. Signing here with node:crypto rather than with
 * `scripts/manifest-signature.mjs` keeps the handler tests independent of the publisher's code: they
 * check what the launcher accepts, not that both sides call the same helper.
 */
const trustedKeys: { keyId: string; publicKeyPem: string; addedAt: string }[] = []

vi.mock('../electron/manifest-keys', () => ({ MANIFEST_KEYS: trustedKeys }))

let signingKey: KeyObject
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

/** `keyId` as `scripts/manifest-signature.mjs` derives it. */
function keyIdFor(key: KeyObject): string {
  const der = createPublicKey(key).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

function signManifestBytes(bytes: Buffer, key: KeyObject = signingKey) {
  const digest = Buffer.from(createHash('sha256').update(bytes).digest('hex'), 'hex')

  return {
    keyId: keyIdFor(key),
    alg: 'ed25519',
    sha256: digest.toString('hex'),
    signature: signDetached(null, digest, key).toString('base64')
  }
}

/** Answers each URL with its own response, the way the two assets really arrive separately. */
function routeFetch(handlers: { manifest?: () => unknown; signature?: () => unknown }) {
  fetchMock.mockImplementation(async (url: string) => {
    const handler = url === SIGNATURE_URL ? handlers.signature : url === MANIFEST_URL ? handlers.manifest : undefined
    if (!handler) throw new Error(`unexpected fetch of ${url}`)
    const response = handler()
    if (response instanceof Error) throw response
    return response
  })
}

/** Response bytes: bytes pass through untouched, so a signature stays valid through the mock. */
const body = (value: unknown) =>
  Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const okBytes = (value: unknown) => ({ ok: true, status: 200, arrayBuffer: async () => body(value) })
const okJson = (value: unknown) => ({ ok: true, status: 200, json: async () => value })
const httpError = (status: number) => ({ ok: false, status })

/** Serves `manifest` signed with the trusted key: the only response that may reach the game. */
function respondWith(manifest: unknown) {
  const bytes = body(manifest)
  routeFetch({ manifest: () => okBytes(bytes), signature: () => okJson(signManifestBytes(bytes)) })
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

  const pair = generateKeyPairSync('ed25519')
  signingKey = pair.privateKey
  trustedKeys.length = 0
  trustedKeys.push({
    keyId: keyIdFor(signingKey),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    addedAt: 'test'
  })
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

  it('refuses to launch and touches nothing when the modpack cannot be reached', async () => {
    writeJar(path.join(modsDir, 'stale.jar'))
    writeJar(path.join(gameDir, 'stray.jar'))
    routeFetch({ manifest: () => httpError(503) })
    const { prepareMods } = await loadHandler()

    // Fail closed: the launch is refused, and no jar is deleted or moved on the way out.
    await expect(prepareMods(SLUG)).rejects.toThrow(/manifesto indisponível/)
    expect(existsSync(path.join(modsDir, 'stale.jar'))).toBe(true)
    expect(existsSync(path.join(gameDir, 'stray.jar'))).toBe(true)
  })

  it('refuses to launch when the request throws', async () => {
    routeFetch({ manifest: () => new Error('offline') })
    const { prepareMods } = await loadHandler()

    await expect(prepareMods(SLUG)).rejects.toThrow(/offline/)
  })

  it('refuses to launch when the signature is missing, so an unsigned manifest is not a fallback', async () => {
    routeFetch({ manifest: () => okBytes(manifestOf(modEntry('a.jar'))), signature: () => httpError(404) })
    const { prepareMods } = await loadHandler()

    await expect(prepareMods(SLUG)).rejects.toThrow(/assinatura/)
  })

  it('refuses a manifest signed by a key the launcher does not trust', async () => {
    const bytes = body(manifestOf(modEntry('a.jar')))
    const stranger = generateKeyPairSync('ed25519').privateKey
    routeFetch({ manifest: () => okBytes(bytes), signature: () => okJson(signManifestBytes(bytes, stranger)) })
    const { prepareMods } = await loadHandler()

    await expect(prepareMods(SLUG)).rejects.toThrow(/chave desconhecida/)
  })

  it('refuses a manifest edited after it was signed', async () => {
    const published = body(manifestOf(modEntry('a.jar')))
    const tampered = body(manifestOf(modEntry('a.jar'), modEntry('injected.jar')))
    routeFetch({ manifest: () => okBytes(tampered), signature: () => okJson(signManifestBytes(published)) })
    const { prepareMods } = await loadHandler()

    // The signature is over what was published; the body that arrives carries one extra mod.
    await expect(prepareMods(SLUG)).rejects.toThrow(/não bate com a assinatura/)
  })

  it('refuses a manifest that is not signed at all', async () => {
    const bytes = body(manifestOf(modEntry('a.jar')))
    routeFetch({ manifest: () => okBytes(bytes), signature: () => okJson({ files: [] }) })
    const { prepareMods } = await loadHandler()

    await expect(prepareMods(SLUG)).rejects.toThrow(/formato/)
  })

  it('keeps the last verified manifest when the modpack goes offline afterwards', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { fetchModpack } = await loadHandler()
    await fetchModpack()

    // Offline after a successful verification: the files still come from a manifest whose signature
    // was checked, so the launch continues instead of being blocked by a network hiccup.
    routeFetch({ manifest: () => new Error('offline') })

    await expect(fetchModpack(true)).resolves.toMatchObject({ files: [{ name: 'a.jar' }] })
  })

  it('reports the manifest as unavailable for the Mods tab without throwing', async () => {
    routeFetch({ manifest: () => httpError(500) })
    const { fetchModpack } = await loadHandler()

    // The tab has nothing to show without a verified manifest; only the launch refuses.
    await expect(fetchModpack()).resolves.toBeNull()
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

describe('manifest cache', () => {
  it('does not refetch the modpack for every request', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { fetchModpack } = await loadHandler()

    await fetchModpack()
    await fetchModpack()

    // One request per asset, once: the manifest and its signature are both cached.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the cached manifest when a later request fails', async () => {
    respondWith(manifestOf(modEntry('a.jar')))
    const { fetchModpack } = await loadHandler()
    await fetchModpack()

    routeFetch({ manifest: () => new Error('offline') })
    await expect(fetchModpack(true)).resolves.toMatchObject({ files: [{ name: 'a.jar' }] })
  })
})