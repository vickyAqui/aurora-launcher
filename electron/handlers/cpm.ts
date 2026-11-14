import { app, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { DEFAULT_PROFILE } from '../const'
import { getGameDir } from '../gamedir'
import {
  CPM_CONFIG_FILE,
  CPM_MODELS_DIR,
  CPM_SELECTION_FILE,
  isModelFileName,
  listModelFiles,
  readSelectedModel,
  readSelection,
  withSelectedModel,
  withSelection,
  type ICpmModelFile
} from '../cpm'

export type { ICpmModelFile }

export interface ICpmState {
  models: ICpmModelFile[]
  /** Model shown as active: the launcher choice, or what CPM left in `config/cpm.json`. */
  selected: string | null
  /** Whether the choice came from the launcher and is reapplied before the next launch. */
  savedInLauncher: boolean
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

/** Launcher-side file that keeps the choice even after CPM rewrites `config/cpm.json`. */
function getSelectionPath(): string {
  return path.join(app.getPath('userData'), CPM_SELECTION_FILE)
}

function readConfigRaw(configPath: string): string | null {
  try {
    return fs.readFileSync(configPath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Writes `contents` through a temporary file, so a game reading the config at the same moment
 * never sees a half-written file.
 */
function writeAtomic(filePath: string, contents: string): boolean {
  const tmpPath = `${filePath}.tmp`

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmpPath, contents)
    fs.renameSync(tmpPath, filePath)
    return true
  } catch (err) {
    logger.error(`Error writing ${filePath}:`, err)
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // Nothing else to do: the original file was left untouched.
    }
    return false
  }
}

function readState(slug: string = DEFAULT_PROFILE.slug): ICpmState {
  const modelsDir = getCpmModelsDir(slug)
  const configPath = getCpmConfigPath(slug)
  const raw = readConfigRaw(configPath)
  const selection = readSelection(readConfigRaw(getSelectionPath()), slug)

  return {
    models: listModelFiles(modelsDir),
    // Before the first choice in the launcher, the model CPM loaded last is what the player sees.
    selected: selection.saved ? selection.selected : readSelectedModel(raw),
    savedInLauncher: selection.saved,
    modelsDir,
    configPath,
    configExists: raw !== null
  }
}

/**
 * Writes the model CPM should load on the next join.
 *
 * The choice is kept in the launcher too: CPM owns `config/cpm.json` and rewrites it when the game
 * closes, so `applySelectedModel` puts this value back right before the game starts.
 */
function setSelectedModel(name: string | null, slug: string = DEFAULT_PROFILE.slug): boolean {
  if (name !== null && !isModelFileName(name)) return false

  const modelsDir = getCpmModelsDir(slug)
  if (name !== null && !fs.existsSync(path.join(modelsDir, name))) return false

  // The launcher copy is the source of truth; failing to write it means the choice would be lost.
  if (!writeAtomic(getSelectionPath(), withSelection(readConfigRaw(getSelectionPath()), slug, name))) return false

  const configPath = getCpmConfigPath(slug)
  if (!writeAtomic(configPath, withSelectedModel(readConfigRaw(configPath), name))) {
    // Saved anyway: `applySelectedModel` retries on the next launch.
    logger.warn('CPM: choice saved in the launcher, but config/cpm.json could not be written now.')
  }

  logger.log(`CPM model set to: ${name ?? '(vanilla skin)'}`)
  return true
}

/**
 * Reapplies the model chosen in the launcher to `config/cpm.json`.
 *
 * Called right before the game starts, because CPM rewrites that file when the game closes. Does
 * nothing when the player never chose a model in the launcher, so an in-game choice is respected.
 */
export function applySelectedModel(slug: string = DEFAULT_PROFILE.slug): boolean {
  const selection = readSelection(readConfigRaw(getSelectionPath()), slug)
  if (!selection.saved) return false

  if (selection.selected !== null && !fs.existsSync(path.join(getCpmModelsDir(slug), selection.selected))) {
    logger.warn(`CPM: model "${selection.selected}" is gone from player_models; keeping the current config.`)
    return false
  }

  const configPath = getCpmConfigPath(slug)
  const ok = writeAtomic(configPath, withSelectedModel(readConfigRaw(configPath), selection.selected))
  if (ok) logger.log(`CPM model applied before launch: ${selection.selected ?? '(vanilla skin)'}`)
  return ok
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
        savedInLauncher: false,
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
