# KubeJS — avisos do Aurora Mortis

Dois scripts de servidor **independentes** (um não interfere no outro):

| Arquivo | Para quem avisa | Quando |
|---|---|---|
| `aurora_mortis_biomes.js` | operadores (OP) | jogador entra em bioma do mod |
| `aurora_mortis_fronteira.js` | o próprio jogador | jogador cruza a borda de um bioma do mod |

Não alteram o mod nem o modpack: usam o KubeJS que já está no pack.

## Aviso para operadores (`aurora_mortis_biomes.js`)

Avisa **somente os operadores** quando um jogador entra em um bioma do mod
`aurora_mortis`.

## O que faz

- Detecta a entrada em qualquer bioma do namespace `aurora_mortis`
  (hoje: `dominio_da_criatividade`, `dominio_da_ilusao`, `dominio_da_nostalgia`,
  `dominio_da_realidade`, `dominio_da_repeticao`, `dominio_de_olhos_do_pesadelo`,
  `dominio_do_caos`, `dominio_do_futuro`, `dominio_do_pesadelo`,
  `ilusao_sem_radicao`, `rubro` — e qualquer bioma novo do mod, automaticamente).
- Manda a mensagem **só para quem tem OP** (nível 2 ou mais), incluindo:
  nome do jogador, nome do bioma, id do bioma, coordenadas e dimensão.
- Ignora biomas vanilla e de outros mods (Biomes O' Plenty, BYG, Regions
  Unexplored, etc.).
- Também escreve a mesma informação no console do servidor.
- Tem cooldown de 30 s por jogador para não floodar quando se anda na borda.

Exemplo do que o operador vê:

```
[Aurora] Fulano entrou no bioma Domínio do Caos (aurora_mortis:dominio_do_caos) @ 123 64 -45 em minecraft:overworld
```

## Instalação

1. Copie o arquivo com o servidor parado **ou** com ele rodando (depois aplique
   com `/kubejs reload server_scripts`).
2. Copie a pasta `kubejs/` para a raiz do servidor, de forma que fique:
   ```
   <servidor>/kubejs/server_scripts/aurora_mortis_biomes.js
   ```
   Se o servidor já tem uma pasta `kubejs/`, copie só o arquivo `.js` para
   dentro de `kubejs/server_scripts/`.
3. Inicie o servidor. O script carrega junto com os server scripts.
4. Confira no console: deve aparecer o carregamento dos scripts do KubeJS sem
   erro.

> O KubeJS precisa estar nos mods do servidor. Ele já está no modpack, então se
> o servidor roda o mesmo pack, não precisa baixar nada.

## Como testar

No jogo, como operador:

```
/locate biome aurora_mortis:dominio_do_caos
/tp @s <x> <y> <z>
```

Ao chegar no bioma, **outro** operador (ou você mesmo) deve receber a mensagem.
Se você for o único OP online, a mensagem aparece para você mesmo — é o esperado.

Para testar sem se locomover, use um jogador não-OP e teleporte-o para o bioma.

## Ajustes rápidos

Tudo fica no topo do arquivo:

| Constante | Padrão | Para que serve |
|---|---:|---|
| `AURORA_BIOME_NAMESPACE` | `aurora_mortis` | Namespace dos biomas que geram aviso |
| `AURORA_CHECK_EVERY_TICKS` | `10` | Frequência da checagem (10 ticks = 0,5 s) |
| `AURORA_COOLDOWN_TICKS` | `600` | Tempo mínimo entre avisos do mesmo jogador (30 s) |
| `AURORA_ANNOUNCE_ON_JOIN` | `false` | `true` avisa também quando o jogador loga já dentro do bioma |

Para desligar o recurso: apague (ou renomeie para `.js.disabled`) o arquivo e
rode `/kubejs reload server_scripts`.

## Observações

- **Nunca use `/reload` neste servidor.** Ele é Arclight (Forge + Bukkit): o
  `/reload` cai no reload do Bukkit, que já quebrou o registro de comandos do
  servidor (todos os comandos passaram a responder "Unknown command"). Para
  recarregar scripts use `/kubejs reload server_scripts`; para o resto,
  reinicie.
- O estado do último bioma fica salvo no NBT do jogador
  (`aurora_last_biome`), então sobrevive a relog e a reload de scripts.
- Como o aviso é por entrada no bioma, ficar parado dentro dele não repete a
  mensagem.
- Não depende do patch do `meds_and_herbs`; os dois recursos são independentes.

## Aviso pessoal de fronteira (`aurora_mortis_fronteira.js`)

Arquivo **separado e independente** do aviso de OP. Quando o jogador cruza a
borda de um bioma do `aurora_mortis` (entrando, saindo ou passando de um
domínio para outro), **ele mesmo** recebe:

```
Atenção: Você está ultrapassando uma fronteira!!
```

A mensagem sai em **vermelho escuro (`dark_red`) e negrito**.

- Só o jogador que cruzou recebe; os OPs continuam recebendo o aviso do outro
  script normalmente.
- Usa NBT próprio (`aurora_fronteira_last_biome`), sem tocar no estado do
  script de OPs.
- Cooldown de 3 s (`AURORA_FRONTEIRA_COOLDOWN_TICKS`) para não floodar quando
  se anda na borda.
- Só avisa se pelo menos um dos lados da travessia é bioma do mod; trocar de
  bioma vanilla para outro vanilla não gera nada.

Para desligar só esse aviso, apague (ou renomeie para `.js.disabled`)
`aurora_mortis_fronteira.js` e rode `/kubejs reload server_scripts` — o aviso
de OP continua funcionando.

## Cuidados ao editar (Rhino do KubeJS)

O Rhino que roda os scripts do KubeJS tem duas manias que já causaram bugs
reais aqui:

- **`const`/`let` dentro de um `for`**: na segunda iteração o Rhino acusa
  `redeclaration of var <nome>`. Em loop, use `var` (é o que o script faz em
  `auroraTellOps`).
- **`const` no nível do arquivo vaza para o escopo global** e colide com o
  mesmo nome em outro script (`redeclaration of var x`). Por isso todos os
  nomes deste script levam o prefixo `aurora`/`AURORA_`.

Outras APIs que **não** existem no KubeJS (testado no servidor):

| Tentativa | Correto |
|---|---|
| `level.gameTime` | `server.tickCount` |
| `level.dimension()` | `level.dimension.location()` |
| `player.isOp` (propriedade) | `player.isOp()` (função) |
| `server.players.filter(...).tell(...)` | loop com `.get(i)` e `.tell(...)` em cada jogador |
