import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compareVersions,
  diagnoseMods,
  filenameMinecraftVersion,
  normalizeLoaderVersion,
  readModMetadata,
  satisfiesVersionRange,
  scanModsDir,
  type IModMetadata,
  type IScannedMod
} from '../electron/modscan'

/* -------------------------------------------------------------------------- */
/* Minimal ZIP writer: the reader has to be tested against a real archive, and */
/* committing a binary jar fixture just for this would be worse.               */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildJar(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, 'utf8')
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuffer.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    nameBuffer.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuffer.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuffer.copy(central, 46)

    locals.push(local, compressed)
    centrals.push(central)
    offset += local.length + compressed.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(centrals.length, 8)
  end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, directory, end])
}

function writeJar(filePath: string, entries: Record<string, string | Buffer>) {
  writeFileSync(filePath, buildJar(entries))
}

/* -------------------------------------------------------------------------- */

const FORGE_TOML = `
modLoader="javafml"
loaderVersion="[47,)"
license="MIT"

[[mods]]
modId="example"
version="\${file.jarVersion}"
displayName="Example Mod"

[[dependencies.example]]
    modId="minecraft"
    mandatory=true
    versionRange="[1.20.1]"
    ordering="NONE"
    side="BOTH"

[[dependencies.example]]
    modId="citadel"
    mandatory=true
    versionRange="[2,)"
    side="BOTH"
`

/** A minimal Forge jar carrying one mod, used as a nested jar in the wrapper tests. */
function forgeJar(modId: string, name: string, dependencies = ''): Buffer {
  return buildJar({
    'META-INF/mods.toml': `modLoader="javafml"\nloaderVersion="[47,)"\n\n[[mods]]\nmodId="${modId}"\nversion="1.0.0"\ndisplayName="${name}"\n${dependencies}`
  })
}

let dir = ''

function mod(partial: Partial<IModMetadata> & { modId: string }): IScannedMod {
  return {
    file: `${partial.modId}.jar`,
    enabled: true,
    metadata: {
      file: `${partial.modId}.jar`,
      enabled: true,
      modId: partial.modId,
      name: partial.name ?? partial.modId,
      version: partial.version ?? '1.0.0',
      loader: 'forge',
      loaderVersion: partial.loaderVersion,
      dependencies: partial.dependencies ?? []
    }
  }
}

function issueFor(mods: IScannedMod[], kind: string, file?: string) {
  return diagnoseMods(mods, { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' }).find(
    (issue) => issue.kind === kind && (!file || issue.file === file)
  )
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aurora-modscan-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('version ranges', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.20.1', '1.20.1')).toBe(0)
    expect(compareVersions('1.20.2', '1.20.1')).toBe(1)
    expect(compareVersions('1.9.9', '1.10.0')).toBe(-1)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
  })

  it('accepts the ranges Forge mods actually use', () => {
    expect(satisfiesVersionRange('1.20.1', '[1.20.1]')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '[1.20.1,)')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '[1.20,1.21)')).toBe(true)
    expect(satisfiesVersionRange('47.4.10', '[47,)')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '*')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', undefined)).toBe(true)
  })

  it('accepts the comparator ranges Fabric mods use', () => {
    expect(satisfiesVersionRange('1.20.1', '>=1.20 <1.20.2')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '>= 1.20, < 1.20.2')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '>=1.16.5')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '>=1.20.2 <1.21')).toBe(false)
  })

  it('can ignore the upper bound of a loader range', () => {
    expect(satisfiesVersionRange('47.4.10', '[46,47.3.12]')).toBe(false)
    expect(satisfiesVersionRange('47.4.10', '[46,47.3.12]', { minimumOnly: true })).toBe(true)
    expect(satisfiesVersionRange('47.4.10', '[48,)', { minimumOnly: true })).toBe(false)
  })

  it('drops the Minecraft prefix Arclight puts in front of the loader version', () => {
    expect(normalizeLoaderVersion('1.20.1-47.4.10', '1.20.1')).toBe('47.4.10')
    expect(normalizeLoaderVersion('47.4.10', '1.20.1')).toBe('47.4.10')
  })

  it('rejects ranges for another Minecraft version', () => {
    expect(satisfiesVersionRange('1.20.1', '[1.20.2]')).toBe(false)
    expect(satisfiesVersionRange('1.20.1', '[1.20.2,1.21)')).toBe(false)
    expect(satisfiesVersionRange('1.20.1', '[1.19,1.20)')).toBe(false)
    expect(satisfiesVersionRange('47.4.10', '[48,)')).toBe(false)
  })

  it('checks every group of a union', () => {
    expect(satisfiesVersionRange('1.20.1', '[1.19,1.20),[1.20.1,1.21)')).toBe(true)
    expect(satisfiesVersionRange('1.20.1', '[1.18,1.19),[1.21,1.22)')).toBe(false)
  })
})

describe('filenameMinecraftVersion', () => {
  it('accepts the pack version and mods whose own version starts with 1.x', () => {
    expect(filenameMinecraftVersion('alexsmobs-1.22.9.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('jei-1.20.1-forge-15.20.0.106.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('moonlight-1.20-2.11.8.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('create-1.20.1-0.5.1.f.jar', '1.20.1')).toBeNull()
  })

  it('reports a file name that points at another Minecraft version', () => {
    expect(filenameMinecraftVersion('additionallanterns-1.1.2-forge-mc1.20.2.jar', '1.20.1')).toBe('1.20.2')
    expect(filenameMinecraftVersion('MOAdecor COOKERY 1.20.2.jar', '1.20.1')).toBe('1.20.2')
    expect(filenameMinecraftVersion('old-1.19.2-mod.jar', '1.20.1')).toBe('1.19.2')
    expect(filenameMinecraftVersion('next-1.21-forge.jar', '1.20.1')).toBe('1.21')
    expect(filenameMinecraftVersion('ImmediatelyFast-Forge-1.5.4+1.20.4.jar', '1.20.1')).toBe('1.20.4')
  })

  it('does not mistake a mod version or a supported range for another Minecraft version', () => {
    expect(filenameMinecraftVersion('EnchantmentDescriptions-Forge-1.20.1-17.1.21.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('GPUTape-1.18x-1.21x-1.0.5.1-forge.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('packetfixer-3.3.2-1.18-1.20.4-merged.jar', '1.20.1')).toBeNull()
    expect(filenameMinecraftVersion('melody_forge_1.0.3_MC_1.20.1-1.20.4.jar', '1.20.1')).toBeNull()
  })
})

describe('readModMetadata', () => {
  it('reads a Forge mods.toml, resolving ${file.jarVersion} from the manifest', async () => {
    const jar = path.join(dir, 'example.jar')
    writeJar(jar, {
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\nImplementation-Version: 4.2.0\n',
      'META-INF/mods.toml': FORGE_TOML
    })

    const { metadata, error } = await readModMetadata(jar)

    expect(error).toBeUndefined()
    expect(metadata).toMatchObject({
      file: 'example.jar',
      enabled: true,
      modId: 'example',
      name: 'Example Mod',
      version: '4.2.0',
      loader: 'forge',
      loaderVersion: '[47,)'
    })
    expect(metadata?.dependencies).toEqual([
      { modId: 'minecraft', mandatory: true, versionRange: '[1.20.1]', side: 'BOTH' },
      { modId: 'citadel', mandatory: true, versionRange: '[2,)', side: 'BOTH' }
    ])
  })

  it('reads a Fabric fabric.mod.json', async () => {
    const jar = path.join(dir, 'fabric.jar')
    writeJar(jar, {
      'fabric.mod.json': JSON.stringify({
        id: 'fabricmod',
        name: 'Fabric Mod',
        version: '2.0.0',
        depends: { minecraft: '1.20.1', 'fabric-api': '*' }
      })
    })

    const { metadata } = await readModMetadata(jar)

    expect(metadata).toMatchObject({ modId: 'fabricmod', name: 'Fabric Mod', version: '2.0.0', loader: 'fabric' })
    expect(metadata?.dependencies).toContainEqual({ modId: 'fabric-api', mandatory: true, versionRange: '*', side: 'BOTH' })
  })

  it('reports a jar with no metadata and one that is not a zip', async () => {
    const empty = path.join(dir, 'resourcepack.jar')
    writeJar(empty, { 'pack.mcmeta': '{"pack":{"pack_format":15}}' })

    const broken = path.join(dir, 'broken.jar')
    writeFileSync(broken, 'not a zip')

    expect((await readModMetadata(empty)).error).toContain('não tem META-INF/mods.toml')
    expect((await readModMetadata(broken)).error).toContain('não foi possível abrir o jar')
  })

  it('marks a .jar.disabled file as disabled but keeps the canonical name', async () => {
    const jar = path.join(dir, 'example.jar.disabled')
    writeJar(jar, { 'META-INF/mods.toml': FORGE_TOML })

    const { metadata } = await readModMetadata(jar)

    expect(metadata).toMatchObject({ file: 'example.jar', enabled: false, modId: 'example' })
  })

  it('describes a wrapper jar through the nested mod that matches its name', async () => {
    const jar = path.join(dir, 'kotlinforforge-4.12.0-all.jar')
    writeJar(jar, {
      'META-INF/jarjar/kfflang-4.12.0.jar': forgeJar('kfflang', 'Kotlin Lang'),
      'META-INF/jarjar/kffmod-4.12.0.jar': forgeJar('kotlinforforge', 'Kotlin For Forge')
    })

    const { metadata, provides, error } = await readModMetadata(jar)

    expect(error).toBeUndefined()
    expect(metadata).toMatchObject({ file: 'kotlinforforge-4.12.0-all.jar', modId: 'kotlinforforge', enabled: true })
    expect(provides).toEqual(expect.arrayContaining(['kfflang', 'kotlinforforge']))
  })

  it('collects mods nested two levels deep', async () => {
    const commonality = forgeJar('commonality', 'Commonality')
    const apexcore = buildJar({
      'META-INF/mods.toml': 'modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="apexcore"\nversion="1.0.0"\n',
      'META-INF/jarjar/commonality-1.20.1-7.0.0.jar': commonality
    })
    const jar = path.join(dir, 'fantasyfurniture.jar')
    writeJar(jar, {
      'META-INF/mods.toml': 'modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="fantasyfurniture"\nversion="1.0.0"\n',
      'META-INF/jarjar/apexcore-1.20.1-10.0.0.jar': apexcore
    })

    const { metadata, provides } = await readModMetadata(jar)

    expect(metadata?.modId).toBe('fantasyfurniture')
    expect(provides).toEqual(expect.arrayContaining(['apexcore', 'commonality']))
  })

  it('ignores dependencies declared under a mod id the jar does not ship', async () => {
    const jar = path.join(dir, 'easypaxel.jar')
    writeJar(jar, {
      'META-INF/mods.toml':
        'modLoader="javafml"\nloaderVersion="[47,)"\n\n[[mods]]\nmodId="easypaxellite"\nversion="1.0.0"\ndisplayName="Easy Paxel"\n\n[[dependencies.examplemod]]\nmodId="minecraft"\nmandatory=true\nversionRange="[1.20.1,1.20]"\n'
    })

    const { metadata } = await readModMetadata(jar)

    expect(metadata?.dependencies).toEqual([])
  })
})

describe('diagnoseMods', () => {
  it('reports a duplicate modId and keeps the enabled, newest jar', () => {
    const older = mod({ modId: 'sign_plates', version: '1.0.2' })
    const newer = mod({ modId: 'sign_plates', version: '1.1.2' })

    const issues = diagnoseMods([older, newer], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'duplicate', file: 'sign_plates.jar', severity: 'error', action: 'disable' })
    expect(issues[0].message).toContain('mais de um jar')
  })

  it('ignores a disabled jar when looking for duplicates', () => {
    const enabled = mod({ modId: 'example', version: '1.0.0' })
    const disabled: IScannedMod = {
      file: 'example-2.jar',
      enabled: false,
      metadata: { ...mod({ modId: 'example', version: '2.0.0' }).metadata!, file: 'example-2.jar', enabled: false }
    }

    const issues = diagnoseMods([enabled, disabled], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(issues).toEqual([])
  })

  it('flags a mod built for another Minecraft version', () => {
    const wrong = mod({
      modId: 'oldmod',
      dependencies: [{ modId: 'minecraft', mandatory: true, versionRange: '[1.20.2]', side: 'BOTH' }]
    })

    expect(issueFor([wrong], 'wrong-version')).toMatchObject({ file: 'oldmod.jar', severity: 'error', action: 'disable' })
  })

  it('flags a Forge build that the installed loader cannot run', () => {
    const wrong = mod({ modId: 'futuremod', loaderVersion: '[48,)' })
    expect(issueFor([wrong], 'wrong-version')).toMatchObject({ severity: 'error' })
  })

  it('tolerates an outdated upper bound on the Forge dependency', () => {
    const fakename = mod({
      modId: 'fakename',
      dependencies: [{ modId: 'forge', mandatory: true, versionRange: '[46,47.3.12]', side: 'BOTH' }]
    })

    expect(diagnoseMods([fakename], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })).toEqual([])
  })

  it('accepts a loader version written with the Minecraft prefix', () => {
    const fakename = mod({
      modId: 'fakename',
      loaderVersion: '[46,47.3.12]',
      dependencies: [{ modId: 'forge', mandatory: true, versionRange: '[46,)', side: 'BOTH' }]
    })

    expect(diagnoseMods([fakename], { minecraftVersion: '1.20.1', loaderVersion: '1.20.1-47.4.10' })).toEqual([])
  })

  it('accepts a dependency satisfied by a mod nested in another jar', () => {
    const create = mod({
      modId: 'create',
      dependencies: [
        { modId: 'flywheel', mandatory: true, side: 'BOTH' },
        { modId: 'ponder', mandatory: true, side: 'BOTH' }
      ]
    })
    create.provides = ['flywheel', 'ponder', 'registrate']

    expect(diagnoseMods([create], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })).toEqual([])
  })

  it('does not report a nested mod as missing when the wrapper jar is disabled', () => {
    const dependent = mod({ modId: 'create', dependencies: [{ modId: 'flywheel', mandatory: true, side: 'BOTH' }] })
    const wrapper: IScannedMod = {
      file: 'librarybundle.jar',
      enabled: false,
      metadata: { ...mod({ modId: 'librarybundle' }).metadata!, file: 'librarybundle.jar', enabled: false },
      provides: ['flywheel']
    }

    const issues = diagnoseMods([dependent, wrapper], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'disabled-dependency', file: 'librarybundle.jar', action: 'enable' })
  })

  it('flags a missing mandatory dependency, but not built-ins or server-side ones', () => {
    const dependent = mod({
      modId: 'alexscaves',
      dependencies: [
        { modId: 'citadel', mandatory: true, side: 'BOTH' },
        { modId: 'forge', mandatory: true, versionRange: '[47,)', side: 'BOTH' },
        { modId: 'serveronly', mandatory: true, side: 'SERVER' }
      ]
    })

    const issues = diagnoseMods([dependent], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })
    const missing = issues.filter((issue) => issue.kind === 'missing-dependency')

    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ file: 'alexscaves.jar', action: 'disable' })
    expect(missing[0].message).toContain('citadel')
  })

  it('suggests enabling a dependency that is installed but disabled', () => {
    const dependent = mod({
      modId: 'alexscaves',
      dependencies: [{ modId: 'citadel', mandatory: true, side: 'BOTH' }]
    })
    const citadel: IScannedMod = {
      file: 'citadel.jar',
      enabled: false,
      metadata: { ...mod({ modId: 'citadel', name: 'Citadel' }).metadata!, file: 'citadel.jar', enabled: false }
    }

    const issues = diagnoseMods([dependent, citadel], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'disabled-dependency', file: 'citadel.jar', action: 'enable', severity: 'warning' })
  })

  it('warns about a file name from another Minecraft version without blocking it', () => {
    const old = mod({ modId: 'lanterns' })
    old.file = 'lanterns-mc1.20.2.jar'
    old.metadata!.file = 'lanterns-mc1.20.2.jar'

    expect(issueFor([old], 'filename-version')).toMatchObject({ severity: 'warning', action: 'disable' })
  })

  it('reports jars it could not read', () => {
    const broken: IScannedMod = {
      file: 'broken.jar',
      enabled: true,
      metadata: null,
      error: 'não foi possível abrir o jar: invalid zip'
    }
    const unknown: IScannedMod = {
      file: 'pack.jar',
      enabled: true,
      metadata: null,
      error: 'o jar não tem META-INF/mods.toml nem fabric.mod.json'
    }

    const issues = diagnoseMods([broken, unknown], { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(issues.find((issue) => issue.file === 'broken.jar')).toMatchObject({ kind: 'unreadable', severity: 'error' })
    expect(issues.find((issue) => issue.file === 'pack.jar')).toMatchObject({ kind: 'no-metadata', severity: 'warning' })
  })

  it('leaves a healthy modpack without issues', () => {
    const mods = [
      mod({ modId: 'citadel', version: '2.6.0' }),
      mod({
        modId: 'alexscaves',
        dependencies: [{ modId: 'citadel', mandatory: true, versionRange: '[2,', side: 'BOTH' }]
      })
    ]

    expect(diagnoseMods(mods, { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })).toEqual([])
  })
})

describe('scanModsDir', () => {
  it('reads every jar, enabled or not, and diagnoses the folder', async () => {
    mkdirSync(dir, { recursive: true })
    writeJar(path.join(dir, 'citadel.jar'), {
      'META-INF/mods.toml': `modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="citadel"\nversion="2.6.0"\ndisplayName="Citadel"\n`
    })
    writeJar(path.join(dir, 'alexscaves.jar.disabled'), {
      'META-INF/mods.toml': `modLoader="javafml"\nloaderVersion="[47,)"\n[[mods]]\nmodId="alexscaves"\nversion="2.0.2"\ndisplayName="Alex's Caves"\n[[dependencies.alexscaves]]\nmodId="citadel"\nmandatory=true\nside="BOTH"\n`
    })
    writeFileSync(path.join(dir, 'notes.txt'), 'ignore me')

    const result = await scanModsDir(dir, { minecraftVersion: '1.20.1', loaderVersion: '47.4.10' })

    expect(result.scanned).toBe(2)
    expect(result.mods.map((entry) => `${entry.file}:${entry.enabled}`)).toEqual(['alexscaves.jar:false', 'citadel.jar:true'])
    // The dependent mod is off, so its missing dependency is not a live problem.
    expect(result.issues).toEqual([])
  })
})
