import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import logger from 'electron-log/main'
import { getGameDir } from './gamedir'

const VAULT_PASSPHRASE = 'aurora-studios-mods-vault-7f3a9c1d'
const VAULT_SALT = 'aurora-studios-mods-vault-salt'
const VAULT_ROOT = path.join(app.getPath('userData'), 'mods-vault')

interface IVaultEntry {
  name: string
  file: string
  iv: string
  tag: string
}

interface IVaultManifest {
  version: number
  files: IVaultEntry[]
}

let activeSlug = ''
let encryptPromise: Promise<void> | null = null

export function setActiveVaultSlug(slug: string): void {
  activeSlug = slug
}

function getKey(): Buffer {
  return crypto.scryptSync(VAULT_PASSPHRASE, VAULT_SALT, 32)
}

function getVaultDir(slug: string): string {
  return path.join(VAULT_ROOT, slug)
}

function getModsDir(slug: string): string {
  return path.join(getGameDir(slug), 'mods')
}

export async function decryptMods(slug: string): Promise<void> {
  const vaultDir = getVaultDir(slug)
  const manifestPath = path.join(vaultDir, 'manifest.json')

  let manifest: IVaultManifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
  } catch {
    return
  }

  const modsDir = getModsDir(slug)
  await fs.mkdir(modsDir, { recursive: true })

  const key = getKey()

  for (const entry of manifest.files) {
    try {
      const data = await fs.readFile(path.join(vaultDir, entry.file))
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'))
      decipher.setAuthTag(Buffer.from(entry.tag, 'hex'))
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
      await fs.writeFile(path.join(modsDir, entry.name), decrypted)
      logger.log(`Restored mod from vault: ${entry.name}`)
    } catch (err) {
      logger.error(`Failed to decrypt ${entry.name}:`, err)
    }
  }
}

export function encryptMods(slug: string): Promise<void> {
  if (encryptPromise) return encryptPromise
  encryptPromise = doEncrypt(slug).finally(() => {
    encryptPromise = null
  })
  return encryptPromise
}

async function doEncrypt(slug: string): Promise<void> {
  const modsDir = getModsDir(slug)

  let files: string[]
  try {
    files = (await fs.readdir(modsDir)).filter((f) => f.endsWith('.jar'))
  } catch {
    return
  }

  if (files.length === 0) return

  const vaultDir = getVaultDir(slug)
  await fs.mkdir(vaultDir, { recursive: true })

  try {
    for (const stale of await fs.readdir(vaultDir)) {
      await fs.unlink(path.join(vaultDir, stale)).catch(() => undefined)
    }
  } catch {
    return
  }

  const key = getKey()
  const entries: IVaultEntry[] = []

  for (const file of files) {
    try {
      const data = await fs.readFile(path.join(modsDir, file))
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
      const tag = cipher.getAuthTag()

      const vaultFile = `${entries.length}.enc`
      await fs.writeFile(path.join(vaultDir, vaultFile), encrypted)
      entries.push({ name: file, file: vaultFile, iv: iv.toString('hex'), tag: tag.toString('hex') })
      logger.log(`Encrypted mod: ${file}`)
    } catch (err) {
      logger.error(`Failed to encrypt ${file}:`, err)
    }
  }

  const manifest: IVaultManifest = { version: 1, files: entries }
  await fs.writeFile(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  for (const file of files) {
    try {
      await fs.unlink(path.join(modsDir, file))
      logger.log(`Removed plaintext mod: ${file}`)
    } catch (err) {
      logger.error(`Failed to remove plaintext mod ${file}:`, err)
    }
  }
}

export async function flushModsVault(): Promise<void> {
  if (!activeSlug) return
  await encryptMods(activeSlug)
}
