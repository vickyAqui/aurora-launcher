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
  bioma do mod `aurora_mortis` e aviso de fronteira para o jogador que cruza a
  borda. Instruções em `kubejs/README.md`. É independente deste patch.
- `resourcepack/` — resource pack que troca o modelo e a textura da **brewing
  stand** pelo caldeirão "Caldeirão Futuro". Instruções abaixo.

## Resource pack do caldeirão

Modelos e texturas de bloco são renderizados pelo **cliente**; o servidor só
distribui o pacote. O pack é servido por `resource-pack=` no `server.properties`
e é **obrigatório** (`require-resource-pack=true`): quem recusar o download é
expulso, então todo mundo vê o caldeirão.

### O que o pack muda

| Arquivo no pack | Efeito |
|---|---|
| `assets/minecraft/blockstates/brewing_stand.json` | um único `multipart` com `apply`, sem os modelos de bule/garrafa do vanilla |
| `assets/minecraft/models/block/brewing_stand.json` | geometria do caldeirão (18 elementos) |
| `assets/minecraft/models/item/brewing_stand.json` | item usa o modelo do bloco (aparece como bloco 3D) |
| `assets/aurora_caldeirao/textures/block/caldeirao_futuro.png` | textura 128×128 |

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

### Publicar o pack

```powershell
# 1. (re)gera o zip a partir de resourcepack/
powershell -ExecutionPolicy Bypass -File server-patch/tools/build-resourcepack.ps1

# 2. sobe o zip para a release "server-pack" (usa GH_TOKEN do .env)
node server-patch/tools/publish-resourcepack.mjs
```

O zip vai para
`https://github.com/vickyAqui/aurora-launcher/releases/download/server-pack/aurora_caldeirao.zip`.

A release é separada de propósito: o `publish-modpack.mjs` apaga todo asset da
release `modpack` que não esteja em `modpack/`, então o pack sumiria no próximo
publish do modpack.

### Configurar o servidor

No `server.properties` (backup em `server.properties.bak-20261112`):

```properties
resource-pack=https://github.com/vickyAqui/aurora-launcher/releases/download/server-pack/aurora_caldeirao.zip
resource-pack-sha1=953a01a7e7e8becb7cafde57396d896b8a9dd1fe
resource-pack-prompt={"text":"Aurora Studios: aceite o pacote de recursos para ver o Caldeirao Futuro.","color":"gold"}
require-resource-pack=true
```

Reinicie o servidor depois de editar (não use `/reload`). Sempre que o zip mudar,
rode o build de novo, publique e atualize `resource-pack-sha1`; com o SHA1 errado
o cliente recusa o pack e, como ele é obrigatório, ninguém consegue entrar.

Para desativar: apague as quatro linhas e reinicie.

### Validar em jogo

- Ao entrar, o cliente baixa o pack e o aceita sozinho (é obrigatório).
- Colocar uma brewing stand: deve aparecer o caldeirão.
- Item no inventário e na mão: bloco 3D.
- Colocar bules e abrir a GUI: a funcionalidade e os bules continuam normais.

## Arquivos

- `mods/meds_and_herbs-1.20.1-2.0.3.jar` — jar patchado para o servidor
- `tools/patch.jar` — patcher autocontido (Java 17+)
- `tools/Patch.java` — fonte do patcher
- `tools/patch.ps1` — atalho para Windows
- `resourcepack/` — conteúdo do resource pack (pack.mcmeta + assets)
- `aurora_caldeirao.zip` — resource pack pronto para o `resource-pack=`
- `tools/build-resourcepack.ps1` — gera o zip
- `tools/publish-resourcepack.mjs` — publica o zip na release `server-pack`
- `NOTICE.md` — atribuição e aviso de modificação
- `licenses/` — textos das licenças Apache-2.0 e AFL-3.0
- `CHECKSUMS.txt` — hashes para conferência
