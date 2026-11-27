import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_ADMIN_URL, DEFAULT_PROFILE } from './const'
import { getAppDataDir } from './gamedir'

export interface IAdminToolConfig {
  /** Base URL do painel, sem barra final. */
  url: string
  /** Slug do perfil usado no endpoint `/api/files-updater/<slug>`. */
  slug: string
}

/** Nome do arquivo opcional que permite trocar a URL sem recompilar o launcher. */
export const ADMIN_TOOL_CONFIG_FILE = 'aurora-admin-tool.json'

function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim().replace(/\/+$/, '')
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const slug = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return slug || null
}

/**
 * Lê a configuração do AdminTool. Fontes, em ordem de prioridade:
 *
 * 1. `AURORA_ADMIN_URL` / `AURORA_ADMIN_SLUG` (override rápido, útil em teste);
 * 2. `<appData>/aurora-admin-tool.json` (`{ "url": "...", "slug": "..." }`);
 * 3. `DEFAULT_ADMIN_URL` compilado.
 *
 * Sem uma URL válida, retorna `null` e o launcher segue exatamente como antes, no GitHub Releases.
 * Isso mantém o fallback automático enquanto o painel não estiver disponível para os jogadores.
 */
export function getAdminToolConfig(slug: string = DEFAULT_PROFILE.slug): IAdminToolConfig | null {
  let fromFile: { url?: unknown; slug?: unknown } | null = null
  try {
    const file = path.join(getAppDataDir(), ADMIN_TOOL_CONFIG_FILE)
    if (fs.existsSync(file)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object') fromFile = parsed as { url?: unknown; slug?: unknown }
    }
  } catch {
    // Config ausente ou inválida não é erro: apenas mantém o modo GitHub.
  }

  const url = normalizeUrl(process.env.AURORA_ADMIN_URL ?? fromFile?.url ?? DEFAULT_ADMIN_URL)
  if (!url) return null

  return { url, slug: normalizeSlug(process.env.AURORA_ADMIN_SLUG ?? fromFile?.slug ?? slug) ?? slug }
}

/** Endpoint que o próprio `eml-lib` usa para buscar os arquivos do perfil. */
export function adminToolManifestUrl(config: IAdminToolConfig): string {
  return `${config.url}/api/files-updater/${encodeURIComponent(config.slug)}`
}
