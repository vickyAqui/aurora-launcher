// Aviso pessoal de fronteira — só entre domínios do Aurora Mortis.
//
// Regra: o jogador recebe o aviso SOMENTE quando passa diretamente de um
// domínio do mod Aurora Mortis para outro domínio do mod (ex.: do domínio da
// nostalgia para o domínio da repetição). Entrar ou sair de um domínio vindo
// de um bioma vanilla/outro mod NÃO gera aviso (ex.: taiga -> repetição).
//
// Biomas que são variações do mesmo domínio contam como o mesmo domínio (ver
// AURORA_FRONTEIRA_DOMAIN_ALIASES), então andar entre eles não dispara aviso.
// Ex.: "Dominio do Pesadelo" e "Dominio de Olhos do Pesadelo" se intercalam no
// mundo; sem isso o jogador levaria aviso o tempo todo dentro do pesadelo.
//
// O aviso é pessoal: só quem cruzou recebe.
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
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 5  // checa a cada 0,25 s
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 60    // no máximo 1 aviso a cada 3 s

const AURORA_FRONTEIRA_NBT_LAST_DOMAIN = 'aurora_fronteira_last_domain'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'
const AURORA_FRONTEIRA_NBT_LAST_DIMENSION = 'aurora_fronteira_last_dimension'
const AURORA_FRONTEIRA_NBT_DIMENSION_PENDING_UNTIL = 'aurora_fronteira_dimension_pending_until'
const AURORA_FRONTEIRA_DIMENSION_GRACE_TICKS = 40 // 2 s para o bioma da dimensão destino aparecer

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

/** Grava o domínio atual sem avisar (login, saída para bioma comum, etc.) */
function auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain) {
    auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
}

function auroraFronteiraDimensionAt(auroraFronteiraPlayer) {
    return String(auroraFronteiraPlayer.level.dimension.location())
}

// Ao entrar no servidor, começa do domínio em que o jogador está, sem avisar
// (evita aviso falso quando ele loga já dentro de um domínio).
PlayerEvents.loggedIn(event => {
    const auroraFronteiraPlayer = event.player
    try {
        auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomainOf(auroraFronteiraBiomeIdAt(auroraFronteiraPlayer)))
        auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DIMENSION, auroraFronteiraDimensionAt(auroraFronteiraPlayer))
        auroraFronteiraPlayer.persistentData.putLong(AURORA_FRONTEIRA_NBT_DIMENSION_PENDING_UNTIL, 0)
    } catch (auroraFronteiraErr) {
        auroraFronteiraSetDomain(auroraFronteiraPlayer, '')
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
    const auroraFronteiraDimension = auroraFronteiraDimensionAt(auroraFronteiraPlayer)
    const auroraFronteiraLastDimension = auroraFronteiraData.getString(AURORA_FRONTEIRA_NBT_LAST_DIMENSION)

    // In a cross-dimension teleport, Minecraft can expose a temporary vanilla/empty biome
    // before the destination chunk is ready. Keep the source domain briefly so A -> B still
    // counts as a direct frontier crossing instead of being erased during that gap.
    // Players that were already online when this script was reloaded may not have the new
    // dimension marker yet. Initialize it before the equality early-return below.
    if (!auroraFronteiraLastDimension) {
        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DIMENSION, auroraFronteiraDimension)
    } else if (auroraFronteiraDimension !== auroraFronteiraLastDimension) {
        auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_DIMENSION, auroraFronteiraDimension)
        auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_DIMENSION_PENDING_UNTIL, auroraFronteiraTick + AURORA_FRONTEIRA_DIMENSION_GRACE_TICKS)
    }

    const auroraFronteiraDimensionPendingUntil = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_DIMENSION_PENDING_UNTIL)

    if (auroraFronteiraDomain === auroraFronteiraLastDomain) return

    console.info('[aurora-fronteira-check] ' + auroraFronteiraPlayer.profile.name + ': ' + (auroraFronteiraLastDomain || '<vazio>') + ' -> ' + (auroraFronteiraDomain || '<comum>') + ' (' + auroraFronteiraBiome + ', ' + auroraFronteiraDimension + ')')

    // Entrou/saiu de domínio passando por um bioma que não é domínio: só
    // registra o novo estado, sem aviso.
    if (auroraFronteiraDomain === '' || auroraFronteiraLastDomain === '') {
        if (auroraFronteiraDomain === '' && auroraFronteiraDimensionPendingUntil > auroraFronteiraTick) return
        auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain)
        return
    }

    // Cruzamento entre dois domínios diferentes.
    // Se o cooldown ainda estiver ativo, NÃO grava o domínio novo: a próxima
    // checagem tenta de novo, então nenhum cruzamento é perdido.
    const auroraFronteiraLastMsg = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_MSG)
    if (auroraFronteiraLastMsg > 0 && auroraFronteiraTick - auroraFronteiraLastMsg < AURORA_FRONTEIRA_COOLDOWN_TICKS) return

    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)
    auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain)

    // Só o jogador que cruzou recebe
    auroraFronteiraPlayer.tell(Text.darkRed('Atenção: Você está ultrapassando uma fronteira!!').bold())
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' + auroraFronteiraLastDomain + ' -> ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
})
