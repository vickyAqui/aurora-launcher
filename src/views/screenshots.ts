import { setView, closeOverlay } from '../state'
import { screenshots } from '../ipc'
import { Dialog } from './dialog'
import type { IScreenshot } from '../../electron/handlers/screenshots'
import logger from 'electron-log/renderer'

const screenshotUrl = (filePath: string) => `screenshot://img/${encodeURIComponent(filePath)}`

let currentList: IScreenshot[] = []
let viewerIndex = 0
let viewerOpen = false

const formatDate = (ts: number) => {
  const date = new Date(ts)
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function initScreenshots() {
  document.getElementById('btn-close-screenshots')?.addEventListener('click', () => {
    closeViewer()
    closeOverlay('screenshots')
  })

  document.getElementById('btn-screenshots-folder')?.addEventListener('click', () => {
    screenshots.openFolder()
  })

  document.getElementById('screenshot-viewer-close')?.addEventListener('click', closeViewer)
  document.getElementById('screenshot-viewer-prev')?.addEventListener('click', () => navigateViewer(-1))
  document.getElementById('screenshot-viewer-next')?.addEventListener('click', () => navigateViewer(1))
  document.getElementById('screenshot-viewer-folder')?.addEventListener('click', () => {
    const current = currentList[viewerIndex]
    if (current) screenshots.reveal(current.path)
  })
  document.getElementById('screenshot-viewer-delete')?.addEventListener('click', deleteCurrent)

  document.addEventListener('keydown', (e) => {
    if (!viewerOpen) return
    if (e.key === 'Escape') closeViewer()
    if (e.key === 'ArrowLeft') navigateViewer(-1)
    if (e.key === 'ArrowRight') navigateViewer(1)
    if (e.key === 'Delete') deleteCurrent()
  })
}

export async function openScreenshots() {
  closeViewer()
  const grid = document.getElementById('screenshots-grid')!
  const empty = document.getElementById('screenshots-empty')!

  grid.innerHTML = '<div class="mods-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Carregando screenshots...</span></div>'

  setView('screenshots')

  try {
    currentList = await screenshots.list()

    if (currentList.length === 0) {
      grid.innerHTML = ''
      empty.classList.remove('hidden')
      return
    }

    empty.classList.add('hidden')
    grid.innerHTML = ''

    for (const shot of currentList) {
      const item = document.createElement('div')
      item.className = 'screenshot-item'
      item.innerHTML = `
        <img src="${screenshotUrl(shot.path)}" alt="${shot.filename}" loading="lazy" />
        <div class="screenshot-item-overlay">
          <span class="screenshot-item-date">${formatDate(shot.modifiedAt)}</span>
          <span class="screenshot-item-name">${shot.filename}</span>
        </div>
      `
      item.addEventListener('click', () => openViewer(currentList.indexOf(shot)))
      grid.appendChild(item)
    }
  } catch (err) {
    logger.error('Error loading screenshots:', err)
    grid.innerHTML = '<div class="mods-error">Erro ao carregar screenshots.</div>'
  }
}

function openViewer(index: number) {
  if (currentList.length === 0) return
  viewerIndex = index
  viewerOpen = true
  renderViewer()
  const viewer = document.getElementById('screenshot-viewer')!
  viewer.classList.remove('hidden')
}

function closeViewer() {
  viewerOpen = false
  const viewer = document.getElementById('screenshot-viewer')!
  viewer.classList.add('hidden')
}

function navigateViewer(direction: number) {
  if (currentList.length === 0) return
  viewerIndex = (viewerIndex + direction + currentList.length) % currentList.length
  renderViewer()
}

function renderViewer() {
  const img = document.getElementById('screenshot-viewer-img') as HTMLImageElement
  const current = currentList[viewerIndex]
  if (!current) return
  img.src = screenshotUrl(current.path)

  const prev = document.getElementById('screenshot-viewer-prev')!
  const next = document.getElementById('screenshot-viewer-next')!
  prev.style.display = currentList.length > 1 ? 'flex' : 'none'
  next.style.display = currentList.length > 1 ? 'flex' : 'none'
}

async function deleteCurrent() {
  const current = currentList[viewerIndex]
  if (!current) return

  const confirmed = await Dialog.show(`Excluir screenshot "${current.filename}"?`, [
    { text: 'Cancelar', type: 'cancel' },
    { text: 'Excluir', type: 'danger' }
  ])

  if (!confirmed) return

  const success = await screenshots.delete(current.path)
  if (!success) {
    await Dialog.show('Não foi possível excluir o screenshot.', [{ text: 'OK', type: 'ok' }])
    return
  }

  currentList.splice(viewerIndex, 1)
  if (currentList.length === 0) {
    closeViewer()
    const grid = document.getElementById('screenshots-grid')!
    const empty = document.getElementById('screenshots-empty')!
    grid.innerHTML = ''
    empty.classList.remove('hidden')
    return
  }

  viewerIndex = Math.min(viewerIndex, currentList.length - 1)
  renderViewer()
}
