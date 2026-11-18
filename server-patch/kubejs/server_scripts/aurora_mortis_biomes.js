// Aviso de bioma do Aurora Mortis — visível SOMENTE para operadores.
//
// Quando um jogador troca de SUB-BIOMA dentro do mesmo domínio do mod Aurora
// Mortis (namespace "aurora_mortis"), os operadores online recebem uma mensagem
// com o nome do jogador, o bioma, as coordenadas e a dimensão.
//
// Entrada e saída de domínio NÃO são anunciadas aqui: quem faz isso (para os
// operadores) é aurora_mortis_fronteira.js. Antes os dois scripts anunciavam
// o mesmo cruzamento e o OP recebia quatro mensagens por evento — era o spam
// reclamado. Agora cada evento tem um único aviso.
//
// Biomas de outros mods e biomas vanilla não geram aviso.
//
// Destinatários: operadores. A lista principal vem de
// kubejs/config/aurora_ops.json (editável no painel, relida a cada aviso) e é
// complementada pelo ops.json do servidor (`getPlayerList().getOps()` lido com
// getName()/getId()), por isOp() e por AURORA_EXTRA_OPS. O envio é feito um a
// um, por nome. Neste servidor (Arclight + LuckPerms) o seletor
// `@a[level=2..]` não enxerga todos os OPs, então ele fica só como último
// recurso.
//
// Instalação: copie este arquivo para <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `aurora`.

const AURORA_BIOME_NAMESPACE = 'aurora_mortis' // só biomas deste mod
const AURORA_CHECK_EVERY_TICKS = 10            // checa a cada 0,5 s
const AURORA_ENTER_COOLDOWN_TICKS = 600        // evita spam ao andar na borda do sub-bioma (30 s)
const AURORA_ANNOUNCE_ON_JOIN = false          // true = avisa também quando o jogador loga já dentro do bioma

// Origem principal dos administradores: arquivo editável no painel, relido a
// cada aviso (não precisa dar /kubejs reload). As duas formas de path cobrem
// as versões do KubeJS que resolvem o caminho dentro ou fora de kubejs/.
const AURORA_OPS_CONFIG_PATHS = [
    'kubejs/config/aurora_ops.json',
    'config/aurora_ops.json'
]

// Operadores sem OP vanilla (por exemplo, staff só com LuckPerms) podem ser
// listados aqui pelo nome exato da conta. O JSON é a forma preferida.
const AURORA_EXTRA_OPS = []

var auroraOpsConfigWarned = false

const AURORA_NBT_LAST_BIOME = 'aurora_last_biome'
const AURORA_NBT_ENTER_MSG = 'aurora_last_biome_enter_msg'

// Variações de bioma que pertencem ao mesmo domínio (mesma tabela do
// aurora_mortis_fronteira.js). Serve para saber quando a troca de bioma é
// apenas um sub-bioma dentro do domínio e quando é uma fronteira de verdade.
const AURORA_DOMAIN_ALIASES = {
    'ilusao_sem_radicao': 'ilusao',
    'rubro': 'repeticao',
    'dominio_de_olhos_do_pesadelo': 'pesadelo'
}

/** Id do bioma onde o jogador está, ex.: "aurora_mortis:dominio_do_caos" */
function auroraBiomeIdAt(auroraPlayerArg) {
    const auroraKey = auroraPlayerArg.level.getBiome(auroraPlayerArg.blockPosition()).unwrapKey()
    return auroraKey.isPresent() ? String(auroraKey.get().location()) : 'minecraft:the_void'
}

/** Dimensão do jogador, ex.: "minecraft:overworld" */
function auroraDimensionOf(auroraPlayerArg) {
    return String(auroraPlayerArg.level.dimension.location())
}

/**
 * Domínio do bioma, ou '' se o bioma não for do mod.
 * Ex.: "aurora_mortis:dominio_da_nostalgia" -> "nostalgia"
 */
function auroraDomainOf(auroraBiomeIdArg) {
    if (!auroraBiomeIdArg.startsWith(AURORA_BIOME_NAMESPACE + ':')) return ''

    const auroraPath = auroraBiomeIdArg.substring(AURORA_BIOME_NAMESPACE.length + 1)
    const auroraAlias = AURORA_DOMAIN_ALIASES[auroraPath]
    if (auroraAlias) return auroraAlias

    return auroraPath.replace(/^dominio_(da|do|de)_/, '')
}

/**
 * Cooldown baseado em tick do servidor.
 *
 * O tickCount reinicia quando o servidor é reiniciado, mas o valor salvo no NBT
 * do jogador não. Um valor salvo maior que o tick atual é resto de uma sessão
 * anterior: nesse caso o cooldown é considerado expirado e o valor é zerado.
 * Sem isso a conta fica negativa e o aviso é descartado para sempre.
 */
function auroraCooldownAtivo(auroraDataArg, auroraKeyArg, auroraTickArg, auroraCooldownArg) {
    const auroraLast = auroraDataArg.getLong(auroraKeyArg)
    if (auroraLast <= 0) return false
    if (auroraLast > auroraTickArg) {
        auroraDataArg.putLong(auroraKeyArg, 0)
        return false
    }
    return auroraTickArg - auroraLast < auroraCooldownArg
}

/**
 * Lê kubejs/config/aurora_ops.json via JsonIO do KubeJS.
 * Tentamos os dois caminhos porque a resolução muda entre versões do KubeJS.
 */
function auroraReadOpsConfig() {
    for (var auroraIdx = 0; auroraIdx < AURORA_OPS_CONFIG_PATHS.length; auroraIdx++) {
        try {
            const auroraJson = JsonIO.read(AURORA_OPS_CONFIG_PATHS[auroraIdx])
            if (auroraJson) return auroraJson
        } catch (auroraErr) {
            // tenta o próximo caminho
        }
    }
    if (!auroraOpsConfigWarned) {
        auroraOpsConfigWarned = true
        console.warn('[aurora] nao consegui ler kubejs/config/aurora_ops.json; usando ops.json/isOp()')
    }
    return null
}

/** Normaliza "operators" do JSON em [{ name, uuid }], aceitando string ou objeto. */
function auroraConfigEntries(auroraConfig) {
    var auroraEntries = []
    if (!auroraConfig) return auroraEntries

    var auroraList = null
    try {
        auroraList = auroraConfig.operators
    } catch (auroraErr) {
        auroraList = null
    }
    if (!auroraList) {
        try {
            auroraList = auroraConfig.get('operators')
        } catch (auroraErrGet) {
            auroraList = null
        }
    }
    if (!auroraList) return auroraEntries

    var auroraLen = 0
    try {
        auroraLen = auroraList.length
    } catch (auroraErr2) {
        auroraLen = 0
    }
    if (!auroraLen && typeof auroraList.size === 'function') auroraLen = auroraList.size()

    for (var auroraIdx2 = 0; auroraIdx2 < auroraLen; auroraIdx2++) {
        var auroraItem = auroraList[auroraIdx2]
        if (auroraItem === undefined || auroraItem === null) {
            if (typeof auroraList.get === 'function') auroraItem = auroraList.get(auroraIdx2)
        }
        if (typeof auroraItem === 'string') {
            auroraEntries.push({ name: auroraItem.toLowerCase(), uuid: '' })
            continue
        }
        if (!auroraItem) continue

        var auroraNameEntry = ''
        var auroraUuidEntry = ''
        try {
            if (auroraItem.name) auroraNameEntry = String(auroraItem.name)
        } catch (auroraErr3) {
            // sem nome
        }
        try {
            if (auroraItem.uuid) auroraUuidEntry = String(auroraItem.uuid)
        } catch (auroraErr4) {
            // sem uuid
        }
        if (auroraNameEntry || auroraUuidEntry) {
            auroraEntries.push({ name: auroraNameEntry.toLowerCase(), uuid: auroraUuidEntry.toLowerCase() })
        }
    }
    return auroraEntries
}

/**
 * Nome de um GameProfile. String(gameProfile) NÃO devolve só o nome (devolve
 * algo como "GameProfile{id=..., name=...}"), por isso getName() vem primeiro.
 */
function auroraProfileName(auroraProfile) {
    try {
        const auroraNameFromApi = auroraProfile.getName()
        if (auroraNameFromApi) return String(auroraNameFromApi)
    } catch (auroraErr) {
        // tenta campo abaixo
    }
    try {
        if (auroraProfile.name) return String(auroraProfile.name)
    } catch (auroraErr2) {
        // tenta string abaixo
    }
    const auroraText = String(auroraProfile)
    const auroraMatch = /name=([^,}]+)/.exec(auroraText)
    return auroraMatch ? auroraMatch[1].trim() : auroraText
}

/** UUID do GameProfile, também usado para reconhecer admin que trocou de nome. */
function auroraProfileUuid(auroraProfile) {
    try {
        const auroraId = auroraProfile.getId()
        if (auroraId) return String(auroraId).toLowerCase()
    } catch (auroraErr) {
        // tenta campo abaixo
    }
    try {
        if (auroraProfile.id) return String(auroraProfile.id).toLowerCase()
    } catch (auroraErr2) {
        // sem uuid
    }
    return ''
}

function auroraConfigHas(auroraEntries, auroraName, auroraUuid) {
    const auroraLower = String(auroraName).toLowerCase()
    const auroraUuidLower = String(auroraUuid || '').toLowerCase()
    for (var auroraIdx3 = 0; auroraIdx3 < auroraEntries.length; auroraIdx3++) {
        const auroraEntry = auroraEntries[auroraIdx3]
        if (auroraEntry.name === auroraLower) return true
        if (auroraUuidLower && auroraEntry.uuid === auroraUuidLower) return true
    }
    return false
}

/**
 * Nomes dos operadores segundo o próprio servidor, em minúsculas.
 * Agora usando getName()/getId() do GameProfile, não String() direto.
 */
function auroraServerOpNames(auroraServerArg) {
    var auroraNames = []
    try {
        var auroraKeys = auroraServerArg.getPlayerList().getOps().getUserList()
        for (var auroraIdx4 = 0; auroraIdx4 < auroraKeys.length; auroraIdx4++) {
            const auroraProfile = auroraKeys[auroraIdx4]
            const auroraNameFromOps = auroraProfileName(auroraProfile)
            if (auroraNameFromOps) auroraNames.push(auroraNameFromOps.toLowerCase())
        }
    } catch (auroraErr5) {
        console.warn('[aurora] nao consegui ler a lista de OPs do servidor: ' + auroraErr5)
    }
    return auroraNames
}

/** true se o jogador está no JSON, no ops.json, na lista extra ou é isOp(). */
function auroraIsStaff(auroraTargetArg, auroraOpNamesArg, auroraConfigEntriesArg) {
    var auroraName = ''
    try {
        auroraName = String(auroraTargetArg.profile.name)
    } catch (auroraErr) {
        return false
    }
    if (auroraConfigHas(auroraConfigEntriesArg, auroraName, auroraProfileUuid(auroraTargetArg.profile))) return true
    if (AURORA_EXTRA_OPS.indexOf(auroraName) >= 0) return true
    if (auroraOpNamesArg.indexOf(auroraName.toLowerCase()) >= 0) return true
    try {
        return auroraTargetArg.isOp() === true
    } catch (auroraErr2) {
        return false
    }
}

/**
 * Envia um JSON de tellraw para todos os operadores online, um a um.
 * Retorna { count, names } para o log de diagnóstico.
 */
function auroraTellOps(auroraServerArg, auroraJsonArg, auroraPlainArg) {
    var auroraSent = 0
    var auroraSentNames = []
    const auroraOpNames = auroraServerOpNames(auroraServerArg)
    const auroraOpsFromConfig = auroraConfigEntries(auroraReadOpsConfig())
    const auroraPlayers = auroraServerArg.players

    for (var auroraIdx = 0; auroraIdx < auroraPlayers.size(); auroraIdx++) {
        var auroraTarget = auroraPlayers.get(auroraIdx)
        if (!auroraIsStaff(auroraTarget, auroraOpNames, auroraOpsFromConfig)) continue

        var auroraOk = false
        try {
            auroraOk = auroraServerArg.runCommandSilent(
                'tellraw ' + auroraTarget.profile.name + ' ' + auroraJsonArg
            ) > 0
        } catch (auroraErr) {
            auroraOk = false
        }
        if (!auroraOk) {
            try {
                auroraTarget.tell(auroraPlainArg)
            } catch (auroraErr2) {
                // sem outro caminho de envio
            }
        }
        auroraSent++
        auroraSentNames.push(auroraTarget.profile.name)
    }

    // Nenhum OP reconhecido (ops.json ilegível?): última tentativa pelo seletor.
    if (auroraSent === 0) {
        try {
            auroraSent = auroraServerArg.runCommandSilent('tellraw @a[level=2..] ' + auroraJsonArg)
        } catch (auroraErr3) {
            auroraSent = 0
        }
    }

    return { count: auroraSent, names: auroraSentNames }
}

/** JSON do aviso: [Aurora] Nome <verbo> bioma <id> @ x y z (dim) */
function auroraBiomeJson(auroraNameArg, auroraVerbArg, auroraBiomeIdArg, auroraXArg, auroraYArg, auroraZArg, auroraDimArg) {
    return JSON.stringify([
        { text: '[Aurora] ', color: 'gold' },
        { text: auroraNameArg, color: 'white' },
        { text: ' ' + auroraVerbArg + ' bioma ', color: 'gray' },
        { text: auroraBiomeIdArg, color: 'aqua' },
        { text: ' @ ' + auroraXArg + ' ' + auroraYArg + ' ' + auroraZArg + ' (' + auroraDimArg + ')', color: 'dark_gray' }
    ])
}

// Ao entrar no servidor, esquece o último bioma da sessão anterior. Sem isso o
// valor salvo no NBT (ex.: dominio_da_realidade) mascara o evento quando o
// jogador reloga em outro lugar e volta: o script acha que ele nunca saiu e
// deixa de avisar. O primeiro tick depois do login só registra o bioma atual,
// sem anunciar.
PlayerEvents.loggedIn(event => {
    try {
        event.player.persistentData.putString(AURORA_NBT_LAST_BIOME, '')
    } catch (auroraErr) {
        console.error('[aurora] ERRO ao resetar bioma no login: ' + auroraErr)
    }
})

PlayerEvents.tick(event => {
    const auroraPlayer = event.player
    const auroraTick = auroraPlayer.server.tickCount

    if (auroraTick % AURORA_CHECK_EVERY_TICKS !== 0) return

    try {
        auroraBiomeCheck(auroraPlayer, auroraTick)
    } catch (auroraErr) {
        console.error('[aurora] ERRO em ' + auroraPlayer.profile.name + ': ' + auroraErr)
    }
})

function auroraBiomeCheck(auroraPlayer, auroraTick) {
    const auroraBiomeId = auroraBiomeIdAt(auroraPlayer)
    const auroraData = auroraPlayer.persistentData
    const auroraLastBiome = auroraData.getString(AURORA_NBT_LAST_BIOME)

    if (auroraBiomeId === auroraLastBiome) return

    // Guarda o bioma atual antes de decidir se avisa
    auroraData.putString(AURORA_NBT_LAST_BIOME, auroraBiomeId)

    const auroraNowIsMod = auroraBiomeId.startsWith(AURORA_BIOME_NAMESPACE + ':')

    // Primeira leitura (login): só registra a referência, sem anunciar
    if (!auroraLastBiome) {
        if (!AURORA_ANNOUNCE_ON_JOIN || !auroraNowIsMod) return
    }

    const auroraName = auroraPlayer.profile.name

    // Troca de domínio é fronteira: quem anuncia no chat é
    // aurora_mortis_fronteira.js (para todos, inclusive OPs). Aqui só registra
    // no console, senão o OP recebe dois avisos para o mesmo cruzamento.
    if (auroraDomainOf(auroraBiomeId) !== auroraDomainOf(auroraLastBiome)) {
        console.info('[aurora] ' + auroraName + ' mudou de dominio: ' + auroraLastBiome + ' -> ' +
            auroraBiomeId + ' (aviso pelo aurora_mortis_fronteira.js)')
        return
    }

    // Só interessa bioma do mod (variação de sub-bioma dentro do domínio)
    if (!auroraNowIsMod) return

    // Cooldown para não floodar quando o jogador cruza a borda do sub-bioma
    if (auroraCooldownAtivo(auroraData, AURORA_NBT_ENTER_MSG, auroraTick, AURORA_ENTER_COOLDOWN_TICKS)) return
    auroraData.putLong(AURORA_NBT_ENTER_MSG, auroraTick)

    const auroraX = Math.floor(auroraPlayer.x)
    const auroraY = Math.floor(auroraPlayer.y)
    const auroraZ = Math.floor(auroraPlayer.z)
    const auroraDim = auroraDimensionOf(auroraPlayer)

    const auroraEnterJson = auroraBiomeJson(auroraName, 'entrou no', auroraBiomeId, auroraX, auroraY, auroraZ, auroraDim)
    const auroraEnterPlain = '[Aurora] ' + auroraName + ' entrou no bioma ' + auroraBiomeId +
        ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ')'
    const auroraEnterSent = auroraTellOps(auroraPlayer.server, auroraEnterJson, auroraEnterPlain)

    console.info('[aurora] ' + auroraName + ' entrou em ' + auroraBiomeId +
        ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ') ops=' + auroraEnterSent.count +
        ' [' + auroraEnterSent.names.join(',') + ']')
}
