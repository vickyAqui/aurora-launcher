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

var auroraBmApplied = false
var auroraBmPrevActive = false
var auroraBmSaved = {}
var auroraBmWarned = false
var auroraBmUtils = null
var auroraBmVarsClass = null

var AURORA_BM_MOON_TEXTURE = 'bloodmoon:textures/entities/bloodmoon.png'

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

    if (ativo && !auroraBmPrevActive) {
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
    }

    if (ativo) {
        auroraBmLoopLevels(event, (level) => {
            if (!auroraBmUtils.isNight(level)) {
                level.setDayTime(auroraBmNightTime(level.getDayTime()))
            }
        })
    }

    if (!ativo && auroraBmPrevActive) {
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
        auroraBmSaved = {}
    }

    auroraBmPrevActive = ativo
})
