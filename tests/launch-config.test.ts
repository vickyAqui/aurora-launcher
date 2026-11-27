import type { Account } from 'eml-lib'
import { describe, expect, it } from 'vitest'
import { buildLauncherConfig } from '../electron/launchConfig'

const account: Account = {
  name: 'Aurora',
  uuid: 'bcc56411-2494-3630-9e5e-186a2c3acfe3',
  accessToken: 'token',
  clientToken: 'client',
  meta: { online: true, type: 'msa' }
}

const base = {
  slug: 'aurora-studios',
  account,
  modpackDataUrl: 'data:application/json;base64,e30=',
  java: { install: 'auto' as const },
  memory: { min: 1024, max: 8192 },
  window: { width: 1280, height: 720, fullscreen: false }
}

describe('buildLauncherConfig', () => {
  it('keeps the exact GitHub-mode config when the AdminTool is not configured', () => {
    const config = buildLauncherConfig({ ...base, admin: null })

    expect(config.url).toBeUndefined()
    expect(config.profile).toEqual({ slug: 'aurora-studios' })
    expect(config.minecraft).toMatchObject({
      version: '1.20.1',
      loader: { loader: 'forge', version: '1.20.1-47.4.10' },
      modpackUrl: base.modpackDataUrl
    })
  })

  it('sets the AdminTool URL without dropping the filtered manifest or our launch rules', () => {
    const config = buildLauncherConfig({
      ...base,
      admin: { url: 'https://at.example.com', slug: 'aurora-studios' }
    })

    expect(config.url).toBe('https://at.example.com')
    expect(config.minecraft).toBeUndefined()
    expect(config.profile).toMatchObject({
      slug: 'aurora-studios',
      minecraft: {
        version: '1.20.1',
        loader: { loader: 'forge', version: '1.20.1-47.4.10' },
        modpackUrl: base.modpackDataUrl
      }
    })
    expect(config.cleaning).toEqual({ enabled: false })
    expect(config.memory).toEqual(base.memory)
  })
})
