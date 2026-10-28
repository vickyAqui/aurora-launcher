import { readFileSync } from 'fs'
import path from 'path'

const token = process.env.GH_TOKEN
const repo = 'vickyAqui/aurora-launcher'
const tag = 'modpack'
const filePath = path.resolve('./modpack/mods/auroramortis_ex-1.20.1-1.0.0 (4).jar')
const name = path.basename(filePath)

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
}

async function main() {
  let res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers })
  if (!res.ok) throw new Error('get release failed: ' + res.status)
  const release = await res.json()
  console.log('release', release.id)
  
  const data = readFileSync(filePath)
  const upUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`
  res = await fetch(upUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(data)
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error('upload failed: ' + res.status + ' ' + t)
  }
  const asset = await res.json()
  console.log('uploaded', asset.name)
}
main().catch(e => { console.error(e); process.exit(1) })
