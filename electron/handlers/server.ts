import { ipcMain } from 'electron'
import { ServerStatus } from 'eml-lib'
import logger from 'electron-log/main'

export function registerServerHandlers() {
  ipcMain.handle('server:status', async (_event, ip: string, port: number = 25565) => {
    try {
      const server = new ServerStatus(ip, port, 'modern', 774)
      const status = await server.getStatus()
      if (status) return status
    } catch (err) {
      logger.error('Failed to get modern server status:', err)
    }

    try {
      const server = new ServerStatus(ip, port, '1.6', -1, 3)
      return await server.getStatus()
    } catch (err) {
      logger.error('Failed to get legacy server status:', err)
      return null
    }
  })
}

