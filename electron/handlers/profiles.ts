import { ipcMain } from 'electron'
import { DEFAULT_PROFILE } from '../const'

export function registerProfilesHandlers() {
  ipcMain.handle('profiles:get', async () => {
    return [DEFAULT_PROFILE]
  })
}
