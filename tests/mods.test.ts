import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildLaunchManifest,
  buildModEntries,
  disabledPathOf,
  emptyChoices,
  findForeignModFiles,
  findStrayModFiles,
  indexManifest,
  isModFileName,
  MAX_MOD_SCAN_DEPTH,
  isModOff,
  isSafeName,
  listDiskMods,
  parseChoices,
  parseManifest,
  serializeChoices,
  toCanonicalName,
  type IModpackFile
} from '../electron/mods'
import { modEntry, useTempGame, writeJar, type TempGame } from './helpers'

let tmp: TempGame
let modsDir: string
let gameDir: string

beforeEach(() => {
  tmp = useTempGame()
  gameDir = tmp.gameDir
  modsDir = tmp.modsDir
  tmp.ensureModsDir()
})

afterEach(() => tmp.cleanup())

describe('parseManifest', () => {
  it('accepts a manifest shaped like the published one', () => {
    const manifest = parseManifest({ files: [modEntry('a.jar'), { name: 'mods', path: '', url: 'u', type: 'FOLDER' }] })
    expect(manifest?.files).toHaveLength(2)
  })

  it('rejects a response that is not a manifest', () => {
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest('<html>404</html>')).toBeNull()
    expect(parseManifest({})).toBeNull()
    expect(parseManifest({ files: 'nope' })).toBeNull()
  })

  it('drops an entry that could escape the game directory', () => {
    const manifest = parseManifest({
      files: [modEntry('../escape.jar'), modEntry('sub/evil.jar'), modEntry('ok.jar')]
    })

    expect(manifest?.files.map((f) => f.name)).toEqual(['ok.jar'])
  })

  it('drops an entry whose path climbs out', () => {
    const manifest = parseManifest({ files: [modEntry('a.jar', { path: '../../' })] })
    expect(manifest?.files).toEqual([])
  })

  it('drops entries with no name, no url or an unknown type', () => {
    const manifest = parseManifest({
      files: [
        { path: 'mods/', url: 'u', type: 'MOD' },
        { name: 'a.jar', path: 'mods/', type: 'MOD' },
        { name: 'a.jar', path: 'mods/', url: 'u', type: 'EXECUTABLE' }
      ]
    })

    expect(manifest?.files).toEqual([])
  })

  it('keeps a FOLDER entry, which carries no size or hash', () => {
    const manifest = parseManifest({ files: [{ name: 'mods', path: '', url: 'u', type: 'FOLDER' }] })
    expect(manifest?.files[0]).toEqual({ name: 'mods', path: '', url: 'u', type: 'FOLDER' })
  })
})

describe('names', () => {
  it('strips and appends the disabled suffix', () => {
    expect(toCanonicalName('jei.jar')).toBe('jei.jar')
    expect(toCanonicalName('jei.jar.disabled')).toBe('jei.jar')
    expect(disabledPathOf('jei.jar')).toBe('jei.jar.disabled')
  })

  it('recognises mods in either state, case-insensitively', () => {
    expect(isModFileName('jei.jar')).toBe(true)
    expect(isModFileName('jei.jar.disabled')).toBe(true)
    expect(isModFileName('JEI.JAR')).toBe(true)
    expect(isModFileName('config.toml')).toBe(false)
  })

  it('rejects names that could escape the mods folder', () => {
    expect(isSafeName('jei.jar')).toBe(true)
    expect(isSafeName('jei.jar.disabled')).toBe(true)
    expect(isSafeName('../evil.jar')).toBe(false)
    expect(isSafeName('sub/jei.jar')).toBe(false)
    expect(isSafeName('sub\\jei.jar')).toBe(false)
    expect(isSafeName(path.join(path.sep, 'abs.jar'))).toBe(false)
    expect(isSafeName('')).toBe(false)
  })
})

describe('indexManifest', () => {
  it('keys MOD entries by canonical name and flags the ones shipped off', () => {
    const index = indexManifest({
      files: [modEntry('a.jar'), modEntry('b.jar.disabled'), { ...modEntry('c.jar'), type: 'FOLDER' }]
    })

    expect([...index.byName.keys()]).toEqual(['a.jar', 'b.jar'])
    expect([...index.shippedDisabled]).toEqual(['b.jar'])
  })

  it('survives a missing manifest', () => {
    expect(indexManifest(null).byName.size).toBe(0)
    expect(indexManifest(undefined).shippedDisabled.size).toBe(0)
  })
})

describe('buildLaunchManifest', () => {
  it('puts every MOD in the mods folder, so Forge actually loads it', () => {
    const built = buildLaunchManifest({ files: [modEntry('a.jar', { path: '' })] }, emptyChoices())
    expect(built.files[0].path).toBe('mods/')
  })

  it('repairs the manifest that shipped with an empty path', () => {
    const broken = { files: [modEntry('a.jar', { path: '' }), modEntry('b.jar', { path: 'lixo/' })] }
    expect(buildLaunchManifest(broken, emptyChoices()).files.map((f) => f.path)).toEqual(['mods/', 'mods/'])
  })

  it('repairs a MOD entry that declares no path at all', () => {
    const broken = { files: [{ ...modEntry('a.jar'), path: undefined }] }
    expect(buildLaunchManifest(broken as never, emptyChoices()).files[0].path).toBe('mods/')
  })

  it('names a mod the player turned off ".disabled", so it is not re-downloaded', () => {
    const manifest = { files: [modEntry('a.jar'), modEntry('b.jar')] }
    const choices = emptyChoices()
    choices.disabled.add('b.jar')

    const built = buildLaunchManifest(manifest, choices)

    expect(built.files.map((f) => f.name)).toEqual(['a.jar', 'b.jar.disabled'])
    // The url and hash still describe the real jar, so the renamed file matches and nothing downloads.
    expect(built.files[1].url).toBe(manifest.files[1].url)
    expect(built.files[1].sha1).toBe(manifest.files[1].sha1)
  })

  it('leaves a mod shipped off turned off', () => {
    const built = buildLaunchManifest({ files: [modEntry('a.jar.disabled')] }, emptyChoices())
    expect(built.files[0].name).toBe('a.jar.disabled')
  })

  it('lets the player turn on a mod that ships off, and keeps it on', () => {
    const choices = emptyChoices()
    choices.enabledOverrides.add('a.jar')

    const built = buildLaunchManifest({ files: [modEntry('a.jar.disabled')] }, choices)

    expect(built.files[0].name).toBe('a.jar')
    expect(built.files[0].path).toBe('mods/')
  })

  it('lets the player turn a shipped-on mod off', () => {
    const choices = emptyChoices()
    choices.disabled.add('a.jar')
    choices.enabledOverrides.add('a.jar')

    // The override is only there because the player first enabled it; a later disable must win.
    choices.enabledOverrides.delete('a.jar')
    expect(buildLaunchManifest({ files: [modEntry('a.jar')] }, choices).files[0].name).toBe('a.jar.disabled')
  })

  it('never touches non-MOD entries', () => {
    // A FOLDER entry legitimately carries no size or hash.
    const folder: IModpackFile = { name: 'mods', path: '', url: 'https://example.test/mods', type: 'FOLDER' }
    const built = buildLaunchManifest({ files: [folder, modEntry('a.jar')] }, emptyChoices())
    expect(built.files[0]).toEqual(folder)
  })

  it('returns an empty manifest for a missing one', () => {
    expect(buildLaunchManifest(null, emptyChoices()).files).toEqual([])
  })
})

describe('isModOff', () => {
  it('honours override, then disable, then modpack default', () => {
    const shipped = new Set(['shipped.jar'])
    expect(isModOff('shipped.jar', shipped, emptyChoices())).toBe(true)
    expect(isModOff('other.jar', shipped, emptyChoices())).toBe(false)

    const disabled = emptyChoices()
    disabled.disabled.add('other.jar')
    expect(isModOff('other.jar', shipped, disabled)).toBe(true)

    const overridden = emptyChoices()
    overridden.enabledOverrides.add('shipped.jar')
    expect(isModOff('shipped.jar', shipped, overridden)).toBe(false)
  })
})

describe('listDiskMods', () => {
  it('collapses the enabled and disabled copies of the same mod', () => {
    writeJar(path.join(modsDir, 'a.jar'), 'aaaa')
    writeJar(path.join(modsDir, 'a.jar.disabled'), 'bb')

    const disk = listDiskMods(modsDir)
    expect(disk.size).toBe(1)
    expect(disk.get('a.jar')).toEqual({ enabled: false, size: 4 })
  })

  it('keeps a mod enabled when only the enabled copy exists', () => {
    writeJar(path.join(modsDir, 'a.jar'), 'aaaa')
    expect(listDiskMods(modsDir).get('a.jar')).toEqual({ enabled: true, size: 4 })
  })

  it('ignores anything that is not a jar', () => {
    writeFileSync(path.join(modsDir, 'config.toml'), 'a=1')
    writeFileSync(path.join(modsDir, 'readme.txt'), 'hi')
    expect(listDiskMods(modsDir).size).toBe(0)
  })

  it('ignores folders and returns empty for a missing folder', () => {
    mkdirSync(path.join(modsDir, 'nested.jar'), { recursive: true })
    expect(listDiskMods(modsDir).size).toBe(0)
    expect(listDiskMods(path.join(modsDir, 'nope')).size).toBe(0)
  })
})

describe('buildModEntries', () => {
  it('reports a downloaded, enabled mod', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    const [entry] = buildModEntries({ files: [modEntry('a.jar')] }, listDiskMods(modsDir), emptyChoices())

    expect(entry).toMatchObject({ name: 'a.jar', enabled: true, installed: true, inManifest: true })
    expect(entry.size).toBe(10)
  })

  it('reports a mod the player turned off as installed but disabled', () => {
    writeJar(path.join(modsDir, 'a.jar.disabled'))
    const choices = emptyChoices()
    choices.disabled.add('a.jar')

    const [entry] = buildModEntries({ files: [modEntry('a.jar')] }, listDiskMods(modsDir), choices)
    expect(entry).toMatchObject({ enabled: false, installed: true })
  })

  it('reports a shipped-off mod as disabled before it is downloaded', () => {
    const [entry] = buildModEntries({ files: [modEntry('a.jar.disabled')] }, new Map(), emptyChoices())
    expect(entry).toMatchObject({ name: 'a.jar', enabled: false, installed: false })
  })

  it('still lists a mod the player dropped in manually', () => {
    writeJar(path.join(modsDir, 'local.jar'))
    const entries = buildModEntries(null, listDiskMods(modsDir), emptyChoices())

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'local.jar', inManifest: false, installed: true, enabled: true })
  })

  it('merges manifest and disk, sorted, without duplicates', () => {
    writeJar(path.join(modsDir, 'b.jar'))
    writeJar(path.join(modsDir, 'local.jar'))
    const entries = buildModEntries({ files: [modEntry('a.jar'), modEntry('b.jar')] }, listDiskMods(modsDir), emptyChoices())

    expect(entries.map((entry) => entry.name)).toEqual(['a.jar', 'b.jar', 'local.jar'])
  })
})

describe('findForeignModFiles', () => {
  it('reports jars the modpack does not ship', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeJar(path.join(modsDir, 'stale.jar'))
    writeJar(path.join(modsDir, 'stale.jar.disabled'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([
      { rel: 'stale.jar', kind: 'file' },
      { rel: 'stale.jar.disabled', kind: 'file' }
    ])
  })

  it('accepts a shipped-off mod in either state', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeJar(path.join(modsDir, 'b.jar.disabled'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar'), modEntry('b.jar.disabled')] })).toEqual([])
  })

  it('never reports non-jar files, so player configs and folders survive', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeFileSync(path.join(modsDir, 'options.toml'), 'a=1')
    mkdirSync(path.join(modsDir, 'pack'), { recursive: true })

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([])
  })

  it('reports nothing when the manifest is unavailable, so nothing is ever deleted', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    expect(findForeignModFiles(modsDir, null)).toEqual([])
    expect(findForeignModFiles(modsDir, { files: [] })).toEqual([])
  })

  it('reports jars hidden in a sub-folder, which the game loads just the same', () => {
    writeJar(path.join(modsDir, 'a.jar'))
    writeJar(path.join(modsDir, 'sub', 'stale.jar'))
    writeJar(path.join(modsDir, 'sub', 'deep', 'deeper', 'stale.jar'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([
      { rel: path.join('sub', 'deep', 'deeper', 'stale.jar'), kind: 'file' },
      { rel: path.join('sub', 'stale.jar'), kind: 'file' }
    ])
  })

  it('reports a shipped mod found in a sub-folder under its own name', () => {
    writeJar(path.join(modsDir, 'sub', 'a.jar'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([])
  })

  it('reports symlinks, which point the game at a jar living anywhere on disk', () => {
    const outside = path.join(tmp.appData, 'elsewhere.jar')
    writeJar(outside)
    symlinkSync(outside, path.join(modsDir, 'innocent.jar'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([
      { rel: 'innocent.jar', kind: 'symlink' }
    ])
  })

  it('reports a symlinked folder instead of following it into someone elses disk', () => {
    const elsewhere = path.join(tmp.appData, 'payload')
    mkdirSync(elsewhere, { recursive: true })
    writeJar(path.join(elsewhere, 'stale.jar'))
    symlinkSync(elsewhere, path.join(modsDir, 'addon'))

    expect(findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })).toEqual([
      { rel: 'addon', kind: 'symlink' }
    ])
  })

  it('reports the folder itself past the depth limit instead of skipping what is inside', () => {
    let deep = modsDir
    for (let level = 0; level <= MAX_MOD_SCAN_DEPTH; level++) deep = path.join(deep, `d${level}`)
    writeJar(path.join(deep, 'stale.jar'))

    const found = findForeignModFiles(modsDir, { files: [modEntry('a.jar')] })

    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('dir')
    expect(found[0].rel).not.toContain('stale.jar')
  })
})

describe('findStrayModFiles', () => {
  it('reports manifest mods left in the game directory root', () => {
    writeJar(path.join(gameDir, 'a.jar'))
    writeJar(path.join(gameDir, 'b.jar'))
    writeJar(path.join(gameDir, 'not-in-pack.jar'))
    writeJar(path.join(modsDir, 'a.jar'))

    // A copy already in mods/ is left alone; only the one at the root is a stray.
    expect(findStrayModFiles(gameDir, { files: [modEntry('a.jar'), modEntry('b.jar')] })).toEqual(['a.jar', 'b.jar'])
  })

  it('ignores non-jar files sitting in the game directory root', () => {
    writeJar(path.join(gameDir, 'a.jar'))
    writeFileSync(path.join(gameDir, 'options.txt'), 'x')
    writeFileSync(path.join(gameDir, 'mods-extra.json'), '{}')

    expect(findStrayModFiles(gameDir, { files: [modEntry('a.jar')] })).toEqual(['a.jar'])
  })

  it('reports a shipped-off mod sitting at the root', () => {
    writeJar(path.join(gameDir, 'a.jar.disabled'))
    expect(findStrayModFiles(gameDir, { files: [modEntry('a.jar.disabled')] })).toEqual(['a.jar.disabled'])
  })

  it('reports nothing when the manifest is unavailable', () => {
    writeJar(path.join(gameDir, 'a.jar'))
    expect(findStrayModFiles(gameDir, null)).toEqual([])
  })
})

describe('choices store', () => {
  it('round-trips', () => {
    const choices = emptyChoices()
    choices.disabled.add('b.jar')
    choices.enabledOverrides.add('c.jar')

    const parsed = parseChoices(serializeChoices(choices))
    expect([...parsed.disabled]).toEqual(['b.jar'])
    expect([...parsed.enabledOverrides]).toEqual(['c.jar'])
  })

  it('reads the legacy bare array of disabled names', () => {
    const parsed = parseChoices(JSON.stringify(['a.jar', 'b.jar.disabled', '../evil.jar']))
    expect([...parsed.disabled]).toEqual(['a.jar', 'b.jar'])
  })

  it('never trusts a stored name that could escape the mods folder', () => {
    const parsed = parseChoices(JSON.stringify({ disabled: ['../evil.jar', 'a/b.jar', 'ok.jar'] }))
    expect([...parsed.disabled]).toEqual(['ok.jar'])
  })

  it('falls back to no choices on unreadable content', () => {
    expect(parseChoices('{ not json').disabled.size).toBe(0)
    expect(parseChoices('null').disabled.size).toBe(0)
    expect(parseChoices('{"disabled":"nope"}').disabled.size).toBe(0)
  })
})