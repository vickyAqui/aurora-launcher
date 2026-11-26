// Aplica configuracoes de performance que aceitam reload, sem reiniciar.
// Cada comando roda em um tick separado para que um reload nao interrompa os demais.
var auroraPerfApplyTick = 0

var auroraPerfComandos = [
    'gamerule randomTickSpeed 3',
    'betterchunkloading setsimdist 1',
    'servercore reload'
]

ServerEvents.tick(event => {
    if (auroraPerfApplyTick >= auroraPerfComandos.length) return
    // Espera 2 ticks apos o carregamento do script.
    auroraPerfApplyTick++
    if (auroraPerfApplyTick < 3) return

    var cmd = auroraPerfComandos[auroraPerfApplyTick - 3]
    try {
        event.server.runCommandSilent(cmd)
        console.info('[aurora-perf-apply] executado: /' + cmd)
    } catch (e) {
        console.warn('[aurora-perf-apply] falha ao executar /' + cmd + ': ' + e)
    }
})
