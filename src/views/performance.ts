import logger from 'electron-log/renderer'
import { performance as performanceApi } from '../ipc'
import { Dialog } from './dialog'
import {
  PERFORMANCE_PROFILES,
  isPerformanceProfileId,
  type IPerformanceProfile,
  type PerformanceProfileId
} from '../performancePresets'
import type { IPerformanceStateResponse } from '../../electron/handlers/performance'

let response: IPerformanceStateResponse | null = null
let selected: PerformanceProfileId = 'balanced'
let busy = false

/** Loads the tab and wires its buttons. Called once, when the settings modal is built. */
export async function initPerformanceTab() {
  bindListeners()
  await refreshPerformanceTab()
}

/**
 * Re-reads the state. The tab is refreshed every time it is opened because the game rewrites the
 * files it reports on, and the state can also change from the Game tab's RAM slider.
 */
export async function refreshPerformanceTab(syncSliders = false) {
  try {
    response = await performanceApi.get()
    if (response.state) selected = response.state.profile
    render()
    if (syncSliders) syncMemorySliders(response.currentMemory)
  } catch (err) {
    logger.error('Error loading performance state:', err)
    const hardware = document.getElementById('perf-hardware')
    if (hardware) hardware.innerHTML = '<p class="mods-error">Não foi possível ler o hardware.</p>'
    setStatus('Não foi possível carregar o estado de desempenho.', true)
  }
}

function bindListeners() {
  document.getElementById('btn-apply-performance')?.addEventListener('click', () => {
    void applySelectedProfile()
  })

  document.getElementById('btn-restore-performance')?.addEventListener('click', () => {
    void restoreProfile()
  })

  document.getElementById('perf-profiles')?.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-profile]')
    if (!card) return

    const id = card.dataset.profile
    if (!isPerformanceProfileId(id) || id === selected) return

    selected = id
    render()
  })
}

function render() {
  if (!response) return

  renderHardware()
  renderProfiles()
  renderStatus()
  updateButtons()
}

function renderHardware() {
  const container = document.getElementById('perf-hardware')
  if (!container || !response) return

  const { totalMemGB, cores, suggestedMemory } = response.hardware

  container.innerHTML = `
    <div class="perf-hardware-grid">
      <div class="perf-hardware-item">
        <span>RAM total</span>
        <strong>${totalMemGB} GB</strong>
      </div>
      <div class="perf-hardware-item">
        <span>Núcleos</span>
        <strong>${cores}</strong>
      </div>
      <div class="perf-hardware-item">
        <span>RAM sugerida</span>
        <strong>${suggestedMemory} GB</strong>
      </div>
      <div class="perf-hardware-item">
        <span>Shaders</span>
        <strong>${response.hasShaderPack ? 'Pack selecionado' : 'Nenhum pack'}</strong>
      </div>
    </div>
    <p class="perf-hardware-note">
      <i class="fa-fw fa-solid fa-memory"></i>
      O perfil usa <strong>${suggestedMemory} GB</strong> de heap e nunca passa de metade da RAM do PC.
      ${
        response.gameDirExists
          ? ''
          : ' O jogo ainda não foi iniciado: só o <code>options.txt</code> será criado agora, os configs dos mods entram no primeiro launch.'
      }
    </p>
  `
}

function renderProfiles() {
  const container = document.getElementById('perf-profiles')
  if (!container || !response) return

  container.innerHTML = ''

  for (const profile of PERFORMANCE_PROFILES) {
    const active = response.state?.profile === profile.id
    const card = document.createElement('button')
    card.type = 'button'
    card.className = `perf-profile${profile.id === selected ? ' selected' : ''}${active ? ' active' : ''}`
    card.dataset.profile = profile.id
    card.setAttribute('aria-pressed', profile.id === selected ? 'true' : 'false')
    card.innerHTML = `
      <span class="perf-profile-icon"><i class="fa-solid ${profile.icon}"></i></span>
      <span class="perf-profile-body">
        <span class="perf-profile-head">
          <span class="perf-profile-name">${profile.name}</span>
          ${active ? '<span class="perf-profile-badge">Ativo</span>' : ''}
        </span>
        <span class="perf-profile-tagline">${profile.tagline}</span>
        <span class="perf-profile-desc">${profile.description}</span>
        <span class="perf-profile-highlights">
          ${profile.highlights.map((item) => `<span class="perf-profile-highlight">${item}</span>`).join('')}
        </span>
      </span>
      <span class="perf-profile-check"><i class="fa-solid fa-circle-check"></i></span>
    `
    container.appendChild(card)
  }
}

function renderStatus() {
  if (!response) return

  if (response.state) {
    const profile = PERFORMANCE_PROFILES.find((entry) => entry.id === response?.state?.profile)
    setStatus(
      `Perfil ativo: ${profile?.name ?? response.state.profile} · ${response.state.memory} GB de heap · reaplicado antes de cada inicialização.`
    )
    return
  }

  if (response.backups.length > 0) {
    setStatus('Nenhum perfil ativo, mas há alterações anteriores que podem ser desfeitas.')
    return
  }

  setStatus('Nenhum perfil aplicado. O jogo está usando as configurações atuais.')
}

function updateButtons() {
  const applyBtn = document.getElementById('btn-apply-performance') as HTMLButtonElement | null
  const restoreBtn = document.getElementById('btn-restore-performance') as HTMLButtonElement | null
  const canRestore = Boolean(response && (response.state || response.backups.length > 0))

  if (applyBtn) applyBtn.disabled = busy || !response
  if (restoreBtn) restoreBtn.disabled = busy || !canRestore
}

function setBusy(value: boolean) {
  busy = value
  updateButtons()
}

function setStatus(message: string, isError = false) {
  const status = document.getElementById('perf-status')
  if (!status) return

  status.innerText = message
  status.classList.toggle('error', isError)
}

function syncMemorySliders(memory: { min: number; max: number }) {
  const minInput = document.getElementById('ram-min') as HTMLInputElement | null
  const maxInput = document.getElementById('ram-max') as HTMLInputElement | null
  if (!minInput || !maxInput) return

  minInput.value = String(memory.min)
  maxInput.value = String(memory.max)
  maxInput.dispatchEvent(new Event('input'))
}

function profileName(id: PerformanceProfileId): string {
  return PERFORMANCE_PROFILES.find((entry) => entry.id === id)?.name ?? id
}

async function applySelectedProfile() {
  if (!response || busy) return

  const profile: IPerformanceProfile | undefined = PERFORMANCE_PROFILES.find((entry) => entry.id === selected)
  if (!profile) return

  const memory = response.hardware.suggestedMemory
  const confirmed = await Dialog.show(
    `Aplicar o perfil ${profile.name}?\n\nO launcher vai ajustar as opções gráficas, os configs dos mods de performance e o heap do Java para ${memory} GB.`,
    [
      { text: 'Cancelar', type: 'cancel' },
      { text: 'Aplicar', type: 'ok' }
    ],
    'Aplicar perfil de desempenho'
  )
  if (!confirmed) return

  setBusy(true)
  setStatus(`Aplicando o perfil ${profile.name}...`)

  try {
    const result = await performanceApi.apply(selected, memory)
    if (!result.ok) {
      setStatus(result.error ?? 'Não foi possível aplicar o perfil.', true)
      return
    }

    await refreshPerformanceTab(true)
    setStatus(`Perfil ${profileName(selected)} aplicado · ${result.memory ?? memory} GB de heap.`)
  } catch (err) {
    logger.error('Error applying performance profile:', err)
    setStatus('Erro ao aplicar o perfil de desempenho. Veja os logs.', true)
  } finally {
    setBusy(false)
  }
}

async function restoreProfile() {
  if (busy) return

  const confirmed = await Dialog.show(
    'Desfazer as alterações de desempenho?\n\nOs arquivos voltam ao estado anterior e o perfil salvo é removido.',
    [
      { text: 'Cancelar', type: 'cancel' },
      { text: 'Desfazer', type: 'danger' }
    ],
    'Desfazer alterações'
  )
  if (!confirmed) return

  setBusy(true)
  setStatus('Restaurando os arquivos...')

  try {
    const result = await performanceApi.restore()
    if (!result.ok) {
      setStatus(result.error ?? 'Não foi possível desfazer as alterações.', true)
      return
    }

    await refreshPerformanceTab(true)
    setStatus(
      result.restored.length > 0
        ? `${result.restored.length} arquivo(s) restaurado(s). O jogo voltou às configurações anteriores.`
        : 'Nenhum arquivo precisava ser restaurado.'
    )
  } catch (err) {
    logger.error('Error restoring performance profile:', err)
    setStatus('Erro ao desfazer as alterações. Veja os logs.', true)
  } finally {
    setBusy(false)
  }
}
