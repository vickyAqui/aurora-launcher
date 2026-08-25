import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'

export function sha1(filePath) {
  const hash = createHash('sha1')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function walk(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const folders = []
  const files = []

  for (const entry of entries) {
    if (entry.name === 'modpack.json') continue
    const full = path.join(dir, entry.name)
    const rel = path.posix.join(prefix, entry.name)

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, rel })
      const nested = await walk(full, rel)
      folders.push(...nested.folders)
      files.push(...nested.files)
    } else if (entry.isFile()) {
      files.push({ name: entry.name, rel, full })
    }
  }

  return { folders, files }
}
