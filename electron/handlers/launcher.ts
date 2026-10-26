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

    // O token da Microsoft vale ~24h, e o launcher pode ficar aberto por muito mais que isso.
    // Renova antes de baixar/abrir qualquer coisa: com um token vencido o jogo sobe e só falha na
    // autenticação com o servidor.
    let account: Account
    try {
      account = await ensureFreshAccount(payload.account)
    } catch (err) {
      logger.error('Launch refused: could not refresh the Microsoft session:', err)
      send(
        'game:launch_error',
        'Não foi possível renovar sua sessão da Microsoft. Entre na conta novamente.'
      )
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
      prepared = await prepareMods(slug)
    } catch (err) {
      const reason = err instanceof ModpackUnavailableError ? err.reason : (err as Error).message
      logger.error('Launch refused:', err)
      send('game:launch_error', reason)
      return
    }

    const minecraft = { ...MINECRAFT, modpackUrl: toDataUrl(prepared.manifest) }

    const launcher = new Launcher({
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

    launcher.on('launch_compute_download', () => {
      logger.log('Computing download...')
      send('game:launch_compute_download')
    })

    launcher.on('launch_download', (download) => {
      logger.log(`Downloading ${download.total.amount} files (${download.total.size} B).`)
      send('game:launch_download', download)
    })
    launcher.on('download_progress', (progress) => {
      send('game:download_progress', progress)
    })
    launcher.on('download_error', (error) => {
      logger.error(`Error downloading ${error.filename}: ${error.message}`)
      send('game:download_error', error)
    })
    launcher.on('download_end', (info) => {
      logger.log(`Downloaded ${info.downloaded.amount} files.`)
      send('game:download_end', info)
    })

    launcher.on('launch_install_loader', (loader) => {
      logger.log(`Installing loader ${loader.type} ${loader.loaderVersion}...`)
      send('game:launch_install_loader', loader)
    })

    launcher.on('launch_extract_natives', () => {
      logger.log('Extracting natives...')
      send('game:launch_extract_natives')
    })
    launcher.on('extract_progress', (progress) => {
      logger.log(`Extracted ${progress.filename}.`)
      send('game:extract_progress', progress)
    })
    launcher.on('extract_end', (info) => {
      logger.log(`Extracted ${info.amount} files.`)
      send('game:extract_end', info)
    })

    launcher.on('launch_copy_assets', () => {
      logger.log('Copying assets...')
      send('game:launch_copy_assets')
    })
    launcher.on('copy_progress', (progress) => {
      logger.log(`Copied ${progress.filename} to ${progress.dest}.`)
      send('game:copy_progress', progress)
    })
    launcher.on('copy_end', (info) => {
      logger.log(`Copied ${info.amount} files.`)
      send('game:copy_end', info)
    })

    launcher.on('launch_patch_loader', () => {
      logger.log('Patching loader...')
      send('game:launch_patch_loader')
    })
    launcher.on('patch_progress', (progress) => {
      send('game:patch_progress', progress)
    })
    launcher.on('patch_error', (error) => {
      logger.error(`Error patching ${error.filename}: ${error.message}`)
      send('game:patch_error', error)
    })
    launcher.on('patch_end', (info) => {
      logger.log(`Patched ${info.amount} files.`)
      send('game:patch_end', info)
    })

    launcher.on('launch_check_java', () => {
      logger.log('Checking Java...')
      send('game:launch_check_java')
    })
    launcher.on('java_info', (info) => {
      logger.log(`Using Java ${info.version} ${info.arch}`)
      send('game:java_info', info)
    })

    launcher.on('launch_clean', () => {
      logger.log('Cleaning game directory...')
      send('game:launch_clean')
    })
    launcher.on('clean_progress', (progress) => {
      send('game:clean_progress', progress)
    })
    launcher.on('clean_end', (info) => {
      logger.log(`Cleaned ${info.amount} files.`)
      send('game:clean_end', info)
    })

    launcher.on('launch_launch', (info) => {
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
      logger.log(`Closed with code ${code}.`)
      endSession()
      send('game:launch_close', code)
    })

    launcher.on('launch_debug', (message) => {
      send('game:launch_debug', message)
    })
    launcher.on('patch_debug', (message) => {
      send('game:patch_debug', message)
    })

    try {
      await launcher.launch()
    } catch (err) {
      logger.error('Launcher error:', err)
    }
  })
}
