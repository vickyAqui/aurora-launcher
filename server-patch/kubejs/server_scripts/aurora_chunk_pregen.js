// Pre-geracao continua e adaptativa com Chunky.
// - Mantem UM centro por vez: nao cancela o Chunky porque o jogador andou 4 chunks.
// - Troca de alvo apenas a cada 3 min, e so se o alvo saiu mais de 128 blocos.
// - Pausa com histerese quando o intervalo entre ticks passa de 52 ms (~19 TPS).
// - Nao apaga nada: apenas gera chunks no disco.
var pregenTick = 0
var pregenLast = 0
var pregenSum = 0
var pregenCnt = 0
var pregenMspt = 50
var pregenPaused = false
var pregenLastChange = 0
var pregenLastCenter = -99999
var pregenCx = 0
var pregenCz = 0
var pregenCycles = 0
var pregenIndex = 0

var PREGEN_RAIO = 256
var PREGEN_CICLO = 3600        // 3 min entre trocas de jogador
var PREGEN_MIN_MOVIMENTO = 128 // 8 chunks: ignora deslocamentos curtos
var PREGEN_MIN_RECADASTRO = 3600
var PREGEN_PAUSA = 52
var PREGEN_RETOMA = 50.5

function pregenEhOverworld(jogador) {
    try {
        return jogador.level.dimension().location().toString() === 'minecraft:overworld'
    } catch (e) {
        return false
    }
}

function pregenIndiceOverworld(jogadores) {
    for (var i = 0; i < jogadores.length; i++) {
        if (pregenEhOverworld(jogadores[i])) return i
    }
    return 0
}

function pregenProximoIndice(jogadores, atual) {
    for (var k = 1; k <= jogadores.length; k++) {
        var i = (atual + k) % jogadores.length
        if (pregenEhOverworld(jogadores[i])) return i
    }
    return atual
}

function pregenIniciar(event, jogador, motivo) {
    var cx = Math.round(jogador.getX())
    var cz = Math.round(jogador.getZ())
    if (cx === pregenCx && cz === pregenCz && pregenCycles > 0) return

    pregenLastCenter = pregenTick
    pregenCx = cx
    pregenCz = cz
    pregenCycles++

    event.server.runCommandSilent('chunky cancel')
    event.server.runCommandSilent('chunky world minecraft:overworld')
    event.server.runCommandSilent('chunky center ' + cx + ' ' + cz)
    event.server.runCommandSilent('chunky radius ' + PREGEN_RAIO)
    event.server.runCommandSilent('chunky shape circle')
    event.server.runCommandSilent('chunky start')

    console.info('[aurora-pregen] ciclo=' + pregenCycles +
        ' motivo=' + motivo +
        ' centro=' + cx + ',' + cz +
        ' raio=' + PREGEN_RAIO +
        ' MSPT=' + pregenMspt.toFixed(1))
}

ServerEvents.tick(event => {
    pregenTick++

    var agora = Date.now()
    if (pregenLast > 0) {
        var delta = agora - pregenLast
        if (delta > 0 && delta < 30000) {
            pregenSum += delta
            pregenCnt++
        }
    }
    pregenLast = agora
    if (pregenCnt >= 100) {
        pregenMspt = pregenSum / pregenCnt
        pregenSum = 0
        pregenCnt = 0
    }

    if (pregenTick === 10) {
        try { event.server.runCommandSilent('chunky silent') } catch (e) {}
    }

    if (pregenTick % 100 !== 0) return

    try {
        var jogadores = event.server.getPlayers()

        if (jogadores.length === 0) {
            if (!pregenPaused) {
                event.server.runCommandSilent('chunky pause')
                pregenPaused = true
                pregenLastChange = pregenTick
                console.info('[aurora-pregen] pausado: nenhum jogador online')
            }
            return
        }

        // Freio por carga com histerese e intervalo minimo entre mudancas.
        // Como o tick saudavel dura ~50 ms, o limite antigo (60) so disparava
        // depois de o servidor ja estar abaixo de 17 TPS.
        if (pregenTick - pregenLastChange > 300) {
            if (!pregenPaused && pregenMspt > PREGEN_PAUSA) {
                event.server.runCommandSilent('chunky pause')
                pregenPaused = true
                pregenLastChange = pregenTick
                console.info('[aurora-pregen] pausado por carga: MSPT=' + pregenMspt.toFixed(1))
                return
            }
            if (pregenPaused && pregenMspt < PREGEN_RETOMA) {
                event.server.runCommandSilent('chunky continue')
                pregenPaused = false
                pregenLastChange = pregenTick
                console.info('[aurora-pregen] retomado: MSPT=' + pregenMspt.toFixed(1))
            }
        }

        if (pregenPaused) return

        var trocaJogador = pregenTick - pregenLastCenter >= PREGEN_CICLO
        if (trocaJogador) {
            // Primeiro ciclo escolhe quem ja esta no overworld; depois alterna.
            if (pregenCycles === 0) pregenIndex = pregenIndiceOverworld(jogadores)
            else pregenIndex = pregenProximoIndice(jogadores, pregenIndex)
        }

        var alvo = jogadores[pregenIndex]
        if (!alvo) alvo = jogadores[0]

        var dx = alvo.getX() - pregenCx
        var dz = alvo.getZ() - pregenCz
        var longe = Math.sqrt(dx * dx + dz * dz) > PREGEN_MIN_MOVIMENTO
        var podeRecentralizar = pregenTick - pregenLastCenter >= PREGEN_MIN_RECADASTRO

        if ((trocaJogador || longe) && podeRecentralizar) {
            pregenIniciar(event, alvo, trocaJogador ? 'ciclo' : 'movimento')
        }
    } catch (e) {
        console.warn('[aurora-pregen] falha: ' + e)
    }
})
