# Devlog — estabilidade Aurora (26/11/2026)

Registro isolado das mudanças e do diagnóstico. **Sem restart do servidor, sem reload executado por agente, sem bump de versão, tag ou release.** Nenhum arquivo de mundo foi alterado.

## Diagnóstico (somente leitura)

### Servidor

- 697 `Can't keep up!` em 24–26/11, cadência estável de ~303 s (~12/h) nos 4 arquivos de log. Hipótese mais forte: autosave vanilla (6000 ticks) com MSPT base já em ~50,7 ms.
- `AuroraMortis_Ex` roda `Cleaning expired/used Starlium Token IDs` a cada 12000 ticks (10 min). O intervalo é `CLEANUP_INTERVAL = 12000l`, **hardcoded no jar** — não há config para ajustar. 99/99 limpezas em `latest.log` coincidem com um warning.
- Geração Chunky regrediu em 26/11: 7 tarefas não-instantâneas, 489 s acumulados, máx. 122 s. `bettercaves: CREATING AND INIT'ING MASTER CONTROLLER` aparece antes dos picos de 11,4 s e 24,5 s.
- Picos graves de estado/entidades (não geração): 12:51 → 24,5 s; 12:56 → 159,3 s. Em `Noezis`, com 2 jogadores online: 95 `POI data mismatch`, 67 `UUID of added entity already exists` (principalmente `Spadefish`), 41 referências de `ServerPlayer` e 4909 `LevelChunk`. Não há correção segura sem mexer no mundo; não foi feito nada.
- Bloodmoon (`BreakDoorGoal` / listener `MobBlockBreakerProcedure`) e `/sotpl` estão resolvidos: 0 ocorrências novas.
- KubeJS carregou 25/25 scripts em 25/11 09:30 sem erros. Hoje há 26 arquivos em disco; o servidor não foi recarregado desde então. Portanto as versões novas de `aurora_cleanup.js`, `aurora_chunk_pregen.js` e `aurora_ajuda.js` **ainda não estão ativas em memória**.

### Cliente

- 1066 `ATLUnsupportedOperation` em 12:33:20–22, todos de `Hexerei` woodcutting via JEI, causados por `ingredientDedupe: true`.
- `Registering recipes took 20.01 s`, plugin `irons_spellbooks` 7,48 s, aviso de 90% de memória às 12:43:14.
- Voice chat reconecta a cada ~35–45 s (`Connection timeout`), e há 486 `Failed to load texture: minecraft:dynamic/cpm_*` + 248 `Exception loading blockstate`. Ruído, não causa dos picos longos.

## Mudanças aplicadas (isoladas)

1. `src/performancePresets.ts`: `ingredientDedupe` passou de `true` para `false` nos três perfis (`eco`, `balanced`, `quality`). `resourceLocationDedupe` continua `true`.
2. `server-patch/kubejs/server_scripts/`: versionados os 16 scripts que existiam apenas no remoto, para paridade com o servidor:
   - `aurora_bloodmoon_event_unreg.js`, `aurora_bloodmoon_guard.js`
   - `aurora_cfg_probe.js`, `aurora_cfg_verify.js`, `aurora_ev_probe.js`, `aurora_glob_probe.js`, `aurora_int_probe.js`, `aurora_config_probe.js` (probes pequenos)
   - `aurora_chunk_boost.js` (desativado), `aurora_chunk_guard.js`, `aurora_chunk_locator.js`
   - `aurora_perf_apply.js`, `aurora_perf_diag.js`, `aurora_perf_fix.js`, `aurora_setsim.js`
   - `example.js`
3. `server-patch/kubejs/config/common.properties`: versionado do remoto (329 B) — faltava no repo.
4. `aurora_crawler_nest_damage.js`: normalizado para LF; o conteúdo já era idêntico ao remoto, só os fins de linha diferiam.
5. `server-patch/kubejs/server_scripts/aurora_runtime_configs.js`: `ingredientDedupe` também passou de `true` para `false` no servidor, para manter os dois lados alinhados. **Ainda sem efeito em runtime**, porque o KubeJS não foi recarregado.

6. Otimizações adicionais nos scripts de tick (todas **somente em disco**, sem efeito até reload manual):
   - `aurora_chunk_pregen.js`: raio de 256 → **160** blocos. A área cai para ~1/3 (de ~1089 para ~400 chunks por ciclo), mantendo o pregen contínuo.
   - `aurora_perf_diag.js`: janela de 600 → **610 ticks**, com offset 150.
   - `aurora_chunk_guard.js`: janela de 600 → **617 ticks** (intervalo primo).
   - `aurora_chunk_locator.js`: log de 300 → **600 ticks**, offset 150. O pregen já lê os jogadores diretamente, então esse log é só diagnóstico.
   - Objetivo: quebrar o alinhamento que fazia cleanup + diag + locator + guard rodarem no mesmo tick e despejarem ~2000 linhas no mesmo instante.
7. `src/performancePresets.ts`: tabela de `suggestMemoryGB()` alinhada ao `recommendedMemory` do `memorysettings.json` do pack (2/3/4/5/7/8/9/10 GB), mantendo o limite de metade da RAM física. É apenas uma **recomendação**; a escolha do jogador continua prevalecendo. Testes atualizados.
8. `server-patch/user_jvm_args.txt`: preparado com `-Xlog:gc*:file=./logs/gc.log...` para medir pausas de GC. **Preparado no repo, não enviado ao servidor**; só vale após restart.
9. `server-patch/config/alltheleaks.json`: preparado com `logIntervalInMinutes=30` (era 10) e `ingredientDedupe=false`. Também **preparado no repo, não enviado**; o mod lê a config no boot.

10. Otimizações em caminhos quentes de scripts (também **somente em disco**, sem efeito até reload):
   - `aurora_bloodmoon_guard.js` e `aurora_born_in_chaos_spawns.js`: `ForgeRegistries` é carregado uma vez e reaproveitado no `checkSpawn`, em vez de `Java.loadClass` a cada spawn natural.
   - `aurora_mortis_fronteira.js`: polling de bioma de 5 → **10 ticks** (o debounce continua em 40 ticks, então a detecção não perde travessias).
   - `aurora_mortis_fronteira.js`, `aurora_mortis_biomes.js` e `aurora_ajuda.js`: cache de **30 s** do `aurora_ops.json`. Antes cada aviso podia fazer até 8 tentativas de leitura (2 paths × 2 variantes × 2 formas de caminho) para os 76 operadores.

11. Partícula do Totem of Possession: o efeito grande **não** era o `DustParticleOptions` já interceptado pelo mixin, e sim `alexscaves:totem_explosion` (disparado por `TotemExplosion`), que ainda usava os 16 sprites de explosão da vanilla. Adicionado override em `modpack/kubejs/assets/alexscaves/particles/totem_explosion.json` (16 frames apontando para `aurora_vicky:totem_viola`), com cópia idêntica em `server-patch/resourcepack/assets/alexscaves/` para entrar no jar numa próxima build. O cliente aplica com **F3+T** (reload de recursos), sem restart do servidor e sem novo jar.

12. Gerador de emojis do Discord: `scripts/generate-discord-emojis.mjs` consulta `GET /guilds/1460012886511587412/emojis` com token de bot lido de `DISCORD_BOT_TOKEN` ou `DISCORD_TOKEN_FILE` (nunca do chat/repo) e escreve um datapack Emojiful em `server-patch/datapacks/aurora_discord/`. Cada emoji vira uma receita `emojiful:emoji_recipe` com URL direta do CDN (`.png` ou `.gif`); `pack.mcmeta` usa `pack_format: 15`. Há modo de teste por `DISCORD_EMOJI_FIXTURE`, sem rede e sem token. Documentação em `server-patch/datapacks/README.md`. Datapack real já gerado com 159 receitas (92 `.png`, 67 `.gif`) a partir dos 161 emojis do servidor; 2 foram ignorados por nome duplicado/inválido. **Não foi enviado ao servidor** — upload/restart continuam manuais.

Validação: `npm run build` OK; `npx vitest run tests/performance.test.ts` → 23/23 testes OK; `node --check` passou nos **26** scripts KubeJS e no gerador; ambos os JSON do tótem validados com `JSON.parse`; gerador validado com fixture (receitas escritas, duplicados/indisponíveis ignorados e limpeza de arquivos obsoletos).

## Não alterado / pendente

- **Reload do servidor**: o acesso remoto é SFTP-only (`Unable to exec`), então não foi possível rodar `/kubejs reload server_scripts`. Precisa ser feito no console do servidor, manualmente, quando o usuário decidir. Isso ativará o cleanup com limites 64/32, o pregen atualizado e o `/ajuda`.
- A mudança de `ingredientDedupe` em `aurora_runtime_configs.js` só passa a valer quando o KubeJS for recarregado manualmente. Até lá, o servidor segue executando a versão antiga em memória.
- `AuroraMortis_Ex`: sem config de intervalo; não foi editado nenhum jar.
- `Noezis`: sem limpeza de POI/entidades; qualquer correção exigiria backup e janela de manutenção.
- `server-patch/user_jvm_args.txt` e `server-patch/config/alltheleaks.json` são apenas **preparações locais**: não foram enviados ao servidor e não têm efeito em runtime sem restart.
- `config/betterchunkloading.json` e `config/smoothchunk.json` já estão com valores conservadores (`predictionarea=3`, `predictionLoadingSpeed=0.5`, `chunkUnloadLimit=20`, `disableProtoSave=true`); não há ganho óbvio sem medir.
- `Noezis`: limpeza de POIs/entidades duplicadas exige backup e janela de manutenção; não foi feita.
- Starlium a cada 10 min é `CLEANUP_INTERVAL = 12000l` hardcoded no jar; sem editar o mod não há config para ajustar.
- Release `v1.2.9` permanece como está; nenhuma versão/tag/release foi criada.
- O PAT do GitHub colado no chat não foi salvo nem usado e ainda precisa ser revogado pelo usuário.
