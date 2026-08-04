import { app, BrowserWindow, Menu, nativeTheme, net, protocol, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerAuthHandlers } from './handlers/auth'
import { registerLauncherHandlers } from './handlers/launcher'
import { registerSettingsHandlers } from './handlers/settings'
import { registerServerHandlers } from './handlers/server'
import { registerNewsHandlers } from './handlers/news'
import { registerBackgroundHandlers } from './handlers/background'
import { registerMaintenanceHandlers } from './handlers/maintenance'
import { registerBootstrapHandlers } from './handlers/bootstraps'
import logger from 'electron-log/main'
import { registerProfilesHandlers } from './handlers/profiles'
import { registerSkinHandlers } from './handlers/skin'
import { registerJavaHandlers } from './handlers/java'
import { registerScreenshotsHandlers } from './handlers/screenshots'
import { registerStatsHandlers } from './handlers/stats'
import { registerPacksHandlers } from './handlers/packs'
import { registerUpdateHandlers } from './handlers/update'

const APP_TITLE = 'Aurora Studios'
const BG_COLOR = '#14121c'

let mainWindow: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([
  { scheme: 'screenshot', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } }
])

if (process.env.VITE_DEV_SERVER_URL) {
  app.setName(APP_TITLE)
}

function createWindow() {
  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1000,
    minHeight: 700,
    title: APP_TITLE,
    autoHideMenuBar: true,
    backgroundColor: BG_COLOR,
    show: false,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // mainWindow.removeMenu()

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function configureAppMenu() {
  app.setAboutPanelOptions({
    applicationName: APP_TITLE,
    applicationVersion: app.getVersion(),
    version: 'Build 2026.1',
    copyright: 'Copyright © 2026 Aurora Studios',
    credits: 'Aurora Studios · Powered by EML Lib',
    iconPath: path.join(__dirname, '../build/icon.png')
  })

  const template: any[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),

    {
      label: 'File',
      submenu: [{ role: 'close' }]
    },

    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },

    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  logger.initialize()
  configureAppMenu()

  protocol.handle('screenshot', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      logger.error('Error serving screenshot:', err)
      return new Response(null, { status: 404 })
    }
  })

  createWindow()

  if (mainWindow) {
    registerAuthHandlers(mainWindow)
    registerProfilesHandlers()
    registerServerHandlers()
    registerSkinHandlers()
    registerNewsHandlers()
    registerBackgroundHandlers()
    registerMaintenanceHandlers()
    registerBootstrapHandlers(mainWindow)
    registerLauncherHandlers(mainWindow)
    registerSettingsHandlers()
    registerJavaHandlers()
    registerScreenshotsHandlers()
    registerStatsHandlers()
    registerPacksHandlers()
    registerUpdateHandlers(mainWindow)
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

