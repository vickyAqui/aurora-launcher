# Patch de servidor — meds and herbs 2.0.3

Patch para **servidor dedicado** que impede o mod de aplicar/remover efeitos e de
alterar atributos automaticamente. O modpack do launcher **não** é alterado: este é
um jar separado para substituir o original apenas no servidor.

O mod é `server_only` no Modrinth (`client_side: unsupported`, `server_side: required`),
então clientes não precisam dele. Se o pack do launcher já inclui o jar original, não
há problema: o servidor é quem manda nos efeitos e atributos.

## O que o patch faz

O mod original não tem config, gamerule nem comando: os efeitos e a velocidade de
movimento são aplicados por procedures do MCreator hardcoded. Este patch neutraliza
no bytecode **264 chamadas** que fazem isso:

| Chamada | Qtd. | Efeito |
|---|---:|---|
| `LivingEntity.addEffect(MobEffectInstance)` | 180 | aplicar efeito |
| `LivingEntity.removeEffect(MobEffect)` | 75 | remover efeito |
| `AttributeInstance.setBaseValue(double)` | 9 | velocidade de movimento |

Nada mais foi alterado. Efeitos, itens, receitas, texturas, GUI e o comportamento
interno dos efeitos (dano de sangramento, etc.) continuam iguais. A comparação
estrutural dos jars deu **2060 entradas / 0 diferenças**; só os 39 métodos que
continham essas chamadas mudaram.

## O que muda no jogo

- Nenhum efeito do mod é aplicado automaticamente (combate, carne crua, leite,
  plantas, seringas, kits médicos, curativos, etc.).
- Nenhum efeito do mod é removido automaticamente (kits/curativos não curam mais;
  use `/effect clear`).
- A velocidade de movimento não é mais alterada por osso quebrado, cura de osso ou
  adrenalina. Use `/attribute`.
- `/effect give` e `/effect clear` continuam funcionando normalmente. Como o mod não
  mexe mais em efeitos, o efeito dado por comando **permanece** até expirar ou ser
  removido por comando.
- `/attribute <jogador> minecraft:generic.movement_speed base set <valor>` continua
  funcionando normalmente.
- Beber leite ainda limpa todos os efeitos (comportamento vanilla). O mod original
  reaplicava os efeitos do mod depois do leite; este patch desativa essa reaplicação.
- Itens médicos continuam funcionando como itens (podem gastar durabilidade, aplicar
  cooldown ou tocar som), mas não aplicam nem removem efeito.

### Sobre a "tag de bypass"

No método de jar a tag não é necessária. A ideia da tag era impedir que um loop
automático limpasse os efeitos dados por comando. Aqui o mod simplesmente não
adiciona nem remove mais nada, então todo efeito aplicado por `/effect` já fica
preservado. O jar não lê tags/scoreboard; implementar uma tag exigiria um script
KubeJS separado e não traria benefício para este objetivo.

## Instalação

1. Pare o servidor.
2. Faça backup de `mods/meds_and_herbs-1.20.1-2.0.3.jar`.
3. Substitua pelo jar patchado:
   `server-patch/mods/meds_and_herbs-1.20.1-2.0.3.jar`
   (mantenha o mesmo nome; o Forge identifica o mod pelo `mods.toml`, não pelo arquivo).
4. Inicie o servidor.
5. Uma vez, com os jogadores online, corrija a velocidade de quem ficou travado:
   ```
   /attribute @a minecraft:generic.movement_speed base set 0.1
   ```
   Jogadores offline mantêm o valor salvo; rode o comando quando entrarem (ou use
   `/attribute <nome> ...`).

Clientes com o jar original continuam conectando: o id e a versão do mod não mudaram
(`meds_and_herbs` 2.0.3).

## Testes rápidos

- `/effect give @s meds_and_herbs:bleeding 30 0` → o efeito aparece e permanece.
- Bater em um mob/player com dano alto → não deve aplicar sangramento.
- Comer carne crua → não deve aplicar parasitas.
- Usar seringa/kit médico → não deve aplicar nem remover efeito.
- `/attribute @s minecraft:generic.movement_speed base set 0.2` → a velocidade muda.

IDs de efeito do mod: `meds_and_herbs:bleeding`, `meds_and_herbs:broken_bone`,
`meds_and_herbs:bone_heal`, `meds_and_herbs:adrenaline`, `meds_and_herbs:parasites`,
`meds_and_herbs:burns`, `meds_and_herbs:laceration`, `meds_and_herbs:painkiller`, etc.

## Reaplicar o patch (se o mod atualizar)

O patcher é autocontido (`tools/patch.jar`, já inclui ASM). Precisa só de Java 17+.

```powershell
java -jar server-patch/tools/patch.jar <jar-original> <jar-patchado>
```

Ou, no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File server-patch/tools/patch.ps1 `
  -InputJar "mods/meds_and_herbs-1.20.1-2.0.3.jar" `
  -OutputJar "mods/meds_and_herbs-1.20.1-2.0.3-server.jar"
```

O patcher informa quantas chamadas neutralizou. Para 2.0.3 o esperado é:

```
Patched calls: addEffect=180 removeEffect=75 setBaseValue=9 total=264
```

Se o mod mudar de versão, os nomes SRG (`m_7292_`, `m_21195_`, `m_22100_`) podem
mudar. Nesse caso, revise o `tools/Patch.java` e recompile. O fonte está incluído.

## Validação feita

- 815 classes / 3681 métodos verificados com ASM: **0 erros** (no original e no patchado).
- Comparação estrutural original × patchado: **2060 entradas, 0 diferenças**
  (anotações, campos, assinaturas, `maxStack`/`maxLocals` e recursos idênticos).
- Só os **39 métodos** que continham as chamadas mudaram; **264 chamadas** neutralizadas.
- Teste funcional em JVM com stubs: o jar original chamou `setBaseValue(0.125)` em
  `RunningSpeedsProcedure`; o patchado chamou **0 vezes**. O teste também confirma que
  a classe patchada passa no verificador da JVM.

## Outros recursos de servidor

- `kubejs/` — scripts KubeJS: aviso **somente para operadores** ao entrar em um
  bioma do mod `aurora_mortis` e aviso de fronteira para os operadores (com o
  `Atenção` pessoal apenas quando o jogador passa de um domínio do mod para
  outro). Instruções em `kubejs/README.md`. É independente deste patch.
- `mod/` + `resourcepack/assets/` — mod de recursos que troca o modelo e a
  textura da **brewing stand** pelo caldeirão "Caldeirão Futuro". Instruções
  abaixo.

## Bloodmoon Update — mensagens em português

O Bloodmoon Update 1.4.1 grava as mensagens de início/fim direto no constant pool de
`BloodmoonUtils.class` (não há config nem tradução para editar):

| Ocorrência | Original | Patchado |
|---|---|---|
| início | `§c💀 A bloodmoon is rising... Beware of the monsters... 💀` | `§4§lA Raiva clama por uma resolução` |
| fim | `The strange moon is fading` | `§4§lA Raiva se acalma...` |

`§4` é vermelho forte e `§l` é negrito. O patch muda **somente essas duas strings**;
o jar resultante tem as mesmas 215 entradas do original, com um único `.class`
diferente. O id/versão do mod não mudam, então clientes não precisam de nada.

### Instalação

1. Pare o servidor.
2. Substitua `mods/bloodmoon-1.20.1-1.4.1-forge-1.20.1.jar` pelo jar patchado em
   `server-patch/mods/` (mantenha o mesmo nome).
3. Inicie o servidor. Não precisa recarregar scripts.

> **Atenção:** nunca sobrescreva o jar com o servidor rodando. O classloader
> mantém os offsets do zip em memória e as classes ainda não carregadas passam
> a falhar com `NoClassDefFoundError` (o comando `/bloodmoon moon_event start`
> é o primeiro a quebrar). Se isso acontecer,pare e inicie de novo.

### Reaplicar (se o mod atualizar)

```powershell
python server-patch/tools/patch-bloodmoon-messages.py `
  <jar-original> `
  server-patch/mods/bloodmoon-1.20.1-1.4.1-forge-1.20.1.jar
```

O script localiza as mensagens pelo texto antigo, reescreve as entradas UTF-8 e
reconstrói o jar. Se o texto mudar na versão nova, atualize `REPLACEMENTS` no
topo do script.

### Efeito e trilha no início

`kubejs/server_scripts/aurora_bloodmoon_fix.js` também dispara, na transição
`bloodmoonActive false → true`:

- `effect give @a alexsmobs:earthquake 15 1 true` (15s, nível 1, sem partículas);
- `sotpl play @a bloodmoon_fury url https://youtu.be/ECaneS01wCs?si=r1hKL7k1Eau3nN7i 100 20 40 true false 1.0 MUSIC`.

Aos 30 segundos (600 ticks) o script envia `sotpl stop @a bloodmoon_fury 40`,
com fade de 2 segundos. Se a bloodmoon terminar antes, o stop é enviado na hora.
Isso funciona com `/kubejs reload server_scripts`, sem restart.

## Caldeirão Futuro (mod de recursos)

Modelos e texturas de bloco são renderizados pelo **cliente**. Antes isso era um
resource pack servido pelo servidor (`resource-pack=`); agora é um **mod de
recursos** que viaja no modpack e carrega automaticamente junto com o jogo.

Por que mod e não pack de servidor:

- o pack de servidor fica em `server-resource-packs/<sha1 da URL>` e o cliente
  **não rebaixa** se a pasta existe — trocar o zip mantendo a URL não chegava a
  quem já tinha baixado;
- pack de servidor pode ser recusado ou falhar no download, e com
  `require-resource-pack=true` isso expulsa o jogador (fonte de reclamação e de
  erro de conexão);
- assets de mod (`mod_resources`) **não aparecem** na tela de resource packs,
  então o jogador não consegue desativar o modelo.

O mod é `aurora_vicky-1.0.4.jar` (mod id `aurora_vicky`): uma classe `@Mod` (registra o jar, a
partícula customizada e os pronomes) + `META-INF/mods.toml` + `pack.mcmeta` + `assets/` + dois
mixins client-side. Ele usa `displayTest="IGNORE_SERVER_VERSION"`, então o cliente entra em
servidores que não têm o mod sem aviso de incompatibilidade.

Na 1.0.3 o jar também inclui as texturas de interface (inventário, botões, fundos de menu) do
`aurora_mortis_lib`, para garantir que o tema Aurora apareça mesmo quando outro mod carrega
depois e sobrescreve os assets padrão. A 1.0.4 adiciona logs (`AuroraPronouns` e
`AuroraPronounsRender`) para diagnosticar por que o `/pronome` não aparece em terceira pessoa.

- **Caldeirão e partícula do tótem:** só o cliente precisa do mod (o servidor não precisa).
- **Pronomes:** o servidor **precisa** do mod — é ele que registra `/pronome`, guarda os dados por
  UUID e sincroniza com os clientes. Sem o mod no servidor o comando não existe e nada aparece.

### O que o mod muda

| Arquivo | Efeito |
|---|---|
| `assets/minecraft/blockstates/brewing_stand.json` | um único `multipart` com `apply`, sem os modelos de bule/garrafa do vanilla |
| `assets/minecraft/models/block/brewing_stand.json` | geometria do caldeirão (18 elementos) |
| `assets/minecraft/models/item/brewing_stand.json` | item usa o modelo do bloco (aparece como bloco 3D) |
| `assets/aurora_vicky/textures/block/caldeirao_futuro.png` | textura 128×128 |
| `auroratotem.mixins.json` + `com/aurora/totem/mixin/TotemOfPossessionMixin` | troca o `DustParticleOptions.REDSTONE` emitido pelo `TotemOfPossessionItem.onUseTick` pela partícula `auroratotem:totem_viola` |
| `assets/auroratotem/particles/totem_viola.json` + `textures/particle/totem_viola.png` | sprite violeta usado pela partícula (imagem `viola.png` fornecida pelo usuário) |
| `aurorapronouns.mixins.json` + `com/aurorastudios/vicky/pronouns/mixin/PronounNameTagMixin` | desenha o pronome como segunda linha menor abaixo da name tag |
| `assets/minecraft/textures/gui/**` | interface Aurora (botões, inventário, menus) do `aurora_mortis_lib`, replicada aqui para garantir precedência |

### Pronomes

Cada jogador escolhe o próprio pronome com `/pronome <texto>` (ex.: `/pronome §dela/ela`).
O texto aparece abaixo do nome no mundo, em escala reduzida, com cor/decoração via códigos `§`
(`§c`, `§l`, `§o`, `§r`, etc.). `/pronome limpar` remove; `/pronome` sozinho mostra a ajuda.

Os dados ficam em `config/aurora_pronouns.json` no servidor, no formato `UUID -> texto`, e são
enviados a cada cliente ao entrar e a todos quando alguém define/altera o pronome. O lado do
servidor valida e limita o texto a 32 caracteres (códigos `§` contam), descarta caracteres de
controle e só aceita códigos de formatação válidos.

O mixin intercepta **apenas** o `addParticle` dentro de `onUseTick` (é o único ponto do método que
emite partícula), então redstone e outros efeitos não são afetados. A classe é compilada com
ForgeGradle e reobfuscada para nomes SRG (`m_5929_` / `Level.m_7106_`); as fontes estão em
`mod/totem-src/` e os `.class` em `mod/classes/`.

A GUI da brewing stand não é afetada (usa textura própria) e os bules continuam
sendo renderizados pelo block entity; só a geometria do bloco e o ícone do item
mudam.

### Limitações do modelo em 1.20.1

O JSON exportado do Blockbench usa rotações em vários eixos, que o Java 1.20.1
não aceita (só um eixo, com ângulo `±22.5` ou `±45`). Duas aproximações foram
feitas:

- elementos 10 e 11 (75° em Z) viraram caixas verticais do mesmo comprimento;
- elemento 17 (Euler `18.79 / 51.48 / -0.99`) virou rotação X `22.5`.

As regiões da textura usadas por esses elementos são cor sólida, então a
distorção de UV é imperceptível.

O campo `texture_size` do export foi removido: o 1.20.1 não o lê, e as UVs já
estão na escala 0–16 (16 unidades = textura inteira).

### Estrutura

- `mod/mods.toml`, `mod/pack.mcmeta` — metadados do mod
- `mod/src/com/aurorastudios/vicky/AuroraVicky.java` — classe `@Mod` (partícula, comando e sincronização)
- `mod/src/com/aurorastudios/vicky/pronouns/` — storage, comando, rede, parser de texto e mixin da tag
- `mod/auroratotem.mixins.json` — config do mixin da partícula
- `mod/aurorapronouns.mixins.json` — config do mixin do pronome
- `mod/totem-src/` — fontes Java do mixin/registro da partícula (referência)
- `mod/classes/` — `.class` reobfuscados pelo ForgeGradle, copiados para o jar
- `resourcepack/assets/` — assets reaproveitados (blockstate, modelos, textura, partícula)

### Build e publicação

```powershell
# compila o jar e copia para modpack/mods/
powershell -ExecutionPolicy Bypass -File server-patch/tools/build-caldeirao-mod.ps1

# regenera o modpack.json (inclui o jar novo)
node scripts/build-modpack.mjs

# publica na release "modpack" (confira o plano antes)
node scripts/publish-modpack.mjs --dry-run
node scripts/publish-modpack.mjs
```

O `build-caldeirao-mod.ps1` usa o JDK 17 do launcher
(`%APPDATA%\.aurora_studios\aurora-studios\runtime\jre-17`) e jars das bibliotecas do launcher
(`javafmllanguage`, `forge-universal`, `fmlcore`, `eventbus` e o `client-srg`) como classpath,
além dos `.class` em `mod/classes/`. Se o jar mudar de conteúdo, **suba a versão no nome**
(`aurora_vicky-1.0.4.jar`): o launcher compara tamanho e SHA1 do manifesto.

Para mudar o sprite, substitua `resourcepack/assets/auroratotem/textures/particle/totem_viola.png`
e recompile o jar. Para mudar o código do mixin, edite `mod/totem-src/`, recompile com ForgeGradle
e atualize `mod/classes/`.

### Servidor

O `server.properties` voltou ao original, sem `resource-pack`. O backup da
configuração antiga (pack obrigatório) é `server.properties.bak-20261112`, e a
release `server-pack` (com o zip antigo) foi apagada.

### Validar em jogo

- O jar aparece em `mods/` e o Forge o carrega no boot (log: `aurora_vicky`).
- Colocar uma brewing stand: deve aparecer o caldeirão.
- Item no inventário e na mão: bloco 3D.
- Segurar o Totem of Possession em uma entidade: partículas com o sprite violeta
  em volta da entidade (redstone continua normal).
- Tela de resource packs: o mod **não** aparece na lista, então não há como
  desativar por ali.
- Com o mod também no servidor: `/pronome §dela/ela` deve mostrar `ela/ela` em rosa abaixo
  do nome de quem definiu; `/pronome limpar` remove; o texto sobrevive a restart (arquivo
  `config/aurora_pronouns.json`). Outros jogadores veem a tag sem precisar digitar nada.

## Arquivos

- `mods/meds_and_herbs-1.20.1-2.0.3.jar` — jar patchado para o servidor
- `tools/patch.jar` — patcher autocontido (Java 17+)
- `tools/Patch.java` — fonte do patcher
- `tools/patch.ps1` — atalho para Windows
- `resourcepack/assets/` — assets do caldeirão (blockstate, modelos, textura) e da interface Aurora
- `mod/` — fonte do mod (`mods.toml`, `pack.mcmeta`, `@Mod`, mixin e assets)
- `aurora_vicky-1.0.4.jar` — mod gerado, copiado para `modpack/mods/`
- `tools/build-caldeirao-mod.ps1` — compila o mod e copia para o modpack
- `NOTICE.md` — atribuição e aviso de modificação
- `licenses/` — textos das licenças Apache-2.0 e AFL-3.0
- `CHECKSUMS.txt` — hashes para conferência
