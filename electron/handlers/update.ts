import { ipcMain, app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import logger from 'electron-log/main'

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'up-to-date' }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export function registerUpdateHandlers(mainWindow: BrowserWindow) {
  const send = (channel: string, ...args: unknown[]) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' } satisfies UpdateStatus))
  autoUpdater.on('update-available', (info) => send('update:status', { state: 'available', version: info.version } satisfies UpdateStatus))
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'up-to-date' } satisfies UpdateStatus))
  autoUpdater.on('download-progress', (progress) =>
    send(
      'update:progress',
      {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      } satisfies UpdateProgress
    )
  )
  autoUpdater.on('update-downloaded', (info) => send('update:status', { state: 'downloaded', version: info.version } satisfies UpdateStatus))
  autoUpdater.on('error', (err) => {
    logger.error('Update error:', err)
    send('update:status', { state: 'error', message: err.message } satisfies UpdateStatus)
  })

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return { ok: false, dev: true, updateAvailable: false }
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        ok: true,
        updateAvailable: result != null,
        version: result?.updateInfo?.version
      }
    } catch (err) {
      logger.error('Update check failed:', err)
      return { ok: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (err) {
      logger.error('Update download failed:', err)
      return { ok: false, message: (err as Error).message }
    }
  })

  ipcMain.handle('update:install', async () => {
    autoUpdater.quitAndInstall(false, true)
    return { ok: true }
  })
}
