// Aviso de fronteira — entradas, saídas e travessias entre domínios do
// Aurora Mortis.
//
// Toda passagem de fronteira gera UM aviso para os operadores online, dizendo
// QUEM passou e QUAL domínio/bioma do mod está envolvido:
//   - ENTROU: o jogador entrou em um domínio do mod vindo de fora (bioma
//     vanilla, outro mod ou teleporte).
//   - SAIU: o jogador saiu de um domínio do mod para fora dele.
//   - CRUZOU: o jogador passou de um domínio do mod direto para outro
//     (ex.: nostalgia -> repetição).
//
// O aviso pessoal "Atenção: Você está ultrapassando uma fronteira!!" vai SÓ
// para quem cruzou e SÓ no caso CRUZOU (domínio do Mortis -> outro domínio do
// Mortis). Entrar no mod vindo de fora, ou sair dele para fora, não gera esse
// aviso pessoal: não é uma travessia entre biomas do Mortis.
//
// Anti-spam — cada travessia de verdade avisa UMA vez:
//   - DEBOUNCE: o jogador precisa ficar AURORA_FRONTEIRA_DEBOUNCE_TICKS no novo
//     domínio antes do aviso. Quem fica oscilando em cima da linha (o bioma
//     troca a cada poucos ticks) nunca completa o tempo e não avisa.
//   - SAÍDA: só é avisada depois de AURORA_FRONTEIRA_EXIT_GRACE_TICKS fora do
//     domínio. Sair e voltar rápido (andar na borda, /tp curto) não gera nada.
//   - A mesma janela faz um teleporte que passa por um bioma comum no meio
//     continuar sendo UMA travessia A -> B, e não "saiu de A" + "entrou em B".
//   - Como entrada/travessia exigem DEBOUNCE estável e a saída exige
//     EXIT_GRACE, dois avisos do mesmo jogador nunca ficam a menos de 2 s um do
//     outro. O COOLDOWN existe só como rede de segurança e está em 1 tick (ou
//     seja, não engole travessia de verdade: sair e voltar logo depois de uma
//     saída avisada continua avisando).
//
// Este script é o ÚNICO que anuncia fronteira no chat. O
// aurora_mortis_biomes.js só anuncia variação de bioma DENTRO do mesmo domínio
// (também para os OPs); assim o OP não recebe dois avisos do mesmo cruzamento.
//
// Instalação: <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraFronteira`/`AURORA_FRONTEIRA_`.

const AURORA_FRONTEIRA_NAMESPACE = 'aurora_mortis'
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 5     // checa a cada 0,25 s
const AURORA_FRONTEIRA_DEBOUNCE_TICKS = 40       // 2 s no novo domínio antes de avisar
const AURORA_FRONTEIRA_EXIT_GRACE_TICKS = 200    // 10 s fora antes de avisar a saída
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 1        // 1 tick: rede de segurança, não engole travessia
const AURORA_FRONTEIRA_ANNOUNCE_TO_OPS = true    // avisa os operadores online
const AURORA_FRONTEIRA_ANNOUNCE_PERSONAL = true  // "Você está ultrapassando" só em domínio -> domínio
const AURORA_FRONTEIRA_ANNOUNCE_ENTER = true     // avisa aos OPs ao entrar em um domínio
const AURORA_FRONTEIRA_ANNOUNCE_EXIT = true      // avisa aos OPs ao sair de um domínio

// Operadores sem OP vanilla (por exemplo, staff só com LuckPerms) podem ser
// listados aqui pelo nome exato da conta.
const AURORA_FRONTEIRA_EXTRA_OPS = []

const AURORA_FRONTEIRA_NBT_LAST_DOMAIN = 'aurora_fronteira_last_domain'
const AURORA_FRONTEIRA_NBT_PENDING_DOMAIN = 'aurora_fronteira_pending_domain'
const AURORA_FRONTEIRA_NBT_PENDING_TICK = 'aurora_fronteira_pending_tick'
const AURORA_FRONTEIRA_NBT_PENDING_ACTIVE = 'aurora_fronteira_pending_active'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'

const AURORA_FRONTEIRA_PERSONAL = 'Atenção: Você está ultrapassando uma fronteira!!'

// Variações de bioma que pertencem ao mesmo domínio.
// As chaves são o "path" do bioma (sem o namespace "aurora_mortis:").
const AURORA_FRONTEIRA_DOMAIN_ALIASES = {
    'ilusao_sem_radicao': 'ilusao',
    'rubro': 'repeticao',
    'dominio_de_olhos_do_pesadelo': 'pesadelo'
}

// Nome bonito para o chat.
const AURORA_FRONTEIRA_DOMAIN_LABELS = {
    'caos': 'Caos',
    'criatividade': 'Criatividade',
    'futuro': 'Futuro',
    'ilusao': 'Ilusão',
    'nostalgia': 'Nostalgia',
    'pesadelo': 'Pesadelo',
    'realidade': 'Realidade',
    'repeticao': 'Repetição'
}

/** Id do bioma onde o jogador está, ex.: "aurora_mortis:dominio_do_caos" */
function auroraFronteiraBiomeIdAt(auroraFronteiraPlayer) {
    const auroraFronteiraKey = auroraFronteiraPlayer.level.getBiome(auroraFronteiraPlayer.blockPosition()).unwrapKey()
    return auroraFronteiraKey.isPresent() ? String(auroraFronteiraKey.get().location()) : 'minecraft:the_void'
}

/**
 * Domínio do bioma, ou '' se o bioma não for do mod.
 * Ex.: "aurora_mortis:dominio_da_nostalgia" -> "nostalgia"
 */
function auroraFronteiraDomainOf(auroraFronteiraBiomeId) {
    if (!auroraFronteiraBiomeId.startsWith(AURORA_FRONTEIRA_NAMESPACE + ':')) return ''

    const auroraFronteiraPath = auroraFronteiraBiomeId.substring(AURORA_FRONTEIRA_NAMESPACE.length + 1)
    const auroraFronteiraAlias = AURORA_FRONTEIRA_DOMAIN_ALIASES[auroraFronteiraPath]
    if (auroraFronteiraAlias) return auroraFronteiraAlias

    // "dominio_da_criatividade" -> "criatividade"
    return auroraFronteiraPath.replace(/^dominio_(da|do|de)_/, '')
}

/** "pesadelo" -> "Pesadelo" */
function auroraFronteiraDomainLabel(auroraFronteiraDomain) {
    const auroraFronteiraLabel = AURORA_FRONTEIRA_DOMAIN_LABELS[auroraFronteiraDomain]
    return auroraFronteiraLabel ? auroraFronteiraLabel : auroraFronteiraDomain
}

/**
 * Cooldown baseado em tick do servidor.
 *
 * O tickCount reinicia quando o servidor é reiniciado, mas o valor salvo no NBT
 * do jogador não. Um valor salvo maior que o tick atual é resto de uma sessão
 * anterior: nesse caso o cooldown é considerado expirado e o valor é zerado.
 * Sem isso a conta fica negativa e o aviso é descartado para sempre.
 */
function auroraFronteiraCooldownAtivo(auroraFronteiraData, auroraFronteiraKey, auroraFronteiraTick, auroraFronteiraCooldownTicks) {
    const auroraFronteiraLast = auroraFronteiraData.getLong(auroraFronteiraKey)
    if (auroraFronteiraLast <= 0) return false
    if (auroraFronteiraLast > auroraFronteiraTick) {
        auroraFronteiraData.putLong(auroraFronteiraKey, 0)
        return false
    }
    return auroraFronteiraTick - auroraFronteiraLast < auroraFronteiraCooldownTicks
}

/** JSON do tellraw (vermelho escuro e negrito, igual ao player.tell). */
function auroraFronteiraJson(auroraFronteiraMessage) {
    return JSON.stringify({ text: auroraFronteiraMessage, color: 'dark_red', bold: true })
}

/**
 * Entrega a mensagem pessoal direto no jogador que cruzou.
 *
 * Vai por player.tell (sem passar por nome/seletor), então não depende de
 * comparar nomes: quem cruzou sempre recebe o "Você". tellraw fica de reserva.
 */
function auroraFronteiraTellPersonal(auroraFronteiraPlayer, auroraFronteiraMessage) {
    try {
        auroraFronteiraPlayer.tell(Text.darkRed(auroraFronteiraMessage).bold())
        return true
    } catch (auroraFronteiraErr) {
        // cai para tellraw abaixo
    }
    try {
        return auroraFronteiraPlayer.server.runCommandSilent(
            'tellraw ' + String(auroraFronteiraPlayer.profile.name) + ' ' + auroraFronteiraJson(auroraFronteiraMessage)
        ) > 0
    } catch (auroraFronteiraErr2) {
        return false
    }
}

/**
 * Nomes dos operadores segundo o próprio servidor, em minúsculas.
 *
 * Mesma fonte usada por aurora_mortis_biomes.js:
 * `getPlayerList().getOps().getUserList()` é a lista carregada do ops.json no
 * start e atualizada por /op e /deop em memória.
 */
function auroraFronteiraServerOpNames(auroraFronteiraServer) {
    var auroraFronteiraNames = []
    try {
        var auroraFronteiraKeys = auroraFronteiraServer.getPlayerList().getOps().getUserList()
        for (var auroraFronteiraIdx = 0; auroraFronteiraIdx < auroraFronteiraKeys.length; auroraFronteiraIdx++) {
            auroraFronteiraNames.push(String(auroraFronteiraKeys[auroraFronteiraIdx]).toLowerCase())
        }
    } catch (auroraFronteiraErr) {
        console.warn('[aurora-fronteira] nao consegui ler a lista de OPs do servidor: ' + auroraFronteiraErr)
    }
    return auroraFronteiraNames
}

/** true se o jogador é operador pela lista do servidor, pela lista extra ou por isOp(). */
function auroraFronteiraIsStaff(auroraFronteiraTarget, auroraFronteiraOpNames) {
    var auroraFronteiraName = ''
    try {
        auroraFronteiraName = String(auroraFronteiraTarget.profile.name)
    } catch (auroraFronteiraErr) {
        return false
    }
    if (AURORA_FRONTEIRA_EXTRA_OPS.indexOf(auroraFronteiraName) >= 0) return true
    if (auroraFronteiraOpNames.indexOf(auroraFronteiraName.toLowerCase()) >= 0) return true
    try {
        return auroraFronteiraTarget.isOp() === true
    } catch (auroraFronteiraErr2) {
        return false
    }
}

/**
 * Envia um JSON de tellraw para todos os operadores online, um a um.
 * `skipName` (quem cruzou) fica de fora: ele já recebeu o aviso pessoal.
 * Retorna { count, names } para o log de diagnóstico.
 */
function auroraFronteiraTellOps(auroraFronteiraServer, auroraFronteiraJsonArg, auroraFronteiraPlainArg, auroraFronteiraSkipName) {
    var auroraFronteiraSent = 0
    var auroraFronteiraSentNames = []
    const auroraFronteiraOpNames = auroraFronteiraServerOpNames(auroraFronteiraServer)
    const auroraFronteiraPlayers = auroraFronteiraServer.players

    for (var auroraFronteiraIdx2 = 0; auroraFronteiraIdx2 < auroraFronteiraPlayers.size(); auroraFronteiraIdx2++) {
        var auroraFronteiraTarget = auroraFronteiraPlayers.get(auroraFronteiraIdx2)
        if (!auroraFronteiraIsStaff(auroraFronteiraTarget, auroraFronteiraOpNames)) continue
        if (auroraFronteiraSkipName && String(auroraFronteiraTarget.profile.name) === auroraFronteiraSkipName) continue

        var auroraFronteiraOk = false
        try {
            auroraFronteiraOk = auroraFronteiraServer.runCommandSilent(
                'tellraw ' + auroraFronteiraTarget.profile.name + ' ' + auroraFronteiraJsonArg
            ) > 0
        } catch (auroraFronteiraErr) {
            auroraFronteiraOk = false
        }
        if (!auroraFronteiraOk) {
            try {
                auroraFronteiraTarget.tell(auroraFronteiraPlainArg)
            } catch (auroraFronteiraErr2) {
                // sem outro caminho de envio
            }
        }
        auroraFronteiraSent++
        auroraFronteiraSentNames.push(auroraFronteiraTarget.profile.name)
    }

    // Nenhum OP reconhecido (ops.json ilegível?): última tentativa pelo seletor.
    if (auroraFronteiraSent === 0) {
        try {
            auroraFronteiraSent = auroraFronteiraServer.runCommandSilent('tellraw @a[level=2..] ' + auroraFronteiraJsonArg)
        } catch (auroraFronteiraErr3) {
            auroraFronteiraSent = 0
        }
    }

    return { count: auroraFronteiraSent, names: auroraFronteiraSentNames }
}

/** Coordenadas e dimensão do jogador, no formato usado nas mensagens. */
function auroraFronteiraWhere(auroraFronteiraPlayer) {
    return {
        x: Math.floor(auroraFronteiraPlayer.x),
        y: Math.floor(auroraFronteiraPlayer.y),
        z: Math.floor(auroraFronteiraPlayer.z),
        dim: String(auroraFronteiraPlayer.level.dimension.location())
    }
}

/** JSON do aviso de fronteira (linha única, como no aurora_mortis_biomes.js). */
function auroraFronteiraOpJson(auroraFronteiraName, auroraFronteiraVerb, auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeId, auroraFronteiraWhereArg, auroraFronteiraCross) {
    const auroraFronteiraParts = [
        { text: '[Aurora] ', color: 'gold' },
        { text: auroraFronteiraName, color: 'white' }
    ]

    // Travessia entre domínios: " ultrapassou a fronteira: A -> B"
    auroraFronteiraParts.push({ text: ' ' + auroraFronteiraVerb, color: 'gray' })
    if (auroraFronteiraCross) {
        auroraFronteiraParts.push({ text: auroraFronteiraDomainLabel(auroraFronteiraFrom), color: 'dark_red' })
        auroraFronteiraParts.push({ text: ' -> ', color: 'gray' })
        auroraFronteiraParts.push({ text: auroraFronteiraDomainLabel(auroraFronteiraTo), color: 'dark_red' })
    } else if (auroraFronteiraFrom) {
        auroraFronteiraParts.push({ text: auroraFronteiraDomainLabel(auroraFronteiraFrom), color: 'dark_red' })
    }

    if (auroraFronteiraBiomeId) {
        auroraFronteiraParts.push({ text: ' (' + auroraFronteiraBiomeId + ')', color: 'aqua' })
    }
    auroraFronteiraParts.push({
        text: ' @ ' + auroraFronteiraWhereArg.x + ' ' + auroraFronteiraWhereArg.y + ' ' + auroraFronteiraWhereArg.z + ' (' + auroraFronteiraWhereArg.dim + ')',
        color: 'dark_gray'
    })

    return JSON.stringify(auroraFronteiraParts)
}

/** Texto simples do aviso, para o fallback por player.tell. */
function auroraFronteiraOpPlain(auroraFronteiraName, auroraFronteiraVerb, auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeId, auroraFronteiraWhereArg, auroraFronteiraCross) {
    var auroraFronteiraText = '[Aurora] ' + auroraFronteiraName + ' ' + auroraFronteiraVerb
    if (auroraFronteiraCross) {
        auroraFronteiraText += ' ' + auroraFronteiraDomainLabel(auroraFronteiraFrom) +
            ' -> ' + auroraFronteiraDomainLabel(auroraFronteiraTo)
    } else if (auroraFronteiraFrom) {
        auroraFronteiraText += ' ' + auroraFronteiraDomainLabel(auroraFronteiraFrom)
    }
    if (auroraFronteiraBiomeId) auroraFronteiraText += ' (' + auroraFronteiraBiomeId + ')'
    auroraFronteiraText += ' @ ' + auroraFronteiraWhereArg.x + ' ' + auroraFronteiraWhereArg.y + ' ' +
        auroraFronteiraWhereArg.z + ' (' + auroraFronteiraWhereArg.dim + ')'
    return auroraFronteiraText
}

/**
 * Anuncia a transição para os OPs e, se for travessia entre dois domínios do
 * Mortis, também avisa quem cruzou ("Você está ultrapassando uma fronteira").
 * Retorna quantos OPs receberam o aviso.
 */
function auroraFronteiraNotify(auroraFronteiraPlayer, auroraFronteiraVerb, auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeId, auroraFronteiraCross) {
    const auroraFronteiraName = String(auroraFronteiraPlayer.profile.name)
    const auroraFronteiraWhereArg = auroraFronteiraWhere(auroraFronteiraPlayer)

    // Aviso pessoal só na travessia domínio do Mortis -> outro domínio do Mortis.
    if (auroraFronteiraCross && AURORA_FRONTEIRA_ANNOUNCE_PERSONAL) {
        auroraFronteiraTellPersonal(auroraFronteiraPlayer, AURORA_FRONTEIRA_PERSONAL)
    }

    if (!AURORA_FRONTEIRA_ANNOUNCE_TO_OPS) return 0

    const auroraFronteiraJsonArg = auroraFronteiraOpJson(auroraFronteiraName, auroraFronteiraVerb,
        auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeId, auroraFronteiraWhereArg, auroraFronteiraCross)
    const auroraFronteiraPlainArg = auroraFronteiraOpPlain(auroraFronteiraName, auroraFronteiraVerb,
        auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeId, auroraFronteiraWhereArg, auroraFronteiraCross)

    // Quem cruzou e recebeu o aviso pessoal não recebe o detalhado de novo; nas
    // entradas/saídas (sem aviso pessoal) o OP que passou também é avisado.
    const auroraFronteiraSkip = (auroraFronteiraCross && AURORA_FRONTEIRA_ANNOUNCE_PERSONAL)
        ? auroraFronteiraName : ''

    return auroraFronteiraTellOps(auroraFronteiraPlayer.server, auroraFronteiraJsonArg,
        auroraFronteiraPlainArg, auroraFronteiraSkip).count
}

/** Travessia entre dois domínios do mod (o único caso com aviso pessoal) */
function auroraFronteiraNotifyCross(auroraFronteiraPlayer, auroraFronteiraFrom, auroraFronteiraTo) {
    const auroraFronteiraSent = auroraFronteiraNotify(auroraFronteiraPlayer, 'ultrapassou a fronteira:',
        auroraFronteiraFrom, auroraFronteiraTo, auroraFronteiraBiomeIdAt(auroraFronteiraPlayer), true)
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' +
        auroraFronteiraFrom + ' -> ' + auroraFronteiraTo + ' (' + auroraFronteiraSent + ' ops)')
}

/** Entrada em um domínio vindo de fora (aviso só para os OPs, sem aviso pessoal) */
function auroraFronteiraNotifyEnter(auroraFronteiraPlayer, auroraFronteiraDomain) {
    const auroraFronteiraSent = auroraFronteiraNotify(auroraFronteiraPlayer, 'entrou no domínio',
        auroraFronteiraDomain, '', auroraFronteiraBiomeIdAt(auroraFronteiraPlayer), false)
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' +
        auroraFronteiraDomain + ' (' + auroraFronteiraDomainLabel(auroraFronteiraDomain) + ', ' +
        auroraFronteiraSent + ' ops)')
}

/** Saída de um domínio para fora (aviso só para os OPs, sem aviso pessoal) */
function auroraFronteiraNotifyExit(auroraFronteiraPlayer, auroraFronteiraDomain) {
    const auroraFronteiraSent = auroraFronteiraNotify(auroraFronteiraPlayer, 'saiu do domínio',
        auroraFronteiraDomain, '', 'agora em ' + auroraFronteiraBiomeIdAt(auroraFronteiraPlayer), false)
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' +
        auroraFronteiraDomain + ' (' + auroraFronteiraDomainLabel(auroraFronteiraDomain) + ', ' +
        auroraFronteiraSent + ' ops)')
}

// Ao entrar no servidor, começa do domínio em que o jogador está, sem avisar
// (evita aviso falso quando ele loga já dentro de um domínio).
PlayerEvents.loggedIn(event => {
    const auroraFronteiraPlayer = event.player
    try {
        const auroraFronteiraDomain = auroraFronteiraDomainOf(auroraFronteiraBiomeIdAt(auroraFronteiraPlayer))
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN, '')
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, 0)
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE, 0)
    } catch (auroraFronteiraErr) {
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, '')
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN, '')
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, 0)
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE, 0)
    }
})

PlayerEvents.tick(event => {
    const auroraFronteiraPlayer = event.player
    const auroraFronteiraTick = auroraFronteiraPlayer.server.tickCount

    if (auroraFronteiraTick % AURORA_FRONTEIRA_CHECK_EVERY_TICKS !== 0) return

    try {
        auroraFronteiraCheck(auroraFronteiraPlayer, auroraFronteiraTick)
    } catch (auroraFronteiraErr) {
        console.error('[aurora-fronteira] ERRO em ' + auroraFronteiraPlayer.profile.name + ': ' + auroraFronteiraErr)
    }
})

/**
 * Máquina de estados com debounce.
 *
 * `last_domain` é o domínio "estável" (já anunciado). Quando o bioma muda, o
 * novo domínio fica em `pending_domain` até completar o tempo mínimo:
 *   - entrada/travessia: AURORA_FRONTEIRA_DEBOUNCE_TICKS (2 s)
 *   - saída:             AURORA_FRONTEIRA_EXIT_GRACE_TICKS (10 s)
 * Se o bioma voltar antes disso, o pendente é descartado e nada é anunciado.
 */
function auroraFronteiraCheck(auroraFronteiraPlayer, auroraFronteiraTick) {
    const auroraFronteiraBiome = auroraFronteiraBiomeIdAt(auroraFronteiraPlayer)
    const auroraFronteiraDomain = auroraFronteiraDomainOf(auroraFronteiraBiome)
    const auroraFronteiraData = auroraFronteiraPlayer.persistentData
    const auroraFronteiraStable = auroraFronteiraData.getString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN)

    // Mesmo domínio do estado estável: não há transição pendente.
    if (auroraFronteiraDomain === auroraFronteiraStable) {
        if (auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE) !== 0) {
            auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN, '')
            auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, 0)
            auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE, 0)
        }
        return
    }

    // Novo candidato (ou bioma oscilando): (re)inicia a contagem.
    // A flag "active" é necessária porque o domínio "fora" também é ''.
    if (auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE) === 0 ||
        auroraFronteiraDomain !== auroraFronteiraData.getString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN)) {
        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN, auroraFronteiraDomain)
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, auroraFronteiraTick)
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE, 1)
        return
    }

    const auroraFronteiraSince = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_PENDING_TICK)
    if (auroraFronteiraSince > auroraFronteiraTick) {
        // resto de uma sessão anterior do servidor: recomeça a contagem
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, auroraFronteiraTick)
        return
    }

    const auroraFronteiraNeed = (auroraFronteiraDomain === '')
        ? AURORA_FRONTEIRA_EXIT_GRACE_TICKS
        : AURORA_FRONTEIRA_DEBOUNCE_TICKS
    if (auroraFronteiraTick - auroraFronteiraSince < auroraFronteiraNeed) return

    // Candidato firme: confirma a transição.
    auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_PENDING_DOMAIN, '')
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_TICK, 0)
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_PENDING_ACTIVE, 0)
    auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)

    if (auroraFronteiraStable === '' && auroraFronteiraDomain === '') return

    // Cooldown: rede de segurança em 1 tick (não engole travessia de verdade).
    if (auroraFronteiraCooldownAtivo(auroraFronteiraData, AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick, AURORA_FRONTEIRA_COOLDOWN_TICKS)) {
        console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' +
            (auroraFronteiraStable === '' ? 'fora' : auroraFronteiraStable) + ' -> ' +
            (auroraFronteiraDomain === '' ? 'fora' : auroraFronteiraDomain) + ' (cooldown)')
        return
    }
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)

    if (auroraFronteiraStable === '') {
        if (!AURORA_FRONTEIRA_ANNOUNCE_ENTER) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain)
            return
        }
        auroraFronteiraNotifyEnter(auroraFronteiraPlayer, auroraFronteiraDomain)
        return
    }

    if (auroraFronteiraDomain === '') {
        if (!AURORA_FRONTEIRA_ANNOUNCE_EXIT) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' + auroraFronteiraStable)
            return
        }
        auroraFronteiraNotifyExit(auroraFronteiraPlayer, auroraFronteiraStable)
        return
    }

    auroraFronteiraNotifyCross(auroraFronteiraPlayer, auroraFronteiraStable, auroraFronteiraDomain)
}
