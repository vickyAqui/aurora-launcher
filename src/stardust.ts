/**
 * Stardust Engine - Terra dos Sonhos / Yellow Star Galaxy
 * Renders subtle twinkling stars and rare shooting stars over a dreamy
 * galaxy gradient background.
 *
 * Performance notes:
 * - Each star is pre-rendered once to a small offscreen canvas (sprite),
 *   so the per-frame loop only calls drawImage (no per-frame shadowBlur).
 * - The two full-screen nebula gradients are cached and recreated only on resize.
 */

interface Star {
  x: number
  y: number
  size: number
  baseAlpha: number
  alpha: number
  twinkleSpeed: number
  twinklePhase: number
  color: string
  type: 'dot' | 'sparkle4' | 'sparkle8'
  floatSpeedY: number
  floatSpeedX: number
  sprite: HTMLCanvasElement
}

interface ShootingStar {
  x: number
  y: number
  length: number
  speed: number
  angle: number
  alpha: number
  active: boolean
}

export function initStardustCanvas(canvasId: string = 'stardust-canvas') {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  let width = 0
  let height = 0
  let stars: Star[] = []
  let shootingStars: ShootingStar[] = []
  let animationFrameId: number
  let grad1: CanvasGradient | null = null
  let grad2: CanvasGradient | null = null

  // Clean palette: white, gold (logo accent) and lavender (logo accent)
  const STAR_COLORS = ['#ffffff', '#f6f3ff', '#f7e8b0', '#e8c86a', '#d7a00b', '#c3a8e8']

  function createStarSprite(star: Star): HTMLCanvasElement {
    const radius = star.size
    const glow = radius * 2
    const size = Math.max(6, Math.ceil(radius * 2 + glow * 2))
    const sprite = document.createElement('canvas')
    sprite.width = size
    sprite.height = size
    const sc = sprite.getContext('2d')
    if (!sc) return sprite

    const center = size / 2
    sc.clearRect(0, 0, size, size)
    sc.shadowColor = star.color
    sc.shadowBlur = glow
    sc.fillStyle = star.color

    if (star.type === 'dot') {
      sc.beginPath()
      sc.arc(center, center, radius, 0, Math.PI * 2)
      sc.fill()
      return sprite
    }

    const points = star.type === 'sparkle4' ? 4 : 8
    const innerFactor = star.type === 'sparkle4' ? 0.38 : 0.5
    const maxR = radius * 1.7

    sc.beginPath()
    for (let i = 0; i < points; i++) {
      const angle = (i * Math.PI * 2) / points
      const r = i % 2 === 0 ? maxR : maxR * innerFactor
      const x = center + Math.cos(angle) * r
      const y = center + Math.sin(angle) * r
      if (i === 0) sc.moveTo(x, y)
      else sc.lineTo(x, y)
    }
    sc.closePath()
    sc.fill()
    return sprite
  }

  function resize() {
    width = window.innerWidth
    height = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    createStars()

    grad1 = ctx!.createRadialGradient(width * 0.2, height * 0.2, 50, width * 0.2, height * 0.2, width * 0.5)
    grad1.addColorStop(0, 'rgba(157, 107, 218, 0.06)')
    grad1.addColorStop(1, 'rgba(0, 0, 0, 0)')

    grad2 = ctx!.createRadialGradient(width * 0.8, height * 0.7, 50, width * 0.8, height * 0.7, width * 0.6)
    grad2.addColorStop(0, 'rgba(215, 160, 11, 0.04)')
    grad2.addColorStop(1, 'rgba(0, 0, 0, 0)')
  }

  function createStars() {
    stars = []
    // Low density for a clean, calm look (sparser than before)
    const count = Math.max(20, Math.floor((width * height) / 16000))

    for (let i = 0; i < count; i++) {
      const typeRand = Math.random()
      let type: Star['type'] = 'dot'
      if (typeRand > 0.9) type = 'sparkle8'
      else if (typeRand > 0.7) type = 'sparkle4'

      // Small, subtle stars
      const size =
        type === 'dot'
          ? Math.random() * 0.9 + 0.4
          : type === 'sparkle4'
            ? Math.random() * 0.9 + 1.2
            : Math.random() * 1 + 1.4

      const star: Star = {
        x: Math.random() * width,
        y: Math.random() * height,
        size,
        baseAlpha: Math.random() * 0.2 + 0.08,
        alpha: Math.random(),
        twinkleSpeed: Math.random() * 0.025 + 0.008,
        twinklePhase: Math.random() * Math.PI * 2,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
        type,
        floatSpeedY: -(Math.random() * 0.08 + 0.03),
        floatSpeedX: (Math.random() - 0.5) * 0.06,
        sprite: undefined as unknown as HTMLCanvasElement
      }
      star.sprite = createStarSprite(star)
      stars.push(star)
    }
  }

  function spawnShootingStar() {
    if (shootingStars.length < 2 && Math.random() < 0.004) {
      shootingStars.push({
        x: Math.random() * (width * 0.8),
        y: Math.random() * (height * 0.4),
        length: Math.random() * 60 + 40,
        speed: Math.random() * 7 + 5,
        angle: Math.PI / 4 + (Math.random() - 0.5) * 0.2, // ~45 deg
        alpha: 1,
        active: true
      })
    }
  }

  function render() {
    ctx!.clearRect(0, 0, width, height)

    // Render static nebula radial highlights (subtle, cached gradients)
    if (grad1) {
      ctx!.fillStyle = grad1
      ctx!.fillRect(0, 0, width, height)
    }
    if (grad2) {
      ctx!.fillStyle = grad2
      ctx!.fillRect(0, 0, width, height)
    }

    // Update & draw stars (sprites = no per-frame shadowBlur)
    for (const star of stars) {
      star.twinklePhase += star.twinkleSpeed
      star.alpha = star.baseAlpha + Math.sin(star.twinklePhase) * 0.25
      star.alpha = Math.max(0.04, Math.min(0.9, star.alpha))

      // Float upward gently
      star.y += star.floatSpeedY
      star.x += star.floatSpeedX

      if (star.y < -10) star.y = height + 10
      if (star.x < -10) star.x = width + 10
      if (star.x > width + 10) star.x = -10

      const sprite = star.sprite
      ctx!.globalAlpha = star.alpha
      ctx!.drawImage(sprite, star.x - sprite.width / 2, star.y - sprite.height / 2)
    }
    ctx!.globalAlpha = 1

    // Spawn & render shooting stars
    spawnShootingStar()

    for (let idx = shootingStars.length - 1; idx >= 0; idx--) {
      const s = shootingStars[idx]
      if (!s.active) {
        shootingStars.splice(idx, 1)
        continue
      }

      s.x += Math.cos(s.angle) * s.speed
      s.y += Math.sin(s.angle) * s.speed
      s.alpha -= 0.015

      if (s.alpha <= 0 || s.x > width || s.y > height) {
        s.active = false
        continue
      }

      const headX = s.x
      const headY = s.y
      const tailX = s.x - Math.cos(s.angle) * s.length
      const tailY = s.y - Math.sin(s.angle) * s.length

      const grad = ctx!.createLinearGradient(tailX, tailY, headX, headY)
      grad.addColorStop(0, 'rgba(224, 220, 130, 0)')
      grad.addColorStop(0.7, 'rgba(215, 160, 11, 0.45)')
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.8)')

      ctx!.save()
      ctx!.globalAlpha = s.alpha
      ctx!.strokeStyle = grad
      ctx!.lineWidth = 1.5
      ctx!.lineCap = 'round'
      ctx!.shadowColor = '#D7A00B'
      ctx!.shadowBlur = 6
      ctx!.beginPath()
      ctx!.moveTo(tailX, tailY)
      ctx!.lineTo(headX, headY)
      ctx!.stroke()
      ctx!.restore()
    }

    animationFrameId = requestAnimationFrame(render)
  }

  window.addEventListener('resize', resize)
  resize()
  render()

  return () => {
    window.removeEventListener('resize', resize)
    cancelAnimationFrame(animationFrameId)
  }
}
