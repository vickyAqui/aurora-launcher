import type { IGameSettings, ISystemInfo } from '../electron/handlers/settings'
import type { IAuthResponse, IAccountSummary } from '../electron/handlers/auth'
import type { IDetectedJava } from '../electron/handlers/java'
import type { IScreenshot } from '../electron/handlers/screenshots'
import type { IPlayStats } from '../electron/handlers/stats'
import type { IPackEntry } from '../electron/handlers/packs'
import type { UpdateStatus, UpdateProgress } from '../electron/handlers/update'
import type {
  Account,
  BootstrapsEvents,
  CleanerEvents,
  DownloaderEvents,
  FilesManagerEvents,
  IBackground,
  IBootstraps,
  IMaintenance,
  INews,
  IServerStatus,
  INewsCategory,
  JavaEvents,
  LauncherEvents,
  PatcherEvents,
  IProfile,
  ISkin,
  ICape,
  IAvatar
} from 'eml-lib'

declare global {
  interface Window {
    api: {
      auth: {
        login: () => Promise<IAuthResponse>
        loginCrack: (username: string) => Promise<IAuthResponse>
        refresh: () => Promise<IAuthResponse>
        list: () => Promise<{ success: boolean; accounts: IAccountSummary[] }>
        select: (id: string) => Promise<IAuthResponse>
        logout: () => Promise<{ success: boolean; accounts: IAccountSummary[] }>
      }
      skin: {
        reload: (account?: Account) => Promise<void | null>
        getSkin: (account?: Account) => Promise<ISkin[] | null>
        getCape: (account?: Account) => Promise<ICape[] | null>
        getAvatar: (account?: Account) => Promise<IAvatar | null>
        updateSkin: (source: string | ArrayBuffer, model?: 'classic' | 'slim') => Promise<ISkin[] | null>
        // updateCape: (source: string | Blob) => Promise<ICape[] | null> --- Not implemented with Microsoft accounts ---
        switchCape: (id: string) => Promise<ICape[] | null>
        deleteSkin: (id: string) => Promise<ISkin[] | null>
        // deleteCape: () => Promise<ICape[] | null> --- Not implemented with Microsoft accounts ---
        hideCape: () => Promise<ICape[] | null>
      }
      profiles: {
        get: () => Promise<IProfile[]>
      }
      server: {
        getStatus: (ip: string, port?: number) => Promise<IServerStatus | null>
      }
      news: {
        getNews: () => Promise<INews[]>
        getCategories: () => Promise<INewsCategory[]>
      }
      background: {
        get: () => Promise<IBackground | null>
      }
      maintenance: {
        get: () => Promise<IMaintenance | null>
      }
      bootstraps: {
        check: () => Promise<IBootstraps>
        download: () => Promise<string>
        install: () => Promise<void>
        downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => void
        downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => void
        error: (callback: (value: BootstrapsEvents['bootstraps_error'][0]) => void) => void
      }
      game: {
        launch: (payload: { account: Account; settings: IGameSettings, profileSlug: string }) => Promise<void>

        launchComputeDownload: (callback: () => void) => void

        launchDownload: (callback: (value: LauncherEvents['launch_download'][0]) => void) => void
        downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => void
        downloadError: (callback: (value: DownloaderEvents['download_error'][0]) => void) => void
        downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => void

        launchInstallLoader: (callback: (value: LauncherEvents['launch_install_loader'][0]) => void) => void

        launchExtractNatives: (callback: () => void) => void
        extractProgress: (callback: (value: FilesManagerEvents['extract_progress'][0]) => void) => void
        extractEnd: (callback: (value: FilesManagerEvents['extract_end'][0]) => void) => void
        launchCopyAssets: (callback: () => void) => void
        copyProgress: (callback: (value: FilesManagerEvents['copy_progress'][0]) => void) => void
        copyEnd: (callback: (value: FilesManagerEvents['copy_end'][0]) => void) => void

        launchPatchLoader: (callback: () => void) => void
        patchProgress: (callback: (value: PatcherEvents['patch_progress'][0]) => void) => void
        patchError: (callback: (value: PatcherEvents['patch_error'][0]) => void) => void
        patchEnd: (callback: (value: PatcherEvents['patch_end'][0]) => void) => void

        launchCheckJava: (callback: () => void) => void
        javaInfo: (callback: (value: JavaEvents['java_info'][0]) => void) => void

        launchClean: (callback: () => void) => void
        cleanProgress: (callback: (value: CleanerEvents['clean_progress'][0]) => void) => void
        cleanEnd: (callback: (value: CleanerEvents['clean_end'][0]) => void) => void
        launchLaunch: (callback: (value: LauncherEvents['launch_launch'][0]) => void) => void
        launched: (callback: () => void) => void

        launchData: (callback: (value: LauncherEvents['launch_data'][0]) => void) => void
        launchClose: (callback: (value: any) => void) => void
        launchDebug: (callback: (value: LauncherEvents['launch_debug'][0]) => void) => void
        patchDebug: (callback: (value: PatcherEvents['patch_debug'][0]) => void) => void
      }
      settings: {
        get: () => Promise<IGameSettings>
        set: (s: IGameSettings) => Promise<boolean>
        pickJava: () => Promise<string | null>
      }
      system: {
        getInfo: () => Promise<ISystemInfo>
      }
      mods: {
        getModpack: () => Promise<any>
        setOptional: (modName: string, enabled: boolean) => Promise<boolean>
        verifyIntegrity: () => Promise<any>
        deleteMod: (filename: string) => Promise<boolean>
      }
      java: {
        detect: () => Promise<IDetectedJava[]>
      }
      screenshots: {
        list: () => Promise<IScreenshot[]>
        openFolder: () => Promise<boolean>
        reveal: (filePath: string) => Promise<boolean>
        delete: (filePath: string) => Promise<boolean>
      }
      stats: {
        get: () => Promise<IPlayStats>
      }
      packs: {
        list: () => Promise<{ resourcePacks: IPackEntry[]; shaderPacks: IPackEntry[]; resourcePacksDir: string; shaderPacksDir: string }>
        setResourcePack: (name: string, enabled: boolean) => Promise<boolean>
        setShaderPack: (name: string, enabled: boolean) => Promise<boolean>
        openFolder: (dirPath: string) => Promise<boolean>
        delete: (packPath: string) => Promise<boolean>
      }
      update: {
        check: () => Promise<{ ok: boolean; dev?: boolean; message?: string; updateAvailable?: boolean; version?: string }>
        download: () => Promise<{ ok: boolean; message?: string }>
        install: () => Promise<{ ok: boolean }>
        status: (callback: (value: UpdateStatus) => void) => () => void
        progress: (callback: (value: UpdateProgress) => void) => () => void
      }
    }
  }
}

export const auth = {
  login: async () => await window.api.auth.login(),
  loginCrack: async (username: string) => await window.api.auth.loginCrack(username),
  list: async () => await window.api.auth.list(),
  select: async (id: string) => await window.api.auth.select(id),
  logout: async () => await window.api.auth.logout(),
  refresh: async () => await window.api.auth.refresh()
}

export const skin = {
  reload: async (account?: Account) => await window.api.skin.reload(account),
  getSkin: async (account?: Account) => await window.api.skin.getSkin(account),
  getCape: async (account?: Account) => await window.api.skin.getCape(account),
  getAvatar: async (account?: Account) => await window.api.skin.getAvatar(account),
  updateSkin: async (source: string | ArrayBuffer, model: 'classic' | 'slim') => await window.api.skin.updateSkin(source, model),
  // updateCape: async (source: string | Blob) => await window.api.skin.updateCape(source), --- Not implemented with Microsoft accounts ---
  switchCape: async (id: string) => await window.api.skin.switchCape(id),
  deleteSkin: async (id: string) => await window.api.skin.deleteSkin(id),
  // deleteCape: async () => await window.api.skin.deleteCape(), --- Not implemented with Microsoft accounts ---
  hideCape: async () => await window.api.skin.hideCape()
}

export const profiles = {
  get: async () => await window.api.profiles.get()
}

export const server = {
  getStatus: async (ip: string, port?: number) => await window.api.server.getStatus(ip, port)
}

export const news = {
  getNews: async () => await window.api.news.getNews(),
  getCategories: async () => await window.api.news.getCategories()
}

export const background = {
  get: async () => await window.api.background.get()
}

export const maintenance = {
  get: async () => await window.api.maintenance.get()
}

export const bootstraps = {
  check: async () => await window.api.bootstraps.check(),
  download: async () => await window.api.bootstraps.download(),
  install: async () => await window.api.bootstraps.install(),
  downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => window.api.bootstraps.downloadProgress(callback),
  downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => window.api.bootstraps.downloadEnd(callback),
  error: (callback: (value: BootstrapsEvents['bootstraps_error'][0]) => void) => window.api.bootstraps.error(callback)
}

export const game = {
  launch: async (payload: { account: Account; settings: IGameSettings, profileSlug: string }) => await window.api.game.launch(payload),
  launchComputeDownload: (callback: () => void) => window.api.game.launchComputeDownload(callback),
  launchDownload: (callback: (value: LauncherEvents['launch_download'][0]) => void) => window.api.game.launchDownload(callback),
  downloadProgress: (callback: (value: DownloaderEvents['download_progress'][0]) => void) => window.api.game.downloadProgress(callback),
  downloadError: (callback: (value: DownloaderEvents['download_error'][0]) => void) => window.api.game.downloadError(callback),
  downloadEnd: (callback: (value: DownloaderEvents['download_end'][0]) => void) => window.api.game.downloadEnd(callback),
  launchInstallLoader: (callback: (value: LauncherEvents['launch_install_loader'][0]) => void) => window.api.game.launchInstallLoader(callback),
  launchExtractNatives: (callback: () => void) => window.api.game.launchExtractNatives(callback),
  extractProgress: (callback: (value: FilesManagerEvents['extract_progress'][0]) => void) => window.api.game.extractProgress(callback),
  extractEnd: (callback: (value: FilesManagerEvents['extract_end'][0]) => void) => window.api.game.extractEnd(callback),
  launchCopyAssets: (callback: () => void) => window.api.game.launchCopyAssets(callback),
  copyProgress: (callback: (value: FilesManagerEvents['copy_progress'][0]) => void) => window.api.game.copyProgress(callback),
  copyEnd: (callback: (value: FilesManagerEvents['copy_end'][0]) => void) => window.api.game.copyEnd(callback),
  launchPatchLoader: (callback: () => void) => window.api.game.launchPatchLoader(callback),
  patchProgress: (callback: (value: PatcherEvents['patch_progress'][0]) => void) => window.api.game.patchProgress(callback),
  patchError: (callback: (value: PatcherEvents['patch_error'][0]) => void) => window.api.game.patchError(callback),
  patchEnd: (callback: (value: PatcherEvents['patch_end'][0]) => void) => window.api.game.patchEnd(callback),
  launchCheckJava: (callback: () => void) => window.api.game.launchCheckJava(callback),
  javaInfo: (callback: (value: JavaEvents['java_info'][0]) => void) => window.api.game.javaInfo(callback),
  launchClean: (callback: () => void) => window.api.game.launchClean(callback),
  cleanProgress: (callback: (value: CleanerEvents['clean_progress'][0]) => void) => window.api.game.cleanProgress(callback),
  cleanEnd: (callback: (value: CleanerEvents['clean_end'][0]) => void) => window.api.game.cleanEnd(callback),
  launchLaunch: (callback: (value: LauncherEvents['launch_launch'][0]) => void) => window.api.game.launchLaunch(callback),
  launched: (callback: () => void) => window.api.game.launched(callback),
  launchData: (callback: (value: LauncherEvents['launch_data'][0]) => void) => window.api.game.launchData(callback),
  launchClose: (callback: (value: any) => void) => window.api.game.launchClose(callback),
  launchDebug: (callback: (value: LauncherEvents['launch_debug'][0]) => void) => window.api.game.launchDebug(callback),
  patchDebug: (callback: (value: PatcherEvents['patch_debug'][0]) => void) => window.api.game.patchDebug(callback)
}

export const settings = {
  get: () => window.api.settings.get(),
  set: (s: IGameSettings) => window.api.settings.set(s),
  pickJava: () => window.api.settings.pickJava()
}

export const system = {
  getInfo: () => window.api.system.getInfo()
}

export const mods = {
  getModpack: async () => await window.api.mods.getModpack(),
  setOptional: async (modName: string, enabled: boolean) => await window.api.mods.setOptional(modName, enabled),
  verifyIntegrity: async () => await window.api.mods.verifyIntegrity(),
  deleteMod: async (filename: string) => await window.api.mods.deleteMod(filename)
}

export const java = {
  detect: async () => await window.api.java.detect()
}

export const screenshots = {
  list: async () => await window.api.screenshots.list(),
  openFolder: async () => await window.api.screenshots.openFolder(),
  reveal: async (filePath: string) => await window.api.screenshots.reveal(filePath),
  delete: async (filePath: string) => await window.api.screenshots.delete(filePath)
}

export const stats = {
  get: async () => await window.api.stats.get()
}

export const packs = {
  list: async () => await window.api.packs.list(),
  setResourcePack: async (name: string, enabled: boolean) => await window.api.packs.setResourcePack(name, enabled),
  setShaderPack: async (name: string, enabled: boolean) => await window.api.packs.setShaderPack(name, enabled),
  openFolder: async (dirPath: string) => await window.api.packs.openFolder(dirPath),
  delete: async (packPath: string) => await window.api.packs.delete(packPath)
}

export const update = {
  check: () => window.api.update.check(),
  download: () => window.api.update.download(),
  install: () => window.api.update.install(),
  status: (callback: (value: UpdateStatus) => void) => window.api.update.status(callback),
  progress: (callback: (value: UpdateProgress) => void) => window.api.update.progress(callback)
}