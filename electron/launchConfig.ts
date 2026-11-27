import type { Account, Config } from 'eml-lib'
import type { IAdminToolConfig } from './admintool'
import { MINECRAFT, ROOT_DIR } from './const'

export interface IBuildLauncherConfig {
  slug: string
  admin: IAdminToolConfig | null
  account: Account
  /** Manifesto já filtrado pelas escolhas de mods do jogador, como `data:` URL. */
  modpackDataUrl: string
  java: NonNullable<Config['java']>
  memory: NonNullable<Config['memory']>
  window: NonNullable<Config['window']>
}

/**
 * Monta a config do `eml-lib` sem perder nenhuma das nossas regras de launch.
 *
 * Modo GitHub (padrão): `minecraft.version`/loader e `minecraft.modpackUrl` como hoje.
 *
 * Modo AdminTool: `url` faz o `eml-lib` buscar versão, loader e arquivos do painel. A versão e o
 * loader ficam em `profile.minecraft` (não no `minecraft` global) porque o `setUrl()` da lib
 * descarta `url` quando `config.minecraft.version` existe. O `modpackUrl` continua sendo o nosso
 * manifesto filtrado, então mods desligados pelo jogador não são baixados de novo — inclusive com
 * o painel conectado.
 */
export function buildLauncherConfig({
  slug,
  admin,
  account,
  modpackDataUrl,
  java,
  memory,
  window
}: IBuildLauncherConfig): Config {
  const shared: Config = {
    root: ROOT_DIR,
    account,
    cleaning: { enabled: false },
    java,
    memory,
    window
  }

  if (!admin) {
    return {
      ...shared,
      profile: { slug },
      minecraft: { ...MINECRAFT, modpackUrl: modpackDataUrl }
    }
  }

  return {
    ...shared,
    url: admin.url,
    profile: {
      slug,
      // `profile.minecraft` substitui o `minecraft` global quando tem `version` válida.
      minecraft: { ...MINECRAFT, modpackUrl: modpackDataUrl }
    }
  }
}
