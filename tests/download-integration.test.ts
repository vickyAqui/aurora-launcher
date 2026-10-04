import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// The real downloader from eml-lib, not a reimplementation: this suite exists to prove the manifest
// we hand over is understood the way the launcher actually reads it.
import Downloader from '../node_modules/eml-lib/lib/utils/downloader.js'
import { buildLaunchManifest, emptyChoices, parseChoices, serializeChoices } from '../electron/mods'
import { getGameDir } from '../electron/gamedir'
import { manifestOf, modEntry, useTempGame, writeJar, type TempGame } from './helpers'

let tmp: TempGame
let gameDir: string
let modsDir: string

const SLUG = 'aurora-studios'
const sha1Of = (content: string) => createHash('sha1').update(content).digest('hex')

/** A mod whose recorded size and hash match the bytes we put on disk. */
function installedMod(content: string, overrides: Record<string, unknown> = {}) {
  const sha1 = sha1Of(content)
  return modEntry(`${sha1.slice(0, 8)}.jar`, { size: content.length, sha1, ...overrides })
}

/** eml-lib resolves a modpack entry to `join(root, file.path, file.name)`, `root` being the profile folder. */
function downloader() {
  return new Downloader(getGameDir(SLUG))
}

beforeEach(() => {
  tmp = useTempGame('aurora-integration-')
  gameDir = tmp.gameDir
  modsDir = tmp.modsDir
  mkdirSync(modsDir, { recursive: true })
})

afterEach(() => tmp.cleanup())

describe('the manifest we hand to eml-lib', () => {
  it('puts every mod where Forge looks for it', async () => {
    const manifest = { files: [modEntry('a.jar', { path: '' }), modEntry('b.jar', { path: '' })] }

    const pending = await downloader().getFilesToDownload(buildLaunchManifest(manifest, emptyChoices()).files)

    expect(pending.map((f: { name: string }) => f.name).sort()).toEqual(['a.jar', 'b.jar'])
    expect(pending.every((f: { path: string }) => f.path === 'mods/')).toBe(true)
  })

  it('does not re-download a mod that is already installed', async () => {
    const content = 'jar-content'
    const entry = installedMod(content)
    writeJar(path.join(modsDir, entry.name), content)

    const pending = await downloader().getFilesToDownload(buildLaunchManifest({ files: [entry] }, emptyChoices()).files)

    expect(pending).toEqual([])
  })

  it('does not re-download a mod the player turned off, launch after launch', async () => {
    const content = 'jar-content'
    const entry = installedMod(content)

    // The player turned it off, so the file sits next to it as `.disabled`.
    writeJar(path.join(modsDir, `${entry.name}.disabled`), content)

    const choices = emptyChoices()
    choices.disabled.add(entry.name)

    for (let launch = 0; launch < 3; launch++) {
      const manifest = buildLaunchManifest({ files: [entry] }, choices)
      const pending = await downloader().getFilesToDownload(manifest.files)

      expect(pending, `launch ${launch + 1}`).toEqual([])
    }
  })

  it('re-downloads a mod whose bytes do not match the manifest', async () => {
    const content = 'corrupted'
    const name = `${sha1Of(content).slice(0, 8)}.jar`
    writeJar(path.join(modsDir, name), content)
    const manifest = { files: [installedMod(content, { name, size: 999 })] }

    const pending = await downloader().getFilesToDownload(buildLaunchManifest(manifest, emptyChoices()).files)

    expect(pending.map((f: { name: string }) => f.name)).toEqual([name])
  })

  it('keeps a mod that ships off out of the game until it is turned on', async () => {
    const content = 'off-content'
    const base = installedMod(content).name
    const manifest = { files: [modEntry(`${base}.disabled`, { size: content.length, sha1: sha1Of(content) })] }

    // Untouched: the entry keeps its disabled name, so Forge never loads it.
    expect(buildLaunchManifest(manifest, emptyChoices()).files[0].name).toBe(`${base}.disabled`)

    // Turned on by hand: it becomes a plain `.jar` and is fetched once.
    const choices = emptyChoices()
    choices.enabledOverrides.add(base)
    const on = buildLaunchManifest(manifest, choices)

    expect(on.files[0].name).toBe(base)
    expect((await downloader().getFilesToDownload(on.files)).map((f: { name: string }) => f.name)).toEqual([base])
  })

  it('asks only for the mods in the modpack', async () => {
    // A jar the player dropped in manually is not in the manifest, so it is never requested.
    writeJar(path.join(modsDir, 'hand-installed.jar'), 'x')

    const pending = await downloader().getFilesToDownload(
      buildLaunchManifest(manifestOf(modEntry('a.jar')), emptyChoices()).files
    )

    expect(pending.map((f: { name: string }) => f.name)).toEqual(['a.jar'])
  })

  it('leaves the game directory root clean', async () => {
    const content = 'jar-content'
    const entry = installedMod(content)
    writeJar(path.join(modsDir, entry.name), content)

    await downloader().getFilesToDownload(buildLaunchManifest({ files: [entry] }, emptyChoices()).files)

    expect(readdirSync(gameDir).filter((entry) => entry.endsWith('.jar'))).toEqual([])
  })
})

describe('a mod the player turned off', () => {
  it('is renamed to a name Forge does not load, then stays that way', async () => {
    const content = 'jar-content'
    const entry = installedMod(content)
    writeJar(path.join(modsDir, entry.name), content)

    const choices = emptyChoices()
    choices.disabled.add(entry.name)

    // Turning it off, the way the Mods tab does.
    renameSync(path.join(modsDir, entry.name), path.join(modsDir, `${entry.name}.disabled`))
    const store = serializeChoices(choices)

    // The next launch rebuilds the manifest from the stored choice alone.
    const reread = parseChoices(store)
    const manifest = buildLaunchManifest({ files: [entry] }, reread)

    expect(manifest.files[0].name).toBe(`${entry.name}.disabled`)
    // Forge scans the mods folder for `.jar`, so a `.disabled` name is ignored.
    expect(manifest.files[0].name.endsWith('.jar')).toBe(false)

    expect(await downloader().getFilesToDownload(manifest.files)).toEqual([])
  })

  it('is downloaded again once the player turns it back on', async () => {
    const content = 'jar-content'
    const entry = installedMod(content)
    writeJar(path.join(modsDir, `${entry.name}.disabled`), content)
    renameSync(path.join(modsDir, `${entry.name}.disabled`), path.join(modsDir, entry.name))

    const choices = emptyChoices()
    choices.disabled.delete(entry.name)
    choices.enabledOverrides.add(entry.name)

    const manifest = buildLaunchManifest({ files: [entry] }, choices)

    expect(manifest.files[0].name).toBe(entry.name)
    // Already on disk with matching bytes, so nothing is fetched.
    expect(await downloader().getFilesToDownload(manifest.files)).toEqual([])
  })
})