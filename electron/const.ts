export const MODPACK_URL = 'https://github.com/vickyAqui/aurora-launcher/releases/download/modpack/modpack.json'

/**
 * Endereço público do Aurora Admin. O launcher tenta o manifesto do painel primeiro e
 * cai para o GitHub Releases se ele estiver fora — o jogo nunca fica sem modpack por causa disso.
 *
 * Pode ser sobrescrito sem rebuild por `AURORA_ADMIN_URL` (use '' para desligar) ou por
 * `<appData>/aurora-admin-tool.json` (`{ "url": "https://..." }`).
 */
export const DEFAULT_ADMIN_URL = 'https://aurora-admin-0gu0.onrender.com'

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
  ip: '79.182.128.137',
  port: 25565,
  createdAt: new Date(0),
  updatedAt: new Date(0)
}
