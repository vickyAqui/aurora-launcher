import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { getAppDataDir, getGameDir, getModsDir, getServerFolder } from '../electron/gamedir'
import { useTempGame } from './helpers'

let cleanup: () => void

beforeEach(() => {
  cleanup = useTempGame('aurora-gamedir-').cleanup
})

afterEach(() => cleanup())

describe('game directory layout', () => {
  it('sanitizes the root name, so the folder is .aurora_studios', () => {
    expect(path.basename(getServerFolder('Aurora Studios'))).toBe('.aurora_studios')
  })

  it('puts each profile in its own folder inside the root', () => {
    expect(path.basename(path.dirname(getGameDir('aurora-studios')))).toBe('.aurora_studios')
    expect(path.basename(getGameDir('aurora-studios'))).toBe('aurora-studios')
  })

  it('keeps the mods folder inside the profile, where Forge looks for it', () => {
    expect(path.relative(getGameDir('aurora-studios'), getModsDir('aurora-studios'))).toBe('mods')
  })

  it('separates profiles from each other', () => {
    expect(getGameDir('profile-a')).not.toBe(getGameDir('profile-b'))
  })

  it('uses AURORA_APPDATA_DIR when set, so a run can be redirected', () => {
    expect(getAppDataDir()).toBe(process.env.AURORA_APPDATA_DIR)
    expect(getGameDir('aurora-studios').startsWith(process.env.AURORA_APPDATA_DIR!)).toBe(true)
  })

  it('falls back to the OS location when the override is cleared', () => {
    delete process.env.AURORA_APPDATA_DIR
    expect(getAppDataDir()).not.toBe('')
    expect(existsSync(getAppDataDir())).toBe(true)
  })

  it('creates nothing as a side effect', () => {
    mkdirSync(getModsDir('untouched-profile'), { recursive: true })
    writeFileSync(path.join(getGameDir('untouched-profile'), 'marker'), 'x')

    getGameDir('another-profile')
    getModsDir('another-profile')

    expect(existsSync(getGameDir('another-profile'))).toBe(false)
  })
})