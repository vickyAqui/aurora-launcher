import { setView, closeOverlay } from '../state'
import { settings, system, skin, mods, java, packs, update } from '../ipc'
import { logoutCurrentAccount } from '../account'
import { Dialog } from './dialog'
import { enhanceSelect, type CustomSelect } from './dropdown'
import type { IGameSettings } from '../../electron/handlers/settings'
import type { IDetectedJava } from '../../electron/handlers/java'
import type { IPackEntry } from '../../electron/handlers/packs'
import shared from '../shared'
import logger from 'electron-log/renderer'

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
  initModsTab()
  initJavaDetection()
  initPacksTab()
  initUpdateCheck()

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

  const addSkinUrlBtn = document.getElementById('btn-add-skin-url')!
  const addSkinFileBtn = document.getElementById('btn-add-skin-file')!

  const addSkinFileForm = document.getElementById('form-add-skin-file')!
  const addSkinFileInput = document.getElementById('input-add-skin-file') as HTMLInputElement
  const addSkinFileButton = document.getElementById('btn-add-skin-choose-file') as HTMLButtonElement
  const addSkinFileSelectedDiv = document.getElementById('div-add-skin-file-selected')!
  const addSkinFileSelectedName = document.getElementById('span-add-skin-file-name')!
  const addSkinFileResetBtn = document.getElementById('btn-selected-file-reset') as HTMLButtonElement

  const addSkinUrlForm = document.getElementById('form-add-skin-url')!
  const addSkinUrlInput = document.getElementById('input-add-skin-url') as HTMLInputElement

  const addSkinSubmitBtn = document.getElementById('btn-add-skin-submit') as HTMLButtonElement

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

  addSkinUrlBtn?.addEventListener('click', () => {
    addSkinUrlBtn!.classList.add('active')
    addSkinFileBtn!.classList.remove('active')
    addSkinUrlForm!.style.display = 'block'
    addSkinFileForm!.style.display = 'none'
    addSkinFileInput.value = ''
    addSkinUrlInput.value = ''
    addSkinFileSelectedDiv.style.display = 'none'
    addSkinFileButton.style.display = 'block'
    addSkinSubmitBtn.disabled = true
  })

  addSkinFileBtn?.addEventListener('click', () => {
    addSkinFileBtn!.classList.add('active')
    addSkinUrlBtn!.classList.remove('active')
    addSkinUrlForm!.style.display = 'none'
    addSkinFileForm!.style.display = 'block'
    addSkinUrlInput.value = ''
    addSkinFileInput.value = ''
    addSkinFileSelectedDiv.style.display = 'none'
    addSkinFileButton.style.display = 'block'
    addSkinSubmitBtn.disabled = true
  })

  addSkinFileButton?.addEventListener('click', async () => {
    addSkinFileInput.click()
  })

  addSkinFileInput?.addEventListener('change', async () => {
    const file = addSkinFileInput.files?.[0]
    if (!file) {
      addSkinFileButton.style.display = 'block'
      addSkinSubmitBtn.disabled = true
      addSkinFileSelectedDiv.style.display = 'none'
      return
    }

    addSkinFileButton.style.display = 'none'
    addSkinSubmitBtn.disabled = false
    addSkinFileSelectedName.innerText = file.name
    addSkinFileSelectedDiv.style.display = 'block'
  })

  addSkinUrlInput?.addEventListener('input', () => {
    addSkinSubmitBtn.disabled = addSkinUrlInput.value.trim() === ''
  })

  addSkinFileResetBtn?.addEventListener('click', () => {
    addSkinFileInput.value = ''
    addSkinFileButton.style.display = 'block'
    addSkinSubmitBtn.disabled = true
    addSkinFileSelectedDiv.style.display = 'none'
  })

  addSkinSubmitBtn?.addEventListener('click', async () => {
    addSkin()
    addSkinUrlInput.value = ''
    addSkinFileInput.value = ''
    addSkinFileButton.style.display = 'block'
    addSkinSubmitBtn.disabled = true
    addSkinFileSelectedDiv.style.display = 'none'
    document.getElementById('settings-content')?.scrollTo({ top: 0, behavior: 'smooth' })
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

async function addSkin() {
  const addSkinUrlBtn = document.getElementById('btn-add-skin-url')!
  const addSkinFileBtn = document.getElementById('btn-add-skin-file')!
  const addSkinFileInput = document.getElementById('input-add-skin-file') as HTMLInputElement
  const addSkinUrlInput = document.getElementById('input-add-skin-url') as HTMLInputElement
  const addSkinSlimVariant = document.getElementById('input-add-skin-variant-slim') as HTMLInputElement

  let skinSource: string | ArrayBuffer | null = null
  let variant: 'classic' | 'slim' = 'classic'

  if (addSkinUrlBtn.classList.contains('active')) {
    skinSource = addSkinUrlInput.value.trim()
  } else if (addSkinFileBtn.classList.contains('active')) {
    const file = addSkinFileInput.files?.[0]
    if (file) {
      skinSource = await file.arrayBuffer()
    }
  }

  if (!skinSource) return

  if (addSkinSlimVariant.checked) variant = 'slim'

  try {
    const result = await skin.updateSkin(skinSource, variant)
    if (!result) {
      await Dialog.show('Failed to add skin. Please check the URL or file and try again.', [{ text: 'Close', type: 'ok' }])
      return
    }

    shared.skins = result
    shared.resetMainView()
    shared.resetSkinViews()
  } catch (err) {
    await Dialog.show('An error occurred while adding the skin. Please try again in few minutes.', [{ text: 'Close', type: 'ok' }])
    return
  }
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
        <button class="btn btn-secondary btn-delete-pack" title="Excluir">
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

async function initModsTab() {
  const modsList = document.getElementById('mods-list')!
  const verifyBtn = document.getElementById('btn-verify-integrity')!

  try {
    const modpack = await mods.getModpack()
    if (!modpack) {
      modsList.innerHTML = '<p class="mods-error">Não foi possível carregar a lista de mods.</p>'
      return
    }

    const { mods: modEntries, enabledOptionalMods, totalMods, totalOptional } = modpack

    if (totalOptional === 0) {
      modsList.innerHTML = '<p class="mods-empty">Nenhum mod opcional disponível no momento.</p>'
      return
    }

    modsList.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'mods-list-header'
    header.innerHTML = `
      <span class="mods-count">${totalMods} mods principais</span>
      <span class="mods-count">${totalOptional} opcionais</span>
    `
    modsList.appendChild(header)

    const optionalMods = modEntries.filter((m: any) => m.optional)

    for (const mod of optionalMods) {
      const isEnabled = enabledOptionalMods.includes(mod.filename)
      const modItem = createModItem(mod, isEnabled)
      modsList.appendChild(modItem)
    }
  } catch (err) {
    modsList.innerHTML = '<p class="mods-error">Erro ao carregar mods.</p>'
  }

  verifyBtn.addEventListener('click', verifyIntegrity)
}

function createModItem(mod: any, isEnabled: boolean): HTMLElement {
  const item = document.createElement('div')
  item.className = 'mod-item'
  item.dataset.filename = mod.filename

  const iconClass = mod.valid ? 'fa-cube' : 'fa-triangle-exclamation'
  const iconColor = mod.valid ? 'var(--accent-green)' : 'var(--accent-pink)'

  item.innerHTML = `
    <div class="mod-info">
      <div class="mod-icon" style="color: ${iconColor}">
        <i class="fa-solid ${iconClass}"></i>
      </div>
      <div class="mod-details">
        <span class="mod-name">${mod.name}</span>
        <span class="mod-filename">${mod.filename}</span>
        ${mod.description ? `<span class="mod-description">${mod.description}</span>` : ''}
      </div>
    </div>
    <label class="mod-toggle">
      <input type="checkbox" ${isEnabled ? 'checked' : ''} />
      <span class="mod-toggle-slider"></span>
    </label>
  `

  const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement
  checkbox.addEventListener('change', async () => {
    await mods.setOptional(mod.filename, checkbox.checked)
  })

  return item
}

async function verifyIntegrity() {
  const verifyBtn = document.getElementById('btn-verify-integrity')!
  const integrityStatus = document.getElementById('integrity-status')!
  const integrityResults = document.getElementById('integrity-results')!
  const integrityDetails = document.getElementById('integrity-details')!

  verifyBtn.classList.add('loading')
  verifyBtn.setAttribute('disabled', 'true')
  integrityStatus.textContent = 'Verificando...'
  integrityStatus.className = 'integrity-status checking'

  try {
    const result = await mods.verifyIntegrity()

    if (!result.success) {
      integrityStatus.textContent = `${result.invalid} arquivo(s) inválido(s) encontrado(s)`
      integrityStatus.className = 'integrity-status danger'
    } else {
      integrityStatus.textContent = 'Todos os arquivos estão íntegros'
      integrityStatus.className = 'integrity-status success'
    }

    integrityResults.classList.remove('hidden')
    integrityDetails.innerHTML = ''

    const summary = document.createElement('div')
    summary.className = 'integrity-summary'
    summary.innerHTML = `
      <div class="integrity-stat">
        <span class="integrity-stat-value">${result.totalChecked}</span>
        <span class="integrity-stat-label">Verificados</span>
      </div>
      <div class="integrity-stat">
        <span class="integrity-stat-value success">${result.valid}</span>
        <span class="integrity-stat-label">Válidos</span>
      </div>
      <div class="integrity-stat">
        <span class="integrity-stat-value danger">${result.invalid}</span>
        <span class="integrity-stat-label">Inválidos</span>
      </div>
      ${result.unauthorized.length > 0 ? `
        <div class="integrity-stat">
          <span class="integrity-stat-value warning">${result.unauthorized.length}</span>
          <span class="integrity-stat-label">Não autorizados</span>
        </div>
      ` : ''}
    `
    integrityDetails.appendChild(summary)

    if (result.details && result.details.length > 0) {
      const invalidList = document.createElement('div')
      invalidList.className = 'integrity-list'

      for (const detail of result.details) {
        const item = document.createElement('div')
        item.className = 'integrity-item danger'
        item.innerHTML = `
          <i class="fa-solid fa-times-circle"></i>
          <span>${detail.filename}</span>
        `
        invalidList.appendChild(item)
      }

      integrityDetails.appendChild(invalidList)
    }

    if (result.unauthorized && result.unauthorized.length > 0) {
      const unauthorizedList = document.createElement('div')
      unauthorizedList.className = 'integrity-list'

      for (const filename of result.unauthorized) {
        const item = document.createElement('div')
        item.className = 'integrity-item warning'
        item.innerHTML = `
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>${filename}</span>
          <button class="btn btn-secondary btn-sm btn-delete-unauthorized" data-filename="${filename}">
            <i class="fa-solid fa-trash"></i>
          </button>
        `
        unauthorizedList.appendChild(item)
      }

      integrityDetails.appendChild(unauthorizedList)

      unauthorizedList.querySelectorAll('.btn-delete-unauthorized').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const target = e.currentTarget as HTMLButtonElement
          const filename = target.dataset.filename
          if (filename) {
            const confirmed = await Dialog.show(`Remover mod não autorizado "${filename}"?`, [
              { text: 'Cancelar', type: 'cancel' },
              { text: 'Remover', type: 'danger' }
            ])
            if (confirmed) {
              await mods.deleteMod(filename)
              await verifyIntegrity()
            }
          }
        })
      })
    }
  } catch (err) {
    integrityStatus.textContent = 'Erro ao verificar integridade'
    integrityStatus.className = 'integrity-status danger'
  } finally {
    verifyBtn.classList.remove('loading')
    verifyBtn.removeAttribute('disabled')
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

  update.progress((percent) => {
    setBusy(true)
    setStatus(`Baixando... ${percent.toFixed(0)}%`)
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

