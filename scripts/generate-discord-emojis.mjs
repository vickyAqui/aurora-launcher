#!/usr/bin/env node
/**
 * Gera um datapack do Emojiful com os emojis custom de um servidor Discord.
 *
 * O token NUNCA é impresso nem salvo no repositório. Ele vem de:
 *   DISCORD_BOT_TOKEN  - variável de ambiente
 *   DISCORD_TOKEN_FILE - arquivo local fora do repo (uma linha)
 *
 * Variáveis opcionais:
 *   DISCORD_GUILD_ID     (padrão: 1460012886511587412)
 *   DISCORD_EMOJI_FIXTURE arquivo JSON local para testar sem rede/token
 *   EMOJI_DATAPACK_OUT   (padrão: server-patch/datapacks/aurora_discord)
 *   EMOJI_NAMESPACE      (padrão: aurora_discord)
 *   EMOJI_CATEGORY       (padrão: Aurora)
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const GUILD_ID = process.env.DISCORD_GUILD_ID || '1460012886511587412'
const OUT_DIR = path.resolve(process.env.EMOJI_DATAPACK_OUT || 'server-patch/datapacks/aurora_discord')
const NAMESPACE = normalizeNamespace(process.env.EMOJI_NAMESPACE || 'aurora_discord')
const CATEGORY = process.env.EMOJI_CATEGORY || 'Aurora'
const FIXTURE = process.env.DISCORD_EMOJI_FIXTURE
const API_URL = `https://discord.com/api/v10/guilds/${GUILD_ID}/emojis`

function normalizeNamespace(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'aurora_discord'
}

function normalizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
}

async function readToken() {
  if (FIXTURE) return null
  const fromEnv = process.env.DISCORD_BOT_TOKEN
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  const tokenFile = process.env.DISCORD_TOKEN_FILE
  if (tokenFile && tokenFile.trim()) {
    const token = (await fs.readFile(path.resolve(tokenFile), 'utf8')).replace(/^\uFEFF/, '').trim()
    if (token) return token
  }
  throw new Error(
    'Token do bot ausente. Defina DISCORD_BOT_TOKEN ou DISCORD_TOKEN_FILE ' +
    '(caminho de um arquivo local). Não cole o token no chat nem no repositório.'
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchEmojis(token) {
  if (FIXTURE) {
    const raw = (await fs.readFile(path.resolve(FIXTURE), 'utf8')).replace(/^\uFEFF/, '')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('O fixture de emojis deve ser um array JSON.')
    return parsed
  }

  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(API_URL, {
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'aurora-emojiful-datapack/1.0'
      }
    })
    lastStatus = response.status
    if (response.ok) {
      const data = await response.json()
      if (!Array.isArray(data)) throw new Error('O Discord não devolveu uma lista de emojis.')
      return data
    }
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}))
      const raw = Number(body.retry_after ?? 1)
      const waitMs = Math.min((raw < 10 ? raw * 1000 : raw) + 250, 60_000)
      console.error(`Rate limit do Discord (${lastStatus}); aguardando ${Math.round(waitMs / 1000)}s...`)
      await sleep(waitMs)
      continue
    }
    if (response.status >= 500 && attempt < 3) {
      await sleep(1000 * (attempt + 1))
      continue
    }
    throw new Error(`Falha ao consultar emojis do Discord: HTTP ${lastStatus}.`)
  }
  throw new Error(`Falha ao consultar emojis do Discord: HTTP ${lastStatus} após retries.`)
}

function buildRecipes(emojis) {
  const recipes = new Map()
  let skipped = 0
  for (const emoji of emojis) {
    if (!emoji || typeof emoji.id !== 'string' || emoji.available === false || !emoji.name) {
      skipped++
      continue
    }
    if (!/^[a-z0-9_]+$/i.test(emoji.name)) {
      skipped++
      continue
    }
    const name = normalizeName(emoji.name)
    if (!name || recipes.has(name)) {
      skipped++
      continue
    }
    const ext = emoji.animated === true ? 'gif' : 'png'
    recipes.set(name, {
      type: 'emojiful:emoji_recipe',
      category: CATEGORY,
      name,
      url: `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}`
    })
  }
  return { recipes: [...recipes.values()], skipped }
}

async function writeDatapack(recipes) {
  const namespaceDir = path.join(OUT_DIR, 'data', NAMESPACE)
  await fs.rm(namespaceDir, { recursive: true, force: true })
  await fs.mkdir(path.join(namespaceDir, 'recipes'), { recursive: true })

  const packMcmeta = {
    pack: {
      pack_format: 15,
      description: 'Emojis do Discord da Aurora (gerado por scripts/generate-discord-emojis.mjs)'
    }
  }
  await fs.writeFile(
    path.join(OUT_DIR, 'pack.mcmeta'),
    JSON.stringify(packMcmeta, null, 2) + '\n'
  )

  for (const recipe of recipes) {
    await fs.writeFile(
      path.join(namespaceDir, 'recipes', `${recipe.name}.json`),
      JSON.stringify(recipe, null, 2) + '\n'
    )
  }
}

async function main() {
  const token = await readToken()
  const emojis = await fetchEmojis(token)
  const { recipes, skipped } = buildRecipes(emojis)
  if (recipes.length === 0) {
    throw new Error('Nenhum emoji utilizável encontrado; nada foi escrito.')
  }
  await writeDatapack(recipes)
  console.log(`Servidor: ${GUILD_ID}`)
  console.log(`Emojis recebidos: ${emojis.length}`)
  console.log(`Receitas escritas: ${recipes.length}`)
  console.log(`Ignorados (sem id, indisponível, nome inválido ou duplicado): ${skipped}`)
  console.log(`Datapack: ${OUT_DIR}`)
  console.log('Nada foi enviado ao servidor. Upload/restart continuam manuais.')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
