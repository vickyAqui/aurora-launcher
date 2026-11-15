# KubeJS — avisos do Aurora Mortis

Dois scripts de servidor **independentes** (um não interfere no outro):

| Arquivo | Para quem avisa | Quando |
|---|---|---|
| `aurora_mortis_biomes.js` | operadores (OP) | jogador entra ou sai de um bioma do mod |
| `aurora_mortis_fronteira.js` | todos os jogadores online | jogador entra, sai ou passa de um domínio do mod para outro |

Não alteram o mod nem o modpack: usam o KubeJS que já está no pack.

## Aviso para operadores (`aurora_mortis_biomes.js`)

Avisa **somente os operadores** quando um jogador entra **ou sai** de um bioma
do mod `aurora_mortis`.

## O que faz

- Detecta a entrada em qualquer bioma do namespace `aurora_mortis`
  (hoje: `dominio_da_criatividade`, `dominio_da_ilusao`, `dominio_da_nostalgia`,
  `dominio_da_realidade`, `dominio_da_repeticao`, `dominio_de_olhos_do_pesadelo`,
  `dominio_do_caos`, `dominio_do_futuro`, `dominio_do_pesadelo`,
  `ilusao_sem_radicao`, `rubro` — e qualquer bioma novo do mod, automaticamente).
- Detecta também a **saída** para um bioma que não é do mod.
- Manda a mensagem **só para operadores**, incluindo: nome do jogador, id do
  bioma, coordenadas e dimensão.
- O envio principal é `tellraw @a[level=2..]`: o próprio servidor seleciona os
  operadores, sem depender do script enxergar o status de cada jogador. Se o
  comando não alcançar ninguém, cai para a lista de jogadores online com
  `isOp()` e para `AURORA_EXTRA_OPS` (nomes extras, para staff sem OP vanilla).
- Ignora biomas vanilla e de outros mods (Biomes O' Plenty, BYG, Regions
  Unexplored, etc.).
- Escreve no console quantos operadores receberam (`ops=N`), o que serve de
  diagnóstico.
- Cooldown separado de 30 s para entrada e para saída, por jogador.

Exemplo do que o operador vê:

```
[Aurora] Fulano entrou no bioma aurora_mortis:dominio_do_caos @ 123 64 -45 (minecraft:overworld)
[Aurora] Fulano saiu do bioma aurora_mortis:dominio_do_caos @ 140 66 -52 (minecraft:overworld)
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

Para testar o aviso de fronteira, atravesse **andando** a linha entre dois
domínios do mod (o caminho real do jogador). `/tp` entre domínios também dispara,
mas o teste que importa é o pé no chão. Confira no console:

```
logs/kubejs/server.log
[aurora-fronteira] Fulano: realidade -> futuro
[aurora] Fulano entrou em aurora_mortis:dominio_do_futuro @ 100 64 -200 (minecraft:overworld) ops=5
```

`ops=N` mostra quantos operadores receberam o aviso de bioma.

## Ajustes rápidos

Tudo fica no topo do arquivo:

| Constante | Padrão | Para que serve |
|---|---:|---|
| `AURORA_BIOME_NAMESPACE` | `aurora_mortis` | Namespace dos biomas que geram aviso |
| `AURORA_CHECK_EVERY_TICKS` | `10` | Frequência da checagem (10 ticks = 0,5 s) |
| `AURORA_ENTER_COOLDOWN_TICKS` | `600` | Tempo mínimo entre avisos de entrada do mesmo jogador (30 s) |
| `AURORA_EXIT_COOLDOWN_TICKS` | `600` | Idem para saída (contador separado) |
| `AURORA_ANNOUNCE_ON_JOIN` | `false` | `true` avisa também quando o jogador loga já dentro do bioma |
| `AURORA_EXTRA_OPS` | `[]` | Nomes de staff sem OP vanilla que também recebem o aviso |

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

## Aviso de fronteira (`aurora_mortis_fronteira.js`)

Arquivo **separado e independente** do aviso de OP. Avisa três eventos:

| Evento | Mensagem (quem cruzou / demais) | Cor |
|---|---|---|
| Entrou no domínio vindo de fora | `Você entrou no domínio X.` / `Fulano entrou no domínio X.` | dourado |
| Saiu do domínio para fora | `Você saiu do domínio X.` / `Fulano saiu do domínio X.` | amarelo |
| Passou de um domínio para outro | `Atenção: Você está ultrapassando uma fronteira!!` / `Atenção: Fulano está ultrapassando uma fronteira!!` | vermelho escuro |

Todas as mensagens saem em negrito. Por padrão (`AURORA_FRONTEIRA_ANNOUNCE_TO_ALL
= true`) **todos os jogadores online** recebem; quem cruzou vê "Você" e os
demais veem o nome.

- Biomas que são variações do mesmo domínio contam como o mesmo domínio (ver
  `AURORA_FRONTEIRA_DOMAIN_ALIASES`): `dominio_do_pesadelo` ×
  `dominio_de_olhos_do_pesadelo`, `dominio_da_ilusao` × `ilusao_sem_radicao` e
  `dominio_da_repeticao` × `rubro` não disparam aviso entre si.
- Usa NBT próprio (`aurora_fronteira_last_domain`), sem tocar no estado do
  script de OPs.
- **Janela de tolerância de 5 s** (`AURORA_FRONTEIRA_GRACE_TICKS`): em `/tp`,
  `/mvtp` e nas bordas o servidor pode mostrar um bioma comum por alguns ticks;
  o último domínio fica guardado nesse intervalo, então `A -> (comum) -> B`
  ainda conta como travessia `A -> B`. Sem isso o aviso não saía justamente em
  cima da fronteira.
- Cooldowns separados: travessia 5 s (`AURORA_FRONTEIRA_COOLDOWN_TICKS`),
  entrada/saída 20 s (`AURORA_FRONTEIRA_OUTSIDE_COOLDOWN_TICKS`).
- Checagem a cada 5 ticks (0,25 s) para não pular biomas ao andar rápido.
- Ao logar, o script assume o domínio atual sem avisar (evita aviso falso de
  login).
- Envio por `tellraw` (fallback `player.tell`), que é o caminho de chat mais
  confiável neste servidor.

Para desligar entrada e/ou saída sem perder a travessia, use
`AURORA_FRONTEIRA_ANNOUNCE_ENTER` e `AURORA_FRONTEIRA_ANNOUNCE_EXIT`. Para
desligar só esse aviso, apague (ou renomeie para `.js.disabled`)
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
