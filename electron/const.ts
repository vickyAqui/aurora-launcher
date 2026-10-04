export const MODPACK_URL = 'https://github.com/vickyAqui/aurora-launcher/releases/download/modpack/modpack.json'

/**
 * Signature of `modpack.json`, published next to it by `npm run modpack:publish`.
 *
 * Fetched separately on purpose: the launcher verifies the manifest it received against this
 * document, so a manifest served by anyone but Aurora Studios is rejected instead of deciding which
 * files are downloaded into the game folder.
 */
export const MODPACK_SIGNATURE_URL =
  'https://github.com/vickyAqui/aurora-launcher/releases/download/modpack/modpack.sig.json'

export const ROOT_DIR = 'aurora-studios'

export const MINECRAFT = {
  version: '1.20.1',
  loader: {
    loader: 'forge' as const,
    version: '1.20.1-47.4.10'
  },
  modpackUrl: MODPACK_URL
}

export const DEFAULT_PROFILE = {
  id: 'aurora-studios',
  isDefault: true,
  name: 'Aurora Studios',
  slug: 'aurora-studios',
  ip: 'br1.xmxcloud.net',
  port: 25496,
  createdAt: new Date(0),
  updatedAt: new Date(0)
}
