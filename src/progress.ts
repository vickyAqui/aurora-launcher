export function setIndeterminate(progressBar: HTMLElement | null, progressPercent: HTMLElement | null, active: boolean) {
  if (!progressBar || !progressPercent) return

  if (active) {
    progressBar.classList.add('indeterminate')
    progressPercent.style.display = 'none'
  } else {
    progressBar.classList.remove('indeterminate')
    progressPercent.style.display = 'block'
  }
}
