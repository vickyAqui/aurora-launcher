# Inventário do modpack para o Horizon

Gerado por `python scripts/horizon-inventory.py`. Não editar à mão.

- Mods: **301**
- Tamanho: **1408.5 MB**
- Classes Java: **109.689**
- Com conteúdo (blocos/itens/entidades/worldgen): **150**
- Bibliotecas e ferramentas (sem conteúdo): **151**

## Por tier (heurística)

| tier                                | mods |
| ----------------------------------- | ---- |
| deep (entidades/worldgen)           | 73   |
| machines (GUI/block entities)       | 27   |
| logic (mixins/comportamento)        | 13   |
| data (só registries)                | 37   |
| library (API/base para outros mods) | 47   |
| client (GUI sem conteúdo)           | 19   |
| none (performance/ferramenta)       | 85   |

> O tier vem dos sinais do jar (assets, classes, mixins), não de uma análise do código.
> Serve para separar candidatos; o esforço real de port precisa ser medido mod a mod.

## Por licença

| licença                            | mods |
| ---------------------------------- | ---- |
| permissiva (MIT/Apache/BSD/CC0...) | 107  |
| copyleft (GPL/LGPL/MPL...)         | 67   |
| restritiva (NC/ND)                 | 8    |
| All Rights Reserved                | 79   |
| custom                             | 30   |
| desconhecida                       | 10   |

## Tier × licença

| tier     | permissiva | copyleft | restritiva | All | custom | desconhecida |
| -------- | ---------- | -------- | ---------- | --- | ------ | ------------ |
| deep     | 20         | 8        | 2          | 23  | 17     | 3            |
| machines | 12         | 9        | 1          | 3   | 1      | 1            |
| logic    | 5          | 2        | 0          | 2   | 4      | 0            |
| data     | 16         | 4        | 0          | 13  | 1      | 3            |
| library  | 16         | 15       | 2          | 12  | 2      | 0            |
| client   | 4          | 7        | 0          | 6   | 2      | 0            |
| none     | 34         | 22       | 3          | 20  | 3      | 3            |

## Candidatos para prova de conceito

Mods de conteúdo `data`/`logic` com licença permissiva ou copyleft (os mais baratos de portar):

| mod                       | tier  | licença    | classes | blocos | receitas | deps                                                                             |
| ------------------------- | ----- | ---------- | ------- | ------ | -------- | -------------------------------------------------------------------------------- |
| Heart Pouch               | logic | copyleft   | 15      | 0      | 5        | heartstone;raccooncore                                                           |
| Doomsday Functionality    | logic | permissive | 16      | 0      | 0        | doomsday_decoration                                                              |
| Oh The Trees You'll Grow  | logic | copyleft   | 36      | 0      | 0        |                                                                                  |
| Another Furniture         | logic | permissive | 85      | 179    | 480      | create                                                                           |
| Bloodmoon Update          | logic | permissive | 111     | 4      | 2        |                                                                                  |
| Dramatic Doors            | logic | permissive | 430     | 1960   | 60       | create;dawnoftimebuilder;framedblocks;mcwdoors;minestuck;morecraft;regions_unexp |
| Create Stuff 'N Additions | logic | permissive | 450     | 3      | 91       | create                                                                           |
| BotanyTrees               | data  | copyleft   | 3       | 0      | 655      | bookshelf;botanypots                                                             |
| Night Lights              | data  | copyleft   | 6       | 83     | 133      |                                                                                  |
| Macaw's Trapdoors         | data  | permissive | 7       | 180    | 385      |                                                                                  |
| Macaw's Doors             | data  | permissive | 15      | 247    | 271      |                                                                                  |
| Create: Bells & Whistles  | data  | copyleft   | 19      | 39     | 59       | create                                                                           |
| Display Delight           | data  | copyleft   | 40      | 347    | 3        | farmersdelight                                                                   |
| Construction Wand         | data  | permissive | 72      | 0      | 18       |                                                                                  |
| Create Confectionery      | data  | permissive | 147     | 28     | 115      |                                                                                  |
| MOA DECOR: ART            | data  | permissive | 305     | 151    | 152      |                                                                                  |
| MOA DECOR: SCIENCE        | data  | permissive | 305     | 151    | 162      |                                                                                  |
| MOA: ELECTRONICS          | data  | permissive | 313     | 156    | 173      |                                                                                  |
| MOA DECOR: LIGHTS         | data  | permissive | 315     | 156    | 157      |                                                                                  |
| MOA DECOR: TOYS           | data  | permissive | 329     | 163    | 164      |                                                                                  |
| MOA DECOR: HOLIDAYS       | data  | permissive | 347     | 151    | 157      |                                                                                  |
| MOA DECOR: GARDEN         | data  | permissive | 348     | 167    | 168      |                                                                                  |
| Chisel                    | data  | permissive | 362     | 328    | 376      |                                                                                  |
| MOA DECOR: BATH           | data  | permissive | 375     | 159    | 169      |                                                                                  |
| MOA DECOR: COOKERY        | data  | permissive | 554     | 162    | 166      |                                                                                  |
| Zcoper Karts              | data  | permissive | 925     | 22     | 20       | geckolib                                                                         |
| Abyssal Decor             | data  | permissive | 1858    | 869    | 637      |                                                                                  |

## Dependências mais comuns

| mod                    | quantos dependem |
| ---------------------- | ---------------- |
| geckolib               | 20               |
| architectury           | 18               |
| jei                    | 18               |
| create                 | 13               |
| curios                 | 6                |
| playeranimator         | 5                |
| cloth_config           | 4                |
| moonlight              | 4                |
| placebo                | 4                |
| irons_spellbooks       | 4                |
| terrablender           | 4                |
| kotlinforforge         | 4                |
| jade                   | 4                |
| embeddium              | 4                |
| supermartijn642corelib | 3                |
| raccooncore            | 3                |
| cupboard               | 3                |
| bookshelf              | 3                |
| creativecore           | 3                |
| fusion                 | 3                |

## Maiores por classes

| mod                           | classes | tier     | licença    |
| ----------------------------- | ------- | -------- | ---------- |
| Axiom                         | 5518    | client   | arr        |
| Fazcraft                      | 4458    | deep     | arr        |
| kotlinforforge-4.12.0-all.jar | 4314    | none     | unknown    |
| The Impossible Loader         | 3975    | none     | unknown    |
| The Deep Void                 | 3973    | deep     | permissive |
| Create                        | 2687    | deep     | permissive |
| Tinkers' Construct            | 2400    | deep     | permissive |
| Journeymap                    | 2382    | none     | arr        |
| WorldEdit                     | 2258    | none     | copyleft   |
| Abyssal Decor                 | 1858    | data     | permissive |
| WaterMedia YT Plugin          | 1780    | none     | copyleft   |
| Doomsday Decoration           | 1753    | data     | unknown    |
| Oculus                        | 1587    | client   | copyleft   |
| Born in Chaos                 | 1552    | deep     | arr        |
| Citadel                       | 1419    | library  | copyleft   |
| Botania                       | 1369    | deep     | custom     |
| Alex's Caves                  | 1303    | deep     | copyleft   |
| XaeroPlus                     | 1300    | none     | permissive |
| FramedBlocks                  | 1298    | machines | copyleft   |
| cataclysm                     | 1200    | deep     | custom     |
