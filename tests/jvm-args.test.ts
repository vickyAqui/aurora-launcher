import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeJvmArgs, parseJvmArgs } from '../src/jvmArgs'

let userDataDir = ''
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: { getPath: (key: string) => (key === 'userData' ? userDataDir : '') },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)
  },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 720 } }) },
  dialog: { showOpenDialog: async () => ({ filePaths: [] }) }
}))

vi.mock('electron-log/main', () => ({
  default: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

describe('parseJvmArgs', () => {
  it('aceita vazio e linhas em branco', () => {
    expect(parseJvmArgs('')).toEqual({ args: [], warnings: [], errors: [] })
    expect(parseJvmArgs('  \n\n  ').args).toEqual([])
    expect(parseJvmArgs(null).args).toEqual([])
  })

  it('separa por espaços e quebras, respeitando aspas', () => {
    const result = parseJvmArgs('-XX:+UseG1GC\n-Dfoo="bar baz"\n-Doutro=sim')
    expect(result.errors).toEqual([])
    expect(result.args).toEqual(['-XX:+UseG1GC', '-Dfoo=bar baz', '-Doutro=sim'])
  })

  it('aceita aspas simples, comentários e valores com escaped quote', () => {
    const result = parseJvmArgs("# explicação\n-Da='um dois' -Db=\"diz \\\"oi\\\"\"")
    expect(result.errors).toEqual([])
    expect(result.args).toEqual(['-Da=um dois', '-Db=diz "oi"'])
  })

  it('bloqueia RAM, alvo do Java e argfiles', () => {
    const result = parseJvmArgs('-Xmx10G -Xms2G -jar -cp @args.txt -Dok=1')
    expect(result.args).toEqual(['-Dok=1'])
    expect(result.errors).toHaveLength(5)
    expect(result.errors.join(' ')).toContain('RAM')
    expect(result.errors.join(' ')).toContain('argfile')
  })

  it('bloqueia tokens soltos (possível classe principal)', () => {
    const result = parseJvmArgs('net.minecraft.client.main.Main -Dok=1')
    expect(result.args).toEqual(['-Dok=1'])
    expect(result.errors.join(' ')).toContain('classe principal')
  })

  it('bloqueia -Xmx mesmo com valor colado e variantes longas', () => {
    const result = parseJvmArgs('-Xmx8G -XX:MaxHeapSize=8g -XX:InitialHeapSize=2g')
    expect(result.args).toEqual([])
    expect(result.errors).toHaveLength(3)
  })

  it('avisa sobre repetição exata e mantém a ordem', () => {
    const result = parseJvmArgs('-Dprimeiro=1 -Dsegundo=2 -Dprimeiro=1')
    expect(result.args).toEqual(['-Dprimeiro=1', '-Dsegundo=2'])
    expect(result.warnings).toHaveLength(1)
  })

  it('reporta aspas não fechadas', () => {
    const result = parseJvmArgs('-Dfoo="sem fim')
    expect(result.errors.join(' ')).toContain('aspas não fechadas')
  })

  it('limita quantidade e tamanho dos argumentos', () => {
    const muitos = Array.from({ length: 70 }, (_, i) => `-Dk${i}=v`).join(' ')
    expect(parseJvmArgs(muitos).args).toHaveLength(64)
    expect(parseJvmArgs(`-${'a'.repeat(300)}`).args).toEqual([])
  })
})

describe('normalizeJvmArgs', () => {
  it('devolve só os válidos, um por linha, com aspas quando preciso', () => {
    expect(normalizeJvmArgs('-Xmx9G -Dfoo="bar baz" -XX:+UseG1GC')).toBe(
      '"-Dfoo=bar baz"\n-XX:+UseG1GC'
    )
  })

  it('é estável ao reaplicar', () => {
    const once = normalizeJvmArgs('-Da=1 -Db="dois tres" -Da=1')
    expect(normalizeJvmArgs(once)).toBe(once)
  })
})

// settings:set filtra de novo para cobrir chamadas externas ao IPC; settings:get
// filtra arquivos editados diretamente no disco.
describe('settings:get / settings:set com argumentos JVM', () => {
  beforeEach(() => {
    handlers.clear()
    userDataDir = mkdtempSync(path.join(tmpdir(), 'aurora-jvm-settings-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  async function load() {
    vi.resetModules()
    const module = await import('../electron/handlers/settings')
    module.registerSettingsHandlers()
    return handlers
  }

  it('grava somente os argumentos válidos', async () => {
    const ipc = await load()
    const base = {
      java: 'bundled',
      javaPath: '',
      memory: { min: 1, max: 4 },
      resolution: { width: 1280, height: 720, fullscreen: false },
      launcherAction: 'close' as const,
      extraJvmArgs: '-Xmx10G\n-Dfoo=bar\n-XX:+UseG1GC'
    }

    expect(await ipc.get('settings:set')!({}, base)).toBe(true)
    const saved = JSON.parse(readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'))
    expect(saved.extraJvmArgs).toBe('-Dfoo=bar\n-XX:+UseG1GC')
  })

  it('filtra argumentos de um settings.json antigo/editado à mão', async () => {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(
      path.join(userDataDir, 'settings.json'),
      JSON.stringify({ memory: { min: 2, max: 8 }, extraJvmArgs: '-jar bug.jar -Dok=1' })
    )

    const ipc = await load()
    const result = await ipc.get('settings:get')!({}) as { extraJvmArgs: string; memory: { max: number } }
    expect(result.extraJvmArgs).toBe('-Dok=1')
    expect(result.memory.max).toBe(8)
  })
})
