import { ipcMain, app, screen, dialog } from 'electron'
import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { clampMemoryGB, maxSafeMemoryGB } from '../../src/performancePresets'

const settingsPath = path.join(app.getPath('userData'), 'settings.json')

export interface ISystemInfo {
  totalMem: number // in GB
  /** Heap máximo seguro para esta máquina; o slider nunca deve passar dele. */
  maxMemory: number
  resolution: {
    width: number
    height: number
  }
  version: string
}

function totalMemGB(): number {
  return Math.round(os.totalmem() / 1024 / 1024 / 1024)
}

function safeMemory(memory: IGameSettings['memory']): IGameSettings['memory'] {
  const max = clampMemoryGB(memory.max, totalMemGB())
  const min = Math.min(max, Math.max(0.5, clampMemoryGB(memory.min, totalMemGB())))
  return { min, max }
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
  launcherAction: 'close'
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async () => {
    const defaults: IGameSettings = { ...DEFAULT_SETTINGS, memory: safeMemory(DEFAULT_SETTINGS.memory) }
    try {
      if (!fs.existsSync(settingsPath)) {
        fs.writeFileSync(settingsPath, JSON.stringify(defaults, null, 2))
        return defaults
      }
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Partial<IGameSettings>
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        memory: safeMemory({ ...DEFAULT_SETTINGS.memory, ...(parsed.memory ?? {}) })
      }
    } catch (err) {
      logger.error('Error reading settings:', err)
      return defaults
    }
  })

  ipcMain.handle('settings:set', async (_event, newSettings: IGameSettings) => {
    try {
      const sanitized: IGameSettings = { ...newSettings, memory: safeMemory(newSettings.memory) }
      fs.writeFileSync(settingsPath, JSON.stringify(sanitized, null, 2))
      return true
    } catch (err) {
      logger.error('Error writing settings:', err)
      return false
    }
  })

  ipcMain.handle('system:info', async () => {
    const totalMemBytes = os.totalmem()
    const totalMem = Math.round(totalMemBytes / 1024 / 1024 / 1024)

    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.workAreaSize

    return {
      totalMem,
      maxMemory: maxSafeMemoryGB(totalMem),
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

