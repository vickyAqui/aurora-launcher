// Diagnostico de MSPT usando apenas JavaScript nativo (sem classes Java bloqueadas).
// Loga a media a cada 600 ticks (30s) no latest.log. Nao altera o mundo.
var auroraDiagUltimo = 0
var auroraDiagSoma = 0
var auroraDiagCont = 0
var auroraDiagPior = 0

ServerEvents.tick(event => {
    var agora = Date.now()
    if (auroraDiagUltimo > 0) {
        var ms = agora - auroraDiagUltimo
        if (ms > 0 && ms < 60000) {
            auroraDiagSoma += ms
            auroraDiagCont++
            if (ms > auroraDiagPior) auroraDiagPior = ms
        }
    }
    auroraDiagUltimo = agora

    // 610 ticks (30,5 s) em vez de 600: evita alinhar com cleanup/locator/guard
    // no mesmo tick e concentrar varias linhas de log e trabalho em um so instante.
    if (event.server.tickCount % 610 !== 150 || auroraDiagCont === 0) return
    var media = auroraDiagSoma / auroraDiagCont
    var status = media <= 50 ? 'OK' : (media <= 100 ? 'ATENCAO' : 'LAG')
    console.info('[aurora-perf-diag] tick=' + event.server.tickCount +
        ' MSPT=' + media.toFixed(2) + ' pior=' + auroraDiagPior.toFixed(0) +
        ' amostras=' + auroraDiagCont + ' (' + status + ')')
    auroraDiagSoma = 0
    auroraDiagCont = 0
    auroraDiagPior = 0
})
