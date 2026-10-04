import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildManifestEntries,
  sanitizeAssetName,
  sha1,
  toManifestPath,
  validateManifest,
  walk
} from '../scripts/modpack-utils.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let tmpDir

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'modpack-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function makeJar(dir, name, content) {
  mkdirSync(path.join(dir, path.dirname(name)), { recursive: true })
  writeFileSync(path.join(dir, name), content)
}

describe('toManifestPath', () => {
  it('is the parent folder with a trailing slash', () => {
    expect(toManifestPath('mods/jei.jar')).toBe('mods/')
    expect(toManifestPath('mods/jei.jar.disabled')).toBe('mods/')
  })

  it('keeps a deeper layout', () => {
    expect(toManifestPath('config/tomcatweaks.toml')).toBe('config/')
  })

  it('is empty for a file in the modpack root', () => {
    expect(toManifestPath('jei.jar')).toBe('')
  })
})

describe('walk', () => {
  it('reports relative paths and skips the generated manifest', async () => {
    makeJar(tmpDir, 'mods/a.jar', 'a')
    makeJar(tmpDir, 'config/b.toml', 'b')
    writeFileSync(path.join(tmpDir, 'modpack.json'), '{}')

    const { files } = await walk(tmpDir)

    expect(files.map((f) => f.rel).sort()).toEqual(['config/b.toml', 'mods/a.jar'])
  })

  it('finds nested folders', async () => {
    makeJar(tmpDir, 'resourcepacks/pack/x.txt', 'x')
    const { folders } = await walk(tmpDir)
    expect(folders.map((f) => f.rel).sort()).toEqual(['resourcepacks', 'resourcepacks/pack'])
  })
})

describe('sanitizeAssetName', () => {
  it('predicts the name GitHub stores an asset under', () => {
    // Names taken from a real release: this is the substitution GitHub applied on upload.
    expect(sanitizeAssetName('MOAdecor ART 1.20.1.jar')).toBe('MOAdecor.ART.1.20.1.jar')
    expect(sanitizeAssetName('EasyPaxel1.20.1(Forge)vs1.0.3.jar')).toBe('EasyPaxel1.20.1.Forge.vs1.0.3.jar')
    expect(sanitizeAssetName('[1.20.1] SecurityCraft v1.10.1.jar')).toBe('1.20.1.SecurityCraft.v1.10.1.jar')
    expect(sanitizeAssetName('everlasting_leaves-1.20.1-1.0.0 (1).jar')).toBe('everlasting_leaves-1.20.1-1.0.0.1.jar')
    expect(sanitizeAssetName('cyberspace 2.2.0 (F1.20.1).jar')).toBe('cyberspace.2.2.0.F1.20.1.jar')
  })

  it('leaves an ordinary mod name alone', () => {
    expect(sanitizeAssetName('jei-1.20.1-forge-15.2.0.27.jar')).toBe('jei-1.20.1-forge-15.2.0.27.jar')
  })
})

describe('buildManifestEntries', () => {
  it('scans mods/ into entries the game can actually load', async () => {
    makeJar(tmpDir, 'mods/a.jar', 'aaa')
    const { folders, files } = await walk(tmpDir)
    const entries = await buildManifestEntries({ folders, files, baseUrl: 'https://cdn.test' })

    const jar = entries.find((e) => e.name === 'a.jar')
    expect(jar).toMatchObject({ path: 'mods/', size: 3, type: 'MOD' })
    expect(jar.sha1).toBe(await sha1(path.join(tmpDir, 'mods/a.jar')))
  })

  it('produces a manifest with no problems', async () => {
    makeJar(tmpDir, 'mods/a.jar', 'aaa')
    makeJar(tmpDir, 'mods/b.jar.disabled', 'bb')
    const { folders, files } = await walk(tmpDir)

    const manifest = { files: await buildManifestEntries({ folders, files, baseUrl: 'https://cdn.test' }) }
    expect(validateManifest(manifest)).toEqual([])
  })

  it('catches a mod left outside mods/', async () => {
    makeJar(tmpDir, 'a.jar', 'aaa')
    const { folders, files } = await walk(tmpDir)
    const manifest = { files: await buildManifestEntries({ folders, files, baseUrl: 'https://cdn.test' }) }

    const problems = validateManifest(manifest)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('a.jar')
    expect(problems[0]).toContain('mods/')
  })

  it('gives a folder a url even though only files were uploaded', async () => {
    // The bug that broke a real publish: `urlFor` is fed from the upload results, which only exist
    // for files, so asking it about the `mods/` folder entry threw and the manifest was never
    // written — leaving the release with every jar and no modpack.json at all.
    makeJar(tmpDir, 'mods/a.jar', 'aaa')
    const { folders, files } = await walk(tmpDir)
    const uploaded = new Map([['mods/a.jar', { browser_download_url: 'https://cdn.test/a.jar' }]])

    const entries = await buildManifestEntries({
      folders,
      files,
      baseUrl: 'https://cdn.test',
      urlFor: (entry) => uploaded.get(entry.rel)?.browser_download_url
    })

    const folder = entries.find((e) => e.type === 'FOLDER')
    expect(folder.name).toBe('mods')
    expect(folder.url).toBe('https://cdn.test/modpack.json')
    expect(entries.find((e) => e.type === 'MOD').url).toBe('https://cdn.test/a.jar')
    expect(validateManifest({ files: entries })).toEqual([])
  })

  it('points the url at the name GitHub will store, not the local one', async () => {
    makeJar(tmpDir, 'mods/MOAdecor ART 1.20.1.jar', 'aaa')
    const { folders, files } = await walk(tmpDir)

    const entries = await buildManifestEntries({ folders, files, baseUrl: 'https://cdn.test' })

    expect(entries.find((e) => e.type === 'MOD').url).toBe('https://cdn.test/MOAdecor.ART.1.20.1.jar')
  })
})

describe('validateManifest', () => {
  const jar = (over = {}) => ({
    name: 'a.jar',
    path: 'mods/',
    size: 1,
    sha1: 'a'.repeat(40),
    url: 'https://cdn.test/a.jar',
    type: 'MOD',
    ...over
  })

  it('accepts a correct manifest', () => {
    expect(validateManifest({ files: [jar()] })).toEqual([])
  })

  it('rejects the bug that broke the launcher: an empty MOD path', () => {
    const problems = validateManifest({ files: [jar({ path: '' })] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('would not load')
  })

  it('accepts a bare array, as older tools produced', () => {
    expect(validateManifest([jar()])).toEqual([])
  })

  it('rejects a manifest with no files array', () => {
    expect(validateManifest({})).toEqual(['manifest has no "files" array'])
  })

  it('rejects a mod that would never load', () => {
    const problems = validateManifest({ files: [jar({ size: 0 })] })
    expect(problems.join()).toContain('size must be greater than zero')
  })

  it('rejects a bad hash', () => {
    expect(validateManifest({ files: [jar({ sha1: 'nope' })] }).join()).toContain('sha1')
  })

  it('rejects the same file declared twice', () => {
    expect(validateManifest({ files: [jar(), jar()] }).join()).toContain('duplicated')
  })

  it('rejects an entry without a url', () => {
    expect(validateManifest({ files: [jar({ url: '' })] }).join()).toContain('missing url')
  })

  it('allows FOLDER entries at the root', () => {
    const folder = { name: 'mods', path: '', url: 'https://cdn.test/mods', type: 'FOLDER' }
    expect(validateManifest({ files: [folder, jar()] })).toEqual([])
  })

  it('rejects the same mod shipped twice under two names', () => {
    // The symptom this catches: the player downloads the mod twice and the game loads both copies.
    const problems = validateManifest({ files: [jar(), jar({ name: 'jei (1).jar' })] })

    expect(problems.join()).toContain('duplicated')
    expect(problems.join()).toContain('jei (1).jar')
  })

  it('rejects two names GitHub would store as a single asset', () => {
    // The old name and the new one of the same mod: GitHub folds both into one asset, so every
    // publish would overwrite the other and the manifest would point twice at the same file.
    const problems = validateManifest({
      files: [
        jar({ name: 'MOAdecor ART 1.20.1.jar' }),
        jar({ name: 'MOAdecor.ART.1.20.1.jar', sha1: 'b'.repeat(40) })
      ]
    })

    expect(problems.join()).toContain('MOAdecor.ART.1.20.1.jar')
    expect(problems.join()).toContain('rename one of them')
  })
})

describe('publish-modpack.mjs', () => {
  /** Runs the real script against `dir`, with a token that must not be needed. */
  function runPublish(dir) {
    try {
      const stdout = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/publish-modpack.mjs')], {
        env: { ...process.env, MODPACK_DIR: dir, GH_TOKEN: 'not-a-real-token', GH_REPO: 'vickyAqui/does-not-exist' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return { stdout, stderr: '' }
    } catch (err) {
      return { stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') }
    }
  }

  it('refuses a broken manifest before touching the release', () => {
    makeJar(tmpDir, 'a.jar', 'aaa')

    const result = runPublish(tmpDir)

    expect(result.stderr).toMatch(/MOD path must be "mods\/"/)
    // Nothing may be deleted or uploaded on the way to that refusal: an earlier version wiped every
    // asset first, so a manifest problem left the release with the jars and no modpack.json.
    expect(result.stderr).not.toMatch(/GitHub API/)
  })
})

describe('the modpack.json shipped in this repo', () => {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'modpack.json'), 'utf8'))

  it('passes validation', () => {
    expect(validateManifest(manifest)).toEqual([])
  })

  it('has every MOD pointing at the mods folder', () => {
    const mods = manifest.files.filter((f) => f.type === 'MOD')
    expect(mods.length).toBeGreaterThan(0)
    expect([...new Set(mods.map((f) => f.path))]).toEqual(['mods/'])
  })

  it('resolves every entry inside the mods folder, the way eml-lib downloads it', () => {
    const gameDir = path.join('/tmp', '.aurora_studios', 'aurora-studios')
    const misplaced = manifest.files
      .filter((f) => f.type === 'MOD')
      .filter((f) => path.dirname(path.join(gameDir, f.path, f.name)) !== path.join(gameDir, 'mods'))

    expect(misplaced.map((f) => `${f.path}${f.name}`)).toEqual([])
  })

  it('declares no duplicate entries', () => {
    const keys = manifest.files.map((f) => `${f.path}${f.name}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only references mods that exist in the modpack folder', () => {
    const missing = manifest.files
      .filter((f) => f.type === 'MOD')
      .filter((f) => !existsSync(path.join(repoRoot, 'modpack', f.path, f.name)))

    expect(missing.map((f) => f.name)).toEqual([])
  })

  it('has a matching file for every entry in the modpack folder', async () => {
    const declared = new Set(manifest.files.filter((f) => f.type === 'MOD').map((f) => f.name))
    const { files } = await walk(path.join(repoRoot, 'modpack'))

    expect(files.filter((f) => !declared.has(f.name)).map((f) => f.name)).toEqual([])
  })

  it('matches the recorded size and hash of a sample of mods', async () => {
    const sample = manifest.files.filter((f) => f.type === 'MOD').slice(0, 3)
    for (const file of sample) {
      const full = path.join(repoRoot, 'modpack', file.path, file.name)
      expect(await sha1(full), file.name).toBe(file.sha1)
      expect(existsSync(full) && readFileSync(full).length, file.name).toBe(file.size)
    }
  })
})

describe('update-modpack.mjs', () => {
  /** Writes `manifest` to a temp file and runs the real script against it. */
  function runUpdate(manifest) {
    const file = path.join(tmpDir, 'modpack.json')
    const raw = JSON.stringify(manifest, null, 2)
    writeFileSync(file, raw)
    try {
      execFileSync(process.execPath, [path.join(repoRoot, 'scripts/update-modpack.mjs')], {
        env: { ...process.env, MODPACK_FILE: file },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      })
      return { before: raw, after: readFileSync(file, 'utf8') }
    } catch (err) {
      // The script is expected to refuse and exit non-zero; the file must be left untouched.
      return { before: raw, after: readFileSync(file, 'utf8'), stderr: String(err.stderr ?? '') }
    }
  }

  it('refuses to rewrite a manifest that would send the mods to the wrong place', () => {
    const result = runUpdate({
      files: [
        { name: 'mods', path: '', url: 'https://example.test/mods', type: 'FOLDER' },
        {
          name: 'jei.jar',
          path: '',
          size: 1,
          sha1: 'a'.repeat(40),
          url: 'https://example.test/jei.jar',
          type: 'MOD'
        }
      ]
    })

    expect(result.stderr).toMatch(/MOD path must be "mods\/"/)

    // The point of the guard: a refresh must never bake the broken state into the file.
    expect(result.after).toBe(result.before)
  })

  it('refuses a manifest with no files array at all', () => {
    const result = runUpdate({})
    expect(result.stderr).toMatch(/files/)
    expect(result.after).toBe(result.before)
  })
})

let cachedWalk
async function walkTmp() {
  cachedWalk ??= await walk(path.join(repoRoot, 'modpack'))
  return cachedWalk
}
