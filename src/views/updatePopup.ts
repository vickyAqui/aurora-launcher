import logger from 'electron-log/renderer'
import { update } from '../ipc'
import type { UpdateStatus } from '../../electron/handlers/update'

let checked = false

interface PopupElements {
  overlay: HTMLElement
  title: HTMLElement
  message: HTMLElement
  progress: HTMLElement
  label: HTMLElement
  percent: HTMLElement
  bar: HTMLElement
  buttons: HTMLElement
}

function els(): PopupElements {
  return {
    overlay: document.getElementById('update-popup')!,
    title: document.getElementById('update-popup-title')!,
    message: document.getElementById('update-popup-message')!,
    progress: document.getElementById('update-popup-progress')!,
    label: document.getElementById('update-popup-label')!,
    percent: document.getElementById('update-popup-percent')!,
    bar: document.getElementById('update-popup-bar') as HTMLElement,
    buttons: document.getElementById('update-popup-buttons')!
  }
}

function hide() {
  const e = els()
  e.overlay.classList.add('hidden')
  e.buttons.innerHTML = ''
}

function renderButtons(e: PopupElements, configs: { text: string; type: 'ok' | 'cancel' | 'danger'; action?: () => void }[]) {
  e.buttons.innerHTML = ''
  for (const cfg of configs) {
    const btn = document.createElement('button')
    btn.innerText = cfg.text
    btn.className = `btn btn-${cfg.type === 'danger' ? 'danger' : 'secondary'}`
    btn.onclick = () => {
      hide()
      cfg.action?.()
    }
    e.buttons.appendChild(btn)
  }
}

function showAvailable(version: string) {
  const e = els()
  e.title.innerText = 'Atualização disponível'
  e.message.innerText = `A versão ${version} está disponível!\nDeseja baixar e instalar agora?`
  e.progress.classList.add('hidden')
  renderButtons(e, [
    { text: 'Agora não', type: 'cancel' },
    { text: 'Baixar agora', type: 'ok', action: () => startDownload() }
  ])
  e.overlay.classList.remove('hidden')
}

function startDownload() {
  const e = els()
  e.message.innerText = ''
  e.progress.classList.remove('hidden')
  e.label.innerText = 'Baixando atualização...'
  e.percent.innerText = '0%'
  e.bar.style.width = '0%'
  renderButtons(e, [])
  e.overlay.classList.remove('hidden')

  const offProgress = update.progress((percent) => {
    e.percent.innerText = `${percent.toFixed(0)}%`
    e.bar.style.width = `${percent}%`
  })
  const offStatus = update.status((status: UpdateStatus | null) => {
    if (!status) return
    if (status.state === 'downloaded') {
      offProgress()
      offStatus()
      showReady(status.version)
    } else if (status.state === 'error') {
      offProgress()
      offStatus()
      showError(status.message)
    }
  })

  const res = update.download()
  res.catch((err) => {
    logger.error('Update download failed:', err)
    offProgress()
    offStatus()
    showError('Falha ao iniciar o download.')
  })
}

function showReady(version?: string) {
  const e = els()
  e.title.innerText = 'Atualização pronta'
  e.message.innerText = `Versão ${version ?? ''} baixada com sucesso.\nReiniciar o launcher agora para instalar?`
  e.progress.classList.add('hidden')
  renderButtons(e, [
    { text: 'Depois', type: 'cancel' },
    { text: 'Reiniciar agora', type: 'ok', action: () => update.install() }
  ])
  e.overlay.classList.remove('hidden')
}

function showError(message?: string) {
  const e = els()
  e.title.innerText = 'Erro na atualização'
  e.message.innerText = message ? `Não foi possível baixar a atualização:\n${message}` : 'Não foi possível baixar a atualização.'
  e.progress.classList.add('hidden')
  renderButtons(e, [{ text: 'Fechar', type: 'ok' }])
  e.overlay.classList.remove('hidden')
}

export async function autoCheckForUpdate() {
  if (checked) return
  checked = true
  if (!document.body.classList.contains('loaded')) return

  try {
    const res = await update.check()
    if (res.ok && res.updateAvailable && res.version) {
      showAvailable(res.version)
    }
  } catch (err) {
    logger.error('Update check failed:', err)
  }
}
