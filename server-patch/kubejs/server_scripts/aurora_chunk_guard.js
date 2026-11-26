// Reforca a reducao da simulacao em runtime a cada 600 ticks (30s).
// Mantem a view distance em 12 (visao do jogador) e reduz so a simulacao.
// o carregamento de chunks leve mesmo apos trocas de dimensao/teleportes.
var auroraGuardTicks = 0

ServerEvents.tick(event => {
    auroraGuardTicks++
    if (auroraGuardTicks % 600 !== 0) return
    try {
        event.server.runCommandSilent('betterchunkloading setsimdist 1')
        console.info('[aurora-chunk-guard] simdist=1 reforcado (viewdist=12)')
    } catch (e) {
        console.warn('[aurora-chunk-guard] falha: ' + e)
    }
})
