import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isModelFileName, listModelFiles, readSelectedModel, withSelectedModel } from '../electron/cpm'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'aurora-cpm-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeModel(name: string, size = 10) {
  writeFileSync(path.join(dir, name), 'x'.repeat(size))
}

describe('isModelFileName', () => {
  it('accepts a plain .cpmmodel name', () => {
    expect(isModelFileName('Estrelinha.cpmmodel')).toBe(true)
    expect(isModelFileName('model.CPMMODEL')).toBe(true)
  })

  it('rejects anything that could escape the models folder', () => {
    expect(isModelFileName('../model.cpmmodel')).toBe(false)
    expect(isModelFileName('sub/model.cpmmodel')).toBe(false)
    expect(isModelFileName('sub\\model.cpmmodel')).toBe(false)
    expect(isModelFileName('model.cpmmodel.exe')).toBe(false)
    expect(isModelFileName('model')).toBe(false)
    expect(isModelFileName('')).toBe(false)
    expect(isModelFileName(null)).toBe(false)
  })
})

describe('listModelFiles', () => {
  it('lists only .cpmmodel files, sorted naturally', () => {
    writeModel('model10.cpmmodel')
    writeModel('model2.cpmmodel')
    writeModel('Alpha.cpmmodel', 42)
    writeFileSync(path.join(dir, 'notes.txt'), 'nope')
    mkdirSync(path.join(dir, 'folder.cpmmodel'))

    expect(listModelFiles(dir).map((model) => model.name)).toEqual(['Alpha.cpmmodel', 'model2.cpmmodel', 'model10.cpmmodel'])
    expect(listModelFiles(dir).find((model) => model.name === 'Alpha.cpmmodel')?.size).toBe(42)
  })

  it('returns an empty list when the folder does not exist', () => {
    expect(listModelFiles(path.join(dir, 'missing'))).toEqual([])
  })
})

describe('readSelectedModel', () => {
  it('reads the selected model from the CPM config', () => {
    expect(readSelectedModel('{"selectedModel":"a.cpmmodel","titleScreenButton":true}')).toBe('a.cpmmodel')
  })

  it('returns null for missing, empty or invalid configs', () => {
    expect(readSelectedModel(null)).toBeNull()
    expect(readSelectedModel('')).toBeNull()
    expect(readSelectedModel('not json')).toBeNull()
    expect(readSelectedModel('{}')).toBeNull()
    expect(readSelectedModel('{"selectedModel":""}')).toBeNull()
    expect(readSelectedModel('[]')).toBeNull()
    expect(readSelectedModel('{"selectedModel":42}')).toBeNull()
  })
})

describe('withSelectedModel', () => {
  it('changes only selectedModel and keeps the other keys', () => {
    const raw = JSON.stringify({ editorLastVersion: '0.6.25a', selectedModel: 'old.cpmmodel', titleScreenButton: true }, null, 2)

    const next = JSON.parse(withSelectedModel(raw, 'new.cpmmodel'))

    expect(next).toEqual({ editorLastVersion: '0.6.25a', selectedModel: 'new.cpmmodel', titleScreenButton: true })
    expect(withSelectedModel(raw, 'new.cpmmodel').endsWith('\n')).toBe(true)
  })

  it('removes selectedModel when the vanilla skin is chosen', () => {
    const next = JSON.parse(withSelectedModel('{"selectedModel":"a.cpmmodel","keybinds":{}}', null))

    expect(next).toEqual({ keybinds: {} })
  })

  it('creates a minimal config when the file is missing or corrupt', () => {
    expect(JSON.parse(withSelectedModel(null, 'a.cpmmodel'))).toEqual({ selectedModel: 'a.cpmmodel' })
    expect(JSON.parse(withSelectedModel('{broken', 'a.cpmmodel'))).toEqual({ selectedModel: 'a.cpmmodel' })
  })
})
