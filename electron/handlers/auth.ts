import { ipcMain, app } from 'electron'
import { MicrosoftAuth, CrackAuth } from 'eml-lib'
import type { Account } from 'eml-lib'
import logger from 'electron-log/main'
import * as path from 'node:path'
import crypto from 'node:crypto'
import {
  addOrActivateAccount,
  loadAccounts,
  saveAccounts,
  toSummaries,
  type IAccountsFile,
  type ISavedSession
} from '../authStore'

const sessionPath = path.join(app.getPath('userData'), 'session.json')
const accountsPath = path.join(app.getPath('userData'), 'accounts.json')

export type { IAccountSummary } from '../authStore'

export type IAuthResponse = { success: true; account: Account } | { success: false; error: string }

// Instância criada em `registerAuthHandlers`; guardada aqui para que o launcher consiga renovar o
// token da Microsoft pouco antes de abrir o jogo.
let microsoftAuth: MicrosoftAuth | null = null

function readAccounts(): IAccountsFile {
  return loadAccounts(accountsPath, sessionPath, logger)
}

function writeAccounts(store: IAccountsFile): void {
  saveAccounts(accountsPath, store)
}

async function resolveSession(session: ISavedSession, msAuth: MicrosoftAuth): Promise<Account> {
  if (session.authType === 'crack') return session.account

  const valid = await msAuth.validate(session.account)
  if (valid) return session.account
  return await msAuth.refresh(session.account)
}

/**
 * Renova o token de uma conta Microsoft se ele já não servir, e grava a versão nova no
 * `accounts.json`.
 *
 * O token do Minecraft vale ~24h e o launcher pode ficar aberto por dias. Sem isso, o jogo sobe com
 * um token vencido e o jogador só descobre quando o servidor recusa a autenticação.
 */
export async function ensureFreshAccount(account: Account): Promise<Account> {
  if (account.meta.type !== 'msa') return account
  if (!microsoftAuth) throw new Error('Microsoft authentication is not initialized.')

  // A cópia guardada em accounts.json é a fonte da verdade: ela recebe o refresh token novo a cada
  // renovação. O token que o renderer tem em memória pode estar defasado (inclusive o refresh
  // token, se a Microsoft rotacioná-lo), então não dá para renovar a partir dele.
  const store = readAccounts()
  const session = store.accounts.find((s) => s.account.uuid === account.uuid && s.authType === 'microsoft')
  const current = session?.account ?? account

  const valid = await microsoftAuth.validate(current)
  if (valid) return current

  const fresh = await microsoftAuth.refresh(current)
  if (session) {
    session.account = fresh
    writeAccounts(store)
  }

  return fresh
}

export function registerAuthHandlers(mainWindow: Electron.BrowserWindow) {
  const msAuth = new MicrosoftAuth(mainWindow)
  microsoftAuth = msAuth
  const crackAuth = new CrackAuth()

  // Login original com conta Microsoft (premium)
  ipcMain.handle('auth:login', async () => {
    try {
      const account = await msAuth.auth()
      const store = readAccounts()
      addOrActivateAccount(store, { id: crypto.randomUUID(), authType: 'microsoft', account })
      writeAccounts(store)
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
      const store = readAccounts()
      addOrActivateAccount(store, { id: crypto.randomUUID(), authType: 'crack', account })
      writeAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to login (Crack):', err)
      return { success: false, error: err.message ?? 'Unknown error' }
    }
  })

  ipcMain.handle('auth:refresh', async () => {
    const store = readAccounts()
    if (!store.activeId) return { success: false } as { success: false }

    const session = store.accounts.find((a) => a.id === store.activeId)
    if (!session?.account) return { success: false } as { success: false }

    try {
      const account = await resolveSession(session, msAuth)
      session.account = account
      writeAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to refresh session:', err)
      return { success: false, error: err.message } as IAuthResponse
    }
  })

  ipcMain.handle('auth:list', async () => {
    const store = readAccounts()
    return { success: true, accounts: toSummaries(store) }
  })

  ipcMain.handle('auth:select', async (_event, id: string) => {
    const store = readAccounts()
    const session = store.accounts.find((a) => a.id === id)
    if (!session) {
      return { success: false, error: 'Conta não encontrada.' } as IAuthResponse
    }

    try {
      const account = await resolveSession(session, msAuth)
      session.account = account
      store.activeId = id
      writeAccounts(store)
      return { success: true, account } as IAuthResponse
    } catch (err: any) {
      logger.error('Failed to select account:', err)
      return { success: false, error: err.message ?? 'Unknown error' } as IAuthResponse
    }
  })

  ipcMain.handle('auth:logout', async () => {
    const store = readAccounts()
    const idx = store.accounts.findIndex((a) => a.id === store.activeId)
    if (idx >= 0) store.accounts.splice(idx, 1)
    store.activeId = store.accounts[0]?.id ?? null
    writeAccounts(store)
    return { success: true, accounts: toSummaries(store) }
  })
}
