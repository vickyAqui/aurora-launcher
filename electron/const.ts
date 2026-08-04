export const MODPACK_URL = 'https://raw.githubusercontent.com/vickyAqui/aurora-launcher/main/modpack.json'

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
