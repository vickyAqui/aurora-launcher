// /ajuda {motivo} — pedido de ajuda dos jogadores para os operadores online.
//
// Quem usa o comando recebe só uma confirmação privada. A mensagem com o
// motivo vai para os operadores online (tellraw um a um, por nome), sem som e
// sem título. Os destinatários vêm de kubejs/config/aurora_ops.json (o mesmo
// arquivo dos avisos do Aurora Mortis), complementados por isOp() e pela lista
// de operadores do servidor.
//
// Cooldown de 30 s por jogador, guardado no persistentData dele (sobrevive a
// /kubejs reload server_scripts e a restart do servidor).
//
// Instalação: copie este arquivo para <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
// O registro normal (para /help e autocomplete) aparece após restart.
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraAjuda`.

const AURORA_AJUDA_COOLDOWN_TICKS = 600       // 30 s (20 ticks/s)
const AURORA_AJUDA_NBT_LAST = 'aurora_ajuda_ultimo_pedido'
const AURORA_AJUDA_MAX_MOTIVO = 160
const AURORA_AJUDA_OPS_CONFIG_PATHS = [
    'kubejs/config/aurora_ops.json',
    'config/aurora_ops.json'
]

/** Texto digitado depois de /ajuda, sem códigos de cor e sem quebras de linha. */
function auroraAjudaLimparMotivo(auroraTextoArg) {
    return String(auroraTextoArg || '')
        .replace(/[§&][0-9a-fk-or]/gi, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, AURORA_AJUDA_MAX_MOTIVO)
}

/** Lista normalizada de nomes/UUIDs dos administradores, em minúsculas. */
function auroraAjudaCarregarStaff() {
    var auroraStaff = {}
    var auroraCfg = null
    var auroraErro = ''

    for (var auroraI = 0; auroraI < AURORA_AJUDA_OPS_CONFIG_PATHS.length; auroraI++) {
        var auroraPath = AURORA_AJUDA_OPS_CONFIG_PATHS[auroraI]
        var auroraTentativas = [auroraPath, './' + auroraPath]
        for (var auroraJ = 0; auroraJ < auroraTentativas.length; auroraJ++) {
            try {
                auroraCfg = JsonIO.read(auroraTentativas[auroraJ])
                if (auroraCfg) break
            } catch (auroraLeErro) {
                auroraErro = String(auroraLeErro)
            }
        }
        if (auroraCfg) break
    }

    if (!auroraCfg && auroraErro) {
        console.warn('[aurora-ajuda] nao li aurora_ops.json (' + auroraErro + '); usando isOp()/ops.json')
    }

    var auroraOperators = null
    try {
        auroraOperators = auroraCfg.operators || auroraCfg.get('operators')
    } catch (auroraCfgErro) {
        auroraOperators = null
    }
    if (!auroraOperators) return auroraStaff

    var auroraLen = 0
    try {
        auroraLen = auroraOperators.length
    } catch (auroraLenErro) {
        auroraLen = 0
    }
    if (!auroraLen && typeof auroraOperators.size === 'function') auroraLen = auroraOperators.size()

    for (var auroraK = 0; auroraK < auroraLen; auroraK++) {
        var auroraItem = auroraOperators[auroraK]
        if (auroraItem === undefined || auroraItem === null) {
            if (typeof auroraOperators.get === 'function') auroraItem = auroraOperators.get(auroraK)
        }
        if (typeof auroraItem === 'string') {
            auroraStaff[auroraItem.toLowerCase()] = true
            continue
        }
        if (!auroraItem) continue
        try {
            if (auroraItem.name) auroraStaff[String(auroraItem.name).toLowerCase()] = true
        } catch (auroraNameErro) {
            // item sem nome
        }
        try {
            if (auroraItem.uuid) auroraStaff[String(auroraItem.uuid).toLowerCase()] = true
        } catch (auroraUuidErro) {
            // item sem uuid
        }
    }
    return auroraStaff
}

/** Nomes/UUIDs do ops.json do servidor, quando disponíveis. */
function auroraAjudaOpsDoServidor(auroraServerArg) {
    var auroraOps = {}
    try {
        var auroraLista = auroraServerArg.getPlayerList().getOps().getUserList()
        var auroraLen = auroraLista.size ? auroraLista.size() : auroraLista.length
        for (var auroraI = 0; auroraI < auroraLen; auroraI++) {
            var auroraPerfil = auroraLista.get ? auroraLista.get(auroraI) : auroraLista[auroraI]
            try {
                if (auroraPerfil.getName()) auroraOps[String(auroraPerfil.getName()).toLowerCase()] = true
            } catch (auroraNomeErro) {
                // sem nome
            }
            try {
                if (auroraPerfil.getId()) auroraOps[String(auroraPerfil.getId()).toLowerCase()] = true
            } catch (auroraIdErro) {
                // sem uuid
            }
            if (typeof auroraPerfil === 'string') auroraOps[auroraPerfil.toLowerCase()] = true
        }
    } catch (auroraOpsErro) {
        // ops.json indisponível: aurora_ops.json e isOp() continuam valendo
    }
    return auroraOps
}

function auroraAjudaEhStaff(auroraPlayerArg, auroraStaffArg, auroraOpsArg) {
    var auroraNome = ''
    var auroraUuid = ''
    try {
        auroraNome = String(auroraPlayerArg.profile.name).toLowerCase()
    } catch (auroraNomeErro) {
        return false
    }
    try {
        auroraUuid = String(auroraPlayerArg.profile.id).toLowerCase()
    } catch (auroraUuidErro) {
        auroraUuid = ''
    }
    if (auroraStaffArg[auroraNome] || (auroraUuid && auroraStaffArg[auroraUuid])) return true
    if (auroraOpsArg[auroraNome] || (auroraUuid && auroraOpsArg[auroraUuid])) return true
    try {
        return auroraPlayerArg.isOp() === true
    } catch (auroraIsOpErro) {
        return false
    }
}

/** Envia o aviso para cada operador online e devolve os nomes que receberam. */
function auroraAjudaAvisarOps(auroraServerArg, auroraJsonArg, auroraSimplesArg) {
    var auroraStaff = auroraAjudaCarregarStaff()
    var auroraOps = auroraAjudaOpsDoServidor(auroraServerArg)
    var auroraEnviados = []
    var auroraJogadores = auroraServerArg.players

    for (var auroraI = 0; auroraI < auroraJogadores.size(); auroraI++) {
        var auroraDestino = auroraJogadores.get(auroraI)
        if (!auroraAjudaEhStaff(auroraDestino, auroraStaff, auroraOps)) continue

        var auroraOk = false
        try {
            auroraOk = auroraServerArg.runCommandSilent(
                'tellraw ' + auroraDestino.profile.name + ' ' + auroraJsonArg
            ) > 0
        } catch (auroraTellErro) {
            auroraOk = false
        }
        if (!auroraOk) {
            try {
                auroraDestino.tell(auroraSimplesArg)
            } catch (auroraTellFallbackErro) {
                // sem caminho alternativo
            }
        }
        auroraEnviados.push(String(auroraDestino.profile.name))
    }

    if (auroraEnviados.length === 0) {
        try {
            auroraServerArg.runCommandSilent('tellraw @a[level=2..] ' + auroraJsonArg)
        } catch (auroraSeletorErro) {
            // nenhum operador online
        }
    }
    return auroraEnviados
}

function auroraAjudaJson(auroraNomeArg, auroraMotivoArg) {
    return JSON.stringify([
        { text: '[AJUDA] ', color: 'gold' },
        { text: auroraNomeArg, color: 'white' },
        { text: ': ', color: 'gray' },
        { text: auroraMotivoArg, color: 'yellow' }
    ])
}

/** Encontra o jogador (wrapper KubeJS) pelo UUID da origem do comando. */
function auroraAjudaJogadorDaOrigem(auroraServerArg, auroraUuidArg) {
    if (!auroraUuidArg) return null
    var auroraJogadores = auroraServerArg.players
    for (var auroraI = 0; auroraI < auroraJogadores.size(); auroraI++) {
        var auroraJogador = auroraJogadores.get(auroraI)
        try {
            if (String(auroraJogador.profile.id).toLowerCase() === auroraUuidArg) return auroraJogador
        } catch (auroraUuidErro) {
            // jogador sem uuid
        }
    }
    return null
}

function auroraAjudaResponder(auroraSourceArg, auroraMsgArg) {
    try {
        auroraSourceArg.sendSuccess(Text.of(auroraMsgArg), false)
    } catch (auroraRespostaErro) {
        console.warn('[aurora-ajuda] falha ao responder: ' + auroraRespostaErro)
    }
}

function auroraAjudaCooldownAtivo(auroraDataArg, auroraTickArg) {
    var auroraUltimo = auroraDataArg.getLong(AURORA_AJUDA_NBT_LAST)
    if (auroraUltimo <= 0) return false
    // tickCount reinicia no restart; valor maior que o tick atual é resto da sessão anterior.
    if (auroraUltimo > auroraTickArg) {
        auroraDataArg.putLong(AURORA_AJUDA_NBT_LAST, 0)
        return false
    }
    return auroraTickArg - auroraUltimo < AURORA_AJUDA_COOLDOWN_TICKS
}

/** Executa o pedido. Uma única mensagem por chamada, mesmo com os dois caminhos de comando. */
function auroraAjudaPedir(auroraServerArg, auroraSourceArg, auroraMotivoArg) {
    var auroraMotivo = auroraAjudaLimparMotivo(auroraMotivoArg)
    if (!auroraMotivo) {
        auroraAjudaResponder(auroraSourceArg, '§c[Ajuda] Use: /ajuda {motivo}')
        return
    }

    var auroraEntidade = null
    var auroraUuid = ''
    try {
        auroraEntidade = auroraSourceArg.getEntity()
    } catch (auroraEntidadeErro) {
        try {
            auroraEntidade = auroraSourceArg.entity
        } catch (auroraEntityPropErro) {
            auroraEntidade = null
        }
    }
    if (!auroraEntidade) {
        auroraAjudaResponder(auroraSourceArg, '§c[Ajuda] O comando precisa ser usado por um jogador.')
        return
    }
    try {
        auroraUuid = String(auroraEntidade.getUUID()).toLowerCase()
    } catch (auroraUuidErro) {
        try {
            auroraUuid = String(auroraEntidade.uuid).toLowerCase()
        } catch (auroraUuidPropErro) {
            auroraUuid = ''
        }
    }

    var auroraJogador = auroraAjudaJogadorDaOrigem(auroraServerArg, auroraUuid)
    if (!auroraJogador) {
        auroraAjudaResponder(auroraSourceArg, '§c[Ajuda] Nao foi possivel identificar o jogador.')
        return
    }

    var auroraNome = String(auroraJogador.profile.name)
    var auroraTick = auroraServerArg.tickCount
    var auroraData = auroraJogador.persistentData
    if (auroraAjudaCooldownAtivo(auroraData, auroraTick)) {
        var auroraRestante = Math.ceil(
            (AURORA_AJUDA_COOLDOWN_TICKS - (auroraTick - auroraData.getLong(AURORA_AJUDA_NBT_LAST))) / 20
        )
        auroraAjudaResponder(auroraSourceArg, '§c[Ajuda] Aguarde ' + auroraRestante + 's antes de pedir de novo.')
        return
    }
    auroraData.putLong(AURORA_AJUDA_NBT_LAST, auroraTick)

    var auroraJson = auroraAjudaJson(auroraNome, auroraMotivo)
    var auroraSimples = '[AJUDA] ' + auroraNome + ': ' + auroraMotivo
    var auroraEnviados = auroraAjudaAvisarOps(auroraServerArg, auroraJson, auroraSimples)

    if (auroraEnviados.length === 0) {
        auroraAjudaResponder(auroraSourceArg, '§e[Ajuda] Pedido registrado, mas nenhum operador esta online.')
    } else {
        auroraAjudaResponder(auroraSourceArg, '§a[Ajuda] Enviado aos operadores (' + auroraEnviados.length + ').')
    }
    console.log('[aurora-ajuda] ' + auroraNome + ': ' + auroraMotivo + ' (' + auroraEnviados.length + ' ops)')
}

// Registro normal: /help e autocomplete. Aparece após restart do servidor.
ServerEvents.commandRegistry(event => {
    var auroraCmds = event.commands
    var auroraArgs = event.arguments

    event.register(
        auroraCmds.literal('ajuda')
            .then(
                auroraCmds.argument('motivo', auroraArgs.GREEDY_STRING.create(event))
                    .executes(ctx => {
                        auroraAjudaPedir(
                            ctx.source.server,
                            ctx.source,
                            auroraArgs.GREEDY_STRING.getResult(ctx, 'motivo')
                        )
                        return 1
                    })
            )
            .executes(ctx => {
                auroraAjudaPedir(ctx.source.server, ctx.source, '')
                return 1
            })
    )
})

// Interceptador: funciona na hora após /kubejs reload server_scripts, sem restart.
ServerEvents.command(event => {
    try {
        var auroraInput = String(event.input || '').replace(/^\/+/, '').trim()
        var auroraPartes = auroraInput.split(/\s+/)
        if (auroraPartes[0].toLowerCase() !== 'ajuda') return

        var auroraMotivo = auroraPartes.slice(1).join(' ')
        auroraAjudaPedir(event.server, event.parseResults.context.source, auroraMotivo)
    } catch (auroraErro) {
        console.error('[aurora-ajuda] ERRO no comando: ' + auroraErro)
        return
    }
    // Fora do try: cancel() lança exceção de controle do KubeJS.
    return event.cancel()
})
