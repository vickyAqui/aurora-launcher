import { contextBridge, ipcRenderer } from 'electron'
import type { IGameSettings, ISystemInfo } from './handlers/settings'
import type { IAuthResponse, IAccountSummary } from './handlers/auth'
import type { IDetectedJava } from './handlers/java'
import type { IPackEntry } from './handlers/packs'
import type { IPlayStats } from './handlers/stats'
import type { IScreenshot } from './handlers/screenshots'
import type {
  Account,
  BootstrapsEvents,
  CleanerEvents,
  DownloaderEvents,
  FilesManagerEvents,
  IAvatar,
  IBootstraps,
  ICape,
  IMaintenance,
  INews,
  IServerStatus,
  ISkin,
  JavaEvents,
  LauncherEvents,
  PatcherEvents
} from 'eml-lib'

console.log('Preload script loaded')

contextBridge.exposeInMainWorld('api', {
  auth: {
    login: (): Promise<IAuthResponse> => ipcRenderer.invoke('auth:login'),
    loginCrack: (username: string): Promise<IAuthResponse> => ipcRenderer.invoke('auth:login-crack', username),
    refresh: (): Promise<IAuthResponse> => ipcRenderer.invoke('auth:refresh'),
    list: (): Promise<{ success: boolean; accounts: IAccountSummary[] }> => ipcRenderer.invoke('auth:list'),
    select: (id: string): Promise<IAuthResponse> => ipcRenderer.invoke('auth:select', id),
    logout: (): Promise<{ success: boolean; accounts: IAccountSummary[] }> => ipcRenderer.invoke('auth:logout')
  },
  profiles: {
    get: (): Promise<any[]> => ipcRenderer.invoke('profiles:get')
  },
  game: {
    launch: (payload: { account: Account; settings: IGameSettings; profileSlug: string }) => {
      ipcRenderer.invoke('game:launch', payload)
    },

    launchComputeDownload: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_compute_download', listener)
      return () => ipcRenderer.removeListener('game:launch_compute_download', listener)
    },

    launchDownload: (callback: (value: LauncherEvents['launch_download'][0]) => void) => {
      const listener = (_event: unknown, value: LauncherEvents['launch_download'][0]) => callback(value)
      ipcRenderer.on('game:launch_download', listener)
      return () => ipcRenderer.removeListener('game:launch_download', listener)
    },
    downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => {
      const listener = (_event: unknown, value: DownloaderEvents['download_progress'][0]) => callback(value)
      ipcRenderer.on('game:download_progress', listener)
      return () => ipcRenderer.removeListener('game:download_progress', listener)
    },
    downloadError: (callback: (value: DownloaderEvents['download_error'][0]) => void) => {
      const listener = (_event: unknown, value: DownloaderEvents['download_error'][0]) => callback(value)
      ipcRenderer.on('game:download_error', listener)
      return () => ipcRenderer.removeListener('game:download_error', listener)
    },
    downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => {
      const listener = (_event: unknown, value: DownloaderEvents['download_end'][0]) => callback(value)
      ipcRenderer.on('game:download_end', listener)
      return () => ipcRenderer.removeListener('game:download_end', listener)
    },

    launchInstallLoader: (callback: (value: LauncherEvents['launch_install_loader'][0]) => void) => {
      const listener = (_event: unknown, value: LauncherEvents['launch_install_loader'][0]) => callback(value)
      ipcRenderer.on('game:launch_install_loader', listener)
      return () => ipcRenderer.removeListener('game:launch_install_loader', listener)
    },

    launchExtractNatives: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_extract_natives', listener)
      return () => ipcRenderer.removeListener('game:launch_extract_natives', listener)
    },
    extractProgress: (callback: (value: FilesManagerEvents['extract_progress'][0]) => void) => {
      const listener = (_event: unknown, value: FilesManagerEvents['extract_progress'][0]) => callback(value)
      ipcRenderer.on('game:extract_progress', listener)
      return () => ipcRenderer.removeListener('game:extract_progress', listener)
    },
    extractEnd: (callback: (value: FilesManagerEvents['extract_end'][0]) => void) => {
      const listener = (_event: unknown, value: FilesManagerEvents['extract_end'][0]) => callback(value)
      ipcRenderer.on('game:extract_end', listener)
      return () => ipcRenderer.removeListener('game:extract_end', listener)
    },
    launchCopyAssets: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_copy_assets', listener)
      return () => ipcRenderer.removeListener('game:launch_copy_assets', listener)
    },
    copyProgress: (callback: (value: FilesManagerEvents['copy_progress'][0]) => void) => {
      const listener = (_event: unknown, value: FilesManagerEvents['copy_progress'][0]) => callback(value)
      ipcRenderer.on('game:copy_progress', listener)
      return () => ipcRenderer.removeListener('game:copy_progress', listener)
    },
    copyEnd: (callback: (value: FilesManagerEvents['copy_end'][0]) => void) => {
      const listener = (_event: unknown, value: FilesManagerEvents['copy_end'][0]) => callback(value)
      ipcRenderer.on('game:copy_end', listener)
      return () => ipcRenderer.removeListener('game:copy_end', listener)
    },
    launchPatchLoader: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_patch_loader', listener)
      return () => ipcRenderer.removeListener('game:launch_patch_loader', listener)
    },
    patchProgress: (callback: (value: PatcherEvents['patch_progress'][0]) => void) => {
      const listener = (_event: unknown, value: PatcherEvents['patch_progress'][0]) => callback(value)
      ipcRenderer.on('game:patch_progress', listener)
      return () => ipcRenderer.removeListener('game:patch_progress', listener)
    },
    patchError: (callback: (value: PatcherEvents['patch_error'][0]) => void) => {
      const listener = (_event: unknown, value: PatcherEvents['patch_error'][0]) => callback(value)
      ipcRenderer.on('game:patch_error', listener)
      return () => ipcRenderer.removeListener('game:patch_error', listener)
    },
    patchEnd: (callback: (value: PatcherEvents['patch_end'][0]) => void) => {
      const listener = (_event: unknown, value: PatcherEvents['patch_end'][0]) => callback(value)
      ipcRenderer.on('game:patch_end', listener)
      return () => ipcRenderer.removeListener('game:patch_end', listener)
    },
    launchCheckJava: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_check_java', listener)
      return () => ipcRenderer.removeListener('game:launch_check_java', listener)
    },
    javaInfo: (callback: (value: JavaEvents['java_info'][0]) => void) => {
      const listener = (_event: unknown, value: JavaEvents['java_info'][0]) => callback(value)
      ipcRenderer.on('game:java_info', listener)
      return () => ipcRenderer.removeListener('game:java_info', listener)
    },

    launchClean: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launch_clean', listener)
      return () => ipcRenderer.removeListener('game:launch_clean', listener)
    },
    cleanProgress: (callback: (value: CleanerEvents['clean_progress'][0]) => void) => {
      const listener = (_event: unknown, value: CleanerEvents['clean_progress'][0]) => callback(value)
      ipcRenderer.on('game:clean_progress', listener)
      return () => ipcRenderer.removeListener('game:clean_progress', listener)
    },
    cleanEnd: (callback: (value: CleanerEvents['clean_end'][0]) => void) => {
      const listener = (_event: unknown, value: CleanerEvents['clean_end'][0]) => callback(value)
      ipcRenderer.on('game:clean_end', listener)
      return () => ipcRenderer.removeListener('game:clean_end', listener)
    },
    launchLaunch: (callback: (value: LauncherEvents['launch_launch'][0]) => void) => {
      const listener = (_event: unknown, value: LauncherEvents['launch_launch'][0]) => callback(value)
      ipcRenderer.on('game:launch_launch', listener)
      return () => ipcRenderer.removeListener('game:launch_launch', listener)
    },
    launched: (callback: () => void) => {
      const listener = (_event: unknown) => callback()
      ipcRenderer.on('game:launched', listener)
      return () => ipcRenderer.removeListener('game:launched', listener)
    },

    launchData: (callback: (value: LauncherEvents['launch_data'][0]) => void) => {
      const listener = (_event: unknown, value: LauncherEvents['launch_data'][0]) => callback(value)
      ipcRenderer.on('game:launch_data', listener)
      return () => ipcRenderer.removeListener('game:launch_data', listener)
    },
    launchClose: (callback: (value: any) => void) => {
      const listener = (_event: unknown, value: any) => callback(value)
      ipcRenderer.on('game:launch_close', listener)
      return () => ipcRenderer.removeListener('game:launch_close', listener)
    },
    launchDebug: (callback: (value: LauncherEvents['launch_debug'][0]) => void) => {
      const listener = (_event: unknown, value: LauncherEvents['launch_debug'][0]) => callback(value)
      ipcRenderer.on('game:launch_debug', listener)
      return () => ipcRenderer.removeListener('game:launch_debug', listener)
    },
    patchDebug: (callback: (value: PatcherEvents['patch_debug'][0]) => void) => {
      const listener = (_event: unknown, value: PatcherEvents['patch_debug'][0]) => callback(value)
      ipcRenderer.on('game:patch_debug', listener)
      return () => ipcRenderer.removeListener('game:patch_debug', listener)
    }
  },
  skin: {
    reload: (account: Account): Promise<void | null> => ipcRenderer.invoke('skin:reload', account),
    getSkin: (account?: Account): Promise<ISkin[] | null> => ipcRenderer.invoke('skin:get_skin', account),
    getCape: (account?: Account): Promise<ICape[] | null> => ipcRenderer.invoke('skin:get_cape', account),
    getAvatar: (account?: Account): Promise<IAvatar | null> => ipcRenderer.invoke('skin:get_avatar', account),
    updateSkin: (source: string | Blob, model?: 'classic' | 'slim'): Promise<ISkin[] | null> => ipcRenderer.invoke('skin:update_skin', source, model),
    // updateCape: (source: string | Blob): Promise<ICape[] | null> => ipcRenderer.invoke('skin:update_cape', source), --- Not implemented with Microsoft accounts ---
    switchCape: (id: string): Promise<ICape[] | null> => ipcRenderer.invoke('skin:switch_cape', id),
    deleteSkin: (id: string): Promise<ISkin[] | null> => ipcRenderer.invoke('skin:delete_skin', id),
    // deleteCape: (): Promise<ICape[] | null> => ipcRenderer.invoke('skin:delete_cape'), --- Not implemented with Microsoft accounts ---
    hideCape: (): Promise<ICape[] | null> => ipcRenderer.invoke('skin:hide_cape')
  },
  server: {
    getStatus: (ip: string, port?: number): Promise<IServerStatus> => ipcRenderer.invoke('server:status', ip, port)
  },
  news: {
    getNews: (): Promise<INews[]> => ipcRenderer.invoke('news:get_news'),
    getCategories: (): Promise<any[]> => ipcRenderer.invoke('news:get_categories')
  },
  maintenance: {
    get: (): Promise<IMaintenance | null> => ipcRenderer.invoke('maintenance:get')
  },
  bootstraps: {
    check: (): Promise<IBootstraps> => ipcRenderer.invoke('bootstraps:check'),
    download: (): Promise<string> => ipcRenderer.invoke('bootstraps:download'),
    install: (): Promise<void> => ipcRenderer.invoke('bootstraps:install'),
    downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => {
      const listener = (_event: unknown, value: DownloaderEvents['download_progress'][0]) => callback(value)
      ipcRenderer.on('bootstraps:download_progress', listener)
      return () => ipcRenderer.removeListener('bootstraps:download_progress', listener)
    },
    downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => {
      const listener = (_event: unknown, value: DownloaderEvents['download_end'][0]) => callback(value)
      ipcRenderer.on('bootstraps:download_end', listener)
      return () => ipcRenderer.removeListener('bootstraps:download_end', listener)
    },
    error: (callback: (value: BootstrapsEvents['bootstraps_error'][0]) => void) => {
      const listener = (_event: unknown, value: BootstrapsEvents['bootstraps_error'][0]) => callback(value)
      ipcRenderer.on('bootstraps:error', listener)
      return () => ipcRenderer.removeListener('bootstraps:error', listener)
    }
  },
  settings: {
    get: (): Promise<IGameSettings> => ipcRenderer.invoke('settings:get'),
    set: (s: IGameSettings): Promise<boolean> => ipcRenderer.invoke('settings:set', s),
    pickJava: (): Promise<string | null> => ipcRenderer.invoke('settings:pick_java')
  },
  system: {
    getInfo: (): Promise<ISystemInfo> => ipcRenderer.invoke('system:info')
  },
  java: {
    detect: (): Promise<IDetectedJava[]> => ipcRenderer.invoke('java:detect')
  },
  screenshots: {
    list: (): Promise<IScreenshot[]> => ipcRenderer.invoke('screenshots:list'),
    openFolder: (): Promise<boolean> => ipcRenderer.invoke('screenshots:open_folder'),
    reveal: (filePath: string): Promise<boolean> => ipcRenderer.invoke('screenshots:reveal', filePath),
    delete: (filePath: string): Promise<boolean> => ipcRenderer.invoke('screenshots:delete', filePath)
  },
  stats: {
    get: (): Promise<IPlayStats> => ipcRenderer.invoke('stats:get')
  },
  packs: {
    list: (): Promise<{ resourcePacks: IPackEntry[]; shaderPacks: IPackEntry[]; resourcePacksDir: string; shaderPacksDir: string }> =>
      ipcRenderer.invoke('packs:list'),
    setResourcePack: (name: string, enabled: boolean): Promise<boolean> => ipcRenderer.invoke('packs:set_resource_pack', name, enabled),
    setShaderPack: (name: string, enabled: boolean): Promise<boolean> => ipcRenderer.invoke('packs:set_shader_pack', name, enabled),
    openFolder: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('packs:open_folder', dirPath),
    delete: (packPath: string): Promise<boolean> => ipcRenderer.invoke('packs:delete', packPath)
  },
  update: {
    check: (): Promise<{ ok: boolean; dev?: boolean; message?: string; updateAvailable?: boolean; version?: string }> => ipcRenderer.invoke('update:check'),
    download: (): Promise<{ ok: boolean; message?: string }> => ipcRenderer.invoke('update:download'),
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:install'),
    status: (callback: (value: any) => void) => {
      const listener = (_event: unknown, value: any) => callback(value)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.removeListener('update:status', listener)
    },
    progress: (callback: (value: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => {
      const listener = (_event: unknown, value: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => callback(value)
      ipcRenderer.on('update:progress', listener)
      return () => ipcRenderer.removeListener('update:progress', listener)
    }
  }
})