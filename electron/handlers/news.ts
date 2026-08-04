import { ipcMain } from 'electron'

export function registerNewsHandlers() {
  ipcMain.handle('news:get_news', async () => [])

  ipcMain.handle('news:get_categories', async () => [])
}
