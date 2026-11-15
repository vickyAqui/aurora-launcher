// Aviso pessoal de fronteira ÔÇö s├│ entre dom├¡nios do Aurora Mortis.
//
// Regra: o jogador recebe o aviso SOMENTE quando passa diretamente de um
// dom├¡nio do mod Aurora Mortis para outro dom├¡nio do mod (ex.: do dom├¡nio da
// nostalgia para o dom├¡nio da repeti├º├úo). Entrar ou sair de um dom├¡nio vindo
// de um bioma vanilla/outro mod N├âO gera aviso (ex.: taiga -> repeti├º├úo).
//
// Biomas que s├úo varia├º├Áes do mesmo dom├¡nio contam como o mesmo dom├¡nio (ver
// AURORA_FRONTEIRA_DOMAIN_ALIASES), ent├úo andar entre eles n├úo dispara aviso.
// Ex.: "Dominio do Pesadelo" e "Dominio de Olhos do Pesadelo" se intercalam no
// mundo; sem isso o jogador levaria aviso o tempo todo dentro do pesadelo.
//
// O aviso ├® pessoal: s├│ quem cruzou recebe.
//
// Este script ├® independente de aurora_mortis_biomes.js (que avisa os OPs).
//
// Instala├º├úo: <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraFronteira`/`AURORA_FRONTEIRA_`.

const AURORA_FRONTEIRA_NAMESPACE = 'aurora_mortis'
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 5  // checa a cada 0,25 s
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 60    // no m├íximo 1 aviso a cada 3 s

const AURORA_FRONTEIRA_NBT_LAST_DOMAIN = 'aurora_fronteira_last_domain'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'

// Varia├º├Áes de bioma que pertencem ao mesmo dom├¡nio.
// As chaves s├úo o "path" do bioma (sem o namespace "aurora_mortis:").
const AURORA_FRONTEIRA_DOMAIN_ALIASES = {
    'ilusao_sem_radicao': 'ilusao',
    'rubro': 'repeticao',
    'dominio_de_olhos_do_pesadelo': 'pesadelo'
}

/** Id do bioma onde o jogador est├í, ex.: "aurora_mortis:dominio_do_caos" */
function auroraFronteiraBiomeIdAt(auroraFronteiraPlayer) {
    const auroraFronteiraKey = auroraFronteiraPlayer.level.getBiome(auroraFronteiraPlayer.blockPosition()).unwrapKey()
    return auroraFronteiraKey.isPresent() ? String(auroraFronteiraKey.get().location()) : 'minecraft:the_void'
}

/**
 * Dom├¡nio do bioma, ou '' se o bioma n├úo for do mod.
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

/** Grava o dom├¡nio atual sem avisar (login, sa├¡da para bioma comum, etc.) */
function auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain) {
    auroraFronteiraPlayer.persistentData.putString(AURORA_FRONTEIRA_NBT_LAST_DOMAIN, auroraFronteiraDomain)
}

// Ao entrar no servidor, come├ºa do dom├¡nio em que o jogador est├í, sem avisar
// (evita aviso falso quando ele loga j├í dentro de um dom├¡nio).
PlayerEvents.loggedIn(event => {
    const auroraFronteiraPlayer = event.player
    try {
        auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomainOf(auroraFronteiraBiomeIdAt(auroraFronteiraPlayer)))
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

    if (auroraFronteiraDomain === auroraFronteiraLastDomain) return

    // Entrou/saiu de dom├¡nio passando por um bioma que n├úo ├® dom├¡nio: s├│
    // registra o novo estado, sem aviso.
    if (auroraFronteiraDomain === '' || auroraFronteiraLastDomain === '') {
        auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain)
        return
    }

    // Cruzamento entre dois dom├¡nios diferentes.
    // Se o cooldown ainda estiver ativo, N├âO grava o dom├¡nio novo: a pr├│xima
    // checagem tenta de novo, ent├úo nenhum cruzamento ├® perdido.
    const auroraFronteiraLastMsg = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_MSG)
    if (auroraFronteiraLastMsg > 0 && auroraFronteiraTick - auroraFronteiraLastMsg < AURORA_FRONTEIRA_COOLDOWN_TICKS) return

    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)
    auroraFronteiraSetDomain(auroraFronteiraPlayer, auroraFronteiraDomain)

    // S├│ o jogador que cruzou recebe
    auroraFronteiraPlayer.tell(Text.darkRed('Aten├º├úo: Voc├¬ est├í ultrapassando uma fronteira!!').bold())
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' + auroraFronteiraLastDomain + ' -> ' + auroraFronteiraDomain + ' (' + auroraFronteiraBiome + ')')
})
