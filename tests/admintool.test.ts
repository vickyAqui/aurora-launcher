import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_TOOL_CONFIG_FILE, adminToolManifestUrl, getAdminToolConfig } from '../electron/admintool'
import { TEST_SLUG, useTempGame, type TempGame } from './helpers'

let tmp: TempGame
const originalUrl = process.env.AURORA_ADMIN_URL
const originalSlug = process.env.AURORA_ADMIN_SLUG

beforeEach(() => {
  tmp = useTempGame('aurora-admintool-')
  delete process.env.AURORA_ADMIN_URL
  delete process.env.AURORA_ADMIN_SLUG
})

afterEach(() => {
  if (originalUrl === undefined) delete process.env.AURORA_ADMIN_URL
  else process.env.AURORA_ADMIN_URL = originalUrl
  if (originalSlug === undefined) delete process.env.AURORA_ADMIN_SLUG
  else process.env.AURORA_ADMIN_SLUG = originalSlug
  tmp.cleanup()
})

describe('getAdminToolConfig', () => {
  it('stays off by default, so the current GitHub flow is untouched', () => {
    expect(getAdminToolConfig()).toBeNull()
  })

  it('reads the URL from the environment and uses the profile slug', () => {
    process.env.AURORA_ADMIN_URL = 'https://at.example.com/'
    expect(getAdminToolConfig('aurora-studios')).toEqual({
      url: 'https://at.example.com',
      slug: TEST_SLUG
    })
  })

  it('lets the environment override the slug', () => {
    process.env.AURORA_ADMIN_URL = 'https://at.example.com'
    process.env.AURORA_ADMIN_SLUG = 'Outro Perfil'
    expect(getAdminToolConfig()?.slug).toBe('outro-perfil')
  })

  it('reads the optional local config file', () => {
    writeFileSync(
      path.join(tmp.appData, ADMIN_TOOL_CONFIG_FILE),
      JSON.stringify({ url: 'https://painel.example.com', slug: 'aurora-studios' })
    )
    expect(getAdminToolConfig()).toEqual({ url: 'https://painel.example.com', slug: TEST_SLUG })
  })

  it('prefers the environment over the file', () => {
    writeFileSync(path.join(tmp.appData, ADMIN_TOOL_CONFIG_FILE), JSON.stringify({ url: 'https://file.example.com' }))
    process.env.AURORA_ADMIN_URL = 'https://env.example.com'
    expect(getAdminToolConfig()?.url).toBe('https://env.example.com')
  })

  it('rejects non-HTTP URLs and malformed files instead of breaking the launch', () => {
    process.env.AURORA_ADMIN_URL = 'ftp://at.example.com'
    expect(getAdminToolConfig()).toBeNull()

    delete process.env.AURORA_ADMIN_URL
    writeFileSync(path.join(tmp.appData, ADMIN_TOOL_CONFIG_FILE), 'not json')
    expect(getAdminToolConfig()).toBeNull()
  })
})

describe('adminToolManifestUrl', () => {
  it('uses the same endpoint as eml-lib', () => {
    expect(adminToolManifestUrl({ url: 'https://at.example.com', slug: TEST_SLUG })).toBe(
      `https://at.example.com/api/files-updater/${TEST_SLUG}`
    )
  })
})
