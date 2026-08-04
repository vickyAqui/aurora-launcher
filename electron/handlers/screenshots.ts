import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { getScreenshotsDir } from '../gamedir'

export interface IScreenshot {
  id: string
  filename: string
  path: string
  size: number
  modifiedAt: number
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp']

function listScreenshots(): IScreenshot[] {
  const dir = getScreenshotsDir()
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const screenshots: IScreenshot[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!IMAGE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue

    const filePath = path.join(dir, entry.name)
    try {
      const stat = fs.statSync(filePath)
      screenshots.push({
        id: entry.name,
        filename: entry.name,
        path: filePath,
        size: stat.size,
        modifiedAt: stat.mtimeMs
      })
    } catch (err) {
      logger.error(`Error reading screenshot ${entry.name}:`, err)
    }
  }

  return screenshots.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function registerScreenshotsHandlers() {
  ipcMain.handle('screenshots:list', async () => {
    return listScreenshots()
  })

  ipcMain.handle('screenshots:open_folder', async () => {
    const dir = getScreenshotsDir()
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      await shell.openPath(dir)
      return true
    } catch (err) {
      logger.error('Error opening screenshots folder:', err)
      return false
    }
  })

  ipcMain.handle('screenshots:reveal', async (_event, filePath: string) => {
    try {
      const dir = getScreenshotsDir()
      if (path.dirname(filePath) !== dir || !fs.existsSync(filePath)) return false
      shell.showItemInFolder(filePath)
      return true
    } catch (err) {
      logger.error('Error revealing screenshot:', err)
      return false
    }
  })

  ipcMain.handle('screenshots:delete', async (_event, filePath: string) => {
    try {
      const dir = getScreenshotsDir()
      if (path.dirname(filePath) !== dir || !fs.existsSync(filePath)) return false
      fs.unlinkSync(filePath)
      return true
    } catch (err) {
      logger.error('Error deleting screenshot:', err)
      return false
    }
  })
}
