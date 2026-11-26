import { ipcMain, app, screen, dialog } from 'electron'
import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { normalizeJvmArgs } from '../../src/jvmArgs'

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

export interface ISystemInfo {
  totalMem: number // in GB
  resolution: {
    width: number
    height: number
  }
  version: string
}

export interface IGameSettings {
  java: string
  javaPath: string
  memory: {
    min: number
    max: number
  }
  resolution: {
    width: number
    height: number
    fullscreen: boolean
  }
  launcherAction: 'close' | 'keep' | 'hide'
  /** Argumentos JVM extras digitados pelo jogador, um por linha. */
  extraJvmArgs: string
}

export const DEFAULT_SETTINGS: IGameSettings = {
  java: 'bundled',
  javaPath: '',
  memory: {
    min: 1,
    max: 4
  },
  resolution: {
    width: 1280,
    height: 720,
    fullscreen: false
  },
  launcherAction: 'close',
  extraJvmArgs: ''
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async () => {
    try {
      if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2))
        return DEFAULT_SETTINGS
      }
      const data = fs.readFileSync(settingsPath, 'utf-8')
      const stored = JSON.parse(data) as Partial<IGameSettings>
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        // settings.json também pode ser editado à mão: filtra de novo na leitura.
        extraJvmArgs: normalizeJvmArgs(stored.extraJvmArgs)
      }
    } catch (err) {
      logger.error('Error reading settings:', err)
      return DEFAULT_SETTINGS
    }
  })

  ipcMain.handle('settings:set', async (_event, newSettings: IGameSettings) => {
    try {
      const toSave: IGameSettings = {
        ...DEFAULT_SETTINGS,
        ...newSettings,
        extraJvmArgs: normalizeJvmArgs(newSettings?.extraJvmArgs)
      }
      fs.writeFileSync(settingsPath, JSON.stringify(toSave, null, 2))
      return true
    } catch (err) {
      logger.error('Error writing settings:', err)
      return false
    }
  })

  ipcMain.handle('system:info', async () => {
    const totalMemBytes = os.totalmem()
    const totalMemGB = Math.round(totalMemBytes / 1024 / 1024 / 1024)

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    return {
      totalMem: totalMemGB,
      resolution: { width, height },
      version: app.getVersion()
    }
  })

  ipcMain.handle('settings:pick_java', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Java Executable', extensions: ['exe', 'bin', ''] }]
    })
    return result.filePaths[0] ?? null
  })
}

