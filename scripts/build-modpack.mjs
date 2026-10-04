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
import { buildManifestEntries, validateManifest, walk } from './modpack-utils.mjs'

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
  const modpackFiles = await buildManifestEntries({ folders, files, baseUrl })

  const problems = validateManifest({ files: modpackFiles })
  if (problems.length > 0) {
    console.error(`\nERROR: generated manifest has ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('\nMods must live in "modpack/mods/": the game loads them from the mods folder.')
    process.exit(1)
  }

  await fs.writeFile(outputPath, JSON.stringify({ files: modpackFiles }, null, 2) + '\n')
  console.log(`\nGenerated ${outputPath} (${modpackFiles.length} entries)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})