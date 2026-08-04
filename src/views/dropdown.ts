export interface CustomSelect {
  get value(): string
  setValue(value: string): void
  refresh(): void
}

/**
 * Replaces a native <select> with a themed, rounded dropdown.
 * The native select is kept (hidden) inside the wrapper so that
 * value reads / change events keep working as before.
 */
export function enhanceSelect(select: HTMLSelectElement): CustomSelect {
  const wrapper = document.createElement('div')
  wrapper.className = 'custom-select'

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'custom-select-button'

  const valueSpan = document.createElement('span')
  valueSpan.className = 'custom-select-value'

  const chevron = document.createElement('i')
  chevron.className = 'fa-solid fa-chevron-down'
  chevron.setAttribute('aria-hidden', 'true')

  button.append(valueSpan, chevron)

  const list = document.createElement('div')
  list.className = 'custom-select-list'

  select.classList.add('custom-select-input')
  select.style.display = 'none'

  select.parentNode?.insertBefore(wrapper, select)
  wrapper.append(button, list, select)

  let open = false
  let listEls: { el: HTMLDivElement; option: HTMLOptionElement }[] = []

  const syncLabel = () => {
    const opt = select.selectedOptions[0]
    valueSpan.textContent = opt ? opt.textContent : ''
    valueSpan.title = opt ? opt.textContent ?? '' : ''
  }

  const renderOptions = () => {
    list.innerHTML = ''
    listEls = []

    for (const opt of Array.from(select.options)) {
      const item = document.createElement('div')
      item.className = 'custom-select-option'
      if (opt.selected) item.classList.add('selected')
      item.textContent = opt.textContent
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        if (select.value !== opt.value) {
          select.value = opt.value
          syncLabel()
          renderOptions()
          select.dispatchEvent(new Event('change', { bubbles: true }))
        }
        close()
      })
      list.appendChild(item)
      listEls.push({ el: item, option: opt })
    }
  }

  const onDocClick = (e: MouseEvent) => {
    if (!wrapper.contains(e.target as Node)) close()
  }

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = select.selectedIndex
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const next = Math.max(0, Math.min(select.options.length - 1, idx + dir))
      if (next !== idx) {
        select.selectedIndex = next
        syncLabel()
        renderOptions()
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }
  }

  const close = () => {
    if (!open) return
    open = false
    wrapper.classList.remove('open')
    list.classList.remove('open')
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKeydown)
  }

  const openList = () => {
    open = true
    renderOptions()
    list.classList.add('open')
    wrapper.classList.add('open')
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKeydown)
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation()
    if (open) close()
    else openList()
  })

  syncLabel()

  return {
    get value() {
      return select.value
    },
    setValue(value: string) {
      select.value = value
      syncLabel()
      renderOptions()
    },
    refresh() {
      syncLabel()
      renderOptions()
    }
  }
}
