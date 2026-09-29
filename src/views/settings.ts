import { setView, closeOverlay } from '../state'
import { settings, system, java, packs, update, logs, mods } from '../ipc'
import { logoutCurrentAccount } from '../account'
import { Dialog } from './dialog'
import { enhanceSelect, type CustomSelect } from './dropdown'
import type { IGameSettings } from '../../electron/handlers/settings'
import type { IDetectedJava } from '../../electron/handlers/java'
import type { IPackEntry } from '../../electron/handlers/packs'
import type { IModEntry } from '../../electron/handlers/mods'
import logger from 'electron-log/renderer'
import { formatRemaining, formatSpeed, formatBytes } from '../format'
import type { UpdateProgress } from '../../electron/handlers/update'

const resolutionList = [
  { label: 'Auto (default)', value: '854x480', width: 854, height: 480 },
  { label: 'Fullscreen', value: 'fullscreen', width: 854, height: 480 },
  { label: '2560x1440 (1440p)', value: '2560x1440', width: 2560, height: 1440 },
  { label: '1920x1080 (1080p)', value: '1920x1080', width: 1920, height: 1080 },
  { label: '1600x900', value: '1600x900', width: 1600, height: 900 },
  { label: '1366x768', value: '1366x768', width: 1366, height: 768 },
  { label: '1280x1024', value: '1280x1024', width: 1280, height: 1024 },
  { label: '1280x720 (720p)', value: '1280x720', width: 1280, height: 720 },
  { label: '1024x768', value: '1024x768', width: 1024, height: 768 },
  { label: '800x600', value: '800x600', width: 800, height: 600 }
]

let currentSettings: IGameSettings
const customSelects = new Map<string, CustomSelect>()

export async function initSettings() {
  const sysInfo = await system.getInfo()
  currentSettings = await settings.get()

  initUIListeners()
  initDualSlider(sysInfo.totalMem)
  initFormValues(sysInfo.resolution)
  enhanceSettingsSelects()
  initJavaDetection()
  initModsTab()
  initPacksTab()
  initUpdateCheck()
  initLogsTab()

  const versionElem = document.getElementById('version')
  if (versionElem) versionElem.innerText = `Aurora Studios v${sysInfo.version}`
}

function enhanceSettingsSelects() {
  for (const id of ['resolution-select', 'launcher-action-select', 'java-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null
    if (el && !customSelects.has(id)) customSelects.set(id, enhanceSelect(el))
  }
}

function initUIListeners() {
  const closeBtn = document.getElementById('btn-close-settings')
  const tabContents = document.querySelectorAll('.tab-content')
  const tabButtons = document.querySelectorAll('.nav-btn')
  const logoutBtn = document.getElementById('btn-logout')

  closeBtn?.addEventListener('click', async () => {
    await saveSettings()
    closeOverlay('settings')
  })

  logoutBtn?.addEventListener('click', async () => {
    if (
      await Dialog.show('Sair da conta?', [
        { text: 'Cancelar', type: 'cancel' },
        { text: 'Sair', type: 'danger' }
      ])
    ) {
      closeOverlay('settings')
      const hasNext = await logoutCurrentAccount()
      if (!hasNext) setView('login')
    }
  })

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const targetTab = btn.getAttribute('data-tab')
      tabContents.forEach((c) => (c.id === `tab-${targetTab}` ? c.classList.add('active') : c.classList.remove('active')))
    })
  })
}

function initDualSlider(maxRamSystem: number) {
  maxRamSystem = Math.min(maxRamSystem, 16)
  const minInput = document.getElementById('ram-min') as HTMLInputElement
  const maxInput = document.getElementById('ram-max') as HTMLInputElement
  const fill = document.getElementById('ram-track-fill')
  const minLabel = document.getElementById('ram-min-label')
  const maxLabel = document.getElementById('ram-max-label')

  if (!minInput || !maxInput || !fill) return

  minInput.max = maxRamSystem.toString()
  maxInput.max = maxRamSystem.toString()

  const gap = 0.5
  const updateSlider = (e?: Event) => {
    let minVal = parseFloat(minInput.value)
    let maxVal = parseFloat(maxInput.value)

    if (maxVal - minVal < gap) {
      if (e?.target === minInput) {
        minInput.value = (maxVal - gap).toString()
        minVal = parseFloat(minInput.value)
      } else {
        maxInput.value = (minVal + gap).toString()
        maxVal = parseFloat(maxInput.value)
      }
    }

    if (minLabel) minLabel.innerText = `${minVal} GB`
    if (maxLabel) maxLabel.innerText = `${maxVal} GB`

    const range = maxRamSystem - parseFloat(minInput.min)
    const minPercent = ((minVal - parseFloat(minInput.min)) / range) * 100
    const maxPercent = ((maxVal - parseFloat(maxInput.min)) / range) * 100

    fill.style.left = `${minPercent}%`
    fill.style.width = `${maxPercent - minPercent}%`
  }

  minInput.addEventListener('input', updateSlider)
  maxInput.addEventListener('input', updateSlider)
  updateSlider()
}

function initFormValues(resolution: { width: number; height: number }) {
  if (!currentSettings) return

  const minInput = document.getElementById('ram-min') as HTMLInputElement
  const maxInput = document.getElementById('ram-max') as HTMLInputElement
  const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement
  const launcherActionSelect = document.getElementById('launcher-action-select') as HTMLSelectElement
  const javaSelect = document.getElementById('java-select') as HTMLSelectElement

  if (minInput) minInput.value = currentSettings.memory.min + ''
  if (maxInput) maxInput.value = currentSettings.memory.max + ''
  if (resolutionSelect) {
    const availableResolutions = getAvailableResolutions(resolution)
    resolutionSelect.innerHTML = ''
    availableResolutions.forEach((res) => {
      const option = document.createElement('option')
      option.value = res.value
      option.innerText = res.label
      resolutionSelect.appendChild(option)
    })

    resolutionSelect.value = currentSettings.resolution.fullscreen
      ? 'fullscreen'
      : `${currentSettings.resolution.width}x${currentSettings.resolution.height}`
  }
  if (launcherActionSelect) launcherActionSelect.value = currentSettings.launcherAction
  if (javaSelect) javaSelect.value = currentSettings.java === 'bundled' || currentSettings.java === 'system' || currentSettings.java === 'path' ? currentSettings.java : 'bundled'

  minInput.dispatchEvent(new Event('input'))
}

async function saveSettings() {
  const minInput = document.getElementById('ram-min') as HTMLInputElement
  const maxInput = document.getElementById('ram-max') as HTMLInputElement
  const launcherActionSelect = document.getElementById('launcher-action-select') as HTMLSelectElement
  const resolutionSelect = document.getElementById('resolution-select') as HTMLSelectElement
  const javaSelect = document.getElementById('java-select') as HTMLSelectElement

  const newSettings: IGameSettings = {
    ...currentSettings,
    memory: {
      min: parseFloat(minInput.value),
      max: parseFloat(maxInput.value)
    },
    resolution: {
      height: resolutionList.find((r) => r.value === resolutionSelect.value)?.height ?? 854,
      width: resolutionList.find((r) => r.value === resolutionSelect.value)?.width ?? 480,
      fullscreen: resolutionSelect.value === 'fullscreen'
    },
    java: javaSelect.value === 'bundled' ? 'bundled' : javaSelect.value === 'system' ? 'system' : 'path',
    javaPath: currentSettings.javaPath,
    launcherAction: launcherActionSelect.value as 'close' | 'keep' | 'hide'
  }

  await settings.set(newSettings)
  currentSettings = newSettings
}

function getAvailableResolutions(systemResolution: { width: number; height: number }) {
  return resolutionList.filter((res) => res.width <= systemResolution.width && res.height <= systemResolution.height)
}

function initJavaDetection() {
  const detectBtn = document.getElementById('btn-detect-java') as HTMLButtonElement
  const pickBtn = document.getElementById('btn-pick-java') as HTMLButtonElement

  detectBtn?.addEventListener('click', () => {
    detectJava()
  })

  pickBtn?.addEventListener('click', async () => {
    const picked = await settings.pickJava()
    if (!picked) return
    currentSettings.javaPath = picked
    customSelects.get('java-select')?.setValue('path')
    detectJava()
  })

  detectJava()
}

async function detectJava() {
  const detectBtn = document.getElementById('btn-detect-java') as HTMLButtonElement
  const original = detectBtn.innerHTML

  detectBtn.disabled = true
  detectBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'

  try {
    const list = await java.detect()
    renderDetectedJava(list)
  } catch (err) {
    logger.error('Error detecting Java:', err)
    renderDetectedJava([])
  } finally {
    detectBtn.disabled = false
    detectBtn.innerHTML = original
  }
}

function renderDetectedJava(list: IDetectedJava[]) {
  const container = document.getElementById('java-detected-list')!
  const status = document.getElementById('java-detected-status')!
  const javaSelect = document.getElementById('java-select') as HTMLSelectElement

  const pathOption = javaSelect.querySelector<HTMLOptionElement>('option[value="path"]')
  if (pathOption && currentSettings.javaPath) {
    const active = list.find((e) => e.path === currentSettings.javaPath)
    pathOption.textContent = active
      ? `Java ${active.version} · ${active.path}`
      : `Java personalizado · ${currentSettings.javaPath}`
  }
  customSelects.get('java-select')?.refresh()

  container.innerHTML = ''

  if (list.length === 0) {
    status.innerText = 'Nenhum Java encontrado no sistema.'
    return
  }

  status.innerText = ''

  for (const entry of list) {
    const item = document.createElement('div')
    item.className = 'java-detected-item'
    if (currentSettings.java === 'path' && currentSettings.javaPath === entry.path) {
      item.classList.add('active')
    }
    item.innerHTML = `
      <div class="java-detected-info">
        <span class="java-detected-version">Java ${entry.version}</span>
        <span class="java-detected-path">${entry.path}</span>
      </div>
      <span class="java-detected-badge">${entry.arch}${entry.fromPath ? ' · PATH' : ''}</span>
    `
    item.addEventListener('click', () => {
      currentSettings.javaPath = entry.path
      customSelects.get('java-select')?.setValue('path')
      renderDetectedJava(list)
    })
    container.appendChild(item)
  }
}

let allMods: IModEntry[] = []

function initModsTab() {
  const searchInput = document.getElementById('mods-search-input') as HTMLInputElement | null
  const openBtn = document.getElementById('btn-open-mods')
  const refreshBtn = document.getElementById('btn-refresh-mods')

  searchInput?.addEventListener('input', () => renderMods())
  openBtn?.addEventListener('click', async () => {
    await mods.openFolder()
  })
  refreshBtn?.addEventListener('click', () => {
    loadMods()
  })

  loadMods()
}

async function loadMods() {
  const container = document.getElementById('mods-list')!

  container.innerHTML = '<div class="mods-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Carregando...</span></div>'

  try {
    const data = await mods.list()
    allMods = data.mods
    renderMods()
  } catch (err) {
    logger.error('Error loading mods:', err)
    container.innerHTML = '<p class="mods-error">Erro ao carregar mods.</p>'
  }
}

function updateModsCount(visible: number = allMods.length) {
  const countEl = document.getElementById('mods-count')
  if (!countEl) return

  const total = allMods.length
  const enabledCount = allMods.filter((mod) => mod.enabled).length
  const scope = visible === total ? `${total} mods` : `${visible} de ${total} mods`

  countEl.innerText = `${scope} · ${enabledCount} ativos`
}

function renderMods() {
  const container = document.getElementById('mods-list')
  if (!container) return

  const searchInput = document.getElementById('mods-search-input') as HTMLInputElement | null
  const term = (searchInput?.value ?? '').trim().toLowerCase()
  const visible = term ? allMods.filter((mod) => mod.name.toLowerCase().includes(term)) : allMods

  updateModsCount(visible.length)

  container.innerHTML = ''

  if (visible.length === 0) {
    container.innerHTML = `<p class="mods-empty">${term ? 'Nenhum mod encontrado.' : 'Nenhum mod no modpack.'}</p>`
    return
  }

  for (const mod of visible) {
    container.appendChild(buildModItem(mod))
  }
}

function buildModItem(mod: IModEntry): HTMLElement {
  const item = document.createElement('div')
  item.className = `mod-item${mod.enabled ? '' : ' disabled'}`

  item.innerHTML = `
    <div class="mod-info">
      <div class="mod-icon">
        <i class="fa-solid fa-cube"></i>
      </div>
      <div class="mod-details">
        <span class="mod-name"></span>
        <span class="mod-filename"></span>
      </div>
    </div>
    <div class="pack-item-actions">
      <label class="mod-toggle" title="${mod.installed ? '' : 'Disponível após o primeiro download do modpack'}">
        <input type="checkbox" ${mod.enabled ? 'checked' : ''} ${mod.installed ? '' : 'disabled'} />
        <span class="mod-toggle-slider"></span>
      </label>
    </div>
  `

  const nameEl = item.querySelector('.mod-name') as HTMLElement
  const filenameEl = item.querySelector('.mod-filename') as HTMLElement
  nameEl.textContent = mod.name

  const refreshFilename = () => {
    const status = !mod.installed ? 'será instalado no próximo início' : mod.enabled ? 'ativo' : 'desativado'
    filenameEl.textContent = `${mod.size ? formatBytes(mod.size) + ' · ' : ''}${status}`
  }
  refreshFilename()

  const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement
  checkbox.addEventListener('change', async () => {
    const ok = await mods.setEnabled(mod.name, checkbox.checked)

    if (!ok) {
      checkbox.checked = !checkbox.checked
      await Dialog.show('Não foi possível alterar este mod.', [{ text: 'OK', type: 'ok' }])
      return
    }

    mod.enabled = checkbox.checked
    item.classList.toggle('disabled', !mod.enabled)
    refreshFilename()
    updateModsCount()
  })

  return item
}

async function initPacksTab() {
  const openResourcepacks = document.getElementById('btn-open-resourcepacks')
  const openShaderpacks = document.getElementById('btn-open-shaderpacks')

  openResourcepacks?.addEventListener('click', async () => {
    const data = await packs.list()
    await packs.openFolder(data.resourcePacksDir)
  })

  openShaderpacks?.addEventListener('click', async () => {
    const data = await packs.list()
    await packs.openFolder(data.shaderPacksDir)
  })

  await loadPacks()
}

async function loadPacks() {
  const resourceList = document.getElementById('resourcepacks-list')!
  const shaderList = document.getElementById('shaderpacks-list')!

  try {
    const data = await packs.list()
    renderPackList(resourceList, data.resourcePacks, 'resource')
    renderPackList(shaderList, data.shaderPacks, 'shader')
  } catch (err) {
    logger.error('Error loading packs:', err)
    resourceList.innerHTML = '<p class="mods-error">Erro ao carregar packs.</p>'
    shaderList.innerHTML = ''
  }
}

function renderPackList(container: HTMLElement, packEntries: IPackEntry[], kind: 'resource' | 'shader') {
  container.innerHTML = ''

  if (packEntries.length === 0) {
    container.innerHTML = `<p class="mods-empty">Nenhum ${kind === 'resource' ? 'resource pack' : 'shader pack'} instalado.</p>`
    return
  }

  for (const pack of packEntries) {
    const item = document.createElement('div')
    item.className = 'mod-item'
    item.innerHTML = `
      <div class="mod-info">
        <div class="mod-icon" style="color: ${pack.type === 'zip' ? 'var(--accent-yellow)' : 'var(--accent-cyan)'}">
          <i class="fa-solid ${pack.type === 'zip' ? 'fa-file-zipper' : 'fa-folder'}"></i>
        </div>
        <div class="mod-details">
          <span class="mod-name">${pack.name}</span>
          <span class="mod-filename">${pack.type === 'zip' ? 'arquivo .zip' : 'pasta'}</span>
        </div>
      </div>
      <div class="pack-item-actions">
        <label class="mod-toggle">
          <input type="checkbox" ${pack.enabled ? 'checked' : ''} />
          <span class="mod-toggle-slider"></span>
        </label>
        <button class="btn btn-ghost btn-delete-pack" title="Excluir">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `

    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement
    checkbox.addEventListener('change', async () => {
      const ok = kind === 'resource' ? await packs.setResourcePack(pack.name, checkbox.checked) : await packs.setShaderPack(pack.name, checkbox.checked)
      if (!ok) {
        checkbox.checked = !checkbox.checked
        await Dialog.show('Não foi possível alterar este pack.', [{ text: 'OK', type: 'ok' }])
      }
    })

    const deleteBtn = item.querySelector('.btn-delete-pack') as HTMLButtonElement
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const confirmed = await Dialog.show(`Excluir "${pack.name}"?`, [
        { text: 'Cancelar', type: 'cancel' },
        { text: 'Excluir', type: 'danger' }
      ])
      if (!confirmed) return

      const ok = await packs.delete(pack.path)
      if (ok) {
        await loadPacks()
      } else {
        await Dialog.show('Não foi possível excluir este pack.', [{ text: 'OK', type: 'ok' }])
      }
    })

    container.appendChild(item)
  }
}

function initUpdateCheck() {
  const checkBtn = document.getElementById('btn-check-update') as HTMLButtonElement
  const statusEl = document.getElementById('update-status')!
  if (!checkBtn) return

  const setStatus = (text: string) => (statusEl.innerText = text)
  const setBusy = (busy: boolean) => {
    checkBtn.disabled = busy
    const icon = checkBtn.querySelector('i')!
    icon.className = busy ? 'fa-fw fa-solid fa-spinner fa-spin' : 'fa-fw fa-solid fa-cloud-arrow-down'
  }

  update.status((status) => {
    if (!status) return
    switch (status.state) {
      case 'checking':
        setStatus('Verificando...')
        break
      case 'available':
        checkBtn.querySelector('span')!.innerText = 'Baixar atualização'
        setStatus(`Versão ${status.version} disponível!`)
        break
      case 'up-to-date':
        checkBtn.querySelector('span')!.innerText = 'Verificar atualização'
        setStatus('Você está na versão mais recente.')
        setBusy(false)
        break
      case 'downloaded':
        checkBtn.querySelector('span')!.innerText = 'Reiniciar agora'
        setStatus(`Versão ${status.version} pronta para instalar.`)
        setBusy(false)
        break
      case 'error':
        checkBtn.querySelector('span')!.innerText = 'Verificar atualização'
        setStatus('Falha ao verificar atualização.')
        setBusy(false)
        break
    }
  })

  update.progress((progress: UpdateProgress) => {
    setBusy(true)
    setStatus(`Baixando... ${progress.percent.toFixed(0)}% · faltam ${formatRemaining(progress.transferred, progress.total)} · ${formatSpeed(progress.bytesPerSecond)}`)
  })

  checkBtn.addEventListener('click', async () => {
    const label = checkBtn.querySelector('span')!.innerText

    if (label === 'Reiniciar agora') {
      await update.install()
      return
    }

    if (label === 'Baixar atualização') {
      setBusy(true)
      setStatus('Preparando download...')
      const res = await update.download()
      if (!res.ok) {
        setBusy(false)
        checkBtn.querySelector('span')!.innerText = 'Verificar atualização'
        setStatus('Não foi possível baixar a atualização.')
      }
      return
    }

    setBusy(true)
    const res = await update.check()
    if (!res.ok) {
      setBusy(false)
      setStatus(res.dev ? 'Indisponível no modo de desenvolvimento.' : 'Falha ao verificar atualização.')
    }
  })
}

function initLogsTab() {
  const openBtn = document.getElementById('btn-open-logs')
  const refreshBtn = document.getElementById('btn-refresh-logs')

  openBtn?.addEventListener('click', async () => {
    await logs.openFolder()
  })

  refreshBtn?.addEventListener('click', () => {
    loadLogFiles()
  })

  loadLogFiles()
}

async function loadLogFiles() {
  const container = document.getElementById('logs-files')!
  const viewerContent = document.getElementById('log-viewer-content')!
  const viewerTitle = document.getElementById('log-viewer-title')!

  try {
    const files = await logs.list()
    container.innerHTML = ''

    if (files.length === 0) {
      container.innerHTML = '<p class="mods-empty">Nenhum arquivo de log encontrado.</p>'
      return
    }

    for (const file of files) {
      const item = document.createElement('button')
      item.className = 'log-file-item'
      const sizeLabel = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`
      item.innerHTML = `
        <i class="fa-fw fa-solid fa-file-lines"></i>
        <span class="log-file-name">${file.name}</span>
        <span class="log-file-size">${sizeLabel}</span>
      `
      item.addEventListener('click', async () => {
        viewerTitle.innerText = file.name
        viewerContent.innerText = 'Carregando...'
        const content = await logs.read(file.path)
        viewerContent.innerText = content || '(log vazio)'
      })
      container.appendChild(item)
    }
  } catch (err) {
    logger.error('Error loading logs:', err)
    container.innerHTML = '<p class="mods-error">Erro ao carregar logs.</p>'
  }
}

