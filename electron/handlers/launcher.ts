import { ipcMain, BrowserWindow, app } from 'electron'
import { Launcher } from 'eml-lib'
import type { Account } from 'eml-lib'
import type { IGameSettings } from './settings'
import logger from 'electron-log/main'
import { DEFAULT_PROFILE, MINECRAFT, ROOT_DIR } from '../const'
import { endSession, startSession } from './stats'
import { ModpackUnavailableError, prepareMods, type IPreparedMods } from './mods'
import { ensureFreshAccount } from './auth'

/**
 * Hands the filtered manifest to `eml-lib` through a `data:` URL, so the downloader only ever sees
 * the mods this player should have: the right `path`, and the right file name for a mod that is off.
 */
function toDataUrl(manifest: unknown): string {
  return 'data:application/json;base64,' + Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64')
}

/**
 * Quanto tempo o lançamento pode ficar sem dar nenhum sinal de vida antes de avisarmos o jogador.
 *
 * `launcher.launch()` do eml-lib não tem timeout: se o processo de patch do Forge travar (ou o Java
 * nunca fechar), a promessa nunca resolve e a janela fica em "Finalizando..." para sempre. O
 * watchdog não cancela o lançamento, mas tira o jogador de um estado sem saída e diz onde travou.
 */
const LAUNCH_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const WATCHDOG_INTERVAL_MS = 15 * 1000

/** Traduz o erro do eml-lib para algo que o jogador consiga entender. */
function describeLaunchError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code

  if (code === 'DOWNLOAD_ERROR') {
    return 'Não foi possível baixar os arquivos do jogo. Verifique sua conexão e tente novamente.'
  }
  if (code === 'JAVA_ERROR' || code === 'EXEC_ERROR') {
    return 'Não foi possível iniciar o Java. Confira a opção de Java nas configurações e tente novamente.'
  }
  if (code === 'PATCHER_ERROR') {
    return 'Não foi possível finalizar a instalação do Forge. Tente novamente; se continuar, reinicie o launcher.'
  }

  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return message || 'Erro inesperado ao iniciar o jogo. Veja os logs para mais detalhes.'
}

export function registerLauncherHandlers(mainWindow: BrowserWindow) {
  /**
   * O processo do Minecraft continua escrevendo no stdout depois que a janela do launcher some (o
   * jogador fechou, ou `launcherAction: 'close'` encerrou o app). Mandar IPC para uma janela
   * destruída estoura `Object has been destroyed` de dentro do EventEmitter do socket, e o Electron
   * mostra isso como "A JavaScript error occurred in the main process".
   */
  const send = (channel: string, ...args: unknown[]) => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(channel, ...args)
  }

  ipcMain.handle('game:launch', async (_event, payload: { account: Account; settings: IGameSettings; profileSlug: string }) => {
    const { settings, profileSlug } = payload

    /**
     * Estado do watchdog deste lançamento. Fica na closure do handler para que dois lançamentos
     * (por exemplo, um depois de um erro) não compartilhem o mesmo timer.
     */
    let phase = 'iniciando o launcher'
    let lastActivity = Date.now()
    let failureReported = false
    let watchdog: ReturnType<typeof setInterval> | null = null

    const stopWatchdog = () => {
      if (watchdog) {
        clearInterval(watchdog)
        watchdog = null
      }
    }

    /** Marca que o eml-lib continua trabalhando (e, opcionalmente, em qual etapa está). */
    const touch = (nextPhase?: string) => {
      lastActivity = Date.now()
      if (nextPhase) phase = nextPhase
    }

    const fail = (reason: string) => {
      if (failureReported) return
      failureReported = true
      stopWatchdog()
      logger.error(`Launch failed during "${phase}":`, reason)
      send('game:launch_error', reason)
    }

    const startWatchdog = () => {
      stopWatchdog()
      lastActivity = Date.now()
      watchdog = setInterval(() => {
        if (Date.now() - lastActivity < LAUNCH_IDLE_TIMEOUT_MS) return
        fail(
          `O jogo ficou mais de ${LAUNCH_IDLE_TIMEOUT_MS / 60000} minutos sem responder durante "${phase}". ` +
            'Feche o launcher, verifique sua conexão e tente novamente.'
        )
      }, WATCHDOG_INTERVAL_MS)
    }

    startWatchdog()

    // O token da Microsoft vale ~24h, e o launcher pode ficar aberto por muito mais que isso.
    // Renova antes de baixar/abrir qualquer coisa: com um token vencido o jogo sobe e só falha na
    // autenticação com o servidor.
    let account: Account
    try {
      touch('renovando a sessão da Microsoft')
      account = await ensureFreshAccount(payload.account)
    } catch (err) {
      logger.error('Launch refused: could not refresh the Microsoft session:', err)
      fail('Não foi possível renovar sua sessão da Microsoft. Entre na conta novamente.')
      return
    }

    let java: { install: 'auto' } | { install: 'manual'; absolutePath: string }
    if (settings.java === 'system') {
      java = { install: 'manual' as const, absolutePath: 'java' }
    } else if (settings.java === 'path' && settings.javaPath) {
      java = { install: 'manual' as const, absolutePath: settings.javaPath }
    } else {
      java = { install: 'auto' as const }
    }

    logger.log('Launching')

    const slug = profileSlug || DEFAULT_PROFILE.slug

    // `prepareMods` throws when the manifest cannot be verified; the launch is refused rather than
    // continued on a manifest of unknown origin. The reason goes to the window, because
    // `game:launch` is invoked fire-and-forget and a rejection here would leave the UI waiting.
    let prepared: IPreparedMods
    try {
      touch('verificando os arquivos do modpack')
      prepared = await prepareMods(slug)
    } catch (err) {
      const reason = err instanceof ModpackUnavailableError ? err.reason : (err as Error).message
      logger.error('Launch refused:', err)
      fail(reason)
      return
    }

    const minecraft = { ...MINECRAFT, modpackUrl: toDataUrl(prepared.manifest) }

    let launcher: Launcher
    try {
      launcher = new Launcher({
        root: ROOT_DIR,
        profile: { slug: profileSlug || DEFAULT_PROFILE.slug },
        account: account,
        minecraft: minecraft,
        cleaning: {
          enabled: false
        },
        java: java,
        memory: {
          min: +settings.memory.min * 1024,
          max: +settings.memory.max * 1024
        },
        window: {
          width: settings.resolution.width,
          height: settings.resolution.height,
          fullscreen: settings.resolution.fullscreen
        }
      })
    } catch (err) {
      // Uma configuração inválida estoura aqui, antes de existir qualquer evento para a janela.
      logger.error('Could not create the launcher:', err)
      fail(describeLaunchError(err))
      return
    }

    launcher.on('launch_compute_download', () => {
      touch('calculando o download')
      logger.log('Computing download...')
      send('game:launch_compute_download')
    })

    launcher.on('launch_download', (download) => {
      touch('baixando arquivos')
      logger.log(`Downloading ${download.total.amount} files (${download.total.size} B).`)
      send('game:launch_download', download)
    })
    launcher.on('download_progress', (progress) => {
      touch()
      send('game:download_progress', progress)
    })
    launcher.on('download_error', (error) => {
      touch()
      logger.error(`Error downloading ${error.filename}: ${error.message}`)
      send('game:download_error', error)
    })
    launcher.on('download_end', (info) => {
      touch()
      logger.log(`Downloaded ${info.downloaded.amount} files.`)
      send('game:download_end', info)
    })

    launcher.on('launch_install_loader', (loader) => {
      touch('instalando o Forge')
      logger.log(`Installing loader ${loader.type} ${loader.loaderVersion}...`)
      send('game:launch_install_loader', loader)
    })

    launcher.on('launch_extract_natives', () => {
      touch('extraindo arquivos')
      logger.log('Extracting natives...')
      send('game:launch_extract_natives')
    })
    launcher.on('extract_progress', (progress) => {
      touch()
      logger.log(`Extracted ${progress.filename}.`)
      send('game:extract_progress', progress)
    })
    launcher.on('extract_end', (info) => {
      touch()
      logger.log(`Extracted ${info.amount} files.`)
      send('game:extract_end', info)
    })

    launcher.on('launch_copy_assets', () => {
      touch('copiando assets')
      logger.log('Copying assets...')
      send('game:launch_copy_assets')
    })
    launcher.on('copy_progress', (progress) => {
      touch()
      logger.log(`Copied ${progress.filename} to ${progress.dest}.`)
      send('game:copy_progress', progress)
    })
    launcher.on('copy_end', (info) => {
      touch()
      logger.log(`Copied ${info.amount} files.`)
      send('game:copy_end', info)
    })

    launcher.on('launch_patch_loader', () => {
      touch('finalizando a instalação do Forge')
      logger.log('Patching loader...')
      send('game:launch_patch_loader')
    })
    launcher.on('patch_progress', (progress) => {
      touch()
      send('game:patch_progress', progress)
    })
    launcher.on('patch_error', (error) => {
      touch()
      logger.error(`Error patching ${error.filename}: ${error.message}`)
      send('game:patch_error', error)
    })
    launcher.on('patch_end', (info) => {
      touch()
      logger.log(`Patched ${info.amount} files.`)
      send('game:patch_end', info)
    })

    launcher.on('launch_check_java', () => {
      touch('verificando o Java')
      logger.log('Checking Java...')
      send('game:launch_check_java')
    })
    launcher.on('java_info', (info) => {
      touch()
      logger.log(`Using Java ${info.version} ${info.arch}`)
      send('game:java_info', info)
    })

    launcher.on('launch_clean', () => {
      touch('limpando arquivos antigos')
      logger.log('Cleaning game directory...')
      send('game:launch_clean')
    })
    launcher.on('clean_progress', (progress) => {
      touch()
      send('game:clean_progress', progress)
    })
    launcher.on('clean_end', (info) => {
      touch()
      logger.log(`Cleaned ${info.amount} files.`)
      send('game:clean_end', info)
    })

    launcher.on('launch_launch', (info) => {
      // O Minecraft vai abrir: daqui em diante o silêncio é normal (o jogo está rodando).
      stopWatchdog()
      touch('abrindo o Minecraft')
      logger.log(`Launching Minecraft ${info.version} (${info.type}${info.loaderVersion ? ` ${info.loaderVersion}` : ''})...`)

      send('game:launch_launch', info)
      startSession()
      if (settings.launcherAction === 'close') {
        setTimeout(() => app.quit(), 5000)
      } else if (settings.launcherAction === 'hide') {
        setTimeout(() => {
          if (!mainWindow.isDestroyed()) mainWindow.minimize()
        }, 5000)
      }
      send('game:launched')
    })
    launcher.on('launch_data', (message) => {
      logger.log(message)
      send('game:launch_data', message)
    })
    launcher.on('launch_close', (code) => {
      stopWatchdog()
      logger.log(`Closed with code ${code}.`)
      endSession()
      send('game:launch_close', code)
    })

    launcher.on('launch_debug', (message) => {
      touch()
      send('game:launch_debug', message)
    })
    launcher.on('patch_debug', (message) => {
      touch()
      send('game:patch_debug', message)
    })

    try {
      await launcher.launch()
    } catch (err) {
      // Sem isso a janela ficaria em "Finalizando..." para sempre: o `game:launch` é
      // fire-and-forget no renderer, então a rejeição nunca chegaria lá sozinha.
      logger.error('Launcher error:', err)
      fail(describeLaunchError(err))
    } finally {
      stopWatchdog()
    }
  })
}
