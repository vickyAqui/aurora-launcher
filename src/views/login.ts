import { setView } from '../state'
import { auth } from '../ipc'
import { activateAccount } from '../account'
import { Dialog } from './dialog'
import logger from 'electron-log/renderer'

export function initLogin() {
  initMicrosoftLogin()
  initCrackLogin()
}

function initMicrosoftLogin() {
  const btn = document.getElementById('btn-login-ms') as HTMLButtonElement | null
  if (!btn) return

  btn.addEventListener('click', async () => {
    const originalText = btn.innerHTML

    btn.disabled = true
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Connecting...'

    try {
      const session = await auth.login()
      await handleLoginResult(session)
    } catch (err) {
      logger.error(err)
      await Dialog.show('An error occurred during login.', [{ text: 'OK', type: 'ok' }])
    } finally {
      btn.disabled = false
      btn.innerHTML = originalText
    }
  })
}

function initCrackLogin() {
  const btn = document.getElementById('btn-login-crack') as HTMLButtonElement | null
  const input = document.getElementById('input-crack-username') as HTMLInputElement | null
  if (!btn || !input) return

  const submit = async () => {
    const username = input.value.trim()

    if (!username) {
      await Dialog.show('Digite um nickname para continuar.', [{ text: 'OK', type: 'ok' }])
      return
    }

    const originalText = btn.innerHTML

    btn.disabled = true
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Entrando...'

    try {
      const session = await auth.loginCrack(username)
      await handleLoginResult(session)
    } catch (err) {
      logger.error(err)
      await Dialog.show('An error occurred during login.', [{ text: 'OK', type: 'ok' }])
    } finally {
      btn.disabled = false
      btn.innerHTML = originalText
    }
  }

  btn.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit()
  })
}

async function handleLoginResult(session: Awaited<ReturnType<typeof auth.login>>) {
  if (session.success) {
    await activateAccount(session.account)
    setView('home')
  } else {
    logger.error(session.error)
    await Dialog.show(session.error ?? 'Login failed', [{ text: 'OK', type: 'ok' }])
  }
}