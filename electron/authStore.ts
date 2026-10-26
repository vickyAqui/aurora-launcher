import crypto from 'node:crypto'
import * as fs from 'node:fs'
import type { Account } from 'eml-lib'

/**
 * Persistence for `accounts.json` (and the legacy single-account `session.json`).
 *
 * Deliberately free of Electron imports: the migration from the old session file is the part most
 * likely to break silently, so it can be exercised by the test suite without booting Electron.
 */

export interface IAccountSummary {
  id: string
  name: string
  uuid: string
  type: Account['meta']['type']
  active: boolean
}

// Guardamos o tipo de login junto da conta, pra saber depois (no refresh) se é
// Microsoft (precisa validar/renovar token) ou Crack (só reaproveita direto).
export interface ISavedSession {
  id: string
  authType: 'microsoft' | 'crack'
  account: Account
}

export interface IAccountsFile {
  activeId: string | null
  accounts: ISavedSession[]
}

export interface IAccountStoreLogger {
  error: (...args: unknown[]) => void
}

/**
 * Reads a session written by the single-account launcher.
 *
 * Builds before the multi-account store wrote the raw `Account` to `session.json`; the migration
 * here originally looked only for `{ account }`, so every existing login was dropped on upgrade.
 * Both shapes are accepted, and `authType` is inferred when the file predates it.
 */
export function parseLegacySession(raw: unknown): ISavedSession | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown> & { account?: Account; authType?: unknown }

  // `{ account, authType }` (intermediate builds) or the raw Account (older builds).
  const account = (record.account ?? record) as Account | undefined
  if (!account || typeof account.uuid !== 'string' || !account.uuid) return null

  const authType: ISavedSession['authType'] =
    record.authType === 'crack' || record.authType === 'microsoft'
      ? record.authType
      : account.meta?.type === 'crack'
        ? 'crack'
        : 'microsoft'

  return { id: crypto.randomUUID(), authType, account }
}

function isSavedSession(value: unknown): value is ISavedSession {
  const session = value as ISavedSession
  return (
    !!session &&
    typeof session.id === 'string' &&
    !!session.account &&
    typeof session.account.uuid === 'string' &&
    typeof session.account.name === 'string'
  )
}

export function loadAccounts(accountsPath: string, legacySessionPath: string, log: IAccountStoreLogger): IAccountsFile {
  if (fs.existsSync(accountsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'))
      const accounts = Array.isArray(data?.accounts) ? data.accounts.filter(isSavedSession) : []
      return { activeId: data?.activeId ?? null, accounts }
    } catch (err) {
      // Do not fall through to the legacy migration: that would overwrite a file we failed to
      // read, taking every other account with it.
      log.error('Failed to read accounts file:', err)
      return { activeId: null, accounts: [] }
    }
  }

  // Migra a sessão única antiga (session.json) para o novo formato.
  if (fs.existsSync(legacySessionPath)) {
    try {
      const session = parseLegacySession(JSON.parse(fs.readFileSync(legacySessionPath, 'utf-8')))
      if (session) {
        const store: IAccountsFile = { activeId: session.id, accounts: [session] }
        saveAccounts(accountsPath, store)
        fs.unlinkSync(legacySessionPath)
        return store
      }
    } catch (err) {
      log.error('Failed to migrate legacy session:', err)
    }
  }

  return { activeId: null, accounts: [] }
}

export function saveAccounts(accountsPath: string, store: IAccountsFile): void {
  if (store.accounts.length === 0) {
    if (fs.existsSync(accountsPath)) fs.unlinkSync(accountsPath)
    return
  }

  // Write-then-rename: a crash mid-write would otherwise leave a truncated JSON behind, which
  // `loadAccounts` treats as "no accounts" and every saved login is gone.
  const tmpPath = `${accountsPath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2))
  fs.renameSync(tmpPath, accountsPath)
}

export function toSummaries(store: IAccountsFile): IAccountSummary[] {
  return store.accounts.map((s) => ({
    id: s.id,
    name: s.account.name,
    uuid: s.account.uuid,
    type: s.account.meta.type,
    active: s.id === store.activeId
  }))
}

export function addOrActivateAccount(store: IAccountsFile, session: ISavedSession): void {
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
