import { ipcMain, app } from 'electron'
import logger from 'electron-log/main'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { MODPACK_URL, DEFAULT_PROFILE } from '../const'
import { getGameDir } from '../gamedir'

export interface IModpackFile {
  name: string
  path: string
  size: number
  sha1: string
  url: string
  type: string
  optional?: boolean
  description?: string
}

export interface IModpackManifest {
  files: IModpackFile[]
  optional_mods?: string[]
}

export interface IModStatus {
  name: string
  filename: string
  sha1: string
  expectedSha1: string | null
  installed: boolean
  valid: boolean
  optional: boolean
  description: string
}

export interface IModsSettings {
  enabledOptionalMods: string[]
}

export const DEFAULT_MODS_SETTINGS: IModsSettings = {
  enabledOptionalMods: []
}

const modsPath = path.join(app.getPath('userData'), 'mods-settings.json')

function getModsDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'mods')
}

function computeSha1(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const stream = fs.createReadStream(filePath)
      const hash = crypto.createHash('sha1')
      stream.on('data', (data) => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

export async function fetchModpack(): Promise<IModpackManifest | null> {
  try {
    const res = await fetch(MODPACK_URL)
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    logger.error('Failed to fetch modpack:', err)
    return null
  }
}

export function loadModsSettings(): IModsSettings {
  try {
    if (fs.existsSync(modsPath)) {
      const data = fs.readFileSync(modsPath, 'utf-8')
      return { ...DEFAULT_MODS_SETTINGS, ...JSON.parse(data) }
    }
  } catch (err) {
    logger.error('Error reading mods settings:', err)
  }
  return DEFAULT_MODS_SETTINGS
}

function saveModsSettings(settings: IModsSettings): boolean {
  try {
    fs.writeFileSync(modsPath, JSON.stringify(settings, null, 2))
    return true
  } catch (err) {
    logger.error('Error writing mods settings:', err)
    return false
  }
}

export function registerModsHandlers() {
  ipcMain.handle('mods:get-modpack', async () => {
    const manifest = await fetchModpack()
    if (!manifest) return null

    const modsSettings = loadModsSettings()
    const modsDir = getModsDir()

    const mods: IModStatus[] = []

    for (const file of manifest.files) {
      if (file.type !== 'MOD') continue

      const isOptional = file.optional === true || manifest.optional_mods?.includes(file.name) === true
      const filePath = path.join(modsDir, file.name)
      const installed = fs.existsSync(filePath)
      let valid = false

      if (installed) {
        const actualSha1 = await computeSha1(filePath)
        valid = actualSha1 === file.sha1
      }

      mods.push({
        name: file.name.replace(/-[\d.]+.*\.jar$/i, '').replace(/_[\d.]+.*\.jar$/i, ''),
        filename: file.name,
        sha1: installed ? (await computeSha1(filePath)) ?? '' : '',
        expectedSha1: file.sha1,
        installed,
        valid,
        optional: isOptional,
        description: file.description ?? ''
      })
    }

    return {
      mods,
      enabledOptionalMods: modsSettings.enabledOptionalMods,
      totalMods: mods.filter((m) => !m.optional).length,
      totalOptional: mods.filter((m) => m.optional).length
    }
  })

  ipcMain.handle('mods:set-optional', async (_event, modName: string, enabled: boolean) => {
    const modsSettings = loadModsSettings()
    if (enabled) {
      if (!modsSettings.enabledOptionalMods.includes(modName)) {
        modsSettings.enabledOptionalMods.push(modName)
      }
    } else {
      modsSettings.enabledOptionalMods = modsSettings.enabledOptionalMods.filter((n) => n !== modName)
    }
    return saveModsSettings(modsSettings)
  })

  ipcMain.handle('mods:verify-integrity', async () => {
    const manifest = await fetchModpack()
    if (!manifest) return { success: false, message: 'Não foi possível carregar o modpack.' }

    const modsDir = getModsDir()
    const results: { filename: string; expected: string; actual: string | null; valid: boolean }[] = []
    let allValid = true

    for (const file of manifest.files) {
      if (file.type !== 'MOD') continue

      const filePath = path.join(modsDir, file.name)
      const installed = fs.existsSync(filePath)

      if (!installed) {
        results.push({ filename: file.name, expected: file.sha1, actual: null, valid: false })
        allValid = false
        continue
      }

      const actualSha1 = await computeSha1(filePath)
      const valid = actualSha1 === file.sha1
      if (!valid) allValid = false

      results.push({ filename: file.name, expected: file.sha1, actual: actualSha1, valid })
    }

    const modpackNames = new Set(manifest.files.filter((f) => f.type === 'MOD').map((f) => f.name))
    let unauthorized: string[] = []

    if (fs.existsSync(modsDir)) {
      const installedFiles = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'))
      unauthorized = installedFiles.filter((f) => !modpackNames.has(f))
    }

    return {
      success: allValid && unauthorized.length === 0,
      totalChecked: results.length,
      valid: results.filter((r) => r.valid).length,
      invalid: results.filter((r) => !r.valid).length,
      unauthorized,
      details: results.filter((r) => !r.valid)
    }
  })

  ipcMain.handle('mods:delete-mod', async (_event, filename: string) => {
    try {
      const modsDir = getModsDir()
      const filePath = path.join(modsDir, filename)

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        return true
      }
      return false
    } catch (err) {
      logger.error('Error deleting mod:', err)
      return false
    }
  })
}

export async function removeDisabledOptionalMods(): Promise<number> {
  const manifest = await fetchModpack()
  if (!manifest) return 0

  const modsSettings = loadModsSettings()
  const enabledSet = new Set(modsSettings.enabledOptionalMods)
  const modsDir = getModsDir()
  let removed = 0

  for (const file of manifest.files) {
    if (file.type !== 'MOD') continue

    const isOptional = file.optional === true || manifest.optional_mods?.includes(file.name) === true
    if (!isOptional) continue

    if (enabledSet.has(file.name)) continue

    const filePath = path.join(modsDir, file.name)
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        removed++
        logger.log(`Removed disabled optional mod: ${file.name}`)
      } catch (err) {
        logger.error(`Failed to remove ${file.name}:`, err)
      }
    }
  }

  return removed
}
