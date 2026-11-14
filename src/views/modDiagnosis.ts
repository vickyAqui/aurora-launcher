import logger from 'electron-log/renderer'
import { mods } from '../ipc'
import { Dialog } from './dialog'
import type { IModIssue, IModScanResult } from '../../electron/modscan'

/**
 * Mods tab diagnosis.
 *
 * The scan reads the metadata each jar carries (`META-INF/mods.toml` or `fabric.mod.json`) and
 * lists only problems the player can act on: duplicate mod ids, jars built for another Minecraft
 * version, missing dependencies. Every issue offers the same action the Mods list already uses, so
 * turning a mod off here is identical to flipping its switch in the list.
 */

let lastResult: IModScanResult | null = null
let busy = false
let onChanged: (() => void) | null = null

const SEVERITY_ICON: Record<IModIssue['severity'], string> = {
  error: 'fa-circle-xmark',
  warning: 'fa-triangle-exclamation',
  info: 'fa-circle-info'
}

export function initModDiagnosis(onModsChanged: () => void) {
  onChanged = onModsChanged

  document.getElementById('btn-diagnose-mods')?.addEventListener('click', () => {
    void runModDiagnosis()
  })

  document.getElementById('mods-diagnosis')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-diag-action]')
    if (button) void applyIssueAction(button)
  })

  renderHint()
}

function panel(): HTMLElement | null {
  return document.getElementById('mods-diagnosis')
}

function renderHint() {
  const container = panel()
  if (!container) return

  container.classList.remove('hidden')
  container.innerHTML = ''

  const hint = document.createElement('p')
  hint.className = 'diag-hint'
  hint.textContent =
    'O diagnóstico lê o mods.toml de cada jar e aponta duplicados, dependências ausentes e builds de outra versão do Minecraft.'
  container.appendChild(hint)
}

export async function runModDiagnosis() {
  if (busy) return

  const container = panel()
  const button = document.getElementById('btn-diagnose-mods') as HTMLButtonElement | null
  if (!container || !button) return

  busy = true
  button.disabled = true
  const original = button.innerHTML
  button.innerHTML = '<i class="fa-fw fa-solid fa-spinner fa-spin"></i><span>Analisando...</span>'

  container.classList.remove('hidden')
  container.innerHTML =
    '<div class="mods-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Lendo os jars...</span></div>'

  try {
    lastResult = await mods.diagnose()
    renderResult(lastResult)
  } catch (err) {
    logger.error('Error diagnosing mods:', err)
    container.innerHTML = '<p class="mods-error">Não foi possível analisar os mods.</p>'
  } finally {
    busy = false
    button.disabled = false
    button.innerHTML = original
  }
}

function renderResult(result: IModScanResult) {
  const container = panel()
  if (!container) return

  container.innerHTML = ''

  const errors = result.issues.filter((issue) => issue.severity === 'error').length
  const warnings = result.issues.filter((issue) => issue.severity === 'warning').length

  const summary = document.createElement('div')
  summary.className = `diag-summary${errors > 0 ? ' has-errors' : result.issues.length > 0 ? ' has-warnings' : ' is-clean'}`

  const icon = document.createElement('i')
  icon.className = `fa-solid ${errors > 0 ? 'fa-circle-xmark' : result.issues.length > 0 ? 'fa-triangle-exclamation' : 'fa-circle-check'}`
  summary.appendChild(icon)

  const text = document.createElement('span')
  if (result.scanned === 0) {
    text.textContent = 'Nenhum jar encontrado. Inicie o jogo uma vez para baixar o modpack.'
  } else if (result.issues.length === 0) {
    text.textContent = `${result.scanned} jars analisados · nenhum problema encontrado.`
  } else {
    const parts = [`${result.scanned} jars analisados`]
    if (errors > 0) parts.push(`${errors} erro${errors === 1 ? '' : 's'}`)
    if (warnings > 0) parts.push(`${warnings} aviso${warnings === 1 ? '' : 's'}`)
    text.textContent = `${parts.join(' · ')}.`
  }
  summary.appendChild(text)
  container.appendChild(summary)

  if (result.issues.length === 0) return

  const list = document.createElement('ul')
  list.className = 'diag-list'

  for (const issue of result.issues) {
    list.appendChild(buildIssueItem(issue))
  }

  container.appendChild(list)
}

function buildIssueItem(issue: IModIssue): HTMLLIElement {
  const item = document.createElement('li')
  item.className = `diag-item ${issue.severity}`

  const icon = document.createElement('span')
  icon.className = 'diag-icon'
  icon.innerHTML = `<i class="fa-solid ${SEVERITY_ICON[issue.severity]}"></i>`
  item.appendChild(icon)

  const body = document.createElement('div')
  body.className = 'diag-body'

  const message = document.createElement('span')
  message.className = 'diag-message'
  message.textContent = issue.message
  body.appendChild(message)

  const file = document.createElement('span')
  file.className = 'diag-file'
  file.textContent = issue.file
  body.appendChild(file)

  item.appendChild(body)

  if (issue.action) {
    const action = document.createElement('button')
    action.type = 'button'
    action.className = 'btn btn-ghost btn-sm'
    action.dataset.diagAction = issue.action
    action.dataset.diagFile = issue.file
    action.textContent = issue.action === 'disable' ? 'Desativar' : 'Ativar'
    item.appendChild(action)
  }

  return item
}

async function applyIssueAction(button: HTMLButtonElement) {
  const action = button.dataset.diagAction
  const file = button.dataset.diagFile
  if ((action !== 'disable' && action !== 'enable') || !file || busy) return

  const verb = action === 'disable' ? 'Desativar' : 'Ativar'
  const confirmed = await Dialog.show(
    `${verb} ${file}?\n\nA alteração vale para a próxima inicialização do jogo.`,
    [
      { text: 'Cancelar', type: 'cancel' },
      { text: verb, type: action === 'disable' ? 'danger' : 'ok' }
    ],
    `${verb} mod`
  )
  if (!confirmed) return

  busy = true
  button.disabled = true

  try {
    const ok = await mods.setEnabled(file, action === 'enable')
    if (!ok) {
      await Dialog.show('Não foi possível alterar este mod.', [{ text: 'OK', type: 'ok' }])
      return
    }

    lastResult = await mods.diagnose()
    renderResult(lastResult)
    onChanged?.()
  } catch (err) {
    logger.error('Error applying diagnosis action:', err)
    await Dialog.show('Erro ao alterar o mod. Veja os logs.', [{ text: 'OK', type: 'ok' }])
  } finally {
    busy = false
    button.disabled = false
  }
}
