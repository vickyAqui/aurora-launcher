import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from 'eml-lib'
import {
  addOrActivateAccount,
  loadAccounts,
  parseLegacySession,
  saveAccounts,
  toSummaries,
  type IAccountsFile
} from '../electron/authStore'

let dir: string
let accountsPath: string
let sessionPath: string
let error: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>
let log: { error: (...args: unknown[]) => void }

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aurora-auth-'))
  accountsPath = path.join(dir, 'accounts.json')
  sessionPath = path.join(dir, 'session.json')
  error = vi.fn<(...args: unknown[]) => void>()
  log = { error }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

function account(overrides: Partial<Account> = {}): Account {
  return {
    name: 'Player',
    uuid: '11111111-1111-3111-8111-111111111111',
    accessToken: 'access',
    clientToken: 'client',
    refreshToken: 'refresh',
    meta: { online: true, type: 'msa' },
    ...overrides
  }
}

describe('legacy session migration', () => {
  /**
   * Regression: the single-account launcher wrote the raw Account to session.json, but the
   * migration only looked for `{ account }`. Every user upgrading with a Microsoft login was
   * silently logged out and the old token was left behind on disk.
   */
  it('migrates the raw Account written by the single-account launcher', () => {
    writeFileSync(sessionPath, JSON.stringify(account()))

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].authType).toBe('microsoft')
    expect(store.accounts[0].account.uuid).toBe(account().uuid)
    expect(store.activeId).toBe(store.accounts[0].id)
    expect(existsSync(accountsPath)).toBe(true)
    expect(existsSync(sessionPath)).toBe(false)
    expect(error).not.toHaveBeenCalled()
  })

  it('still reads the wrapped shape and infers crack accounts', () => {
    const crack = account({ meta: { online: false, type: 'crack' }, refreshToken: undefined })
    writeFileSync(sessionPath, JSON.stringify({ account: crack }))

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].authType).toBe('crack')
  })

  it('leaves a file that does not contain an account alone', () => {
    writeFileSync(sessionPath, JSON.stringify({ something: 'else' }))

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.accounts).toHaveLength(0)
    expect(existsSync(sessionPath)).toBe(true)
  })

  it('prefers accounts.json when it exists', () => {
    const current: IAccountsFile = {
      activeId: 'local-id',
      accounts: [{ id: 'local-id', authType: 'microsoft', account: account({ name: 'Current' }) }]
    }
    saveAccounts(accountsPath, current)
    writeFileSync(sessionPath, JSON.stringify(account({ name: 'Old' })))

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].account.name).toBe('Current')
    expect(existsSync(sessionPath)).toBe(true)
  })

  it('does not overwrite accounts.json when it cannot be parsed', () => {
    writeFileSync(accountsPath, '{ not json')
    writeFileSync(sessionPath, JSON.stringify(account()))

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.accounts).toHaveLength(0)
    expect(error).toHaveBeenCalled()
    expect(readFileSync(accountsPath, 'utf-8')).toBe('{ not json')
    expect(existsSync(sessionPath)).toBe(true)
  })

  it('ignores sessions without a uuid', () => {
    expect(parseLegacySession({ name: 'No uuid' })).toBeNull()
    expect(parseLegacySession(null)).toBeNull()
  })
})

describe('accounts store', () => {
  it('round-trips through disk', () => {
    const store: IAccountsFile = {
      activeId: null,
      accounts: [{ id: 'local-id', authType: 'microsoft', account: account() }]
    }
    addOrActivateAccount(store, store.accounts[0])

    saveAccounts(accountsPath, store)

    expect(loadAccounts(accountsPath, sessionPath, log)).toEqual(store)
  })

  it('updates an existing account by uuid instead of adding a duplicate', () => {
    const store: IAccountsFile = { activeId: null, accounts: [] }
    addOrActivateAccount(store, { id: 'first-id', authType: 'microsoft', account: account() })
    addOrActivateAccount(store, {
      id: 'second-id',
      authType: 'microsoft',
      account: account({ accessToken: 'renewed' })
    })

    expect(store.accounts).toHaveLength(1)
    expect(store.activeId).toBe('first-id')
    expect(store.accounts[0].account.accessToken).toBe('renewed')
  })

  it('marks the active account in the summaries the switcher renders', () => {
    const store: IAccountsFile = { activeId: null, accounts: [] }
    addOrActivateAccount(store, { id: 'active-id', authType: 'microsoft', account: account() })
    addOrActivateAccount(store, {
      id: 'other-id',
      authType: 'crack',
      account: account({
        name: 'Offline',
        uuid: '22222222-2222-3222-8222-222222222222',
        meta: { online: false, type: 'crack' }
      })
    })
    addOrActivateAccount(store, { id: 'active-id', authType: 'microsoft', account: account() })

    const summaries = toSummaries(store)

    expect(summaries.find((s) => s.name === 'Player')?.active).toBe(true)
    expect(summaries.find((s) => s.name === 'Offline')?.active).toBe(false)
  })

  it('overwrites an existing accounts file', () => {
    saveAccounts(accountsPath, {
      activeId: 'first',
      accounts: [{ id: 'first', authType: 'microsoft', account: account() }]
    })
    saveAccounts(accountsPath, {
      activeId: 'second',
      accounts: [{ id: 'second', authType: 'crack', account: account({ meta: { online: false, type: 'crack' } }) }]
    })

    const store = loadAccounts(accountsPath, sessionPath, log)

    expect(store.activeId).toBe('second')
    expect(store.accounts).toHaveLength(1)
  })

  it('removes the file when the last account is logged out', () => {
    saveAccounts(accountsPath, {
      activeId: 'local-id',
      accounts: [{ id: 'local-id', authType: 'microsoft', account: account() }]
    })
    expect(existsSync(accountsPath)).toBe(true)

    saveAccounts(accountsPath, { activeId: null, accounts: [] })

    expect(existsSync(accountsPath)).toBe(false)
  })
})
