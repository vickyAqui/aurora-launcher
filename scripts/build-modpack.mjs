#!/usr/bin/env node
/**
 * Generates modpack.json locally by scanning the modpack folder.
 *
 * Environment variables:
 *   MODPACK_DIR      (default: ./modpack) local folder with the modpack files
 *   MODPACK_OUT      (default: ./modpack.json) output path for the manifest
 *   MODPACK_BASE_URL (default: https://github.com/vickyAqui/aurora-launcher/releases/download/modpack)
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sha1, walk } from './modpack-utils.mjs'

const modpackDir = path.resolve(process.env.MODPACK_DIR || './modpack')
const outputPath = path.resolve(process.env.MODPACK_OUT || './modpack.json')
const baseUrl = process.env.MODPACK_BASE_URL || 'https://github.com/vickyAqui/aurora-launcher/releases/download/modpack'

async function main() {
  if (!(await fs.stat(modpackDir).catch(() => null))) {
    console.error(`ERROR: modpack folder not found at "${modpackDir}".`)
    process.exit(1)
  }

  console.log(`Scanning ${modpackDir}...`)
  const { folders, files } = await walk(modpackDir)

  const modpackFiles = []
  for (const folder of folders) {
    const parent = folder.rel.includes('/') ? `${folder.rel.substring(0, folder.rel.lastIndexOf('/'))}/` : ''
    modpackFiles.push({
      name: folder.name,
      path: parent,
      url: `${baseUrl}/${folder.name}`,
      type: 'FOLDER'
    })
  }

  for (const file of files) {
    const parent = file.rel.includes('/') ? `${file.rel.substring(0, file.rel.lastIndexOf('/'))}/` : ''
    const size = (await fs.stat(file.full)).size
    const hash = await sha1(file.full)
    modpackFiles.push({
      name: file.name,
      path: parent,
      size,
      sha1: hash,
      url: `${baseUrl}/${file.name}`,
      type: 'MOD'
    })
    process.stdout.write(`\r${modpackFiles.length}/${files.length + folders.length} files...`)
  }

  const manifest = { files: modpackFiles }
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`\nGenerated ${outputPath} (${modpackFiles.length} entries)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
