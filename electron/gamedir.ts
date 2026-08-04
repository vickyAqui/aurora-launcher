import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PROFILE, ROOT_DIR } from './const'

export function getAppDataDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA || ''
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return os.homedir()
}

export function getServerFolder(serverId: string): string {
  const folder = serverId.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  return path.join(getAppDataDir(), process.platform === 'darwin' ? folder : `.${folder}`)
}

export function getGameDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getServerFolder(ROOT_DIR), slug)
}

export function getScreenshotsDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'screenshots')
}

export function getResourcepacksDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'resourcepacks')
}

export function getShaderpacksDir(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'shaderpacks')
}

export function getOptionsPath(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'options.txt')
}

export function getIrisOptionsPath(slug: string = DEFAULT_PROFILE.slug): string {
  return path.join(getGameDir(slug), 'optionsshaders.txt')
}
