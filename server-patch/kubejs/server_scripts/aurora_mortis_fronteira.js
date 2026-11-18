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
// Destinatários: kubejs/config/aurora_ops.json é a fonte principal; ops.json,
// isOp() e AURORA_FRONTEIRA_EXTRA_OPS complementam. O JSON é relido a cada
// aviso, então alterá-lo no painel não exige recarregar o script.
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

// Origem principal dos administradores: arquivo editável no painel, relido a
// cada aviso (não precisa dar /kubejs reload). As duas formas de path cobrem
// as versões do KubeJS que resolvem o caminho dentro ou fora de kubejs/.
const AURORA_FRONTEIRA_OPS_CONFIG_PATHS = [
    'kubejs/config/aurora_ops.json',
    'config/aurora_ops.json'
]

// Operadores sem OP vanilla (por exemplo, staff só com LuckPerms) podem ser
// listados aqui pelo nome exato da conta. O JSON é a forma preferida.
const AURORA_FRONTEIRA_EXTRA_OPS = []

var auroraFronteiraOpsConfigWarned = false

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
 * Lê kubejs/config/aurora_ops.json via JsonIO do KubeJS.
 * Tentamos os dois caminhos porque a resolução muda entre versões do KubeJS.
 */
function auroraFronteiraReadOpsConfig() {
    for (var auroraFronteiraIdx = 0; auroraFronteiraIdx < AURORA_FRONTEIRA_OPS_CONFIG_PATHS.length; auroraFronteiraIdx++) {
        try {
            const auroraFronteiraJson = JsonIO.read(AURORA_FRONTEIRA_OPS_CONFIG_PATHS[auroraFronteiraIdx])
            if (auroraFronteiraJson) return auroraFronteiraJson
        } catch (auroraFronteiraErr) {
            // tenta o próximo caminho
        }
    }
    if (!auroraFronteiraOpsConfigWarned) {
        auroraFronteiraOpsConfigWarned = true
        console.warn('[aurora-fronteira] nao consegui ler kubejs/config/aurora_ops.json; usando ops.json/isOp()')
    }
    return null
}

/** Normaliza "operators" do JSON em [{ name, uuid }], aceitando string ou objeto. */
function auroraFronteiraConfigEntries(auroraFronteiraConfig) {
    var auroraFronteiraEntries = []
    if (!auroraFronteiraConfig) return auroraFronteiraEntries

    var auroraFronteiraList = null
    try {
        auroraFronteiraList = auroraFronteiraConfig.operators
    } catch (auroraFronteiraErr) {
        auroraFronteiraList = null
    }
    if (!auroraFronteiraList) {
        try {
            auroraFronteiraList = auroraFronteiraConfig.get('operators')
        } catch (auroraFronteiraErrGet) {
            auroraFronteiraList = null
        }
    }
    if (!auroraFronteiraList) return auroraFronteiraEntries

    var auroraFronteiraLen = 0
    try {
        auroraFronteiraLen = auroraFronteiraList.length
    } catch (auroraFronteiraErr2) {
        auroraFronteiraLen = 0
    }
    if (!auroraFronteiraLen && typeof auroraFronteiraList.size === 'function') {
        auroraFronteiraLen = auroraFronteiraList.size()
    }

    for (var auroraFronteiraIdx2 = 0; auroraFronteiraIdx2 < auroraFronteiraLen; auroraFronteiraIdx2++) {
        var auroraFronteiraItem = auroraFronteiraList[auroraFronteiraIdx2]
        if (auroraFronteiraItem === undefined || auroraFronteiraItem === null) {
            if (typeof auroraFronteiraList.get === 'function') auroraFronteiraItem = auroraFronteiraList.get(auroraFronteiraIdx2)
        }
        if (typeof auroraFronteiraItem === 'string') {
            auroraFronteiraEntries.push({ name: auroraFronteiraItem.toLowerCase(), uuid: '' })
            continue
        }
        if (!auroraFronteiraItem) continue

        var auroraFronteiraName = ''
        var auroraFronteiraUuid = ''
        try {
            if (auroraFronteiraItem.name) auroraFronteiraName = String(auroraFronteiraItem.name)
        } catch (auroraFronteiraErr3) {
            // sem nome
        }
        try {
            if (auroraFronteiraItem.uuid) auroraFronteiraUuid = String(auroraFronteiraItem.uuid)
        } catch (auroraFronteiraErr4) {
            // sem uuid
        }
        if (auroraFronteiraName || auroraFronteiraUuid) {
            auroraFronteiraEntries.push({ name: auroraFronteiraName.toLowerCase(), uuid: auroraFronteiraUuid.toLowerCase() })
        }
    }
    return auroraFronteiraEntries
}

/**
 * Nome de um GameProfile. String(gameProfile) NÃO devolve só o nome (devolve
 * algo como "GameProfile{id=..., name=...}"), por isso getName() vem primeiro.
 */
function auroraFronteiraProfileName(auroraFronteiraProfile) {
    try {
        const auroraFronteiraName = auroraFronteiraProfile.getName()
        if (auroraFronteiraName) return String(auroraFronteiraName)
    } catch (auroraFronteiraErr) {
        // tenta campo abaixo
    }
    try {
        if (auroraFronteiraProfile.name) return String(auroraFronteiraProfile.name)
    } catch (auroraFronteiraErr2) {
        // tenta string abaixo
    }
    const auroraFronteiraText = String(auroraFronteiraProfile)
    const auroraFronteiraMatch = /name=([^,}]+)/.exec(auroraFronteiraText)
    return auroraFronteiraMatch ? auroraFronteiraMatch[1].trim() : auroraFronteiraText
}

/** UUID do GameProfile, também usado para reconhecer admin que trocou de nome. */
function auroraFronteiraProfileUuid(auroraFronteiraProfile) {
    try {
        const auroraFronteiraId = auroraFronteiraProfile.getId()
        if (auroraFronteiraId) return String(auroraFronteiraId).toLowerCase()
    } catch (auroraFronteiraErr) {
        // tenta campo abaixo
    }
    try {
        if (auroraFronteiraProfile.id) return String(auroraFronteiraProfile.id).toLowerCase()
    } catch (auroraFronteiraErr2) {
        // sem uuid
    }
    return ''
}

function auroraFronteiraConfigHas(auroraFronteiraEntries, auroraFronteiraName, auroraFronteiraUuid) {
    const auroraFronteiraLower = String(auroraFronteiraName).toLowerCase()
    const auroraFronteiraUuidLower = String(auroraFronteiraUuid || '').toLowerCase()
    for (var auroraFronteiraIdx3 = 0; auroraFronteiraIdx3 < auroraFronteiraEntries.length; auroraFronteiraIdx3++) {
        const auroraFronteiraEntry = auroraFronteiraEntries[auroraFronteiraIdx3]
        if (auroraFronteiraEntry.name === auroraFronteiraLower) return true
        if (auroraFronteiraUuidLower && auroraFronteiraEntry.uuid === auroraFronteiraUuidLower) return true
    }
    return false
}

/**
 * Nomes dos operadores segundo o próprio servidor, em minúsculas.
 * Agora usando getName()/getId() do GameProfile, não String() direto.
 */
function auroraFronteiraServerOpNames(auroraFronteiraServer) {
    var auroraFronteiraNames = []
    try {
        var auroraFronteiraKeys = auroraFronteiraServer.getPlayerList().getOps().getUserList()
        for (var auroraFronteiraIdx4 = 0; auroraFronteiraIdx4 < auroraFronteiraKeys.length; auroraFronteiraIdx4++) {
            const auroraFronteiraProfile = auroraFronteiraKeys[auroraFronteiraIdx4]
            const auroraFronteiraName = auroraFronteiraProfileName(auroraFronteiraProfile)
            if (auroraFronteiraName) auroraFronteiraNames.push(auroraFronteiraName.toLowerCase())
        }
    } catch (auroraFronteiraErr5) {
        console.warn('[aurora-fronteira] nao consegui ler a lista de OPs do servidor: ' + auroraFronteiraErr5)
    }
    return auroraFronteiraNames
}

/** true se o jogador está no JSON, no ops.json, na lista extra ou é isOp(). */
function auroraFronteiraIsStaff(auroraFronteiraTarget, auroraFronteiraOpNames, auroraFronteiraConfigEntriesArg) {
    var auroraFronteiraName = ''
    try {
        auroraFronteiraName = String(auroraFronteiraTarget.profile.name)
    } catch (auroraFronteiraErr) {
        return false
    }
    const auroraFronteiraUuid = auroraFronteiraProfileUuid(auroraFronteiraTarget.profile)
    if (auroraFronteiraConfigHas(auroraFronteiraConfigEntriesArg, auroraFronteiraName, auroraFronteiraUuid)) return true
    if (AURORA_FRONTEIRA_EXTRA_OPS.indexOf(auroraFronteiraName) >= 0) return true
    if (auroraFronteiraOpNames.indexOf(auroraFronteiraName.toLowerCase()) >= 0) return true
    // Em algumas versões getUserList() devolve UUIDs em vez de nomes.
    if (auroraFronteiraUuid && auroraFronteiraOpNames.indexOf(auroraFronteiraUuid) >= 0) return true
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
    const auroraFronteiraOpsFromConfig = auroraFronteiraConfigEntries(auroraFronteiraReadOpsConfig())
    const auroraFronteiraPlayers = auroraFronteiraServer.players

    for (var auroraFronteiraIdx2 = 0; auroraFronteiraIdx2 < auroraFronteiraPlayers.size(); auroraFronteiraIdx2++) {
        var auroraFronteiraTarget = auroraFronteiraPlayers.get(auroraFronteiraIdx2)
        if (!auroraFronteiraIsStaff(auroraFronteiraTarget, auroraFronteiraOpNames, auroraFronteiraOpsFromConfig)) continue
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
