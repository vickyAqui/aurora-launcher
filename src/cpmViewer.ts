/**
 * Interactive 3D preview of a CPM model.
 *
 * The viewer owns a small Three.js scene with one group per cube. The model tree comes from
 * `cpmGeometry`, already in CPM's pixel space; a single root group flips the Y axis (CPM is Y-down)
 * and scales pixels down to Minecraft blocks.
 */

import * as THREE from 'three'
import type { CpmPreviewModel } from '../electron/cpmmodel'
import { buildCpmScene, type CpmNode } from './cpmGeometry'

const PIXELS_PER_BLOCK = 16
const AUTO_ROTATE_SPEED = 0.0045

export class CpmViewer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly pivot = new THREE.Group()
  private readonly modelRoot = new THREE.Group()

  private frame = 0
  private disposed = false
  private dragging = false
  private autoRotate = true
  private yaw = 0
  private pitch = 0.12
  private distance = 4
  private minDistance = 1.5
  private maxDistance = 12
  private viewWidth = 0
  private viewHeight = 0

  private pointerId: number | null = null
  private lastX = 0
  private lastY = 0

  private readonly resizeObserver: ResizeObserver
  private readonly textureLoader = new THREE.TextureLoader()

  private geometries: THREE.BufferGeometry[] = []
  private materials: THREE.Material[] = []
  private textures: THREE.Texture[] = []
  private loadToken = 0

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly isActive: () => boolean
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200)
    this.camera.position.set(0, 0, 4)

    this.pivot.rotation.order = 'YXZ'
    this.modelRoot.rotation.x = Math.PI
    this.modelRoot.scale.setScalar(1 / PIXELS_PER_BLOCK)
    this.pivot.add(this.modelRoot)
    this.scene.add(this.pivot)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement)

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })

    this.resize()
    this.tick()
  }

  /** Draws `model`, replacing whatever was on screen. */
  async setModel(model: CpmPreviewModel): Promise<void> {
    const token = ++this.loadToken
    const texture = await this.loadTexture(model, token)
    if (token !== this.loadToken || this.disposed) {
      texture?.dispose()
      return
    }

    this.clearModel()
    if (texture) this.textures.push(texture)

    const textured = new THREE.MeshBasicMaterial({
      map: texture,
      vertexColors: true,
      alphaTest: 0.5,
      side: THREE.FrontSide
    })
    const colored = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide })
    this.materials.push(textured, colored)

    const tree = buildCpmScene(model)
    const group = this.buildNode(tree, textured, colored)
    this.geometries.push(...collectGeometries(group))

    group.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(group)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    group.position.set(-center.x, -center.y, -center.z)
    this.modelRoot.add(group)

    const radius = Math.max(size.length() / 2 / PIXELS_PER_BLOCK, 0.1)
    const fit = radius / Math.sin((this.camera.fov * Math.PI) / 360)
    this.minDistance = radius * 0.7
    this.maxDistance = radius * 6
    this.distance = fit * 1.15
    this.yaw = 0
    this.pitch = 0.12
    this.autoRotate = true
    this.applyOrbit()
  }

  /** Removes the current model, leaving an empty stage. */
  clear(): void {
    this.loadToken++
    this.clearModel()
    this.autoRotate = false
    this.distance = 4
    this.yaw = 0
    this.pitch = 0.12
    this.applyOrbit()
  }

  /** Restarts the slow turntable animation. */
  resetView(): void {
    this.yaw = 0
    this.pitch = 0.12
    this.autoRotate = true
    this.applyOrbit()
  }

  /** Stops the animation loop and releases every GPU resource. */
  dispose(): void {
    this.disposed = true
    this.loadToken++
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()

    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)

    this.clearModel()
    this.renderer.dispose()
  }

  private clearModel(): void {
    this.modelRoot.clear()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    for (const texture of this.textures) texture.dispose()
    this.geometries = []
    this.materials = []
    this.textures = []
  }

  private async loadTexture(model: CpmPreviewModel, token: number): Promise<THREE.Texture | null> {
    if (!model.texture) return this.createPlaceholderTexture()

    try {
      const texture = await this.textureLoader.loadAsync(model.texture)
      if (token !== this.loadToken) return texture
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
      texture.needsUpdate = true
      return texture
    } catch {
      return this.createPlaceholderTexture()
    }
  }

  /** Checkerboard used when the model relies on the player skin, which the preview does not have. */
  private createPlaceholderTexture(): THREE.Texture {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    for (let y = 0; y < size; y += 8) {
      for (let x = 0; x < size; x += 8) {
        ctx.fillStyle = (x / 8 + y / 8) % 2 === 0 ? '#8a8a96' : '#6f6f7c'
        ctx.fillRect(x, y, 8, 8)
      }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.flipY = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    return texture
  }

  private buildNode(node: CpmNode, textured: THREE.Material, colored: THREE.Material): THREE.Group {
    const group = new THREE.Group()
    group.name = node.name
    group.position.set(node.position[0], node.position[1], node.position[2])
    group.rotation.order = 'ZYX'
    group.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])
    group.scale.set(node.scale[0], node.scale[1], node.scale[2])

    if (node.mesh) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(node.mesh.positions, 3))
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(node.mesh.uvs, 2))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(node.mesh.colors, 3))
      geometry.setIndex(node.mesh.indices)
      group.add(new THREE.Mesh(geometry, node.mesh.textured ? textured : colored))
    }

    for (const child of node.children) group.add(this.buildNode(child, textured, colored))
    return group
  }

  private applyOrbit(): void {
    this.pivot.rotation.set(this.pitch, this.yaw, 0)
    this.camera.position.set(0, 0, this.distance)
    this.camera.lookAt(0, 0, 0)
  }

  private resize(): void {
    const parent = this.canvas.parentElement
    const width = Math.max(parent?.clientWidth ?? 1, 1)
    const height = Math.max(parent?.clientHeight ?? 1, 1)
    if (width === this.viewWidth && height === this.viewHeight) return

    this.viewWidth = width
    this.viewHeight = height
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private tick = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)

    this.resize()
    if (!this.isActive()) return

    if (this.autoRotate && !this.dragging) {
      this.yaw += AUTO_ROTATE_SPEED
      this.applyOrbit()
    }

    this.renderer.render(this.scene, this.camera)
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerId = event.pointerId
    this.dragging = true
    this.lastX = event.clientX
    this.lastY = event.clientY
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.classList.add('dragging')
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || this.pointerId !== event.pointerId) return

    const dx = event.clientX - this.lastX
    const dy = event.clientY - this.lastY
    this.lastX = event.clientX
    this.lastY = event.clientY

    if (Math.abs(dx) + Math.abs(dy) > 1) this.autoRotate = false

    this.yaw += dx * 0.008
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.008))
    this.applyOrbit()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return
    this.dragging = false
    this.pointerId = null
    this.canvas.classList.remove('dragging')
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * Math.exp(event.deltaY * 0.0012)))
    this.applyOrbit()
  }
}

function collectGeometries(group: THREE.Object3D): THREE.BufferGeometry[] {
  const result: THREE.BufferGeometry[] = []
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) result.push(child.geometry as THREE.BufferGeometry)
  })
  return result
}
