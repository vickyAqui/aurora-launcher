// Aviso de fronteira — só entre domínios do Aurora Mortis.
//
// Regra: o aviso é enviado quando o jogador passa de um domínio do mod
// Aurora Mortis para outro domínio do mod (ex.: nostalgia -> repetição).
// Entrar ou sair de um domínio vindo de um bioma vanilla/outro mod NÃO gera
// aviso (ex.: taiga -> repetição).
//
// Em /tp e /mvtp o servidor pode mostrar um bioma comum por alguns ticks no
// meio do teleporte, e nas bordas o bioma pode oscilar. Por isso o último
// domínio é mantido por AURORA_FRONTEIRA_GRACE_TICKS antes de ser esquecido:
// assim um cruzamento A -> (comum) -> B ainda é reconhecido como A -> B.
//
// Biomas que são variações do mesmo domínio contam como o mesmo domínio (ver
// AURORA_FRONTEIRA_DOMAIN_ALIASES), então andar entre eles não dispara aviso.
// Ex.: "Dominio do Pesadelo" e "Dominio de Olhos do Pesadelo" se intercalam no
// mundo; sem isso o jogador levaria aviso o tempo todo dentro do pesadelo.
//
// Destinatários: AURORA_FRONTEIRA_ANNOUNCE_TO_ALL = true envia para todos os
// jogadores online; false envia só para quem cruzou.
//
// Este script é independente de aurora_mortis_biomes.js (que avisa os OPs).
//
// Instalação: <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraFronteira`/`AURORA_FRONTEIRA_`.

const AURORA_FRONTEIRA_NAMESPACE = 'aurora_mortis'
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 5   // checa a cada 0,25 s
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 100    // no máximo 1 aviso a cada 5 s
const AURORA_FRONTEIRA_GRACE_TICKS = 100       // 5 s para atravessar bioma comum
const AURORA_FRONTEIRA_ANNOUNCE_TO_ALL = true  // false = só quem cruzou recebe

const AURORA_FRONTEIRA_NBT_LAST_DOMAIN = 'aurora_fronteira_last_domain'
const AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK = 'aurora_fronteira_last_domain_tick'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'

// Variações de bioma que pertencem ao mesmo domínio.
// As chaves são o "path" do bioma (sem o namespace "aurora_mortis:").
const AURORA_FRONTEIRA_DOMAIN_ALIASES = {
    'ilusao_sem_radicao': 'ilusao',
    'rubro': 'repeticao',
    'dominio_de_olhos_do_pesadelo': 'pesadelo'
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

/**
 * Envia a mensagem para um jogador.
 * Usa tellraw (comando) porque é o caminho de chat mais confiável; se o
 * comando falhar, cai para player.tell().
 */
function auroraFronteiraSend(auroraFronteiraPlayer, auroraFronteiraMessage) {
    const auroraFronteiraJson = JSON.stringify({ text: auroraFronteiraMessage, color: 'dark_red', bold: true })
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

/** Avisa o cruzamento (para todos ou só para quem cruzou) */
function auroraFronteiraNotify(auroraFronteiraPlayer, auroraFronteiraFrom, auroraFronteiraTo) {
    const auroraFronteiraName = auroraFronteiraPlayer.profile.name
    const auroraFronteiraPersonal = 'Atenção: Você está ultrapassando uma fronteira!!'

    if (AURORA_FRONTEIRA_ANNOUNCE_TO_ALL) {
        const auroraFronteiraPlayers = auroraFronteiraPlayer.server.players
        for (var auroraFronteiraIdx = 0; auroraFronteiraIdx < auroraFronteiraPlayers.size(); auroraFronteiraIdx++) {
            const auroraFronteiraTarget = auroraFronteiraPlayers.get(auroraFronteiraIdx)
            if (auroraFronteiraTarget.profile.name === auroraFronteiraName) {
                auroraFronteiraSend(auroraFronteiraTarget, auroraFronteiraPersonal)
            } else {
                auroraFronteiraSend(auroraFronteiraTarget, 'Atenção: ' + auroraFronteiraName + ' está ultrapassando uma fronteira!!')
            }
        }
    } else {
        auroraFronteiraSend(auroraFronteiraPlayer, auroraFronteiraPersonal)
    }

    console.info('[aurora-fronteira] ' + auroraFronteiraName + ': ' + auroraFronteiraFrom + ' -> ' + auroraFronteiraTo)
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
        console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' saiu de ' + auroraFronteiraLastDomain)
        return
    }

    // Entrou em um domínio vindo de bioma comum: registra, sem aviso.
    if (auroraFronteiraLastDomain === '') {
        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraTick)
        console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
        return
    }

    // Trocou de domínio.
    const auroraFronteiraLastTick = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK)
    const auroraFronteiraWithinGrace = auroraFronteiraLastTick > 0 && auroraFronteiraTick - auroraFronteiraLastTick <= AURORA_FRONTEIRA_GRACE_TICKS

    auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_DOMAIN_TICK, auroraFronteiraTick)

    // Ficou tempo demais no bioma comum: conta como entrada, não como cruzamento.
    if (!auroraFronteiraWithinGrace) {
        console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ' entrou em ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
        return
    }

    // Cooldown: evita repetir o aviso quando o bioma oscila na borda.
    const auroraFronteiraLastMsg = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_MSG)
    if (auroraFronteiraLastMsg > 0 && auroraFronteiraTick - auroraFronteiraLastMsg < AURORA_FRONTEIRA_COOLDOWN_TICKS) return
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)

    auroraFronteiraNotify(auroraFronteiraPlayer, auroraFronteiraLastDomain, auroraFronteiraDomain)
})
