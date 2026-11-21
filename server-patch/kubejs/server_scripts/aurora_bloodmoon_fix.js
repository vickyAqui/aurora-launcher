// Corrige a Bloodmoon Update 1.4.1 neste servidor.
// Deploy: /kubejs/server_scripts/aurora_bloodmoon_fix.js
//
// Causa raiz da duracao: o BloodmoonManagerProcedure roda em TODAS as dimensoes e
// encerra a bloodmoon 10 ticks depois se isNight() for falso em QUALQUER uma
// delas. Este servidor tem dimensoes customizadas com dayTime=48000 (dia), entao
// a bloodmoon apagava em ~0,5s. O overworld tambem precisa entrar na noite quando
// o comando manual e dado durante o dia, senao o manager encerra na mesma hora.
//
// Causa raiz da lua branca: o mod 1.4.1 tem o mixin LevelRendererColorMixin
// (que troca a textura da lua) compilado no jar, mas ESQUECEU de registrá-lo no
// bloodmoon.mixins.json. Como a troca e client-side, nao ha como consertar pelo
// servidor. O CustomSkyboxes, que esta no modpack, recebe comandos do servidor:
// usamos "customskyboxes set/clear ... moon" com a textura vermelha do proprio
// Bloodmoon. O comando fica salvo no servidor e e reenviado a quem entrar depois.
//
// Disparo espontaneo: o BloodmoonManagerProcedure sorteia bloodmoon_chance (padrao
// 5%) a cada noite. Mantemos esse valor em 0 para a bloodmoon so ocorrer quando
// alguem iniciar manualmente com /bloodmoon moon_event start.
//
// Fim prematuro: o manager agenda endBloodmoon() 10 ticks depois de ver
// bloodmoonActive=true e isNight()==false em QUALQUER dimensao. O startBloodmoon()
// do mod NAO muda o horario, entao um start manual durante o dia sempre agenda
// esse fim antes mesmo de ajustarmos as dimensoes. Como o agendamento nao e
// reavaliado, corrigimos o horario e reiniciamos a bloodmoon quando isso acontece.

var auroraBmApplied = false
var auroraBmPrevActive = false
var auroraBmSaved = {}
var auroraBmWarned = false
var auroraBmUtils = null
var auroraBmVarsClass = null
var auroraBmTick = 0
var auroraBmStartTick = -1
var auroraBmRestarts = 0
var auroraBmFxTriggered = false
var auroraBmMusicPlaying = false

var AURORA_BM_MOON_TEXTURE = 'bloodmoon:textures/entities/bloodmoon.png'

// Efeito + trilha disparados no inicio da bloodmoon. O stop da trilha e agendado
// 30 segundos depois (600 ticks) com fade de 2 segundos (40 ticks).
var AURORA_BM_EARTHQUAKE_CMD = 'effect give @a alexsmobs:earthquake 15 1 true'
var AURORA_BM_MUSIC_ID = 'bloodmoon_fury'
var AURORA_BM_MUSIC_URL = 'https://youtu.be/ECaneS01wCs?si=r1hKL7k1Eau3nN7i'
var AURORA_BM_MUSIC_FADE = 40
var AURORA_BM_MUSIC_STOP_AT = 600

function auroraBmNightTime(dayTime) {
    return Math.floor(dayTime / 24000) * 24000 + 13000
}

function auroraBmLoopLevels(event, callback) {
    var it = event.server.getAllLevels().iterator()
    while (it.hasNext()) {
        callback(it.next())
    }
}

function auroraBmServer(event) {
    return event.server
}

function auroraBmRunCommand(event, cmd) {
    try {
        var result = auroraBmServer(event).runCommand(cmd)
        console.info('[aurora-bloodmoon] cmd: ' + cmd + ' -> ' + result)
    } catch (e) {
        console.warn('[aurora-bloodmoon] falha no comando "' + cmd + '": ' + e)
    }
}

function auroraBmStopMusic(event) {
    if (!auroraBmMusicPlaying) {
        return
    }
    auroraBmMusicPlaying = false
    auroraBmRunCommand(event, 'sotpl stop @a ' + AURORA_BM_MUSIC_ID + ' ' + AURORA_BM_MUSIC_FADE)
}

function auroraBmMoonCommand(event, action) {
    var cmd = 'customskyboxes ' + action + ' @a moon'
    if (action === 'set') {
        cmd += ' ' + AURORA_BM_MOON_TEXTURE
    }
    try {
        var result = auroraBmServer(event).runCommand(cmd)
        console.info('[aurora-bloodmoon] lua: ' + cmd + ' -> ' + result)
    } catch (e) {
        console.warn('[aurora-bloodmoon] falha ao enviar comando da lua: ' + e)
    }
}

ServerEvents.tick((event) => {
    var world, vars
    try {
        if (auroraBmUtils == null) {
            auroraBmUtils = Java.loadClass('net.foufakirby.bloodmoon.util.common.BloodmoonUtils')
            auroraBmVarsClass = Java.loadClass('net.foufakirby.bloodmoon.network.BloodmoonModVariables$MapVariables')
        }
        world = event.server.getOverworld()
        vars = auroraBmVarsClass.get(world)
    } catch (e) {
        if (!auroraBmWarned) {
            console.warn('[aurora-bloodmoon] falha ao acessar classes: ' + e)
            auroraBmWarned = true
        }
        return
    }

    if (!auroraBmApplied) {
        if (vars.longNightEnabled) {
            vars.longNightEnabled = false
            vars.syncData(world)
            console.info('[aurora-bloodmoon] long_night desativado')
        }
        auroraBmPrevActive = vars.bloodmoonActive
        // Se o servidor iniciou/recarregou com a bloodmoon ja ativa, garante a lua.
        if (auroraBmPrevActive) {
            auroraBmMoonCommand(event, 'set')
        }
        auroraBmApplied = true
    }

    var ativo = vars.bloodmoonActive

    // O manager do mod sortea uma bloodmoon automaticamente usando bloodmoon_chance
    // (padrao 5% a cada noite). Zerar aqui impede o disparo espontaneo sem afetar
    // o comando manual /bloodmoon moon_event start.
    if (vars.bloodmoon_chance !== 0) {
        var chanceAntiga = vars.bloodmoon_chance
        vars.bloodmoon_chance = 0
        vars.syncData(world)
        console.info('[aurora-bloodmoon] chance automatica ' + chanceAntiga + ' -> 0 (desativada)')
    }

    if (ativo && !auroraBmPrevActive) {
        auroraBmStartTick = auroraBmTick
        auroraBmRestarts = 0
        console.info('[aurora-bloodmoon] iniciou: ajustando dimensoes e lua vermelha')
        auroraBmMoonCommand(event, 'set')
        auroraBmSaved = {}
        auroraBmLoopLevels(event, (level) => {
            var key = String(level)
            if (!auroraBmUtils.isNight(level)) {
                var original = level.getDayTime()
                auroraBmSaved[key] = original
                var novo = auroraBmNightTime(original)
                level.setDayTime(novo)
                console.info('[aurora-bloodmoon]   ' + key + ': ' + original + ' -> ' + novo)
            }
        })
        if (!auroraBmFxTriggered) {
            auroraBmFxTriggered = true
            auroraBmRunCommand(event, AURORA_BM_EARTHQUAKE_CMD)
            auroraBmRunCommand(event, 'sotpl play @a ' + AURORA_BM_MUSIC_ID + ' url ' + AURORA_BM_MUSIC_URL + ' 100 20 ' + AURORA_BM_MUSIC_FADE + ' true false 1.0 MUSIC')
            auroraBmMusicPlaying = true
            console.info('[aurora-bloodmoon] terremoto + trilha disparados; fade agendado para 30s')
        }
    }

    if (ativo) {
        auroraBmLoopLevels(event, (level) => {
            if (!auroraBmUtils.isNight(level)) {
                level.setDayTime(auroraBmNightTime(level.getDayTime()))
            }
        })
        if (auroraBmMusicPlaying && auroraBmStartTick >= 0 && auroraBmTick - auroraBmStartTick >= AURORA_BM_MUSIC_STOP_AT) {
            console.info('[aurora-bloodmoon] 30s atingidos: fade-out da trilha')
            auroraBmStopMusic(event)
        }
    }

    if (!ativo && auroraBmPrevActive) {
        var duracao = auroraBmTick - auroraBmStartTick
        if (duracao >= 0 && duracao <= 300 && auroraBmRestarts < 3) {
            // Fim agendado pelo manager antes de ajustarmos o horario. O end ja
            // rodou (mensagem "The strange moon is fading"), entao garantimos que
            // todas as dimensoes estao de noite ANTES de religar o evento, senao
            // o manager agenda outro fim 10 ticks depois.
            auroraBmLoopLevels(event, (level) => {
                if (!auroraBmUtils.isNight(level)) {
                    level.setDayTime(auroraBmNightTime(level.getDayTime()))
                }
            })
            auroraBmUtils.startBloodmoon(world)
            ativo = vars.bloodmoonActive
            auroraBmRestarts++
            auroraBmStartTick = auroraBmTick
            console.info('[aurora-bloodmoon] fim espurio do manager (' + duracao + ' ticks) corrigido: bloodmoon reiniciada')
        } else {
            auroraBmMoonCommand(event, 'clear')
            var count = 0
            for (var key in auroraBmSaved) {
                if (auroraBmSaved.hasOwnProperty(key)) {
                    count++
                }
            }
            if (count > 0) {
                auroraBmLoopLevels(event, (level) => {
                    var k = String(level)
                    if (auroraBmSaved.hasOwnProperty(k)) {
                        level.setDayTime(auroraBmSaved[k])
                    }
                })
                console.info('[aurora-bloodmoon] encerrou: horario de ' + count + ' dimensoes restaurado')
            }
            auroraBmStopMusic(event)
            auroraBmFxTriggered = false
            auroraBmSaved = {}
            auroraBmStartTick = -1
            auroraBmRestarts = 0
        }
    }

    auroraBmTick++
    auroraBmPrevActive = ativo
})

// Chama o mod direto, sem passar pelo comando /bloodmoon. Util quando o jar
// precisa ser trocado sem restart: o classloader pode perder as classes dos
// procedures dos comandos, mas BloodmoonUtils ja carregada continua funcionando.
ServerEvents.command(event => {
    var auroraPartes
    var auroraAcao
    var auroraSource

    try {
        // var de proposito: o Rhino reclama de redeclaration no mesmo escopo.
        var auroraInput = String(event.input || '').replace(/^\/+/, '').trim()
        auroraPartes = auroraInput.split(/\s+/)
        if (auroraPartes[0].toLowerCase() !== 'aurorabm') return

        auroraAcao = auroraPartes.length > 1 ? auroraPartes[1].toLowerCase() : ''
        if (auroraAcao !== 'start' && auroraAcao !== 'end') return

        auroraSource = event.parseResults.context.source
        if (!auroraSource.hasPermission(2)) return

        if (auroraBmUtils == null) {
            auroraBmUtils = Java.loadClass('net.foufakirby.bloodmoon.util.common.BloodmoonUtils')
        }
        var mundo = event.server.getOverworld()
        if (auroraAcao === 'start') {
            auroraBmUtils.startBloodmoon(mundo)
            console.info('[aurora-bloodmoon] iniciada via /aurorabm')
        } else {
            auroraBmUtils.endBloodmoon(mundo)
            console.info('[aurora-bloodmoon] encerrada via /aurorabm')
        }
    } catch (auroraErr) {
        console.error('[aurora-bloodmoon] ERRO no comando: ' + auroraErr)
        return
    }

    // Fora do try: cancel() lanca uma excecao interna de controle do KubeJS.
    return event.cancel()
})
