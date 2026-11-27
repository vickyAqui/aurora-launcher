export const MODPACK_URL = 'https://github.com/vickyAqui/aurora-launcher/releases/download/modpack/modpack.json'

/**
 * Endereço público do EML AdminTool. Vazio enquanto o painel não estiver exposto na internet:
 * o launcher continua no modo atual (GitHub Releases) e nada muda para os jogadores.
 *
 * Pode ser sobrescrito sem rebuild por `AURORA_ADMIN_URL` ou por
 * `<appData>/aurora-admin-tool.json` (`{ "url": "https://..." }`).
 */
export const DEFAULT_ADMIN_URL = ''

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
