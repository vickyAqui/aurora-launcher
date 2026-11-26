# Emojis do Discord → datapack do Emojiful

O Emojiful já está no pack (cliente e servidor, `4.2.0`) e a config local já tem
`datapack = true`. Ele não consulta o Discord em tempo real: lê **receitas** de um
datapack do servidor e baixa a imagem da URL de cada receita no cliente.

O gerador `scripts/generate-discord-emojis.mjs` consulta a API do Discord e cria
essas receitas automaticamente para o servidor `1460012886511587412`.

## O que o script faz

- `GET /guilds/{id}/emojis` com token de bot.
- Filtra emojis sem id, indisponíveis, com nome inválido e nomes duplicados.
- Escreve `data/aurora_discord/recipes/<nome>.json` com:
  - `type`: `emojiful:emoji_recipe`
  - `category`: `Aurora`
  - `name`: nome em minúsculas
  - `url`: `https://cdn.discordapp.com/emojis/<id>.png` (ou `.gif` se animado)
- Escreve `pack.mcmeta` com `pack_format: 15` (Minecraft 1.20.1).
- Apaga só `data/aurora_discord/` antes de reescrever, para não deixar emojis antigos.

Não baixa imagens: as URLs do CDN são usadas diretamente pelo Emojiful no cliente.

## Token (importante)

O bot precisa estar no servidor. O endpoint de listagem não exige permissão especial,
apenas token de bot válido.

**Nunca cole o token no chat nem commite.** Use uma destas opções:

```powershell
$env:DISCORD_BOT_TOKEN = "<token>"
node scripts/generate-discord-emojis.mjs
```

```powershell
$env:DISCORD_TOKEN_FILE = "C:\caminho\fora\do\repo\discord-token.txt"
node scripts/generate-discord-emojis.mjs
```

O arquivo de token deve conter apenas uma linha. Se o token vazar, revogue-o no
portal do Discord e crie outro.

## Saída e variáveis

Padrão: `server-patch/datapacks/aurora_discord/`.

| Variável | Padrão | Uso |
|---|---|---|
| `DISCORD_GUILD_ID` | `1460012886511587412` | Outro servidor |
| `DISCORD_BOT_TOKEN` | — | Token do bot |
| `DISCORD_TOKEN_FILE` | — | Arquivo local com o token |
| `DISCORD_EMOJI_FIXTURE` | — | JSON local para testar sem rede/token |
| `EMOJI_DATAPACK_OUT` | `server-patch/datapacks/aurora_discord` | Outro destino |
| `EMOJI_NAMESPACE` | `aurora_discord` | Outro namespace |
| `EMOJI_CATEGORY` | `Aurora` | Categoria no seletor do Emojiful |

Teste sem token:

```powershell
$env:DISCORD_EMOJI_FIXTURE = "C:\caminho\emojis-fixture.json"
$env:EMOJI_DATAPACK_OUT = "C:\temp\aurora-emojis"
node scripts/generate-discord-emojis.mjs
```

## Instalação no servidor (manual)

1. Rode o gerador e confira a pasta `server-patch/datapacks/aurora_discord/`.
2. Copie a pasta para `world/datapacks/` no servidor.
3. Reinicie o servidor (ou recarregue datapacks) — sem restart as receitas novas
   não chegam aos clientes.
4. No cliente, use `:nome:` no chat; o Emojiful renderiza o emoji.

Para atualizar depois de adicionar/remover emojis no Discord: rode o gerador de novo,
substitua a pasta e reinicie/recarregue.

Nada disso é enviado ao servidor por agente: upload e restart continuam manuais.
