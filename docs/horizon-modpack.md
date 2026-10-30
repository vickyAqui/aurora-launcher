# Rodar o modpack da Aurora no Horizon — viabilidade e plano

Status: **avaliação**. Nada implementado.

Objetivo do usuário: fazer o modpack atual da Aurora rodar no **Horizon** (Minecraft Java 26.3 em
Rust). Launcher fica de fora por enquanto.

## Veredito

**Hoje isso não é possível.** Não é questão de configuração, versão de Java ou argumento de
launch: é uma incompatibilidade de arquitetura.

O Horizon não executa jars Java. Ele executa dois formatos próprios:

| Formato  | O que é                                                                             | Roda código Java? |
| -------- | ----------------------------------------------------------------------------------- | ----------------- |
| `.hmod`  | dados e assets (blocos, itens, receitas, loot, tags, modelos, texturas, estruturas) | não               |
| `.hnmod` | bundle Rust (`horizon-mixins`) que altera o código do próprio Horizon               | não (é Rust)      |

Jars Fabric/NeoForge/Forge **não rodam como estão**: o código deles chama e patcheia classes Java do
Minecraft, que o Horizon não tem. O próprio Horizon documenta isso em `docs/mods.md`.

## Evidências do nosso modpack

Inventário completo em [`docs/horizon-inventory.csv`](horizon-inventory.csv), gerado por
`python scripts/horizon-inventory.py` (30/10/2026):

| Métrica                                       | Valor                                |
| --------------------------------------------- | ------------------------------------ |
| Mods                                          | 301 (300 `.jar` + 1 `.jar.disabled`) |
| Tamanho total                                 | 1.408 MB                             |
| Classes Java                                  | **109.689** (mediana de 122 por mod) |
| Mods com mixins/refmap                        | **199**                              |
| Mods que adicionam blocos                     | 123                                  |
| Mods que adicionam entidades                  | 68                                   |
| Mods com worldgen                             | 60                                   |
| Mods com GUI própria                          | 104                                  |
| Mods com receitas                             | 139                                  |
| Mods **sem nenhum** asset de conteúdo         | 151 (libs, performance, ferramentas) |
| Mods **puramente** data/assets (zero classes) | **0**                                |

Ou seja: **nenhum mod do pack é "só dados"**. Todos os 301 têm código Java, e 199 dependem de mixins —
exatamente o mecanismo que o Horizon não possui.

## Resultado do inventário

Classificação heurística por tier (detalhes em [`horizon-inventory.md`](horizon-inventory.md)):

| Tier                                | Mods |
| ----------------------------------- | ---: |
| deep (entidades/worldgen)           |   73 |
| machines (GUI/block entities)       |   27 |
| logic (mixins/comportamento)        |   13 |
| data (só registries)                |   37 |
| library (API/base para outros mods) |   47 |
| client (GUI sem conteúdo)           |   19 |
| none (performance/ferramenta)       |   85 |

Licenças:

| Licença                            | Mods |
| ---------------------------------- | ---: |
| permissiva (MIT/Apache/BSD/CC0...) |  107 |
| copyleft (GPL/LGPL/MPL...)         |   67 |
| restritiva (NC/ND)                 |    8 |
| All Rights Reserved                |   79 |
| custom                             |   30 |
| desconhecida                       |   10 |

Cruzando as duas coisas: **27 mods** de conteúdo `data`/`logic` têm licença permissiva ou copyleft —
os candidatos baratos para uma prova de conceito. Entre eles: Macaw's Doors, Macaw's Trapdoors,
Night Lights, Chisel, Another Furniture e Construction Wand.

Mas "permissiva no `mods.toml`" não é o mesmo que "o autor liberou um port": vários projetos declaram
MIT no metadata e mantêm todos os direitos sobre assets (texturas, modelos, sons). Isso precisa ser
confirmado no repositório de cada um antes de publicar qualquer coisa.

> Achado colateral: o pack tem **duas versões do SignPlates** (`1.0.2` e `1.1.2`) na mesma pasta
> `mods/`. Isso é um problema do modpack atual, independente do Horizon: o Forge recusa mods
> duplicados. Vale corrigir na próxima publicação.

## O pipeline de port do Horizon

O Horizon tem um plano (`docs/modpacks.md`) para portar modpacks, mas ele é **design, não produto
entregue**. O fluxo é:

```
pack → inventário → classificação → ordem de dependência
     → carry-over de assets/data (mecânico)
     → port de cada mod para Rust (um agente por mod, com harness)
     → relatório de cobertura
```

No estudo do All the Mods 10 (495 jars), o próprio Horizon classificou:

- 287 mods de conteúdo;
- apenas **56** no tier "data" (carry-over mecânico);
- 55 "logic", 89 "machines", 87 "deep" — cada um exige código Rust;
- 91 no total no tier "deep" (entidades, IA, dimensões, renderers).

O nosso pack tem proporção parecida ou pior: 123 mods com blocos, 68 com entidades, 60 com worldgen,
104 com GUI. Traduzindo: a maior parte cairia em "logic", "machines" ou "deep".

## Bloqueio jurídico

Portar um mod é **obra derivada**. O Horizon é explícito: só se publica um port se a licença permitir
(permissiva, ou copyleft com o port na mesma licença e código publicado) ou se o autor der permissão
por escrito. No ATM10, **89 mods eram All Rights Reserved** e 14 não permitiam derivados.

Ter código no GitHub **não significa** que o mod seja open source: o repositório pode estar público só
para leitura, e o `mods.toml` é que declara a licença. No nosso pack:

- **79 mods** declaram `All Rights Reserved` — por exemplo Biomes O' Plenty, Iron's Spells 'n
  Spellbooks, Waystones, Regions Unexplored, Supplementaries, Born in Chaos, Rechiseled e Pipez.
- **8 mods** têm licença restritiva (NC/ND): Patchouli (CC BY-NC-SA 3.0), Jade (CC BY-NC-SA 4.0),
  WaterMedia e WaterVision (PolyForm Strict), Kaleidoscope Cookery/Tavern (BSD + CC BY-NC-SA),
  Genshin Instruments (CC BY-NC 4.0) e Cristel Lib (CC BY-NC-ND 4.0).
- **30 mods** usam licença custom (Botania, Supplementaries Team License, Terrarium License,
  Timefall Development License...) e **10** não declaram licença — os dois grupos exigem leitura
  manual.

Sem permissão dos autores, não dá para distribuir uma versão portada — mesmo que tecnicamente
funcionasse. Uma saída legal é o port **local**: cada jogador gera o port na própria máquina, a partir
do jar que já baixou, e nada é redistribuído. Isso resolve a distribuição, mas não o esforço de portar
79 mods ARR.

## O que é realisticamente possível

### Caminho A — "Aurora Horizon Edition" (recomendado)

Criar um pack **novo**, nativo do Horizon, com a identidade da Aurora:

- `.hmod` próprios: blocos, itens, receitas, loot, worldgen (data-driven, sem Rust).
- Resource pack da Aurora (texturas, UI, fontes).
- Data packs no formato 26.3.
- Alguns native mods em Rust para gameplay específico (experimental).
- Meta realista: **10–20 mods equivalentes**, não 301.

Isso é alcançável em semanas/meses e não depende de terceiros.

### Caminho B — Portar um subconjunto pequeno

Escolher 5–10 mods importantes e portar um a um para `.hmod`/`.hnmod`, só os que a licença permitir.
Esforço aproximado por tier:

| Tier     | Exemplos no nosso pack           | Esforço por mod |
| -------- | -------------------------------- | --------------- |
| data     | decoração, blocos simples        | dias            |
| logic    | interações, configs              | 1–2 semanas     |
| machines | Create, Tinkers                  | 3–6 semanas     |
| deep     | Alex's Mobs, dimensões, worldgen | 1–3 meses       |

Mesmo assim, o pack final seria um recorte, não o pack atual.

### Caminho C — Esperar

Esperar o pipeline de port do Horizon virar ferramenta usável e/ou o Horizon ganhar uma camada de
compatibilidade Java (não está no roadmap: eles portam, não emulam).

## Plano se formos pelo Caminho A/B

### Fase 0 — Inventário e licenças ✅ concluída

- [x] Extrair `mods.toml`/`fabric.mod.json` de cada jar: id, nome, versão, licença, dependências.
- [x] Classificar por tier (data/logic/machines/deep/client/library) usando assets + classes + mixins.
- [x] Marcar o que é biblioteca, performance ou ferramenta de cliente (não precisa port).
- [x] Separar o que tem licença permissiva do que é ARR/sem permissão.
- [x] Saída: [`docs/horizon-inventory.csv`](horizon-inventory.csv),
      [`docs/horizon-inventory.md`](horizon-inventory.md) e `scripts/horizon-inventory.py`.

O script pode ser rodado de novo a cada mudança no pack: `python scripts/horizon-inventory.py`.

### Fase 1 — Prova de conceito (1–2 semanas)

- [ ] Montar o ambiente do Horizon (build do repo ou release + `horizon-prepare`).
- [ ] Portar **1 mod data-tier** para `.hmod` e validar no jogo.
- [ ] Portar **1 mod logic-tier** como `.hnmod` mínimo e validar.
- [ ] Medir o custo real de cada um e recalibrar o plano.

### Fase 2 — Definição do pack (1 semana)

- [ ] Escolher o recorte: 10–20 mods, com licença ok.
- [ ] Definir o que vira conteúdo próprio da Aurora.
- [ ] Publicar num release `horizon` separado do `modpack` atual.

### Fase 3 — Produção (semanas/meses)

- [ ] Portar os mods escolhidos, um por um, com teste no jogo.
- [ ] Empacotar, versionar e documentar.
- [ ] Servidor Horizon separado, se fizer sentido.

## Critérios de sucesso

- **Curto prazo:** 1 mod data-tier e 1 logic-tier rodando no Horizon, com custo medido.
- **Médio prazo:** pack "Aurora Horizon Edition" com 10–20 mods, jogável do início ao fim.
- **Longo prazo:** recorte maior, só se o pipeline do Horizon amadurecer.

## Fora de escopo

- Rodar os 301 mods atuais no Horizon.
- Emular JVM/Forge dentro do Horizon.
- Distribuir ports sem permissão de licença.
- Reaproveitar o `modpack.json`/`eml-lib` atuais para o Horizon.

## Decisões pendentes

1. Caminho A (pack novo), B (portar subconjunto) ou C (esperar)?
2. Qual o recorte mínimo que já seria "sucesso" para você? Ex.: 5 mods? 20? Um mundo survival
   completo?
3. Podemos usar conteúdo próprio da Aurora (blocos/itens novos) ou precisa ser fiel aos mods atuais?
4. Quem vai escrever/validar o Rust dos native mods?
