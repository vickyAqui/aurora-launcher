# KubeJS — avisos do Aurora Mortis

Dois scripts de servidor **independentes** (um não interfere no outro):

| Arquivo | Para quem avisa | Quando |
|---|---|---|
| `aurora_mortis_biomes.js` | operadores (OP) | jogador troca de **sub-bioma** dentro do mesmo domínio do mod |
| `aurora_mortis_fronteira.js` | operadores (OP) e, na travessia entre domínios, quem cruzou | jogador entra, sai ou passa de um domínio do mod para outro |
| `aurora_born_in_chaos_spawns.js` | — (controle de spawn) | spawn natural de mobs do Born in Chaos |
| `aurora_ajuda.js` | operadores (OP) | jogador usa `/ajuda {motivo}` |

Não alteram o mod nem o modpack: usam o KubeJS que já está no pack.

O `aurora_born_in_chaos_spawns.js` limita **todos** os mobs do Born in Chaos
(namespace `born_in_chaos_v1`) ao bioma `aurora_mortis:dominio_do_pesadelo` e a
suas variações `dominio_de_olhos_do_pesadelo` / `pesadelo`. Fora desses biomas o
spawn natural é cancelado; spawns de spawners e de ovos de spawn não são
afetados. O comando `/bornspawns` (alias `/aurorabornspawns`) mostra o estado e o
bioma liberado; `/bornspawns on|off` alterna o bloqueio em quente.

O `aurora_ajuda.js` implementa `/ajuda {motivo}`: qualquer jogador pode pedir
ajuda e **todos os operadores online** recebem no chat:

```
[AJUDA] NomeDoJogador: motivo que ele digitou
```

A mensagem aparece **roxo e em negrito**, sem som e sem título. Quem pediu vê só uma confirmação
privada (`[Ajuda] Enviado aos operadores (N).`) e tem **cooldown de 30 s** por
jogador. O motivo é livre (texto até 160 caracteres) e aparece no `/help`.
Os destinatários vêm de `kubejs/config/aurora_ops.json`, do `ops.json` e de
`isOp()` — a mesma lógica dos avisos de bioma/fronteira. Depois de copiar o
arquivo, `/kubejs reload server_scripts` já habilita o interceptador; o `/help`
com o argumento aparece após restart do servidor.

> **Divisão de trabalho (importante):** só o `aurora_mortis_fronteira.js`
> anuncia cruzamento de fronteira no chat (para os OPs e, na travessia entre
> domínios, também para quem cruzou). O `aurora_mortis_biomes.js` anuncia
> apenas variação de bioma **dentro do mesmo domínio** (detalhe técnico para os
> OPs). Antes os dois anunciavam o mesmo cruzamento e o OP recebia quatro
> mensagens por evento — era o spam reclamado.

## Aviso de sub-bioma para operadores (`aurora_mortis_biomes.js`)

Avisa **somente os operadores** quando um jogador troca de bioma **dentro do
mesmo domínio** do mod `aurora_mortis` (ex.: `dominio_da_ilusao` →
`ilusao_sem_radicao`, ou `dominio_da_repeticao` → `rubro`).

## O que faz

- Detecta a troca de bioma do namespace `aurora_mortis`
  (hoje: `dominio_da_criatividade`, `dominio_da_ilusao`, `dominio_da_nostalgia`,
  `dominio_da_realidade`, `dominio_da_repeticao`, `dominio_de_olhos_do_pesadelo`,
  `dominio_do_caos`, `dominio_do_futuro`, `dominio_do_pesadelo`,
  `ilusao_sem_radicao`, `rubro` — e qualquer bioma novo do mod, automaticamente).
- **Entrada e saída de domínio não passam por aqui**: elas são anunciadas pelo
  `aurora_mortis_fronteira.js`, para os operadores. Aqui só fica o registro
  no console (`mudou de dominio: ...`), para diagnóstico.
- Manda a mensagem **só para operadores**, incluindo: nome do jogador, id do
  bioma, coordenadas e dimensão.
- A lista de administradores vem primeiramente de
  **`kubejs/config/aurora_ops.json`** (arquivo compartilhado pelos dois scripts,
  editável no painel, relido a cada aviso — não precisa recarregar o script).
  Em seguida o script complementa com `ops.json`/`getOps()` do servidor,
  `isOp()`, `AURORA_EXTRA_OPS` e, por último, `tellraw @a[level=2..]`.
- O envio é feito **um a um, por nome** (`tellraw <nome>`), porque neste
  servidor (Arclight + LuckPerms) o seletor `@a[level=2..]` não enxerga todos os
  OPs. Ao ler `ops.json`, o script usa `getName()`/`getId()` do `GameProfile`:
  converter o objeto direto em string não devolve o nome do jogador e era por
  isso que parte da staff ficava sem aviso.
- Ignora biomas vanilla e de outros mods (Biomes O' Plenty, BYG, Regions
  Unexplored, etc.).
- Escreve no console quantos operadores receberam e quem eram (`ops=N [nomes]`),
  o que serve de diagnóstico.
- Cooldown de 30 s por jogador, para não repetir o aviso de sub-bioma.

Exemplo do que o operador vê:

```
[Aurora] Fulano entrou no bioma aurora_mortis:ilusao_sem_radicao @ 123 64 -45 (minecraft:overworld)
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
mas o teste que importa é o pé no chão. Quem cruzou deve ver
`Atenção: Você está ultrapassando uma fronteira!!` e os OPs recebem o aviso com
os dois domínios. Entrar no mod vindo de um bioma vanilla (ou sair dele) avisa
só os OPs, sem o `Atenção` pessoal. Confira no console:

```
logs/kubejs/server.log
[aurora-fronteira] Fulano: realidade -> futuro (5 ops)
[aurora] Fulano mudou de dominio: ... (aviso pelo aurora_mortis_fronteira.js)
```

`(5 ops)` mostra quantos operadores receberam o aviso de fronteira.

## Lista de administradores (`aurora_ops.json`)

Arquivo: `<servidor>/kubejs/config/aurora_ops.json` (no repositório:
`server-patch/kubejs/config/aurora_ops.json`). Os dois scripts usam a **mesma**
lista. Ela vem preenchida com os administradores atuais do `ops.json` do
servidor, mas pode ser editada livremente no painel:

```json
{
  "operators": [
    "NomeSimples",
    { "name": "AMCaos", "uuid": "cd935f06-c626-37af-9dd7-7b5a9b68dd91" }
  ]
}
```

- Aceita **nome** (comparação sem diferenciar maiúsculas/minúsculas) e/ou
  **UUID** — assim um admin que trocou de nome continua recebendo.
- O arquivo é **relido a cada aviso**: adicionar ou remover alguém não exige
  `/kubejs reload server_scripts`.
- A lista do `ops.json` e o `isOp()` continuam funcionando como complemento;
  o JSON serve para garantir quem deve receber mesmo quando o servidor não
  reconhece o OP (Arclight + LuckPerms).

## Ajustes rápidos

Tudo fica no topo de cada arquivo:

`aurora_mortis_biomes.js`:

| Constante | Padrão | Para que serve |
|---|---:|---|
| `AURORA_BIOME_NAMESPACE` | `aurora_mortis` | Namespace dos biomas que geram aviso |
| `AURORA_CHECK_EVERY_TICKS` | `10` | Frequência da checagem (10 ticks = 0,5 s) |
| `AURORA_ENTER_COOLDOWN_TICKS` | `600` | Tempo mínimo entre avisos de sub-bioma do mesmo jogador (30 s) |
| `AURORA_ANNOUNCE_ON_JOIN` | `false` | `true` avisa também quando o jogador loga já dentro do bioma |
| `AURORA_EXTRA_OPS` | `[]` | Nomes de staff sem OP vanilla que também recebem o aviso |
| `AURORA_OPS_CONFIG_PATHS` | `kubejs/config/aurora_ops.json` | Caminhos do JSON compartilhado de administradores |

`aurora_mortis_fronteira.js`:

| Constante | Padrão | Para que serve |
|---|---:|---|
| `AURORA_FRONTEIRA_DEBOUNCE_TICKS` | `40` | Tempo que o jogador precisa ficar no novo domínio antes do aviso (2 s) |
| `AURORA_FRONTEIRA_EXIT_GRACE_TICKS` | `200` | Tempo fora do domínio antes de avisar a saída (10 s) |
| `AURORA_FRONTEIRA_COOLDOWN_TICKS` | `1` | Rede de segurança entre dois avisos do mesmo jogador. Em 1 tick não engole travessia real |
| `AURORA_FRONTEIRA_ANNOUNCE_TO_OPS` | `true` | Avisa os operadores online sobre cada passagem |
| `AURORA_FRONTEIRA_ANNOUNCE_PERSONAL` | `true` | `Atenção: Você...` só na travessia entre dois domínios do Mortis |
| `AURORA_FRONTEIRA_ANNOUNCE_ENTER` | `true` | Avisar aos OPs ao entrar em um domínio |
| `AURORA_FRONTEIRA_ANNOUNCE_EXIT` | `true` | Avisar aos OPs ao sair de um domínio |
| `AURORA_FRONTEIRA_EXTRA_OPS` | `[]` | Nomes de staff sem OP vanilla que também recebem o aviso |
| `AURORA_FRONTEIRA_OPS_CONFIG_PATHS` | `kubejs/config/aurora_ops.json` | Caminhos do JSON compartilhado de administradores |

Para desligar um recurso: apague (ou renomeie para `.js.disabled`) o arquivo e
rode `/kubejs reload server_scripts`.

## Observações

- **Nunca use `/reload` neste servidor.** Ele é Arclight (Forge + Bukkit): o
  `/reload` cai no reload do Bukkit, que já quebrou o registro de comandos do
  servidor (todos os comandos passaram a responder "Unknown command"). Para
  recarregar scripts use `/kubejs reload server_scripts`; para o resto,
  reinicie.
- O estado do último bioma fica no NBT do jogador (`aurora_last_biome`), mas é
  **zerado no login**: assim o valor de uma sessão anterior não mascara o evento
  quando o jogador reloga em outro lugar e volta. O primeiro tick depois do
  login só registra o bioma atual, sem avisar.
- Como o aviso é por troca de bioma, ficar parado dentro dele não repete a
  mensagem.
- Não depende do patch do `meds_and_herbs`; os dois recursos são independentes.

## Aviso de fronteira (`aurora_mortis_fronteira.js`)

Arquivo **separado e independente** do aviso de OP. É o **único** script que
anuncia fronteira no chat. Toda passagem gera **um** aviso detalhado para os
**operadores online**, dizendo quem passou, de qual para qual domínio e em qual
bioma/coordenada. O aviso pessoal `Atenção` só existe quando a travessia é de um
domínio do Mortis para outro:

| Evento | Aviso aos OPs | Aviso pessoal (quem cruzou) |
|---|---|---|
| Entrou no domínio vindo de fora | `[Aurora] Fulano entrou no domínio Nostalgia (aurora_mortis:dominio_da_nostalgia) @ x y z (dim)` | não |
| Saiu do domínio para fora | `[Aurora] Fulano saiu do domínio Nostalgia (agora em minecraft:plains) @ x y z (dim)` | não |
| Passou de um domínio para outro | `[Aurora] Fulano ultrapassou a fronteira: Nostalgia -> Repetição (aurora_mortis:dominio_da_repeticao) @ x y z (dim)` | `Atenção: Você está ultrapassando uma fronteira!!` |

O `Atenção` pessoal sai em **vermelho escuro e negrito** e vai por `player.tell`
direto no jogador que cruzou (sem depender de comparar nomes), como fallback para
`tellraw`. Avisos de entrada e saída do mod **não** geram esse aviso pessoal: não
são travessias entre biomas do Mortis.

### Por que não repete (anti-spam)

- **Debounce de 2 s** (`AURORA_FRONTEIRA_DEBOUNCE_TICKS`): o jogador precisa
  ficar 2 s no novo domínio antes do aviso. Quem fica em cima da linha, com o
  bioma trocando a cada poucos ticks, nunca completa o tempo e não recebe nada.
- **Saída só depois de 10 s fora** (`AURORA_FRONTEIRA_EXIT_GRACE_TICKS`): sair e
  voltar rápido (andar na borda, `/tp` curto) não gera mensagem nenhuma. Antes a
  saída era anunciada no fim da janela de 5 s e quem voltava recebia "saiu" e
  "entrou" quase juntos.
- A mesma janela faz um `/tp` que mostra um bioma comum no meio continuar sendo
  **uma** travessia `A -> B`, e não "saiu de A" + "entrou em B".
- **Cooldown em 1 tick** (`AURORA_FRONTEIRA_COOLDOWN_TICKS = 1`): fica só como
  rede de segurança contra disparo duplicado no mesmo tick. Antes era 3 s e
  engolia travessia de verdade — quem saía (aviso de saída) e voltava logo em
  seguida tinha a entrada descartada, que era a queixa "o Atenção não aparece
  para quem atravessou".

### Outros detalhes

- Biomas que são variações do mesmo domínio contam como o mesmo domínio (ver
  `AURORA_FRONTEIRA_DOMAIN_ALIASES`): `dominio_do_pesadelo` ×
  `dominio_de_olhos_do_pesadelo`, `dominio_da_ilusao` × `ilusao_sem_radicao` e
  `dominio_da_repeticao` × `rubro` não disparam aviso entre si.
- Usa NBT próprio (`aurora_fronteira_*`), sem tocar no estado do script de OPs.
- Checagem a cada 5 ticks (0,25 s) para não pular biomas ao andar rápido.
- Ao logar, o script assume o domínio atual sem avisar (evita aviso falso de
  login).
- Envio aos OPs por `tellraw` um a um (fallback `player.tell`), que é o caminho
  de chat mais confiável neste servidor; a lista de OPs vem do próprio servidor,
  como no `aurora_mortis_biomes.js`.

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
