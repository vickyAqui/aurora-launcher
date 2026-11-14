/**
 * Turns a parsed `.cpmmodel` into a tree of nodes and meshes that the renderer can draw.
 *
 * Everything is in the same units CPM uses: pixels for positions and sizes, radians for rotations.
 * The viewer scales the whole tree down by 16 to get Minecraft blocks. Keeping the pixels here makes
 * the numbers easy to compare with the model format and with CPM's own renderer.
 *
 * This module is pure (no Three.js), so the box layout can be unit tested on its own.
 */

import type { CpmCubeData, CpmFace, CpmFaceUv, CpmPreviewModel, CpmVec3 } from '../electron/cpmmodel'

/** Geometry of one box, in pixels relative to the node that owns it. */
export interface CpmMeshData {
  positions: number[]
  uvs: number[]
  /** Per vertex color: the Minecraft face shade times the cube tint, 0..1. */
  colors: number[]
  indices: number[]
  /** Whether the mesh samples the model texture. Colored cubes do not. */
  textured: boolean
}

export interface CpmNode {
  name: string
  id: number
  /** Pixels. */
  position: CpmVec3
  /** Radians, applied in CPM's ZYX order. */
  rotation: CpmVec3
  scale: CpmVec3
  mesh: CpmMeshData | null
  children: CpmNode[]
}

interface IVanillaPart {
  /** Pivot of the part, in pixels. */
  pos: CpmVec3
  offset: CpmVec3
  size: CpmVec3
  uv: [number, number]
}

const PART_NAMES = ['head', 'body', 'left_arm', 'right_arm', 'left_leg', 'right_leg', 'custom_part']

/** Values from CPM's `PlayerPartValues`, for the default (wide) arms. */
const VANILLA_PARTS: IVanillaPart[] = [
  { pos: [0, 0, 0], offset: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0] },
  { pos: [0, 0, 0], offset: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16] },
  { pos: [5, 2, 0], offset: [-1, -2, -2], size: [4, 12, 4], uv: [32, 48] },
  { pos: [-5, 2, 0], offset: [-3, -2, -2], size: [4, 12, 4], uv: [40, 16] },
  { pos: [1.9, 12, 0], offset: [-2, 0, -2], size: [4, 12, 4], uv: [16, 48] },
  { pos: [-1.9, 12, 0], offset: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16] }
]

/** Arms are 3 pixels wide on slim models, and their offset shifts by one pixel. */
const SLIM_ARMS: Record<number, Partial<IVanillaPart>> = {
  2: { offset: [-1, -2, -2], size: [3, 12, 4] },
  3: { offset: [-2, -2, -2], size: [3, 12, 4] }
}

/** Minecraft's directional shading, so the model reads as 3D without lights. */
const FACE_SHADE: Record<CpmFace, number> = {
  up: 1,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.6,
  west: 0.6
}

/**
 * Vertices of each face, named after CPM's `BoxRender`.
 *
 * `0..7` refer to the eight corners built from the box bounds:
 * `v7=(x,y,z)`, `v=(ex,y,z)`, `v1=(ex,ey,z)`, `v2=(x,ey,z)`, `v3=(x,y,ez)`,
 * `v4=(ex,y,ez)`, `v5=(ex,ey,ez)`, `v6=(x,ey,ez)`.
 */
const FACE_CORNERS: Record<CpmFace, [number, number, number, number]> = {
  east: [5, 1, 2, 6],
  west: [0, 4, 7, 3],
  up: [5, 4, 0, 1],
  down: [2, 3, 7, 6],
  north: [1, 0, 3, 2],
  south: [4, 5, 6, 7]
}

/** The four corners of a box, in the order above. */
function boxCorners(x: number, y: number, z: number, ex: number, ey: number, ez: number): CpmVec3[] {
  return [
    [x, y, z],
    [ex, y, z],
    [ex, ey, z],
    [x, ey, z],
    [x, y, ez],
    [ex, y, ez],
    [ex, ey, ez],
    [x, ey, ez]
  ]
}

interface IQuad {
  face: CpmFace
  corners: CpmVec3[]
  u1: number
  v1: number
  u2: number
  v2: number
}

/** The standard Minecraft box layout, mirroring `BoxRender.createTextured`. */
function standardQuads(
  corners: CpmVec3[],
  texU: number,
  texV: number,
  dx: number,
  dy: number,
  dz: number
): IQuad[] {
  const f4 = texU
  const f5 = texU + dz
  const f6 = texU + dz + dx
  const f7 = texU + dz + dx + dx
  const f8 = texU + dz + dx + dz
  const f9 = texU + dz + dx + dz + dx
  const f10 = texV
  const f11 = texV + dz
  const f12 = texV + dz + dy

  return [
    { face: 'east', corners: cornersOf(corners, 'east'), u1: f6, v1: f11, u2: f8, v2: f12 },
    { face: 'west', corners: cornersOf(corners, 'west'), u1: f4, v1: f11, u2: f5, v2: f12 },
    { face: 'up', corners: cornersOf(corners, 'up'), u1: f5, v1: f10, u2: f6, v2: f11 },
    { face: 'down', corners: cornersOf(corners, 'down'), u1: f6, v1: f11, u2: f7, v2: f10 },
    { face: 'north', corners: cornersOf(corners, 'north'), u1: f5, v1: f11, u2: f6, v2: f12 },
    { face: 'south', corners: cornersOf(corners, 'south'), u1: f8, v1: f11, u2: f9, v2: f12 }
  ]
}

/** Every face samples the same square, mirroring `BoxRender.createTexturedSingle`. */
function singleQuads(corners: CpmVec3[], texU: number, texV: number, size: number): IQuad[] {
  return (['east', 'west', 'up', 'down', 'north', 'south'] as CpmFace[]).map((face) => ({
    face,
    corners: cornersOf(corners, face),
    u1: texU,
    v1: texV,
    u2: texU + size,
    v2: texV + size
  }))
}

/** Per face UVs, mirroring `BoxRender.createTextured(pos, size, sc, delta, PerFaceUV, ...)`. */
function perFaceQuads(corners: CpmVec3[], faceUv: Partial<Record<CpmFace, CpmFaceUv>>): IQuad[] {
  const quads: IQuad[] = []

  for (const face of ['east', 'west', 'up', 'down', 'north', 'south'] as CpmFace[]) {
    const uv = faceUv[face]
    if (!uv) continue
    quads.push({ face, corners: cornersOf(corners, face), u1: uv.sx, v1: uv.sy, u2: uv.ex, v2: uv.ey })
  }

  return quads
}

function cornersOf(corners: CpmVec3[], face: CpmFace): CpmVec3[] {
  return FACE_CORNERS[face].map((index) => corners[index])
}

function perFaceUv(uv: CpmFaceUv, index: number, sheet: [number, number]): [number, number] {
  const rotated = (index + uv.rotation + 3) % 4
  const u = rotated !== 0 && rotated !== 1 ? uv.ex : uv.sx
  const v = rotated !== 0 && rotated !== 3 ? uv.ey : uv.sy
  return [u / sheet[0], v / sheet[1]]
}

function clampScale(value: number): number {
  return Math.max(value, 0.01)
}

interface IBoxOptions {
  offset: CpmVec3
  size: CpmVec3
  meshScale: CpmVec3
  mcScale: number
  uv: [number, number]
  texSize: number
  sheet: [number, number]
  faceUv: Partial<Record<CpmFace, CpmFaceUv>> | null
  singleTex: boolean
  tint: [number, number, number]
  textured: boolean
}

/** Builds the six faces of one box, or `null` when CPM would draw nothing. */
export function buildBoxMesh(options: IBoxOptions): CpmMeshData | null {
  const { offset, size, meshScale, mcScale, uv, texSize, sheet, faceUv, singleTex, tint, textured } = options

  if (size[0] === 0 && size[1] === 0 && size[2] === 0 && mcScale === 0) return null

  const [ox, oy, oz] = offset
  const x = ox - mcScale
  const y = oy - mcScale
  const z = oz - mcScale
  const ex = ox + size[0] * meshScale[0] + mcScale
  const ey = oy + size[1] * meshScale[1] + mcScale
  const ez = oz + size[2] * meshScale[2] + mcScale

  const ts = Math.abs(texSize)
  const dx = Math.ceil(size[0] * ts)
  const dy = Math.ceil(size[1] * ts)
  const dz = Math.ceil(size[2] * ts)
  const texU = uv[0] * ts
  const texV = uv[1] * ts

  let corners = boxCorners(x, y, z, ex, ey, ez)
  let quads: IQuad[]
  let perFace = false

  if (!textured) {
    quads = standardQuads(corners, 0, 0, dx, dy, dz)
  } else if (singleTex) {
    quads = singleQuads(corners, texU, texV, Math.max(dx, Math.max(dy, dz)))
  } else if (faceUv) {
    perFace = true
    quads = perFaceQuads(corners, faceUv)
  } else {
    quads = standardQuads(corners, texU, texV, dx, dy, dz)
  }

  // A negative texture size mirrors the box and its texture, like Minecraft's mirror flag.
  const mirror = textured && !perFace && texSize < 0
  if (mirror) corners = boxCorners(ex, y, z, x, ey, ez)

  const mesh: CpmMeshData = { positions: [], uvs: [], colors: [], indices: [], textured }

  for (const quad of quads) {
    const shade = FACE_SHADE[quad.face]
    const base = mesh.positions.length / 3
    const uvs: [number, number][] = []
    const faceCorners = mirror ? cornersOf(corners, quad.face) : quad.corners

    for (let i = 0; i < 4; i++) {
      const corner = faceCorners[i]
      mesh.positions.push(corner[0], corner[1], corner[2])
      mesh.colors.push(shade * tint[0], shade * tint[1], shade * tint[2])

      if (!textured) uvs.push([0, 0])
      else if (perFace) uvs.push(perFaceUv(faceUv![quad.face]!, i, sheet))
      else {
        const u = i === 0 || i === 3 ? quad.u2 : quad.u1
        const v = i === 0 || i === 1 ? quad.v1 : quad.v2
        uvs.push([u / sheet[0], v / sheet[1]])
      }
    }

    if (mirror) {
      // Reversing the quad keeps the faces outward after the box bounds were swapped.
      for (let i = 0; i < 2; i++) {
        const a = base + i
        const b = base + 3 - i
        for (let j = 0; j < 3; j++) {
          const tmp = mesh.positions[a * 3 + j]
          mesh.positions[a * 3 + j] = mesh.positions[b * 3 + j]
          mesh.positions[b * 3 + j] = tmp
          const colorTmp = mesh.colors[a * 3 + j]
          mesh.colors[a * 3 + j] = mesh.colors[b * 3 + j]
          mesh.colors[b * 3 + j] = colorTmp
        }
        const uvTmp = uvs[i]
        uvs[i] = uvs[3 - i]
        uvs[3 - i] = uvTmp
      }
    }

    for (const uvPair of uvs) mesh.uvs.push(uvPair[0], uvPair[1])

    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  return mesh
}

function tintOf(color: CpmVec3 | null): [number, number, number] {
  return color ? [color[0] / 255, color[1] / 255, color[2] / 255] : [1, 1, 1]
}

/** Builds the vanilla base box of a player part. */
function vanillaMesh(part: number, slim: boolean, sheet: [number, number]): CpmMeshData | null {
  const base = VANILLA_PARTS[part]
  if (!base) return null

  const values = { ...base, ...(slim ? SLIM_ARMS[part] : {}) }

  return buildBoxMesh({
    offset: values.offset,
    size: values.size,
    meshScale: [1, 1, 1],
    mcScale: 0,
    uv: values.uv,
    texSize: 1,
    sheet,
    faceUv: null,
    singleTex: false,
    tint: [1, 1, 1],
    textured: true
  })
}

function cubeMesh(cube: CpmCubeData, sheet: [number, number]): CpmMeshData | null {
  if (!cube.hasMesh || cube.hidden || cube.item) return null

  return buildBoxMesh({
    offset: cube.offset,
    size: cube.size,
    meshScale: cube.meshScale,
    mcScale: cube.mcScale,
    uv: cube.uv,
    texSize: cube.texSize,
    sheet,
    faceUv: cube.faceUv,
    singleTex: cube.singleTex,
    tint: tintOf(cube.color),
    textured: cube.texSize !== 0
  })
}

/**
 * Builds the whole model as one tree.
 *
 * Part nodes (0..6) sit at the vanilla pivots plus the offset the model asks for. Cubes keep their
 * own pivot, rotation and scale, and their children render even when the cube itself is hidden.
 */
export function buildCpmScene(model: CpmPreviewModel): CpmNode {
  const slim = model.skinType === 'slim'
  const partNodes: CpmNode[] = []

  for (let part = 0; part < PART_NAMES.length; part++) {
    const info = model.parts.find((p) => p.part === part)
    const base = VANILLA_PARTS[part]
    const pos: CpmVec3 = base ? [base.pos[0] + (info?.pos[0] ?? 0), base.pos[1] + (info?.pos[1] ?? 0), base.pos[2] + (info?.pos[2] ?? 0)] : (info?.pos ?? [0, 0, 0])

    partNodes.push({
      name: PART_NAMES[part],
      id: part,
      position: pos,
      rotation: info?.rotation ?? [0, 0, 0],
      scale: [1, 1, 1],
      mesh: base && !(info?.hidden ?? false) ? vanillaMesh(part, slim, model.sheet) : null,
      children: []
    })
  }

  const byId = new Map<number, CpmNode>()

  for (const cube of model.cubes) {
    const node: CpmNode = {
      name: `cube_${cube.id}`,
      id: cube.id,
      position: cube.pos,
      rotation: cube.rotation,
      scale: [clampScale(cube.scale[0]), clampScale(cube.scale[1]), clampScale(cube.scale[2])],
      mesh: cubeMesh(cube, model.sheet),
      children: []
    }
    byId.set(cube.id, node)
  }

  for (const cube of model.cubes) {
    const node = byId.get(cube.id)
    if (!node) continue

    const parent = byId.get(cube.parent)
    if (parent) parent.children.push(node)
    else partNodes[cube.parent >= 0 && cube.parent < partNodes.length ? cube.parent : 6].children.push(node)
  }

  return {
    name: 'root',
    id: -1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    mesh: null,
    children: partNodes
  }
}
