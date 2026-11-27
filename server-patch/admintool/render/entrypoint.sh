#!/bin/sh
set -e

# O Render permite apenas um disco por serviço. O AdminTool espera três pastas
# persistentes (/app/files, /app/env, /app/data), então guardamos tudo em
# /app/storage e criamos links simbólicos para as pastas que a app conhece.
STORAGE=/app/storage
mkdir -p "$STORAGE/files" "$STORAGE/env" "$STORAGE/data"

# Na primeira subida, preserva os arquivos padrão da imagem (env/.env.default).
if [ -f /app/env/.env.default ] && [ ! -f "$STORAGE/env/.env.default" ]; then
  cp /app/env/.env.default "$STORAGE/env/.env.default"
fi

for dir in files env data; do
  target="/app/$dir"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    cp -an "$target/." "$STORAGE/$dir/" 2>/dev/null || true
    rm -rf "$target"
  fi
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    ln -s "$STORAGE/$dir" "$target"
  fi
done

# dotenv não sobrescreve variáveis já presentes no ambiente: DATABASE_URL,
# ORIGIN, JWT_SECRET_KEY etc. vêm do Blueprint e continuam valendo.
if [ ! -f /app/env/.env ]; then
  cp /app/env/.env.default /app/env/.env 2>/dev/null || printf 'DATABASE_URL="%s"\n' "$DATABASE_URL" > /app/env/.env
fi

# O Render injeta PORT (10000). O `node .` do AdminTool responde a essa variável.
export PORT="${PORT:-10000}"

echo "Aplicando schema do banco..."
npx dotenv run -f /app/env/.env -- npx prisma db push --accept-data-loss

echo "Aplicando migrações de dados e arquivos..."
npx dotenv run -f /app/env/.env -- node /app/migration-scripts/migrate.js

echo "Iniciando AdminTool na porta $PORT..."
exec npm run serve
