import { ipcMain, app } from 'electron'
import { MicrosoftAuth, CrackAuth } from 'eml-lib'
import type { Account } from 'eml-lib'
import logger from 'electron-log/main'
import * as fs from 'node:fs'
import * as path from 'node:path'
import crypto from 'node:crypto'

const sessionPath = path.join(app.getPath('userData'), 'session.json')
const accountsPath = path.join(app.getPath('userData'), 'accounts.json')

export type IAuthResponse = { success: true; account: Account } | { success: false; error: string }

export interface IAccountSummary {
  id: string
  name: string
  uuid: string
  type: Account['meta']['type']
  active: boolean
}

// Guardamos o tipo de login junto da conta, pra saber depois (no refresh) se é
// Microsoft (precisa validar/renovar token) ou Crack (só reaproveita direto).
interface ISavedSession {
  id: string
  authType: 'microsoft' | 'crack'
  account: Account
}

interface IAccountsFile {
  activeId: string | null
  accounts: ISavedSession[]
}

function loadAccounts(): IAccountsFile {
  if (fs.existsSync(accountsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      return { activeId: data.activeId ?? null, accounts: data.accounts ?? [] }
    } catch (err) {
      logger.error('Failed to read accounts file:', err)
    }
  }

  // Migra a sessão única antiga (session.json) para o novo formato.
  if (fs.existsSync(sessionPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
      if (legacy?.account) {
        const session: ISavedSession = {
          id: crypto.randomUUID(),
          authType: legacy.authType ?? 'microsoft',
          account: legacy.account
        }
        const store: IAccountsFile = { activeId: session.id, accounts: [session] }
        fs.writeFileSync(accountsPath, JSON.stringify(store, null, 2))
        fs.unlinkSync(sessionPath)
        return store
      }
    } catch (err) {
      logger.error('Failed to migrate legacy session:', err)
    }
  }

  return { activeId: null, accounts: [] }
}

function saveAccounts(store: IAccountsFile): void {
  if (store.accounts.length === 0) {
    if (fs.existsSync(accountsPath)) fs.unlinkSync(accountsPath)
    return
  }
  fs.writeFileSync(accountsPath, JSON.stringify(store, null, 2))
}

function toSummaries(store: IAccountsFile): IAccountSummary[] {
  return store.accounts.map((s) => ({
    id: s.id,
    name: s.account.name,
    uuid: s.account.uuid,
    type: s.account.meta.type,
    active: s.id === store.activeId
  }))
}

function addOrActivateAccount(store: IAccountsFile, session: ISavedSession): void {
  const existing = store.accounts.find((a) => a.account.uuid === session.account.uuid)
  if (existing) {
    existing.account = session.account
    existing.authType = session.authType
    store.activeId = existing.id
  } else {
    store.accounts.push(session)
    store.activeId = session.id
  }
}

async function resolveSession(session: ISavedSession, msAuth: MicrosoftAuth): Promise<Account> {
  if (session.authType === 'crack') return session.account

  const valid = await msAuth.validate(session.account)
  if (valid) return session.account
  return await msAuth.refresh(session.account)
}

export function registerAuthHandlers(mainWindow: Electron.BrowserWindow) {
  const msAuth = new MicrosoftAuth(mainWindow)
  const crackAuth = new CrackAuth()

  // Login original com conta Microsoft (premium)
  ipcMain.handle('auth:login', async () => {
    try {
      const account = await msAuth.auth()
      const store = loadAccounts()
      addOrActivateAccount(store, { id: crypto.randomUUID(), authType: 'microsoft', account })
      saveAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to login (Microsoft):', err)
      return { success: false, error: err.message ?? 'Unknown error' }
    }
  })

  // login pirata/offline, só com nickname
  ipcMain.handle('auth:login-crack', async (_event, username: string) => {
    try {
      const name = (username ?? '').trim()

      if (name.length < 3 || name.length > 16) {
        return { success: false, error: 'O nickname deve ter entre 3 e 16 caracteres.' } as IAuthResponse
      }

      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
        return { success: false, error: 'O nickname só pode conter letras, números e underscore (_).' } as IAuthResponse
      }

      const account = await crackAuth.auth(name)
      const store = loadAccounts()
      addOrActivateAccount(store, { id: crypto.randomUUID(), authType: 'crack', account })
      saveAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to login (Crack):', err)
      return { success: false, error: err.message ?? 'Unknown error' }
    }
  })

  ipcMain.handle('auth:refresh', async () => {
    const store = loadAccounts()
    if (!store.activeId) return { success: false } as { success: false }

    const session = store.accounts.find((a) => a.id === store.activeId)
    if (!session?.account) return { success: false } as { success: false }

    try {
      const account = await resolveSession(session, msAuth)
      session.account = account
      saveAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to refresh session:', err)
      return { success: false, error: err.message } as IAuthResponse
    }
  })

  ipcMain.handle('auth:list', async () => {
    const store = loadAccounts()
    return { success: true, accounts: toSummaries(store) }
  })

  ipcMain.handle('auth:select', async (_event, id: string) => {
    const store = loadAccounts()
    const session = store.accounts.find((a) => a.id === id)
    if (!session) {
      return { success: false, error: 'Conta não encontrada.' } as IAuthResponse
    }

    try {
      const account = await resolveSession(session, msAuth)
      session.account = account
      store.activeId = id
      saveAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to select account:', err)
      return { success: false, error: err.message ?? 'Unknown error' } as IAuthResponse
    }
  })

  ipcMain.handle('auth:logout', async () => {
    const store = loadAccounts()
    const idx = store.accounts.findIndex((a) => a.id === store.activeId)
    if (idx >= 0) store.accounts.splice(idx, 1)
    store.activeId = store.accounts[0]?.id ?? null
    saveAccounts(store)
    return { success: true, accounts: toSummaries(store) }
  })
}
