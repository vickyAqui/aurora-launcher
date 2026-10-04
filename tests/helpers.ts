import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getGameDir, getModsDir } from '../electron/gamedir'
import type { File } from 'eml-lib'

export interface TempGame {
  appData: string
  slug: string
  gameDir: string
  modsDir: string
  storePath: string
  ensureModsDir: () => void
  cleanup: () => void
}

export const TEST_SLUG = 'aurora-studios'

/**
 * Creates an isolated fake `%APPDATA%` so a suite never touches the real game directory.
 *
 * The game paths are read back from `electron/gamedir` on purpose: the folder name is sanitized
 * (`aurora-studios` becomes `.aurora_studios`), and hardcoding it here would let the tests drift away
 * from what the launcher really uses.
 */
export function useTempGame(prefix = 'aurora-test-'): TempGame {
  const appData = mkdtempSync(path.join(tmpdir(), prefix))
  const previous = process.env.AURORA_APPDATA_DIR
  process.env.AURORA_APPDATA_DIR = appData

  const gameDir = getGameDir(TEST_SLUG)

  return {
    appData,
    slug: TEST_SLUG,
    gameDir,
    modsDir: getModsDir(TEST_SLUG),
    storePath: path.join(gameDir, 'disabled-mods.json'),
    ensureModsDir: () => mkdirSync(getModsDir(TEST_SLUG), { recursive: true }),
    cleanup: () => {
      if (previous === undefined) delete process.env.AURORA_APPDATA_DIR
      else process.env.AURORA_APPDATA_DIR = previous
      rmSync(appData, { recursive: true, force: true })
    }
  }
}

/** Writes a file, creating parent folders. */
export function writeFile(filePath: string, content = 'x'): string {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

/** Writes a fake jar. */
export function writeJar(filePath: string, content = 'x'): string {
  return writeFile(filePath, content)
}

/** Minimal MOD entry, shaped like the real modpack.json and the `eml-lib` `File` type. */
export function modEntry(name: string, overrides: Partial<File> = {}): File {
  return {
    name,
    path: 'mods/',
    size: 10,
    sha1: 'a'.repeat(40),
    url: `https://example.test/${encodeURIComponent(name)}`,
    type: 'MOD',
    ...overrides
  }
}

export function manifestOf(...files: File[]) {
  return { files }
}