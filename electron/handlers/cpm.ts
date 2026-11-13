import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { DEFAULT_PROFILE } from '../const'
import { getGameDir } from '../gamedir'
import {
  CPM_CONFIG_FILE,
  CPM_MODELS_DIR,
  isModelFileName,
  listModelFiles,
  readSelectedModel,
  withSelectedModel,
  type ICpmModelFile
} from '../cpm'

export type { ICpmModelFile }

export interface ICpmState {
  models: ICpmModelFile[]
  /** Model stored in `config/cpm.json`, even when the file no longer exists in `player_models/`. */
  selected: string | null
  modelsDir: string
  configPath: string
  configExists: boolean
}

function getCpmModelsDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), CPM_MODELS_DIR)
}

function getCpmConfigPath(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), CPM_CONFIG_FILE)
}

function readConfigRaw(configPath: string): string | null {
  try {
    return fs.readFileSync(configPath, 'utf8')
  } catch {
    return null
  }
}

function readState(slug: string = DEFAULT_PROFILE.slug): ICpmState {
  const modelsDir = getCpmModelsDir(slug)
  const configPath = getCpmConfigPath(slug)
  const raw = readConfigRaw(configPath)

  return {
    models: listModelFiles(modelsDir),
    selected: readSelectedModel(raw),
    modelsDir,
    configPath,
    configExists: raw !== null
  }
}

/**
 * Writes the model CPM should load on the next join.
 *
 * Only the `selectedModel` key is touched, and the write goes through a temporary file so a game
 * reading `cpm.json` at the same moment never sees a half-written config.
 */
function setSelectedModel(name: string | null, slug: string = DEFAULT_PROFILE.slug): boolean {
  if (name !== null && !isModelFileName(name)) return false

  const modelsDir = getCpmModelsDir(slug)
  if (name !== null && !fs.existsSync(path.join(modelsDir, name))) return false

  const configPath = getCpmConfigPath(slug)
  const next = withSelectedModel(readConfigRaw(configPath), name)
  const tmpPath = `${configPath}.tmp`

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(tmpPath, next)
    fs.renameSync(tmpPath, configPath)
    logger.log(`CPM model set to: ${name ?? '(vanilla skin)'}`)
    return true
  } catch (err) {
    logger.error('Error writing CPM config:', err)
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // Nothing else to do: the original config was left untouched.
    }
    return false
  }
}

export function registerCpmHandlers() {
  ipcMain.handle('cpm:list', async (_event, slug?: string) => {
    try {
      return readState(slug)
    } catch (err) {
      logger.error('Error listing CPM models:', err)
      return {
        models: [],
        selected: null,
        modelsDir: getCpmModelsDir(slug),
        configPath: getCpmConfigPath(slug),
        configExists: false
      } satisfies ICpmState
    }
  })

  ipcMain.handle('cpm:set_model', async (_event, name: string | null, slug?: string) => {
    try {
      return setSelectedModel(name, slug)
    } catch (err) {
      logger.error('Error setting CPM model:', err)
      return false
    }
  })

  ipcMain.handle('cpm:open_folder', async (_event, slug?: string) => {
    try {
      const modelsDir = getCpmModelsDir(slug)
      if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true })
      await shell.openPath(modelsDir)
      return true
    } catch (err) {
      logger.error('Error opening CPM models folder:', err)
      return false
    }
  })
}
