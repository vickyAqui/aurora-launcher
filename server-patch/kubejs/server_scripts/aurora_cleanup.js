// Limpeza automatica de entidades que travam o tick.
// Antes rodava a cada 600 ticks (30s) e matava TODOS os falling_block de uma vez;
// os picos de 3,6 s no MSPT apareciam exatamente nesse tick.
// Agora roda a cada 900 ticks (45s) e remove no maximo 64/32 entidades por vez.
var auroraCleanTicks = 0
var AURORA_CLEAN_INTERVAL = 900

ServerEvents.tick(event => {
    auroraCleanTicks++
    if (auroraCleanTicks % AURORA_CLEAN_INTERVAL !== 0) return

    try {
        event.server.runCommandSilent('kill @e[type=minecraft:falling_block,limit=64,sort=arbitrary]')
    } catch (e) {
        console.warn('[aurora-cleanup] falha ao limpar falling_block: ' + e)
    }

    try {
        // O mod Untamed Wilds repovoa naturalmente; nao desativar o spawn.
        event.server.runCommandSilent('kill @e[type=untamedwilds:spadefish,limit=32,sort=arbitrary]')
    } catch (e) {
        console.warn('[aurora-cleanup] falha ao limitar spadefish: ' + e)
    }

    console.info('[aurora-cleanup] ciclo=' + (auroraCleanTicks / AURORA_CLEAN_INTERVAL) + ' concluido')
})
