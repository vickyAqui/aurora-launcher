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

Validação: `npm run build` OK; `npx vitest run tests/performance.test.ts` → 23/23 testes OK.

## Não alterado / pendente

- **Reload do servidor**: o acesso remoto é SFTP-only (`Unable to exec`), então não foi possível rodar `/kubejs reload server_scripts`. Precisa ser feito no console do servidor, manualmente, quando o usuário decidir. Isso ativará o cleanup com limites 64/32, o pregen atualizado e o `/ajuda`.
- `aurora_runtime_configs.js` no servidor continua com `ingredientDedupe = true`; isso não afeta a config do cliente (que é local) e não foi mexido para não mudar comportamento do servidor sem reload.
- `AuroraMortis_Ex`: sem config de intervalo; não foi editado nenhum jar.
- `Noezis`: sem limpeza de POI/entidades; qualquer correção exigiria backup e janela de manutenção.
- Release `v1.2.9` permanece como está; nenhuma versão/tag/release foi criada.
- O PAT do GitHub colado no chat não foi salvo nem usado e ainda precisa ser revogado pelo usuário.
