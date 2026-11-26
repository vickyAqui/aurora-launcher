// Localiza os jogadores para definir o centro da pre-geracao (Chunky).
// Apenas leitura: loga coords no latest.log, nao altera nada no mundo.
var auroraLocTick = 0

ServerEvents.tick(event => {
    auroraLocTick++
    if (auroraLocTick !== 100 && auroraLocTick % 300 !== 0) return
    try {
        var players = event.server.getPlayers()
        for (var i = 0; i < players.length; i++) {
            var p = players[i]
            console.info('[aurora-loc] ' + p.getName().getString() +
                ' x=' + Math.round(p.getX()) +
                ' y=' + Math.round(p.getY()) +
                ' z=' + Math.round(p.getZ()))
        }
    } catch (e) {
        console.warn('[aurora-loc] falha: ' + e)
    }
})
