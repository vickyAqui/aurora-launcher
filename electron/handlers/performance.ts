import { app, ipcMain } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import logger from 'electron-log/main'
import { DEFAULT_PROFILE } from '../const'
import { getGameDir } from '../gamedir'
import { DEFAULT_SETTINGS, type IGameSettings } from './settings'
import {
  applyPerformanceProfile,
  hasSelectedShaderPack,
  listBackupFiles,
  readPerformanceState,
  restorePerformanceProfile,
  type IPerformanceApplyResult,
  type IPerformanceRestoreResult,
  type IPerformanceState
} from '../performance'
import { clampMemoryGB, suggestMemoryGB, type PerformanceProfileId } from '../../src/performancePresets'

export type { IPerformanceApplyResult, IPerformanceRestoreResult, IPerformanceState }

export interface IPerformanceHardware {
  totalMemGB: number
  cores: number
  platform: string
  /** Heap size the launcher recommends for this machine. */
  suggestedMemory: number
}

export interface IPerformanceStateResponse {
  state: IPerformanceState | null
  hardware: IPerformanceHardware
  hasShaderPack: boolean
  gameDirExists: boolean
  /** Files that still have a backup, so Undo is available even if the state file is gone. */
  backups: string[]
  /** RAM currently configured in the Game tab, so the performance tab can show/restore it. */
  currentMemory: { min: number; max: number }
  gameDir: string
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readGameSettings(): IGameSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<IGameSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      memory: { ...DEFAULT_SETTINGS.memory, ...(parsed.memory ?? {}) }
    }
  } catch {
    return { ...DEFAULT_SETTINGS, memory: { ...DEFAULT_SETTINGS.memory } }
  }
}

function writeGameSettings(settings: IGameSettings): boolean {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
    return true
  } catch (err) {
    logger.error('Error writing settings from the performance tab:', err)
    return false
  }
}

export function registerPerformanceHandlers() {
  ipcMain.handle('performance:get', async (_event, slug?: string): Promise<IPerformanceStateResponse> => {
    const targetSlug = slug || DEFAULT_PROFILE.slug
    const gameDir = getGameDir(targetSlug)
    const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024)
    const currentMemory = readGameSettings().memory

    return {
      state: readPerformanceState(app.getPath('userData'), targetSlug),
      hardware: {
        totalMemGB,
        cores: os.cpus().length,
        platform: process.platform,
        suggestedMemory: suggestMemoryGB(totalMemGB)
      },
      hasShaderPack: hasSelectedShaderPack(gameDir),
      gameDirExists: fs.existsSync(gameDir),
      backups: listBackupFiles(gameDir),
      currentMemory,
      gameDir
    }
  })

  ipcMain.handle(
    'performance:apply',
    async (_event, profileId: PerformanceProfileId, memory: number, slug?: string): Promise<IPerformanceApplyResult> => {
      const targetSlug = slug || DEFAULT_PROFILE.slug

      try {
        const userDataDir = app.getPath('userData')
        const previous = readPerformanceState(userDataDir, targetSlug)
        const settings = readGameSettings()
        const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024)

        const result = applyPerformanceProfile({
          gameDir: getGameDir(targetSlug),
          userDataDir,
          slug: targetSlug,
          profileId,
          memory: clampMemoryGB(memory, totalMemGB),
          // The memory from before the first apply is what Undo restores. Applying another profile
          // keeps it, so switching profiles never overwrites the player's original choice.
          previousMemory: previous ? previous.previousMemory : settings.memory
        })

        if (!result.ok) return result

        const heap = result.memory ?? 4
        settings.memory = { min: Math.max(1, Math.floor(heap / 2)), max: heap }
        writeGameSettings(settings)

        logger.log(`Performance profile applied: ${profileId} (${heap} GB heap)`)
        return result
      } catch (err) {
        logger.error('Error applying performance profile:', err)
        return { ok: false, error: err instanceof Error ? err.message : 'Erro ao aplicar o perfil de desempenho' }
      }
    }
  )

  ipcMain.handle('performance:restore', async (_event, slug?: string): Promise<IPerformanceRestoreResult> => {
    const targetSlug = slug || DEFAULT_PROFILE.slug

    try {
      const userDataDir = app.getPath('userData')
      const state = readPerformanceState(userDataDir, targetSlug)
      const result = restorePerformanceProfile(getGameDir(targetSlug), userDataDir, targetSlug)

      if (result.ok && state?.previousMemory) {
        const settings = readGameSettings()
        settings.memory = { ...state.previousMemory }
        writeGameSettings(settings)
      }

      if (result.ok) logger.log(`Performance profile restored (${result.restored.length} file(s)).`)
      return result
    } catch (err) {
      logger.error('Error restoring performance profile:', err)
      return {
        ok: false,
        restored: [],
        error: err instanceof Error ? err.message : 'Erro ao desfazer o perfil de desempenho'
      }
    }
  })
}
