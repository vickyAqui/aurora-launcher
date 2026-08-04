import { ipcMain } from 'electron'
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'

export interface IDetectedJava {
  path: string
  version: string
  majorVersion: number
  arch: string
  fromPath: boolean
}

const executable = process.platform === 'win32' ? 'java.exe' : 'java'

function collectJavaCandidates(): string[] {
  const candidates: string[] = []
  const platform = process.platform

  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', executable))
  }

  if (platform === 'win32') {
    const roots = [process.env['ProgramFiles'] || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']
    const vendors = ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'Semeru', 'Liberica']
    for (const root of roots) {
      for (const vendor of vendors) {
        const vendorDir = path.join(root, vendor)
        if (!fs.existsSync(vendorDir)) continue
        for (const entry of fs.readdirSync(vendorDir)) {
          candidates.push(path.join(vendorDir, entry, 'bin', executable))
        }
      }
    }

    const local = process.env.LOCALAPPDATA
    if (local) {
      for (const root of [path.join(local, 'Programs', 'Java'), path.join(local, 'Java')]) {
        if (!fs.existsSync(root)) continue
        for (const entry of fs.readdirSync(root)) {
          candidates.push(path.join(root, entry, 'bin', executable))
        }
      }
    }
  } else if (platform === 'darwin') {
    const jvmRoot = '/Library/Java/JavaVirtualMachines'
    if (fs.existsSync(jvmRoot)) {
      for (const entry of fs.readdirSync(jvmRoot)) {
        candidates.push(path.join(jvmRoot, entry, 'Contents', 'Home', 'bin', executable))
      }
    }
  } else {
    const jvmRoots = ['/usr/lib/jvm', '/usr/lib64/jvm', '/opt/java', '/opt/java/openjdk', '/usr/local/java']
    for (const root of jvmRoots) {
      if (!fs.existsSync(root)) continue
      for (const entry of fs.readdirSync(root)) {
        candidates.push(path.join(root, entry, 'bin', executable))
      }
    }
  }

  return candidates.filter((p) => p && fs.existsSync(p))
}

function resolvePathJava(): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, [executable], (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const first = stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
      resolve(first || null)
    })
  })
}

function getJavaInfo(exePath: string): Promise<IDetectedJava | null> {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(exePath, ['-version'])
    } catch {
      return resolve(null)
    }

    let output = ''
    proc.stdout?.on('data', (data) => (output += data.toString()))
    proc.stderr?.on('data', (data) => (output += data.toString()))
    proc.on('error', () => resolve(null))
    proc.on('close', () => {
      if (!output) return resolve(null)

      const versionMatch = output.match(/"([^"]+)"/)
      const rawVersion = versionMatch ? versionMatch[1] : ''
      let majorVersion = 0

      if (rawVersion) {
        if (rawVersion.startsWith('1.')) {
          majorVersion = parseInt(rawVersion.split('.')[1], 10) || 0
        } else {
          majorVersion = parseInt(rawVersion.split('.')[0], 10) || 0
        }
      }

      const arch = /64-bit|aarch64|amd64|x86_64/i.test(output) ? '64-bit' : '32-bit'

      resolve({
        path: exePath,
        version: rawVersion || 'desconhecida',
        majorVersion,
        arch,
        fromPath: false
      })
    })
  })
}

export async function detectJava(): Promise<IDetectedJava[]> {
  const candidates = collectJavaCandidates()

  const pathJava = await resolvePathJava()
  if (pathJava && !candidates.includes(pathJava)) {
    candidates.push(pathJava)
  }

  const results = (await Promise.all(candidates.map((p) => getJavaInfo(p)))).filter((r): r is IDetectedJava => r !== null)

  const seen = new Set<string>()
  const unique = results.filter((r) => {
    const key = r.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const pathJavaLower = pathJava?.toLowerCase()
  return unique.map((r) => ({ ...r, fromPath: r.path.toLowerCase() === pathJavaLower })).sort((a, b) => b.majorVersion - a.majorVersion)
}

export function registerJavaHandlers() {
  ipcMain.handle('java:detect', async () => {
    try {
      return await detectJava()
    } catch (err) {
      logger.error('Error detecting Java:', err)
      return []
    }
  })
}
