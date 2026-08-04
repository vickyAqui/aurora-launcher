import type { Account } from 'eml-lib'
import { setUser } from './state'
import { auth, skin } from './ipc'
import logger from 'electron-log/renderer'

type Listener = () => void
const listeners: Listener[] = []

export function onAccountsChanged(fn: Listener): void {
  listeners.push(fn)
}

function emitAccountsChanged(): void {
  for (const fn of listeners) fn()
}

export async function activateAccount(account: Account): Promise<boolean> {
  try {
    if (account.meta.type === 'crack') {
      await setUser(account, { skins: [], capes: [], avatar: null })
      emitAccountsChanged()
      return true
    }

    try {
      await skin.reload(account)
    } catch (err) {
      logger.warn('Skin reload failed (non-fatal):', err)
    }

    const [skins, capes, avatar] = await Promise.all([
      skin.getSkin().catch((err) => {
        logger.warn('getSkin failed:', err)
        return []
      }),
      skin.getCape().catch((err) => {
        logger.warn('getCape failed:', err)
        return []
      }),
      skin.getAvatar().catch((err) => {
        logger.warn('getAvatar failed:', err)
        return null
      })
    ])

    await setUser(account, { skins, capes, avatar })
    emitAccountsChanged()
    return true
  } catch (err) {
    logger.error('Failed to activate account:', err)
    return false
  }
}

export async function logoutCurrentAccount(): Promise<boolean> {
  try {
    await auth.logout()
    emitAccountsChanged()
  } catch (err) {
    logger.error('Failed to logout:', err)
    return false
  }

  try {
    const session = await auth.refresh()
    if (session.success) {
      return await activateAccount(session.account)
    }
  } catch (err) {
    logger.error('Failed to load next account:', err)
  }

  return false
}
