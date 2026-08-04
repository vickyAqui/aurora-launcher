import { ipcMain } from 'electron'

export function registerMaintenanceHandlers() {
  ipcMain.handle('maintenance:get', async () => null)
}
