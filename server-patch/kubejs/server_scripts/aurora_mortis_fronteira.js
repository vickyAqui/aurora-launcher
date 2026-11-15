// Aviso de fronteira — entradas, saídas e travessias entre domínios do
// Aurora Mortis.
//
// Eventos avisados:
//   - ENTROU: o jogador entrou em um domínio do mod vindo de fora (bioma
//     vanilla, outro mod ou teleporte).
//   - SAIU: o jogador saiu de um domínio do mod para fora dele.
//   - CRUZOU: o jogador passou de um domínio do mod direto para outro
//     (ex.: nostalgia -> repetição).
//
// Não avisa quando o bioma só varia dentro do mesmo domínio (ver
// AURORA_FRONTEIRA_DOMAIN_ALIASES), então andar dentro do pesadelo não gera
// mensagem.
//
// Em /tp e /mvtp o servidor pode mostrar um bioma comum por alguns ticks no
// meio do teleporte, e nas bordas o bioma pode oscilar. Por isso o último
// domínio é mantido por AURORA_FRONTEIRA_GRACE_TICKS antes de ser esquecido:
// assim um cruzamento A -> (comum) -> B ainda é reconhecido como A -> B.
//
// Destinatários: AURORA_FRONTEIRA_ANNOUNCE_TO_ALL = true envia para todos os
// jogadores online; false envia só para quem cruzou.
//
// Este script é independente de aurora_mortis_biomes.js (que avisa os OPs com
// detalhes de bioma/coordenadas).
//
// Instalação: <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraFronteira`/`AURORA_FRONTEIRA_`.

const AURORA_FRONTEIRA_NAMESPACE = 'aurora_mortis'
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 5   // checa a cada 0,25 s
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 100    // travessia: no máximo 1 aviso a cada 5 s
const AURORA_FRONTEIRA_OUTSIDE_COOLDOWN_TICKS = 400 // entrada/saída: 20 s
const AURORA_FRONTEIRA_GRACE_TICKS = 100       // 5 s para atravessar bioma comum
const AURORA_FRONTEIRA_ANNOUNCE_TO_ALL = true  // false = só quem cruzou recebe
const AURORA_FRONTEIRA_ANNOUNCE_ENTER = true   // avisa ao entrar em um domínio
const AURORA_FRONTEIRA_ANNOUNCE_EXIT = true    // avisa ao sair de um domínio

const AURORA_FRONTEIRA_NBT_LAST_DOMAIN = 'aurora_fronteira_last_domain'
const AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK = 'aurora_fronteira_last_domain_tick'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'
const AURORA_FRONTEIRA_NBT_LAST_ENTER_MSG = 'aurora_fronteira_last_enter_msg'
const AURORA_FRONTEIRA_NBT_LAST_EXIT_MSG = 'aurora_fronteira_last_exit_msg'

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
 * Envia a mensagem para um jogador.
 * Usa tellraw (comando) porque é o caminho de chat mais confiável; se o
 * comando falhar, cai para player.tell().
 */
function auroraFronteiraSend(auroraFronteiraPlayer, auroraFronteiraMessage, auroraFronteiraColor) {
    const auroraFronteiraJson = JSON.stringify({ text: auroraFronteiraMessage, color: auroraFronteiraColor, bold: true })
    try {
        const auroraFronteiraResult = auroraFronteiraPlayer.server.runCommandSilent(
            'tellraw ' + auroraFronteiraPlayer.profile.name + ' ' + auroraFronteiraJson
        )
        if (auroraFronteiraResult > 0) return
    } catch (auroraFronteiraErr) {
        // cai para o envio direto abaixo
    }
    auroraFronteiraPlayer.tell(auroraFronteiraMessage)
}

/**
 * Avisa um evento para todos (ou só para quem cruzou).
 * auroraFronteiraPersonal = mensagem de quem cruzou
 * auroraFronteiraOthers   = mensagem para os demais ('{nome}' é substituído)
 */
function auroraFronteiraBroadcast(auroraFronteiraPlayer, auroraFronteiraPersonal, auroraFronteiraOthers, auroraFronteiraColor) {
    const auroraFronteiraName = auroraFronteiraPlayer.profile.name
    var auroraFronteiraSent = 0

    if (AURORA_FRONTEIRA_ANNOUNCE_TO_ALL) {
        const auroraFronteiraPlayers = auroraFronteiraPlayer.server.players
        const auroraFronteiraOthersMsg = auroraFronteiraOthers.replace('{nome}', auroraFronteiraName)
        for (var auroraFronteiraIdx = 0; auroraFronteiraIdx < auroraFronteiraPlayers.size(); auroraFronteiraIdx++) {
            const auroraFronteiraTarget = auroraFronteiraPlayers.get(auroraFronteiraIdx)
            if (auroraFronteiraTarget.profile.name === auroraFronteiraName) {
                auroraFronteiraSend(auroraFronteiraTarget, auroraFronteiraPersonal, auroraFronteiraColor)
            } else {
                auroraFronteiraSend(auroraFronteiraTarget, auroraFronteiraOthersMsg, auroraFronteiraColor)
            }
            auroraFronteiraSent++
        }
    } else {
        auroraFronteiraSend(auroraFronteiraPlayer, auroraFronteiraPersonal, auroraFronteiraColor)
        auroraFronteiraSent = 1
    }

    return auroraFronteiraSent
}

/** Travessia entre dois domínios */
function auroraFronteiraNotifyCross(auroraFronteiraPlayer, auroraFronteiraFrom, auroraFronteiraTo) {
    auroraFronteiraBroadcast(
        auroraFronteiraPlayer,
        'Atenção: Você está ultrapassando uma fronteira!!',
        'Atenção: {nome} está ultrapassando uma fronteira!!',
        'dark_red'
    )
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' +
        auroraFronteiraFrom + ' -> ' + auroraFronteiraTo)
}

/** Entrada em um domínio vindo de fora */
function auroraFronteiraNotifyEnter(auroraFronteiraPlayer, auroraFronteiraDomain) {
    const auroraFronteiraLabel = auroraFronteiraDomainLabel(auroraFronteiraDomain)
    auroraFronteiraBroadcast(
        auroraFronteiraPlayer,
        'Você entrou no domínio ' + auroraFronteiraLabel + '.',
        '{nome} entrou no domínio ' + auroraFronteiraLabel + '.',
        'gold'
    )
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain)
}

/** Saída de um domínio para fora */
function auroraFronteiraNotifyExit(auroraFronteiraPlayer, auroraFronteiraDomain) {
    const auroraFronteiraLabel = auroraFronteiraDomainLabel(auroraFronteiraDomain)
    auroraFronteiraBroadcast(
        auroraFronteiraPlayer,
        'Você saiu do domínio ' + auroraFronteiraLabel + '.',
        '{nome} saiu do domínio ' + auroraFronteiraLabel + '.',
        'yellow'
    )
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' + auroraFronteiraDomain)
}

// Ao entrar no servidor, começa do domínio em que o jogador está, sem avisar
// (evita aviso falso quando ele loga já dentro de um domínio).
PlayerEvents.loggedIn(event => {
    const auroraFronteiraPlayer = event.player
    try {
        const auroraFronteiraDomain = auroraFronteiraDomainOf(auroraFronteiraBiomeIdAt(auroraFronteiraPlayer))
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraPlayer.server.tickCount)
    } catch (auroraFronteiraErr) {
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, '')
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, 0)
    }
})

PlayerEvents.tick(event => {
    const auroraFronteiraPlayer = event.player
    const auroraFronteiraTick = auroraFronteiraPlayer.server.tickCount

    if (auroraFronteiraTick % AURORA_FRONTEIRA_CHECK_EVERY_TICKS !== 0) return

    const auroraFronteiraBiome = auroraFronteiraBiomeIdAt(auroraFronteiraPlayer)
    const auroraFronteiraDomain = auroraFronteiraDomainOf(auroraFronteiraBiome)
    const auroraFronteiraData = auroraFronteiraPlayer.persistentData
    const auroraFronteiraLastDomain = auroraFronteiraData.getString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN)

    // Mesmo domínio: só mantém o marcador de tempo atualizado.
    if (auroraFronteiraDomain === auroraFronteiraLastDomain) {
        if (auroraFronteiraDomain !== '') {
            auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraTick)
        }
        return
    }

    // Bioma comum (ou vazio durante um teleporte): mantém o último domínio
    // por AURORA_FRONTEIRA_GRACE_TICKS antes de esquecê-lo.
    if (auroraFronteiraDomain === '') {
        if (auroraFronteiraLastDomain === '') return

        const auroraFronteiraLastTick = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK)
        if (auroraFronteiraLastTick > 0 && auroraFronteiraTick - auroraFronteiraLastTick <= AURORA_FRONTEIRA_GRACE_TICKS) return

        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, '')
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, 0)

        if (!AURORA_FRONTEIRA_ANNOUNCE_EXIT) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' + auroraFronteiraLastDomain)
            return
        }

        // Cooldown próprio da saída (não é afetado pelo aviso de entrada).
        const auroraFronteiraLastExit = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_EXIT_MSG)
        if (auroraFronteiraLastExit > 0 && auroraFronteiraTick - auroraFronteiraLastExit < AURORA_FRONTEIRA_OUTSIDE_COOLDOWN_TICKS) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' + auroraFronteiraLastDomain)
            return
        }
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_EXIT_MSG, auroraFronteiraTick)

        auroraFronteiraNotifyExit(auroraFronteiraPlayer, auroraFronteiraLastDomain)
        return
    }

    // Entrou em um domínio vindo de bioma comum.
    if (auroraFronteiraLastDomain === '') {
        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraTick)

        if (!AURORA_FRONTEIRA_ANNOUNCE_ENTER) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
            return
        }

        // Cooldown próprio da entrada.
        const auroraFronteiraLastEnter = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_ENTER_MSG)
        if (auroraFronteiraLastEnter > 0 && auroraFronteiraTick - auroraFronteiraLastEnter < AURORA_FRONTEIRA_OUTSIDE_COOLDOWN_TICKS) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
            return
        }
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_ENTER_MSG, auroraFronteiraTick)

        auroraFronteiraNotifyEnter(auroraFronteiraPlayer, auroraFronteiraDomain)
        return
    }

    // Trocou de domínio.
    const auroraFronteiraLastTick = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK)
    const auroraFronteiraWithinGrace = auroraFronteiraLastTick > 0 && auroraFronteiraTick - auroraFronteiraLastTick <= AURORA_FRONTEIRA_GRACE_TICKS

    auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraTick)

    // Ficou tempo demais no bioma comum: conta como entrada, não como travessia.
    if (!auroraFronteiraWithinGrace) {
        if (!AURORA_FRONTEIRA_ANNOUNCE_ENTER) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
            return
        }
        const auroraFronteiraLastEnter2 = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_ENTER_MSG)
        if (auroraFronteiraLastEnter2 > 0 && auroraFronteiraTick - auroraFronteiraLastEnter2 < AURORA_FRONTEIRA_OUTSIDE_COOLDOWN_TICKS) {
            console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
            return
        }
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_ENTER_MSG, auroraFronteiraTick)
        auroraFronteiraNotifyEnter(auroraFronteiraPlayer, auroraFronteiraDomain)
        return
    }

    // Cooldown: evita repetir o aviso quando o bioma oscila na borda.
    const auroraFronteiraLastMsg = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_MSG)
    if (auroraFronteiraLastMsg > 0 && auroraFronteiraTick - auroraFronteiraLastMsg < AURORA_FRONTEIRA_COOLDOWN_TICKS) return
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)

    auroraFronteiraNotifyCross(auroraFronteiraPlayer, auroraFronteiraLastDomain, auroraFronteiraDomain)
})
