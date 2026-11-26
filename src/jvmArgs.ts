/**
 * Argumentos JVM extras digitados pelo jogador.
 *
 * O texto é tokenizado em um array (o eml-lib usa `spawn` sem shell), filtrado
 * e devolvido para ser somado depois das flags do perfil de desempenho. A RAM
 * continua sendo controlada pelo slider do launcher, então `-Xmx`/`-Xms` e
 * qualquer coisa que troque o alvo do Java (`-jar`, `-cp`, main class) é bloqueado.
 */

export interface JvmArgsParseResult {
  args: string[]
  warnings: string[]
  errors: string[]
}

const MAX_RAW_LENGTH = 2000
const MAX_TOKENS = 64
const MAX_TOKEN_LENGTH = 256

/** Flags que mudam o que o Java executa ou a memória já definida pelo launcher. */
const BLOCKED_EXACT = new Set([
  '-jar',
  '-cp',
  '-classpath',
  '--class-path',
  '-m',
  '--module',
  '--module-path',
  '-version',
  '-help',
  '-h',
  '-?',
  '--help',
  '--',
  '-xmx',
  '-xms',
  '-xx:maxheapsize',
  '-xx:initialheapsize',
  '-xx:maxram',
  '-xx:minrampercentage',
  '-xx:maxrampercentage'
])

const BLOCKED_PREFIXES = ['-xmx', '-xms', '-xx:maxheapsize=', '-xx:initialheapsize=', '-xx:maxram=']

function tokenize(raw: string): { tokens: string[]; errors: string[] } {
  const tokens: string[] = []
  const errors: string[] = []
  // Quebras e tabulações separam tokens; outros caracteres de controle são descartados.
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, (char) => (char === '\n' ? char : ' '))
  let current = ''
  let quote: string | null = null
  let escaped = false
  let hasToken = false

  const push = () => {
    if (!hasToken) return
    tokens.push(current)
    current = ''
    hasToken = false
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '#' && !quote && !hasToken) {
      const end = text.indexOf('\n', index)
      if (end === -1) break
      index = end
      continue
    }
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote) {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }
    if (/\s/.test(char)) {
      push()
      continue
    }
    current += char
    hasToken = true
  }

  if (escaped) {
    current += '\\'
    escaped = false
  }
  if (quote) errors.push('Há aspas não fechadas; o texto depois delas foi ignorado.')
  push()

  return { tokens, errors }
}

export function parseJvmArgs(raw: string | null | undefined): JvmArgsParseResult {
  const args: string[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const text = typeof raw === 'string' ? raw.trim() : ''

  if (!text) return { args, warnings, errors }
  if (text.length > MAX_RAW_LENGTH) {
    errors.push(`Texto muito longo (máximo ${MAX_RAW_LENGTH} caracteres).`)
  }

  const tokenized = tokenize(text.slice(0, MAX_RAW_LENGTH))
  errors.push(...tokenized.errors)

  for (const token of tokenized.tokens) {
    if (token.startsWith('#')) continue

    const lower = token.toLowerCase()
    if (BLOCKED_EXACT.has(lower) || BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      errors.push(`"${token}" foi bloqueado: a RAM é definida pelo slider e o Java/JAR são iniciados pelo launcher.`)
      continue
    }
    if (token.startsWith('@')) {
      errors.push(`"${token}" foi bloqueado: arquivos de argumentos (@argfile) não são permitidos.`)
      continue
    }
    if (!token.startsWith('-')) {
      errors.push(`"${token}" foi ignorado: tokens sem "-" podem ser a classe principal do jogo.`)
      continue
    }
    if (token.length > MAX_TOKEN_LENGTH) {
      errors.push(`Um argumento passou de ${MAX_TOKEN_LENGTH} caracteres e foi ignorado.`)
      continue
    }
    if (args.length >= MAX_TOKENS) {
      errors.push(`Limite de ${MAX_TOKENS} argumentos atingido; os demais foram ignorados.`)
      break
    }
    if (args.includes(token)) {
      warnings.push(`"${token}" estava repetido e só foi usado uma vez.`)
      continue
    }
    args.push(token)
  }

  return { args, warnings, errors }
}

/** Serializa os argumentos válidos de volta em texto (um por linha, aspas quando necessário). */
export function normalizeJvmArgs(raw: string | null | undefined): string {
  return parseJvmArgs(raw).args.map((arg) => {
    if (/^[\w\-+:.=/,\\$]+$/.test(arg)) return arg
    return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }).join('\n')
}
