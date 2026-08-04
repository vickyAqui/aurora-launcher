import { ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log/main'

interface ISession {
  start: number
  end: number
}

interface IStats {
  launches: number
  lastPlayedAt: number | null
  sessions: ISession[]
}

export interface IPlayStats {
  launches: number
  lastPlayedAt: number | null
  totalPlayTimeMs: number
  todayPlayTimeMs: number
  weekPlayTimeMs: number
}

const statsPath = path.join(app.getPath('userData'), 'stats.json')
const MAX_SESSIONS = 500

const DEFAULT_STATS: IStats = {
  launches: 0,
  lastPlayedAt: null,
  sessions: []
}

function loadStats(): IStats {
  try {
    if (fs.existsSync(statsPath)) {
      const data = JSON.parse(fs.readFileSync(statsPath, 'utf-8'))
      return { ...DEFAULT_STATS, ...data, sessions: data.sessions ?? [] }
    }
  } catch (err) {
    logger.error('Error reading stats:', err)
  }
  return { ...DEFAULT_STATS, sessions: [] }
}

function saveStats(stats: IStats): void {
  try {
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2))
  } catch (err) {
    logger.error('Error writing stats:', err)
  }
}

function addSession(stats: IStats, start: number, end: number): void {
  stats.sessions.push({ start, end })
  if (stats.sessions.length > MAX_SESSIONS) {
    stats.sessions = stats.sessions.slice(-MAX_SESSIONS)
  }
}

export function getPlayStats(): IPlayStats {
  const stats = loadStats()

  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const startOfWeek = startOfToday - ((new Date().getDay() + 6) % 7) * 86400000

  let total = 0
  let today = 0
  let week = 0

  for (const session of stats.sessions) {
    const duration = session.end - session.start
    if (duration <= 0) continue
    total += duration
    if (session.end >= startOfToday) today += duration
    if (session.end >= startOfWeek) week += duration
  }

  return {
    launches: stats.launches,
    lastPlayedAt: stats.lastPlayedAt,
    totalPlayTimeMs: total,
    todayPlayTimeMs: today,
    weekPlayTimeMs: week
  }
}

export function startSession(): void {
  const stats = loadStats()

  if (stats.sessions.length > 0) {
    const last = stats.sessions[stats.sessions.length - 1]
    if (last.end === 0) {
      last.end = Date.now()
      stats.launches += 1
      stats.lastPlayedAt = last.end
    }
  }

  addSession(stats, Date.now(), 0)
  saveStats(stats)
}

export function endSession(): void {
  const stats = loadStats()
  const now = Date.now()

  if (stats.sessions.length > 0) {
    const last = stats.sessions[stats.sessions.length - 1]
    if (last.end === 0) {
      last.end = now
      stats.launches += 1
      stats.lastPlayedAt = now
      saveStats(stats)
    }
  }
}

export function registerStatsHandlers() {
  ipcMain.handle('stats:get', async () => {
    return getPlayStats()
  })
}
