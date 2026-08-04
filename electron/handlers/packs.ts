import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'
import { getIrisOptionsPath, getOptionsPath, getResourcepacksDir, getShaderpacksDir } from '../gamedir'

export interface IPackEntry {
  name: string
  type: 'folder' | 'zip'
  path: string
  enabled: boolean
}

function listPacksInDir(dir: string): { name: string; type: 'folder' | 'zip'; path: string }[] {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')))
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? ('folder' as const) : ('zip' as const),
      path: path.join(dir, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readFileSafe(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
  } catch (err) {
    logger.error(`Error reading ${filePath}:`, err)
    return ''
  }
}

function writeFileSafe(filePath: string, content: string): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    return true
  } catch (err) {
    logger.error(`Error writing ${filePath}:`, err)
    return false
  }
}

function parseQuotedList(value: string): string[] {
  const match = value.match(/"((?:[^"\\]|\\.)*)"/g)
  if (!match) return []
  return match.map((m) => m.replace(/^"|"$/g, ''))
}

function serializeList(items: string[]): string {
  return `["${items.join('","')}"]`
}

function readResourcePacksList(optionsText: string): string[] {
  const line = optionsText.split('\n').find((l) => l.startsWith('resourcePacks:'))
  if (!line) return ['vanilla']
  const value = line.slice('resourcePacks:'.length)
  return parseQuotedList(value)
}

function setResourcePacksList(optionsText: string, list: string[]): string {
  const serialized = serializeList(list)
  const lines = optionsText.split('\n')
  const index = lines.findIndex((l) => l.startsWith('resourcePacks:'))
  if (index !== -1) {
    lines[index] = `resourcePacks:${serialized}`
  } else {
    const nonEmpty = lines.filter((l) => l.trim().length > 0)
    nonEmpty.push(`resourcePacks:${serialized}`)
    return nonEmpty.join('\n')
  }
  return lines.join('\n')
}

function getShaderOptionsPath(): { file: string; readText: string } {
  const irisPath = getIrisOptionsPath()
  const optionsPath = getOptionsPath()

  const irisText = readFileSafe(irisPath)
  if (irisText.includes('shaderPack=')) {
    return { file: irisPath, readText: irisText }
  }

  return { file: optionsPath, readText: readFileSafe(optionsPath) }
}

function readEnabledShader(): { name: string | null; file: string; lineFormat: 'iris' | 'optifine' } {
  const { file, readText } = getShaderOptionsPath()

  if (file === getIrisOptionsPath()) {
    const match = readText.match(/^shaderPack=(.*)$/m)
    const value = match ? match[1].trim() : '(internal)'
    return { name: value === '(internal)' ? null : value, file, lineFormat: 'iris' }
  }

  const match = readText.match(/^shaderPack:(.*)$/m)
  const value = match ? match[1].trim() : ''
  return { name: value || null, file, lineFormat: 'optifine' }
}

function setShaderPack(name: string | null): boolean {
  const enabled = readEnabledShader()
  const targetFile = enabled.file === getIrisOptionsPath() || readFileSafe(getIrisOptionsPath()).includes('shaderPack=') ? getIrisOptionsPath() : getOptionsPath()
  const isIris = targetFile === getIrisOptionsPath()

  const text = readFileSafe(targetFile)
  const lines = text.split('\n')
  const value = name ?? (isIris ? '(internal)' : '')
  const prefix = isIris ? 'shaderPack=' : 'shaderPack:'

  const index = lines.findIndex((l) => l.startsWith(prefix))
  if (index !== -1) {
    lines[index] = `${prefix}${value}`
  } else {
    const nonEmpty = lines.filter((l) => l.trim().length > 0)
    nonEmpty.push(`${prefix}${value}`)
    return writeFileSafe(targetFile, nonEmpty.join('\n'))
  }
  return writeFileSafe(targetFile, lines.join('\n'))
}

export function registerPacksHandlers() {
  ipcMain.handle('packs:list', async () => {
    const resourcePacksDir = getResourcepacksDir()
    const shaderPacksDir = getShaderpacksDir()

    const optionsText = readFileSafe(getOptionsPath())
    const resourceList = readResourcePacksList(optionsText)

    const resourcePacks = listPacksInDir(resourcePacksDir).map((pack) => ({
      ...pack,
      enabled: resourceList.some((entry) => entry.replace(/^file\//, '') === pack.name || entry === pack.name)
    }))

    const enabledShader = readEnabledShader().name
    const shaderPacks = listPacksInDir(shaderPacksDir).map((pack) => ({
      ...pack,
      enabled: enabledShader === pack.name
    }))

    return {
      resourcePacks,
      shaderPacks,
      resourcePacksDir,
      shaderPacksDir
    }
  })

  ipcMain.handle('packs:set_resource_pack', async (_event, name: string, enabled: boolean) => {
    try {
      const optionsPath = getOptionsPath()
      const text = readFileSafe(optionsPath)
      let list = readResourcePacksList(text)

      if (enabled) {
        const formatted = `file/${name}`
        if (!list.some((entry) => entry === formatted || entry === name)) {
          list = list.filter((entry) => entry !== 'vanilla').concat('vanilla', formatted)
        }
      } else {
        list = list.filter((entry) => entry !== `file/${name}` && entry !== name)
      }

      return writeFileSafe(optionsPath, setResourcePacksList(text, list))
    } catch (err) {
      logger.error('Error toggling resource pack:', err)
      return false
    }
  })

  ipcMain.handle('packs:set_shader_pack', async (_event, name: string, enabled: boolean) => {
    try {
      return setShaderPack(enabled ? name : null)
    } catch (err) {
      logger.error('Error toggling shader pack:', err)
      return false
    }
  })

  ipcMain.handle('packs:open_folder', async (_event, dirPath: string) => {
    try {
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
      await shell.openPath(dirPath)
      return true
    } catch (err) {
      logger.error('Error opening packs folder:', err)
      return false
    }
  })

  ipcMain.handle('packs:delete', async (_event, packPath: string) => {
    try {
      const resourcePacksDir = getResourcepacksDir()
      const shaderPacksDir = getShaderpacksDir()
      const allowed = [resourcePacksDir, shaderPacksDir]
      const parent = path.dirname(packPath)

      if (!allowed.includes(parent) || !fs.existsSync(packPath)) return false

      fs.rmSync(packPath, { recursive: true, force: true })
      return true
    } catch (err) {
      logger.error('Error deleting pack:', err)
      return false
    }
  })
}
