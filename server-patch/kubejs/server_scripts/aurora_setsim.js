// Reduz a distancia de simulacao em runtime, em um script separado
// para nao depender do aurora_perf_apply.js.
var auroraSetSimTick = 0

ServerEvents.tick(event => {
    auroraSetSimTick++
    if (auroraSetSimTick !== 10) return
    try {
        event.server.runCommandSilent('betterchunkloading setsimdist 1')
        console.info('[aurora-setsim] executado: /betterchunkloading setsimdist 1')
    } catch (e) {
        console.warn('[aurora-setsim] falha: ' + e)
    }
})
