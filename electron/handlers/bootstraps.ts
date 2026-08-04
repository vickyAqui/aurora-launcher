import type Electron from 'electron'
import { ipcMain } from 'electron'

export function registerBootstrapHandlers(_mainWindow: Electron.BrowserWindow) {
  ipcMain.handle('bootstraps:check', async () => ({ updateAvailable: false }))

  ipcMain.handle('bootstraps:download', async () => undefined)

  ipcMain.handle('bootstraps:install', async () => undefined)
}
