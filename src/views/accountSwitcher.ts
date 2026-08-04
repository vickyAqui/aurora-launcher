import { setView, getUser } from '../state'
import { auth } from '../ipc'
import { activateAccount, logoutCurrentAccount, onAccountsChanged } from '../account'
import { Dialog } from './dialog'
import logger from 'electron-log/renderer'
import type { IAccountSummary } from '../../electron/handlers/auth'

function avatarInitial(name: string): string {
  return name ? name.charAt(0).toUpperCase() : '?'
}

const TYPE_LABEL: Record<string, string> = {
  msa: 'Microsoft',
  azuriom: 'Conta do servidor',
  yggdrasil: 'Yggdrasil',
  crack: 'Offline'
}

function renderList(accounts: IAccountSummary[], listEl: HTMLElement, activeId: string | null) {
  listEl.innerHTML = ''

  if (accounts.length === 0) {
    listEl.innerHTML = '<div class="account-dropdown-empty">Nenhuma conta salva</div>'
    return
  }

  for (const account of accounts) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'account-dropdown-item' + (account.id === activeId ? ' active' : '')
    item.title = account.name

    const badge = account.type === 'msa' ? '<i class="fa-brands fa-microsoft account-type-icon"></i>' : ''
    const check = account.id === activeId ? '<i class="fa-solid fa-check account-check"></i>' : ''

    item.innerHTML = `
      <span class="account-avatar">${avatarInitial(account.name)}</span>
      <span class="account-meta">
        <span class="account-name">${account.name}</span>
        <span class="account-type">${TYPE_LABEL[account.type] ?? account.type}</span>
      </span>
      ${badge}
      ${check}
    `

    item.addEventListener('click', async () => {
      closeDropdown()
      if (account.id === activeId) return

      const session = await auth.select(account.id)
      if (session.success) {
        await activateAccount(session.account)
      } else {
        logger.error('Failed to switch account:', session.error)
        await Dialog.show(session.error ?? 'Não foi possível trocar de conta.', [{ text: 'OK', type: 'ok' }])
      }
    })

    listEl.appendChild(item)
  }
}

function closeDropdown() {
  document.getElementById('account-switcher')?.classList.remove('open')
}

async function refreshDropdown() {
  const switcher = document.getElementById('account-switcher')
  const listEl = document.getElementById('account-dropdown-list')
  if (!switcher || !listEl) return

  try {
    const result = await auth.list()
    if (!result.success) return
    const user = getUser()
    const activeId = user?.uuid ?? null
    renderList(result.accounts, listEl, activeId)
  } catch (err) {
    logger.error('Failed to list accounts:', err)
  }
}

export function initAccountSwitcher() {
  const switcher = document.getElementById('account-switcher')
  const toggle = document.getElementById('account-switcher-toggle')
  const addBtn = document.getElementById('btn-add-account')
  const logoutBtn = document.getElementById('btn-account-logout')
  const body = document.body

  toggle?.addEventListener('click', (e) => {
    e.stopPropagation()
    switcher?.classList.toggle('open')
    if (switcher?.classList.contains('open')) refreshDropdown()
  })

  body.addEventListener('click', (e) => {
    if (!switcher?.contains(e.target as Node)) closeDropdown()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown()
  })

  addBtn?.addEventListener('click', async () => {
    closeDropdown()
    setView('login')
  })

  logoutBtn?.addEventListener('click', async () => {
    closeDropdown()
    if (
      await Dialog.show('Sair da conta atual?', [
        { text: 'Cancelar', type: 'cancel' },
        { text: 'Sair', type: 'danger' }
      ])
    ) {
      const hasNext = await logoutCurrentAccount()
      if (!hasNext) setView('login')
    }
  })

  onAccountsChanged(() => {
    if (switcher?.classList.contains('open')) refreshDropdown()
  })
}
