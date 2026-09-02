import { ipcMain, app, shell } from 'electron'
import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'

export interface ILogFile {
  name: string
  path: string
  size: number
  modified: number
}

const MAX_LOG_CHARS = 100000

function getLogsDir(): string {
  return app.getPath('userData')
}

function getLogFiles(): ILogFile[] {
  const dir = getLogsDir()
  const logsDir = path.join(dir, 'logs')
  const dirs =
    fs.existsSync(logsDir) && fs.statSync(logsDir).isDirectory()
      ? [{ name: 'logs', dir: logsDir }]
      : []

  const files: ILogFile[] = []
  for (const { name, dir: d } of dirs) {
    let entries: string[] = []
    try {
      entries = fs.readdirSync(d)
    } catch (err) {
      logger.error('Failed to list logs:', err)
      continue
    }
    for (const entry of entries) {
      if (!/\.log$/.test(entry)) continue
      const fullPath = path.join(d, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (!stat.isFile()) continue
        files.push({
          name: `${name}/${entry}`,
          path: fullPath,
          size: stat.size,
          modified: stat.mtimeMs
        })
      } catch {
        // ignore unreadable files
      }
    }
  }
  return files.sort((a, b) => b.modified - a.modified)
}

function readLogTail(filePath: string): string {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return ''
    const fd = fs.openSync(filePath, 'r')
    try {
      const size = stat.size
      const start = Math.max(0, size - MAX_LOG_CHARS)
      const buffer = Buffer.alloc(size - start)
      fs.readSync(fd, buffer, 0, buffer.length, start)
      let text = buffer.toString('utf-8')
      if (start > 0) {
        const firstBreak = text.indexOf('\n')
        text = firstBreak >= 0 ? text.slice(firstBreak + 1) : text
      }
      return text
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    logger.error('Failed to read log:', err)
    return ''
  }
}

export function registerLogsHandlers() {
  ipcMain.handle('logs:list', async (): Promise<ILogFile[]> => {
    return getLogFiles()
  })

  ipcMain.handle('logs:read', async (_event, filePath: string): Promise<string> => {
    return readLogTail(filePath)
  })

  ipcMain.handle('logs:open_folder', async (): Promise<boolean> => {
    try {
      await shell.openPath(getLogsDir())
      return true
    } catch (err) {
      logger.error('Failed to open logs folder:', err)
      return false
    }
  })
}
