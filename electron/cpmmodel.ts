/**
 * Reads the binary `.cpmmodel` format used by Customizable Player Models.
 *
 * The format is a small container with a compressed block tree inside. The launcher only needs
 * enough of it to draw a static preview: the skin texture, which vanilla parts the model keeps,
 * the extra cubes and the render effects that change their look. Animation, links, templates and
 * the other block types are skipped.
 *
 * Everything here is pure: the parser takes a `Buffer` and returns plain objects, so it can be
 * unit tested and sent over IPC.
 */

/** First byte of a model file and of the inner data block. */
export const CPM_MODEL_MAGIC = 0x53

/** Scale factor of the fixed point numbers used by the format (48 pixels map to a short). */
const DIV = 32767 / 48

/** Directions a cube face can point to, named the way Minecraft does. */
export type CpmFace = 'up' | 'down' | 'north' | 'south' | 'east' | 'west'

export type CpmVec3 = [number, number, number]

/** UV rectangle of a single face, in texture pixels, with the rotation CPM applied to it. */
export interface CpmFaceUv {
  sx: number
  sy: number
  ex: number
  ey: number
  /** 0..3, clockwise quarter turns. */
  rotation: number
}

/** One cube of the model, in the same units CPM uses: pixels and radians. */
export interface CpmCubeData {
  /** Cube id inside the file. 10 and up; 0..6 are the vanilla player parts. */
  id: number
  /** Id of the parent cube or vanilla part this cube is attached to. */
  parent: number
  /** Whether the cube has a mesh. A cube without one is only a pivot for its children. */
  hasMesh: boolean
  pos: CpmVec3
  /** Radians, applied in ZYX order like CPM does. */
  rotation: CpmVec3
  size: CpmVec3
  offset: CpmVec3
  meshScale: CpmVec3
  scale: CpmVec3
  /** Inflates the box on every axis (the "inflate" value of a cube). */
  mcScale: number
  /** 1 for a normal textured cube, other values scale the UVs, 0 means a solid color. */
  texSize: number
  /** Top-left corner of the box in the skin texture, in pixels. */
  uv: [number, number]
  /** Solid color as 0..255 components, or null for textured cubes. */
  color: CpmVec3 | null
  hidden: boolean
  /** Per face UVs, when the model overrides the default box layout. */
  faceUv: Partial<Record<CpmFace, CpmFaceUv>> | null
  /** Renders the whole face area on every side instead of the box layout. */
  singleTex: boolean
  /** The cube renders an item instead of a box; a static preview cannot draw those. */
  item: boolean
}

/** Transform applied on top of a vanilla player part. */
export interface CpmPartData {
  /** 0 = head, 1 = body, 2 = left arm, 3 = right arm, 4 = left leg, 5 = right leg, 6 = custom. */
  part: number
  pos: CpmVec3
  rotation: CpmVec3
  hidden: boolean
}

export interface CpmPreviewModel {
  name: string
  description: string
  skinType: 'slim' | 'default'
  /** Size CPM uses to normalize UVs, in pixels. Not always the pixel size of the PNG. */
  sheet: [number, number]
  /** `data:image/png;base64,...` with the model skin, or null when the model uses the player skin. */
  texture: string | null
  /** `data:image/png;base64,...` with the model icon, or null when there is none. */
  icon: string | null
  /** Which vanilla parts (0..6) keep their default geometry. */
  keepParts: boolean[]
  parts: CpmPartData[]
  cubes: CpmCubeData[]
}

export type ICpmPreviewResult = { ok: true; model: CpmPreviewModel } | { ok: false; error: string }

export class CpmParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CpmParseError'
  }
}

/** Bounded reader over a `Buffer`; every read checks the block it belongs to. */
class CpmReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  get remaining(): number {
    return this.buffer.length - this.offset
  }

  private need(count: number) {
    if (count < 0 || this.offset + count > this.buffer.length) {
      throw new CpmParseError('Arquivo .cpmmodel truncado ou corrompido')
    }
  }

  u8(): number {
    this.need(1)
    return this.buffer[this.offset++]
  }

  i8(): number {
    const value = this.u8()
    return value > 127 ? value - 256 : value
  }

  i16(): number {
    this.need(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  bytes(count: number): Buffer {
    this.need(count)
    const value = this.buffer.subarray(this.offset, this.offset + count)
    this.offset += count
    return value
  }

  /** Reads a block of `count` bytes into a reader of its own. */
  sub(count: number): CpmReader {
    return new CpmReader(this.bytes(count))
  }

  varInt(): number {
    let value = 0
    let shift = 1

    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      value += (byte & 0x7f) * shift
      if ((byte & 0x80) === 0) return value
      shift *= 128
    }

    throw new CpmParseError('Número inválido no arquivo .cpmmodel')
  }

  signedVarInt(): number {
    let byte = this.i8()
    const sign = (byte & 0x40) !== 0 ? -1 : 1
    let value = byte & 0x3f
    let shift = 64

    while ((byte & 0x80) !== 0) {
      byte = this.i8()
      value += (byte & 0x7f) * shift
      shift *= 128
      if (shift > 2 ** 35) throw new CpmParseError('Número inválido no arquivo .cpmmodel')
    }

    return value * sign
  }

  /** Two byte fixed point number. */
  float2(): number {
    return this.i16() / DIV
  }

  varFloat(): number {
    return this.signedVarInt() / DIV
  }

  vec6b(): CpmVec3 {
    return [this.float2(), this.float2(), this.float2()]
  }

  varVec3(): CpmVec3 {
    return [this.varFloat(), this.varFloat(), this.varFloat()]
  }

  /** Three angles stored as unsigned shorts over a full turn, returned in radians. */
  angle(): CpmVec3 {
    const read = () => (this.i16() / 65535) * Math.PI * 2
    return [read(), read(), read()]
  }

  utf(): string {
    const length = this.varInt()
    return this.bytes(length).toString('utf8')
  }

  byteArray(): Buffer {
    return this.bytes(this.varInt())
  }
}

const PLAYER_PART_COUNT = 7

interface ParsedEffect {
  kind: number
  id: number
  hidden?: boolean
  color?: CpmVec3
  mcScale?: number
  meshScale?: CpmVec3
  faceUv?: Partial<Record<CpmFace, CpmFaceUv>>
  uv?: [number, number]
}

interface ParseContext {
  skinType: number | null
  keep: boolean[]
  partPos: Map<number, { pos: CpmVec3; rotation: CpmVec3 }>
  partHidden: Map<number, boolean>
  texture: { sheet: [number, number]; png: Buffer } | null
  cubes: CpmCubeData[]
  effects: ParsedEffect[]
}

const RENDER_EFFECTS = {
  GLOW: 0,
  SCALE: 1,
  HIDE: 2,
  COLOR: 3,
  SINGLE_TEX: 4,
  PER_FACE_UV: 5,
  UV_OVERFLOW: 6,
  ITEM: 7,
  HIDE_SKULL: 8,
  REMOVE_ARMOR_OFFSET: 9,
  EXTRUDE: 10,
  PLAYER_SCALE: 11,
  MODEL_SCALE: 12,
  SCALING: 13,
  COPY_TRANSFORM: 14,
  FIRST_PERSON_HAND: 15,
  DISABLE_VANILLA: 16,
  REMOVE_BED_OFFSET: 17,
  INVIS_GLOW: 18
} as const

const MODEL_PARTS = {
  END: 0,
  PLAYER: 1,
  DEFINITION: 3,
  SKIN: 5,
  PLAYER_PARTPOS: 7,
  RENDER_EFFECT: 8,
  SKIN_TYPE: 11,
  TEXTURE: 17,
  CUBES: 21,
  ROOT_INFO: 22
} as const

/** Face order used by CPM's per face UV data. */
const FACE_ORDER: CpmFace[] = ['up', 'down', 'north', 'south', 'east', 'west']

/** Reads the blocks that can appear at the top level or inside a definition. */
function parseParts(reader: CpmReader, ctx: ParseContext) {
  for (;;) {
    const type = reader.u8()
    const length = reader.varInt()
    const block = reader.sub(length)

    if (type === MODEL_PARTS.END) return

    switch (type) {
      case MODEL_PARTS.PLAYER:
        parsePlayer(block, ctx)
        break
      case MODEL_PARTS.DEFINITION:
        parseDefinition(block, ctx)
        break
      case MODEL_PARTS.SKIN:
        parseTexture(block, ctx)
        break
      case MODEL_PARTS.TEXTURE:
        parseTypedTexture(block, ctx)
        break
      case MODEL_PARTS.PLAYER_PARTPOS:
        parsePartPos(block, ctx)
        break
      case MODEL_PARTS.RENDER_EFFECT:
        parseRenderEffect(block, ctx)
        break
      case MODEL_PARTS.SKIN_TYPE:
        ctx.skinType = block.u8()
        break
      case MODEL_PARTS.CUBES:
        parseCubesV2(block, ctx)
        break
      case MODEL_PARTS.ROOT_INFO:
        parseRootInfo(block, ctx)
        break
      default:
        // Animation data, links, tags, icons: not needed for a static preview.
        break
    }
  }
}

function parsePlayer(reader: CpmReader, ctx: ParseContext) {
  const bits = reader.u8()
  for (let i = 0; i < ctx.keep.length; i++) ctx.keep[i] = (bits & (1 << i)) !== 0
}

function parseDefinition(reader: CpmReader, ctx: ParseContext) {
  const count = reader.varInt()
  for (let i = 0; i < count; i++) {
    const cube = parseLegacyCube(reader, i + 10)
    if (cube) ctx.cubes.push(cube)
  }

  parseParts(reader, ctx)
}

function parseLegacyCube(reader: CpmReader, id: number): CpmCubeData {
  const size: CpmVec3 = [reader.u8() / 10, reader.u8() / 10, reader.u8() / 10]
  const pos = reader.vec6b()
  const offset = reader.vec6b()
  const rotation = reader.angle()
  const parent = reader.varInt()
  const tex = reader.i8()

  let texSize = 0
  let uv: [number, number] = [0, 0]
  let color: CpmVec3 | null = null

  if (tex === 0) {
    color = [reader.u8(), reader.u8(), reader.u8()]
  } else {
    texSize = tex
    uv = [reader.u8(), reader.u8()]
  }

  return {
    id,
    parent,
    hasMesh: true,
    pos,
    rotation,
    size,
    offset,
    meshScale: [1, 1, 1],
    scale: [1, 1, 1],
    mcScale: 0,
    texSize,
    uv,
    color,
    hidden: false,
    faceUv: null,
    singleTex: false,
    item: false
  }
}

const CUBE_FLAGS = {
  HAS_MESH: 1 << 0,
  HAS_TEXTURE: 1 << 1,
  HIDDEN: 1 << 2,
  MESH_SCALED: 1 << 3,
  UV_SCALED: 1 << 4,
  MC_SCALED: 1 << 5,
  SCALED: 1 << 6
} as const

function parseCubesV2(reader: CpmReader, ctx: ParseContext) {
  const count = reader.varInt()

  for (let i = 0; i < count; i++) {
    const flags = reader.u8()
    const parent = reader.varInt()
    const pos = reader.varVec3()
    const rotation = reader.angle()
    const hasMesh = (flags & CUBE_FLAGS.HAS_MESH) !== 0

    let size: CpmVec3 = [0, 0, 0]
    let offset: CpmVec3 = [0, 0, 0]
    let texSize = 0
    let uv: [number, number] = [0, 0]
    let color: CpmVec3 | null = null
    let mcScale = 0

    if (hasMesh) {
      size = reader.varVec3()
      offset = reader.varVec3()

      if ((flags & CUBE_FLAGS.HAS_TEXTURE) !== 0) {
        texSize = (flags & CUBE_FLAGS.UV_SCALED) !== 0 ? reader.i8() : 1
        uv = [reader.varInt(), reader.varInt()]
      } else {
        color = [reader.u8(), reader.u8(), reader.u8()]
      }

      if ((flags & CUBE_FLAGS.MC_SCALED) !== 0) mcScale = reader.float2()
    }

    const meshScale = (flags & CUBE_FLAGS.MESH_SCALED) !== 0 ? reader.varVec3() : ([1, 1, 1] as CpmVec3)
    const scale = (flags & CUBE_FLAGS.SCALED) !== 0 ? reader.varVec3() : ([1, 1, 1] as CpmVec3)

    ctx.cubes.push({
      id: i + 10,
      parent,
      hasMesh,
      pos,
      rotation,
      size,
      offset,
      meshScale,
      scale,
      mcScale,
      texSize,
      uv,
      color,
      hidden: (flags & CUBE_FLAGS.HIDDEN) !== 0,
      faceUv: null,
      singleTex: false,
      item: false
    })
  }
}

function parseTexture(reader: CpmReader, ctx: ParseContext) {
  const width = reader.i16()
  const height = reader.i16()
  const png = reader.byteArray()

  if (width <= 0 || height <= 0 || !isPng(png)) return
  ctx.texture = { sheet: [width, height], png }
}

function parseTypedTexture(reader: CpmReader, ctx: ParseContext) {
  // TextureSheetType: 0 = skin, the other sheets are not drawn on the player body.
  if (reader.u8() !== 0) return
  parseTexture(reader, ctx)
}

function parsePartPos(reader: CpmReader, ctx: ParseContext) {
  const part = reader.varInt()
  if (part < 0 || part >= PLAYER_PART_COUNT) return

  ctx.partPos.set(part, { pos: reader.vec6b(), rotation: reader.angle() })
}

const ROOT_INFO_FLAGS = {
  HIDDEN: 1 << 0,
  CREATE: 1 << 1,
  MODEL: 1 << 2,
  TRANSFORM: 1 << 3,
  DISABLE_VANILLA: 1 << 4
} as const

function parseRootInfo(reader: CpmReader, ctx: ParseContext) {
  const flags = reader.u8()
  // When the model bit is set the enum is a cape/armor/elytra root, not a player part.
  if ((flags & ROOT_INFO_FLAGS.MODEL) !== 0) return

  const part = reader.u8()
  if (part >= PLAYER_PART_COUNT) return

  let pos: CpmVec3 = [0, 0, 0]
  let rotation: CpmVec3 = [0, 0, 0]
  if ((flags & ROOT_INFO_FLAGS.TRANSFORM) !== 0) {
    pos = reader.varVec3()
    rotation = reader.angle()
  }

  let createFrom = 0
  if ((flags & ROOT_INFO_FLAGS.CREATE) !== 0) createFrom = reader.varInt()

  // A root created from a cube only exists in game; the preview keeps the part where it is.
  if (createFrom !== 0) return

  ctx.partHidden.set(part, (flags & ROOT_INFO_FLAGS.HIDDEN) !== 0)
  ctx.partPos.set(part, { pos, rotation })
}

function parseRenderEffect(reader: CpmReader, ctx: ParseContext) {
  const kind = reader.u8()

  switch (kind) {
    case RENDER_EFFECTS.SCALE: {
      const id = reader.varInt()
      const mcScale = reader.float2()
      const meshScale = reader.vec6b()
      ctx.effects.push({ kind, id, mcScale, meshScale })
      break
    }
    case RENDER_EFFECTS.HIDE:
      ctx.effects.push({ kind, id: reader.varInt(), hidden: true })
      break
    case RENDER_EFFECTS.COLOR:
      ctx.effects.push({ kind, id: reader.varInt(), color: [reader.u8(), reader.u8(), reader.u8()] })
      break
    case RENDER_EFFECTS.SINGLE_TEX:
    case RENDER_EFFECTS.EXTRUDE:
    case RENDER_EFFECTS.ITEM:
    case RENDER_EFFECTS.GLOW:
      ctx.effects.push({ kind, id: reader.varInt() })
      break
    case RENDER_EFFECTS.PER_FACE_UV:
      ctx.effects.push({ kind, id: reader.varInt(), faceUv: parsePerFaceUv(reader) })
      break
    case RENDER_EFFECTS.UV_OVERFLOW:
      ctx.effects.push({ kind, id: reader.varInt(), uv: [reader.varInt(), reader.varInt()] })
      break
    default:
      // Unknown effect: the block length already told the caller where it ends.
      break
  }
}

function parsePerFaceUv(reader: CpmReader): Partial<Record<CpmFace, CpmFaceUv>> {
  const mask = reader.u8()
  const faces: Partial<Record<CpmFace, CpmFaceUv>> = {}

  for (let i = 0; i < FACE_ORDER.length; i++) {
    if ((mask & (1 << i)) === 0) continue
    faces[FACE_ORDER[i]] = {
      sx: reader.varInt(),
      sy: reader.varInt(),
      ex: reader.varInt(),
      ey: reader.varInt(),
      rotation: reader.u8()
    }
  }

  return faces
}

function isPng(data: Buffer): boolean {
  return (
    data.length > 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
}

function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`
}

/** Applies the render effects once every cube is known, the same way CPM does. */
function applyEffects(ctx: ParseContext) {
  const byId = new Map<number, CpmCubeData>()
  for (const cube of ctx.cubes) byId.set(cube.id, cube)

  for (const effect of ctx.effects) {
    if (effect.id < 10) {
      // Effects on a vanilla part id hide the part itself (its cubes stay visible).
      if (effect.hidden) ctx.partHidden.set(effect.id, true)
      continue
    }

    const cube = byId.get(effect.id)
    if (!cube) continue

    switch (effect.kind) {
      case RENDER_EFFECTS.SCALE:
        if (effect.meshScale) cube.meshScale = effect.meshScale
        if (effect.mcScale !== undefined) cube.mcScale = effect.mcScale
        break
      case RENDER_EFFECTS.HIDE:
        cube.hidden = true
        break
      case RENDER_EFFECTS.COLOR:
        if (effect.color) cube.color = effect.color
        break
      case RENDER_EFFECTS.SINGLE_TEX:
        cube.singleTex = true
        break
      case RENDER_EFFECTS.PER_FACE_UV:
        if (effect.faceUv) cube.faceUv = effect.faceUv
        break
      case RENDER_EFFECTS.UV_OVERFLOW:
        if (effect.uv) cube.uv = effect.uv
        break
      case RENDER_EFFECTS.ITEM:
        // CPM replaces the box with the item model; nothing to draw here.
        cube.item = true
        break
      default:
        break
    }
  }
}

/**
 * Parses one `.cpmmodel` file.
 *
 * Throws `CpmParseError` when the file is not a model or is truncated.
 */
export function parseCpmModel(buffer: Buffer): CpmPreviewModel {
  if (buffer.length < 12) throw new CpmParseError('Arquivo .cpmmodel vazio')

  // The last two bytes are a checksum over the rest of the container.
  const container = new CpmReader(buffer.subarray(0, buffer.length - 2))
  if (container.u8() !== CPM_MODEL_MAGIC) throw new CpmParseError('Assinatura de .cpmmodel inválida')

  const name = container.utf()
  const description = container.utf()
  const dataBlock = container.byteArray()
  const overflow = container.byteArray()
  const iconBlock = container.byteArray()

  // The overflow block holds extra data for old versions; ignore whatever is there.
  void overflow

  if (dataBlock.length < 4 || dataBlock[0] !== CPM_MODEL_MAGIC) {
    throw new CpmParseError('Bloco de definição inválido')
  }

  const ctx: ParseContext = {
    skinType: null,
    keep: new Array<boolean>(PLAYER_PART_COUNT + 1).fill(true),
    partPos: new Map(),
    partHidden: new Map(),
    texture: null,
    cubes: [],
    effects: []
  }

  parseParts(new CpmReader(dataBlock.subarray(1, dataBlock.length - 2)), ctx)
  applyEffects(ctx)

  const parts: CpmPartData[] = []
  for (let part = 0; part < PLAYER_PART_COUNT; part++) {
    const transform = ctx.partPos.get(part)
    parts.push({
      part,
      pos: transform?.pos ?? [0, 0, 0],
      rotation: transform?.rotation ?? [0, 0, 0],
      hidden: ctx.partHidden.get(part) ?? !ctx.keep[part]
    })
  }

  return {
    name,
    description,
    skinType: ctx.skinType === 0 ? 'slim' : 'default',
    sheet: ctx.texture?.sheet ?? [64, 64],
    texture: ctx.texture ? toDataUrl(ctx.texture.png) : null,
    icon: isPng(iconBlock) ? toDataUrl(iconBlock) : null,
    keepParts: ctx.keep.slice(0, PLAYER_PART_COUNT),
    parts,
    cubes: ctx.cubes
  }
}
