// Correcoes de performance aplicadas no boot (sem restart).
// randomTickSpeed estava em 400 (padrao: 3) -> causava ~133x mais trabalho por tick.
var auroraPerfFixApplied = false

ServerEvents.tick((event) => {
    if (auroraPerfFixApplied) return
    auroraPerfFixApplied = true
    try {
        event.server.runCommandSilent('gamerule randomTickSpeed 3')
        console.info('[aurora-perf] randomTickSpeed=3 aplicado (era 400)')
    } catch (e) {
        console.warn('[aurora-perf] falha ao aplicar randomTickSpeed: ' + e)
    }
})
