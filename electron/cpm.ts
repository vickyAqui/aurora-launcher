import fs from 'node:fs'
import path from 'node:path'

/** Folder inside the game directory where Customizable Player Models keeps the local models. */
export const CPM_MODELS_DIR = 'player_models'

/** Config file where CPM stores the model it loads when the player joins a server. */
export const CPM_CONFIG_FILE = path.join('config', 'cpm.json')

/** Key of the selected model inside `config/cpm.json`. */
export const CPM_SELECTED_KEY = 'selectedModel'

export interface ICpmModelFile {
  name: string
  size: number
}

/**
 * Whether a name is a model file the game would load.
 *
 * Rejects anything that could point outside `player_models/`: the name comes from the renderer and
 * is later joined with the models folder to open the file.
 */
export function isModelFileName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 200) return false
  if (!name.toLowerCase().endsWith('.cpmmodel')) return false
  return !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
}

/** Lists the `.cpmmodel` files in `dir`, sorted the way a player expects to read them. */
export function listModelFiles(dir: string): ICpmModelFile[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const models: ICpmModelFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isModelFileName(entry.name)) continue

    let size = 0
    try {
      size = fs.statSync(path.join(dir, entry.name)).size
    } catch {
      // A file removed between readdir and stat is simply listed without a size.
    }
    models.push({ name: entry.name, size })
  }

  return models.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

/**
 * Reads `selectedModel` from the raw contents of `cpm.json`.
 *
 * Returns `null` for a missing, empty or corrupt file instead of throwing: the tab has to render
 * even when the player never started the game or when CPM wrote something unexpected.
 */
export function readSelectedModel(raw: string | null): string | null {
  if (!raw) return null

  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null

    const value = (data as Record<string, unknown>)[CPM_SELECTED_KEY]
    return typeof value === 'string' && value.trim() ? value : null
  } catch {
    return null
  }
}

/**
 * Returns the contents of `cpm.json` with `selectedModel` set to `name`, or removed when `name` is
 * `null` (back to the vanilla skin).
 *
 * Every other key is kept as-is: CPM owns that file and the launcher only touches this one field.
 * A corrupt file is replaced by a minimal one, which CPM fills with defaults on the next start.
 */
export function withSelectedModel(raw: string | null, name: string | null): string {
  let data: Record<string, unknown> = {}

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
    } catch {
      // Keep the empty object above; CPM will recreate the missing settings.
    }
  }

  if (name) data[CPM_SELECTED_KEY] = name
  else delete data[CPM_SELECTED_KEY]

  return `${JSON.stringify(data, null, 2)}\n`
}
