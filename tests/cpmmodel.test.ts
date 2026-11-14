import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CPM_MODEL_MAGIC,
  CpmParseError,
  parseCpmModel,
  type CpmCubeData,
  type CpmPreviewModel,
  type CpmVec3
} from '../electron/cpmmodel'
import { buildBoxMesh, buildCpmScene, type CpmMeshData } from '../src/cpmGeometry'

/* --------------------------------------------------------------------------------------------- */
/* Fixture writer: mirrors the Java writer in CPM's IOHelper so the parser is tested end to end.  */
/* --------------------------------------------------------------------------------------------- */

const DIV = 32767 / 48

function u8(...values: number[]): Buffer {
  return Buffer.from(values)
}

function i16(value: number): Buffer {
  const out = Buffer.alloc(2)
  out.writeInt16BE(value, 0)
  return out
}

function float2(value: number): Buffer {
  return i16(Math.max(-32768, Math.min(32767, Math.round(value * DIV))))
}

function vec6b(value: CpmVec3): Buffer {
  return Buffer.concat(value.map(float2))
}

function signedVarInt(value: number): Buffer {
  const sign = value < 0 ? 0x40 : 0
  let rest = Math.abs(value)
  let byte = (rest & 0x3f) | sign
  rest = Math.floor(rest / 64)

  const out: number[] = []
  while (rest !== 0) {
    out.push(byte | 0x80)
    byte = rest & 0x7f
    rest = Math.floor(rest / 128)
  }
  out.push(byte)
  return Buffer.from(out)
}

function varInt(value: number): Buffer {
  let rest = value
  const out: number[] = []
  while ((rest & -128) !== 0) {
    out.push((rest & 0x7f) | 0x80)
    rest >>>= 7
  }
  out.push(rest)
  return Buffer.from(out)
}

function varVec3(value: CpmVec3): Buffer {
  return Buffer.concat(value.map((v) => signedVarInt(Math.round(v * DIV))))
}

function angle(value: CpmVec3): Buffer {
  return Buffer.concat(
    value.map((radians) => {
      let raw = Math.round((radians / (Math.PI * 2)) * 65535)
      if (raw > 32767) raw -= 65536
      return i16(raw)
    })
  )
}

function utf(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  return Buffer.concat([varInt(data.length), data])
}

function byteArray(data: Buffer): Buffer {
  return Buffer.concat([varInt(data.length), data])
}

/** Writes one block of the inner definition: enum byte, varint length, payload. */
function block(type: number, payload: Buffer): Buffer {
  return Buffer.concat([u8(type), varInt(payload.length), payload])
}

/** Sum of the container bytes after the magic, like CPM writes it. */
function checksum(data: Buffer): Buffer {
  let sum = 0
  for (let i = 1; i < data.length; i++) sum = (sum + data[i]) & 0xffff
  const out = Buffer.alloc(2)
  out.writeUInt16BE(sum)
  return out
}

/** Inner data block: magic, blocks, END, checksum. */
function innerData(blocks: Buffer[]): Buffer {
  const body = Buffer.concat([u8(CPM_MODEL_MAGIC), ...blocks, block(0, Buffer.alloc(0))])
  return Buffer.concat([body, checksum(body)])
}

/** Whole `.cpmmodel` container: magic, name, description, data, overflow, icon, checksum. */
function modelFile(name: string, description: string, data: Buffer, icon = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([
    u8(CPM_MODEL_MAGIC),
    utf(name),
    utf(description),
    byteArray(data),
    byteArray(Buffer.alloc(0)),
    byteArray(icon)
  ])
  return Buffer.concat([body, checksum(body)])
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

interface ICubeFixture {
  parent: number
  pos?: CpmVec3
  rotation?: CpmVec3
  mesh?: boolean
  size?: CpmVec3
  offset?: CpmVec3
  texture?: boolean
  texSize?: number
  uv?: [number, number]
  color?: CpmVec3
  mcScale?: number
  meshScale?: CpmVec3
  scale?: CpmVec3
  hidden?: boolean
}

const CUBE_FLAGS = { HAS_MESH: 1, HAS_TEXTURE: 2, HIDDEN: 4, MESH_SCALED: 8, UV_SCALED: 16, MC_SCALED: 32, SCALED: 64 }

function cube(options: ICubeFixture): Buffer {
  const hasMesh = options.mesh !== false
  const textured = hasMesh && options.texture !== false
  const texSize = options.texSize ?? 1

  let flags = 0
  if (hasMesh) flags |= CUBE_FLAGS.HAS_MESH
  if (textured) flags |= CUBE_FLAGS.HAS_TEXTURE
  if (options.hidden) flags |= CUBE_FLAGS.HIDDEN
  if (options.meshScale) flags |= CUBE_FLAGS.MESH_SCALED
  if (textured && texSize !== 1) flags |= CUBE_FLAGS.UV_SCALED
  if (hasMesh && options.mcScale !== undefined) flags |= CUBE_FLAGS.MC_SCALED
  if (options.scale) flags |= CUBE_FLAGS.SCALED

  const parts: Buffer[] = [u8(flags), varInt(options.parent), varVec3(options.pos ?? [0, 0, 0]), angle(options.rotation ?? [0, 0, 0])]

  if (hasMesh) {
    parts.push(varVec3(options.size ?? [0, 0, 0]), varVec3(options.offset ?? [0, 0, 0]))
    if (textured) {
      if ((flags & CUBE_FLAGS.UV_SCALED) !== 0) parts.push(u8(texSize & 0xff))
      parts.push(varInt(options.uv?.[0] ?? 0), varInt(options.uv?.[1] ?? 0))
    } else {
      parts.push(u8(...(options.color ?? [0, 0, 0])))
    }
    if ((flags & CUBE_FLAGS.MC_SCALED) !== 0) parts.push(float2(options.mcScale ?? 0))
  }

  if (options.meshScale) parts.push(varVec3(options.meshScale))
  if (options.scale) parts.push(varVec3(options.scale))

  return Buffer.concat(parts)
}

const RENDER_EFFECTS = { GLOW: 0, SCALE: 1, HIDE: 2, COLOR: 3, SINGLE_TEX: 4, PER_FACE_UV: 5, UV_OVERFLOW: 6, ITEM: 7 }
const MODEL_PARTS = { PLAYER: 1, SKIN: 5, PLAYER_PARTPOS: 7, RENDER_EFFECT: 8, SKIN_TYPE: 11, TEXTURE: 17, CUBES: 21, ROOT_INFO: 22 }

function effect(kind: number, payload: Buffer): Buffer {
  return block(MODEL_PARTS.RENDER_EFFECT, Buffer.concat([u8(kind), payload]))
}

/** A model that exercises every block and effect the preview understands. */
function fixture(): Buffer {
  const blocks = [
    block(MODEL_PARTS.PLAYER, u8(0b0000_1011)),
    block(MODEL_PARTS.SKIN_TYPE, u8(0)),
    block(MODEL_PARTS.SKIN, Buffer.concat([i16(64), i16(64), byteArray(PNG)])),
    block(MODEL_PARTS.PLAYER_PARTPOS, Buffer.concat([varInt(0), vec6b([2, 3, 4]), angle([Math.PI / 2, 0, 0])])),
    block(MODEL_PARTS.ROOT_INFO, Buffer.concat([u8(0x09), u8(1), varVec3([1, 2, 3]), angle([0, Math.PI / 2, 0])])),
    block(
      MODEL_PARTS.CUBES,
      Buffer.concat([
        varInt(5),
        cube({ parent: 0, pos: [1, 2, 3], size: [8, 8, 8], uv: [0, 0] }),
        cube({ parent: 10, size: [2, 2, 2], texture: false, color: [255, 0, 0] }),
        cube({ parent: 10, mesh: false, pos: [0, 4, 0] }),
        cube({ parent: 12, size: [1, 1, 1], uv: [8, 8], hidden: true }),
        cube({
          parent: 6,
          size: [2, 2, 2],
          offset: [0, 1, 0],
          texSize: -1,
          uv: [8, 8],
          mcScale: 0.5,
          meshScale: [1, 2, 3],
          scale: [2, 2, 2]
        })
      ])
    ),
    effect(RENDER_EFFECTS.SCALE, Buffer.concat([varInt(10), float2(0.25), vec6b([2, 1, 1])])),
    effect(RENDER_EFFECTS.HIDE, varInt(12)),
    effect(RENDER_EFFECTS.HIDE, varInt(1)),
    effect(RENDER_EFFECTS.COLOR, Buffer.concat([varInt(10), u8(10, 20, 30)])),
    effect(RENDER_EFFECTS.SINGLE_TEX, varInt(14)),
    effect(RENDER_EFFECTS.PER_FACE_UV, Buffer.concat([varInt(11), u8(0x01), varInt(1), varInt(2), varInt(3), varInt(4), u8(1)])),
    effect(RENDER_EFFECTS.UV_OVERFLOW, Buffer.concat([varInt(10), varInt(2), varInt(3)])),
    effect(RENDER_EFFECTS.ITEM, varInt(13)),
    effect(RENDER_EFFECTS.GLOW, varInt(10))
  ]

  return modelFile('Estrelinha de teste', 'Modelo sintético', innerData(blocks), PNG)
}

describe('parseCpmModel', () => {
  it('reads the container, the skin and the model blocks', () => {
    const model = parseCpmModel(fixture())

    expect(model.name).toBe('Estrelinha de teste')
    expect(model.description).toBe('Modelo sintético')
    expect(model.skinType).toBe('slim')
    expect(model.sheet).toEqual([64, 64])
    expect(model.texture).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(model.icon).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('keeps only the vanilla parts marked in the PLAYER block', () => {
    const model = parseCpmModel(fixture())

    expect(model.keepParts).toEqual([true, true, false, true, false, false, false])
    expect(model.parts.map((part) => part.hidden)).toEqual([false, true, true, false, true, true, true])
  })

  it('applies the part transforms and hides the parts the effects target', () => {
    const model = parseCpmModel(fixture())

    expect(model.parts[0].pos).toEqual([2, 3, 4].map((v) => expect.closeTo(v, 2)))
    expect(model.parts[0].rotation[0]).toBeCloseTo(Math.PI / 2, 4)
    expect(model.parts[1].pos).toEqual([1, 2, 3].map((v) => expect.closeTo(v, 2)))
    expect(model.parts[1].rotation[1]).toBeCloseTo(Math.PI / 2, 4)
    expect(model.parts[1].hidden).toBe(true)
  })

  it('reads every cube and applies the effects after parsing', () => {
    const model = parseCpmModel(fixture())
    const byId = new Map(model.cubes.map((cube) => [cube.id, cube]))

    expect(model.cubes.map((cube) => cube.id)).toEqual([10, 11, 12, 13, 14])

    const textured = byId.get(10)!
    expect(textured.parent).toBe(0)
    expect(textured.hasMesh).toBe(true)
    expect(textured.size).toEqual([8, 8, 8].map((v) => expect.closeTo(v, 2)))
    expect(textured.texSize).toBe(1)
    expect(textured.uv).toEqual([2, 3])
    expect(textured.mcScale).toBeCloseTo(0.25, 2)
    expect(textured.meshScale).toEqual([2, 1, 1].map((v) => expect.closeTo(v, 2)))
    expect(textured.color).toEqual([10, 20, 30])
    expect(textured.hidden).toBe(false)
    expect(textured.singleTex).toBe(false)

    const colored = byId.get(11)!
    expect(colored.hasMesh).toBe(true)
    expect(colored.texSize).toBe(0)
    expect(colored.color).toEqual([255, 0, 0])
    expect(colored.faceUv).toEqual({ up: { sx: 1, sy: 2, ex: 3, ey: 4, rotation: 1 } })

    const pivot = byId.get(12)!
    expect(pivot.hasMesh).toBe(false)
    expect(pivot.hidden).toBe(true)
    expect(pivot.pos).toEqual([0, 4, 0].map((v) => expect.closeTo(v, 2)))

    const item = byId.get(13)!
    expect(item.hidden).toBe(true)
    expect(item.item).toBe(true)

    const mirrored = byId.get(14)!
    expect(mirrored.parent).toBe(6)
    expect(mirrored.texSize).toBe(-1)
    expect(mirrored.mcScale).toBeCloseTo(0.5, 2)
    expect(mirrored.meshScale).toEqual([1, 2, 3].map((v) => expect.closeTo(v, 2)))
    expect(mirrored.scale).toEqual([2, 2, 2].map((v) => expect.closeTo(v, 2)))
    expect(mirrored.singleTex).toBe(true)
  })

  it('reads the legacy DEFINITION cubes and their nested blocks', () => {
    const legacyCube = Buffer.concat([
      u8(10, 20, 30),
      vec6b([1, 2, 3]),
      vec6b([-1, -2, -3]),
      angle([0, Math.PI / 2, 0]),
      varInt(0),
      u8(0),
      u8(9, 8, 7)
    ])
    const definition = Buffer.concat([varInt(1), legacyCube, block(0, Buffer.alloc(0))])
    const data = innerData([
      block(3, definition),
      block(MODEL_PARTS.SKIN, Buffer.concat([i16(64), i16(64), byteArray(PNG)]))
    ])

    const model = parseCpmModel(modelFile('Legado', '', data))
    const cube = model.cubes[0]

    expect(model.cubes).toHaveLength(1)
    expect(cube.id).toBe(10)
    expect(cube.size).toEqual([1, 2, 3].map((v) => expect.closeTo(v, 4)))
    expect(cube.pos).toEqual([1, 2, 3].map((v) => expect.closeTo(v, 2)))
    expect(cube.offset).toEqual([-1, -2, -3].map((v) => expect.closeTo(v, 2)))
    expect(cube.rotation[1]).toBeCloseTo(Math.PI / 2, 4)
    expect(cube.texSize).toBe(0)
    expect(cube.color).toEqual([9, 8, 7])
  })

  it('ignores texture sheets that are not the player skin', () => {
    const data = innerData([block(MODEL_PARTS.TEXTURE, Buffer.concat([u8(1), i16(64), i16(64), byteArray(PNG)]))])
    const model = parseCpmModel(modelFile('Sem skin', '', data))

    expect(model.texture).toBeNull()
    expect(model.sheet).toEqual([64, 64])
  })

  it('rejects files that are not CPM models', () => {
    expect(() => parseCpmModel(Buffer.alloc(0))).toThrow(CpmParseError)
    expect(() => parseCpmModel(Buffer.alloc(20))).toThrow('Assinatura de .cpmmodel inválida')

    const badData = modelFile('x', '', Buffer.from([0x00, 0x00, 0x00, 0x00]))
    expect(() => parseCpmModel(badData)).toThrow('Bloco de definição inválido')
  })

  it('rejects truncated files', () => {
    const valid = fixture()
    expect(() => parseCpmModel(valid.subarray(0, valid.length - 8))).toThrow(CpmParseError)

    const emptyData = modelFile('x', '', Buffer.from([CPM_MODEL_MAGIC, 0x01, 0x00, 0x00]))
    expect(() => parseCpmModel(emptyData)).toThrow('truncado')
  })
})

/* --------------------------------------------------------------------------------------------- */
/* Geometry                                                                                       */
/* --------------------------------------------------------------------------------------------- */

type BoxOptions = Parameters<typeof buildBoxMesh>[0]

function box(overrides: Partial<BoxOptions> = {}): CpmMeshData {
  const mesh = buildBoxMesh({
    offset: [0, 0, 0],
    size: [8, 8, 8],
    meshScale: [1, 1, 1],
    mcScale: 0,
    uv: [0, 0],
    texSize: 1,
    sheet: [64, 64],
    faceUv: null,
    singleTex: false,
    tint: [1, 1, 1],
    textured: true,
    ...overrides
  })

  expect(mesh).not.toBeNull()
  return mesh!
}

function vertex(mesh: CpmMeshData, index: number): CpmVec3 {
  return [mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2]]
}

function uvsOf(mesh: CpmMeshData, index: number): [number, number] {
  return [mesh.uvs[index * 2], mesh.uvs[index * 2 + 1]]
}

/** Every triangle must face away from the center of the box. */
function expectOutwardWinding(mesh: CpmMeshData, center: CpmVec3) {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = vertex(mesh, mesh.indices[i])
    const b = vertex(mesh, mesh.indices[i + 1])
    const c = vertex(mesh, mesh.indices[i + 2])

    const ab: CpmVec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac: CpmVec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normal: CpmVec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ]
    const centroid: CpmVec3 = [(a[0] + b[0] + c[0]) / 3 - center[0], (a[1] + b[1] + c[1]) / 3 - center[1], (a[2] + b[2] + c[2]) / 3 - center[2]]

    expect(normal[0] * centroid[0] + normal[1] * centroid[1] + normal[2] * centroid[2]).toBeGreaterThan(0)
  }
}

describe('buildBoxMesh', () => {
  it('builds six textured quads with the Minecraft box layout', () => {
    const mesh = box()

    expect(mesh.positions).toHaveLength(24 * 3)
    expect(mesh.uvs).toHaveLength(24 * 2)
    expect(mesh.colors).toHaveLength(24 * 3)
    expect(mesh.indices).toHaveLength(36)

    expect(mesh.indices.slice(0, 6)).toEqual([0, 1, 2, 0, 2, 3])

    // East face: (u2,v1) (u1,v1) (u1,v2) (u2,v2) over the f6..f8 / f11..f12 rectangle.
    expect(uvsOf(mesh, 0)).toEqual([24 / 64, 8 / 64])
    expect(uvsOf(mesh, 1)).toEqual([16 / 64, 8 / 64])
    expect(uvsOf(mesh, 2)).toEqual([16 / 64, 16 / 64])
    expect(uvsOf(mesh, 3)).toEqual([24 / 64, 16 / 64])

    // Up face sits between f5..f6 / f10..f11.
    expect(uvsOf(mesh, 8)).toEqual([16 / 64, 0])
    expect(uvsOf(mesh, 9)).toEqual([8 / 64, 0])
    expect(uvsOf(mesh, 10)).toEqual([8 / 64, 8 / 64])
    expect(uvsOf(mesh, 11)).toEqual([16 / 64, 8 / 64])
  })

  it('uses the Minecraft face shading for textured and colored cubes', () => {
    const textured = box()
    const colored = box({ textured: false, tint: [1, 0.5, 0.25] })

    // East/west 0.6, up 1, down 0.5, north/south 0.8.
    // Faces in order: east, west, up, down, north, south.
    expect(textured.colors[0]).toBeCloseTo(0.6)
    expect(textured.colors[8 * 3]).toBeCloseTo(1)
    expect(textured.colors[12 * 3]).toBeCloseTo(0.5)
    expect(textured.colors[20 * 3]).toBeCloseTo(0.8)

    expect(colored.colors[0]).toBeCloseTo(0.6)
    expect(colored.colors[1]).toBeCloseTo(0.3)
    expect(colored.colors[2]).toBeCloseTo(0.15)
    expect(colored.textured).toBe(false)
    expect(colored.uvs.every((value) => value === 0)).toBe(true)
  })

  it('mirrors the box and the UVs when the texture size is negative', () => {
    const normal = box()
    const mirrored = box({ texSize: -1 })

    // The bounds are swapped, so the east face now sits on x = 0.
    expect(vertex(normal, 0)[0]).toBe(8)
    expect(vertex(mirrored, 0)[0]).toBe(0)

    // UVs are assigned normally and then reversed with the vertices.
    expect(uvsOf(mirrored, 0)).toEqual([24 / 64, 16 / 64])
    expect(uvsOf(mirrored, 3)).toEqual([24 / 64, 8 / 64])

    const positions = (mesh: CpmMeshData) =>
      Array.from({ length: mesh.positions.length / 3 }, (_, i) => vertex(mesh, i).join(',')).sort()
    expect(positions(mirrored)).toEqual(positions(normal))

    expectOutwardWinding(mirrored, [4, 4, 4])
  })

  it('keeps the faces outward for a normal box', () => {
    expectOutwardWinding(box(), [4, 4, 4])
  })

  it('draws every face with the same square for single texture cubes', () => {
    const mesh = box({ size: [4, 8, 2], uv: [4, 4], singleTex: true })

    expect(mesh.positions).toHaveLength(24 * 3)
    // Every face samples the same 8x8 square that starts at u=4, v=4.
    for (let face = 0; face < 6; face++) {
      expect(uvsOf(mesh, face * 4)).toEqual([12 / 64, 4 / 64])
      expect(uvsOf(mesh, face * 4 + 1)).toEqual([4 / 64, 4 / 64])
      expect(uvsOf(mesh, face * 4 + 2)).toEqual([4 / 64, 12 / 64])
      expect(uvsOf(mesh, face * 4 + 3)).toEqual([12 / 64, 12 / 64])
    }
  })

  it('draws only the faces a per face UV effect lists', () => {
    const mesh = box({
      faceUv: {
        east: { sx: 1, sy: 2, ex: 3, ey: 4, rotation: 0 },
        up: { sx: 5, sy: 6, ex: 7, ey: 8, rotation: 1 }
      }
    })

    expect(mesh.positions).toHaveLength(8 * 3)
    expect(mesh.indices).toHaveLength(12)

    // Rotation 0 walks the rectangle backwards: (ex,sy) (sx,sy) (sx,ey) (ex,ey).
    expect(uvsOf(mesh, 0)).toEqual([3 / 64, 2 / 64])
    expect(uvsOf(mesh, 1)).toEqual([1 / 64, 2 / 64])
    expect(uvsOf(mesh, 2)).toEqual([1 / 64, 4 / 64])
    expect(uvsOf(mesh, 3)).toEqual([3 / 64, 4 / 64])

    // Rotation 1 starts one corner further.
    expect(uvsOf(mesh, 4)).toEqual([5 / 64, 6 / 64])
    expect(uvsOf(mesh, 5)).toEqual([5 / 64, 8 / 64])
    expect(uvsOf(mesh, 6)).toEqual([7 / 64, 8 / 64])
    expect(uvsOf(mesh, 7)).toEqual([7 / 64, 6 / 64])
  })

  it('inflates the box with mcScale and scales it with meshScale', () => {
    const inflated = box({ size: [0, 0, 0], mcScale: 1 })
    expect(Math.min(...inflated.positions)).toBe(-1)
    expect(Math.max(...inflated.positions)).toBe(1)

    const scaled = box({ size: [2, 3, 4], meshScale: [2, 1, 0.5] })
    expect(vertex(scaled, 1)).toEqual([4, 0, 0])
    expect(vertex(scaled, 2)).toEqual([4, 3, 0])
    expect(vertex(scaled, 5)).toEqual([0, 0, 2])
  })

  it('returns null when CPM would draw nothing', () => {
    expect(buildBoxMesh({
      offset: [0, 0, 0],
      size: [0, 0, 0],
      meshScale: [1, 1, 1],
      mcScale: 0,
      uv: [0, 0],
      texSize: 1,
      sheet: [64, 64],
      faceUv: null,
      singleTex: false,
      tint: [1, 1, 1],
      textured: true
    })).toBeNull()
  })
})

/* --------------------------------------------------------------------------------------------- */
/* Scene tree                                                                                     */
/* --------------------------------------------------------------------------------------------- */

function part(part: number, overrides: Partial<CpmPreviewModel['parts'][number]> = {}): CpmPreviewModel['parts'][number] {
  return { part, pos: [0, 0, 0], rotation: [0, 0, 0], hidden: false, ...overrides }
}

function cubeData(id: number, parent: number, overrides: Partial<CpmCubeData> = {}): CpmCubeData {
  return {
    id,
    parent,
    hasMesh: true,
    pos: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    offset: [0, 0, 0],
    meshScale: [1, 1, 1],
    scale: [1, 1, 1],
    mcScale: 0,
    texSize: 1,
    uv: [0, 0],
    color: null,
    hidden: false,
    faceUv: null,
    singleTex: false,
    item: false,
    ...overrides
  }
}

function makeModel(overrides: Partial<CpmPreviewModel> = {}): CpmPreviewModel {
  return {
    name: 'Teste',
    description: '',
    skinType: 'default',
    sheet: [64, 64],
    texture: null,
    icon: null,
    keepParts: [true, true, true, true, true, true, true],
    parts: Array.from({ length: 7 }, (_, i) => part(i)),
    cubes: [],
    ...overrides
  }
}

describe('buildCpmScene', () => {
  it('creates the seven vanilla part nodes at their pivots', () => {
    const root = buildCpmScene(makeModel())

    expect(root.children.map((node) => node.name)).toEqual([
      'head',
      'body',
      'left_arm',
      'right_arm',
      'left_leg',
      'right_leg',
      'custom_part'
    ])
    expect(root.children[0].position).toEqual([0, 0, 0])
    expect(root.children[2].position).toEqual([5, 2, 0])
    expect(root.children[4].position).toEqual([1.9, 12, 0])
    expect(root.children[0].mesh).not.toBeNull()
    expect(root.children[6].mesh).toBeNull()
  })

  it('adds the part transform on top of the vanilla pivot', () => {
    const model = makeModel({ parts: [part(0, { pos: [1, 2, 3], rotation: [0, Math.PI / 2, 0] })] })
    const head = buildCpmScene(model).children[0]

    expect(head.position).toEqual([1, 2, 3])
    expect(head.rotation[1]).toBeCloseTo(Math.PI / 2)
  })

  it('hides the vanilla mesh of a hidden part but keeps its children', () => {
    const model = makeModel({
      parts: [part(0, { hidden: true })],
      cubes: [cubeData(10, 0)]
    })
    const head = buildCpmScene(model).children[0]

    expect(head.mesh).toBeNull()
    expect(head.children.map((node) => node.id)).toEqual([10])
  })

  it('uses the slim arm size when the model is slim', () => {
    const xRange = (mesh: CpmMeshData): [number, number] => {
      const xs = Array.from({ length: mesh.positions.length / 3 }, (_, i) => vertex(mesh, i)[0])
      return [Math.min(...xs), Math.max(...xs)]
    }

    expect(xRange(buildCpmScene(makeModel()).children[2].mesh!)).toEqual([-1, 3])
    expect(xRange(buildCpmScene(makeModel({ skinType: 'slim' })).children[2].mesh!)).toEqual([-1, 2])
  })

  it('nests cubes under their parent cube, or under a part when the parent is a part id', () => {
    const model = makeModel({
      cubes: [cubeData(10, 0), cubeData(11, 10), cubeData(12, 3)]
    })
    const root = buildCpmScene(model)
    const head = root.children[0]
    const rightArm = root.children[3]

    expect(head.children.map((node) => node.id)).toEqual([10])
    expect(head.children[0].children.map((node) => node.id)).toEqual([11])
    expect(rightArm.children.map((node) => node.id)).toEqual([12])
  })

  it('falls back to the custom part for an unknown parent', () => {
    const root = buildCpmScene(makeModel({ cubes: [cubeData(10, 42)] }))
    expect(root.children[6].children.map((node) => node.id)).toEqual([10])
  })

  it('keeps pivot and item cubes without a mesh but still renders their children', () => {
    const model = makeModel({
      cubes: [
        cubeData(10, 0, { hasMesh: false }),
        cubeData(11, 10),
        cubeData(12, 0, { hidden: true }),
        cubeData(13, 12),
        cubeData(14, 0, { item: true }),
        cubeData(15, 14)
      ]
    })
    const head = buildCpmScene(model).children[0]

    expect(head.children.find((node) => node.id === 10)!.mesh).toBeNull()
    expect(head.children.find((node) => node.id === 10)!.children.map((node) => node.id)).toEqual([11])
    expect(head.children.find((node) => node.id === 12)!.mesh).toBeNull()
    expect(head.children.find((node) => node.id === 12)!.children.map((node) => node.id)).toEqual([13])
    expect(head.children.find((node) => node.id === 14)!.mesh).toBeNull()
    expect(head.children.find((node) => node.id === 14)!.children.map((node) => node.id)).toEqual([15])
  })

  it('clamps a zero or negative cube scale', () => {
    const node = buildCpmScene(makeModel({ cubes: [cubeData(10, 0, { scale: [0, 2, -1] })] })).children[0].children[0]
    expect(node.scale).toEqual([0.01, 2, 0.01])
  })

  it('builds the meshes of the parsed fixture', () => {
    const model = parseCpmModel(fixture())
    const root = buildCpmScene(model)
    const nodes = root.children.flatMap((node) => [node, ...node.children])

    expect(root.children).toHaveLength(7)
    expect(nodes.filter((node) => node.mesh).length).toBeGreaterThan(0)

    for (const node of nodes) {
      if (!node.mesh) continue
      expect(node.mesh.positions.length % 12).toBe(0)
      expect(node.mesh.uvs.length).toBe((node.mesh.positions.length / 3) * 2)
      expect(node.mesh.colors.length).toBe(node.mesh.positions.length)
      expect(node.mesh.indices.length % 6).toBe(0)
    }
  })
})

/* --------------------------------------------------------------------------------------------- */
/* Real models                                                                                    */
/* --------------------------------------------------------------------------------------------- */

const realModelsDir = path.join(process.env.APPDATA ?? '', '.aurora_studios', 'aurora-studios', 'player_models')
const realModels = existsSync(realModelsDir)
  ? readdirSync(realModelsDir).filter((name) => name.toLowerCase().endsWith('.cpmmodel'))
  : []

describe.skipIf(realModels.length === 0)('real .cpmmodel files', () => {
  for (const name of realModels) {
    it(`parses ${name}`, () => {
      const model = parseCpmModel(readFileSync(path.join(realModelsDir, name)))
      const ids = new Set(model.cubes.map((cube) => cube.id))

      expect(model.sheet[0]).toBeGreaterThan(0)
      expect(model.sheet[1]).toBeGreaterThan(0)
      expect(model.keepParts).toHaveLength(7)
      expect(model.parts).toHaveLength(7)

      for (const cube of model.cubes) {
        expect(cube.id).toBeGreaterThanOrEqual(10)
        expect(cube.parent >= 0 && cube.parent <= 6 || ids.has(cube.parent)).toBe(true)
      }

      const root = buildCpmScene(model)
      expect(root.children).toHaveLength(7)

      const nodes = root.children.flatMap((node) => [node, ...node.children])
      for (const node of nodes) {
        if (!node.mesh) continue
        expect(node.mesh.positions.length % 12).toBe(0)
        expect(node.mesh.uvs.length).toBe((node.mesh.positions.length / 3) * 2)
        expect(node.mesh.indices.length % 6).toBe(0)
      }
    })
  }
})
