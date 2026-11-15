// Aviso de bioma do Aurora Mortis — visível SOMENTE para operadores.
//
// Quando um jogador entra OU sai de um bioma do mod Aurora Mortis (namespace
// "aurora_mortis"), os operadores online recebem uma mensagem com o nome do
// jogador, o bioma, as coordenadas e a dimensão. Biomas de outros mods e
// biomas vanilla não geram aviso.
//
// Entrada: avisa sempre que o jogador passa a um bioma do mod.
// Saída:   avisa quando o jogador deixa um bioma do mod para um bioma que não
//          é do mod. Troca de um bioma do mod para outro bioma do mod conta só
//          como entrada (o aviso de travessia de domínio já cobre esse caso).
//
// Destinatários: operadores. A lista vem do próprio servidor
// (`getPlayerList().getOps().getUserList()`), a mesma carregada do ops.json no
// start e atualizada por /op e /deop, e o envio é feito um a um, por nome.
// Neste servidor (Arclight + LuckPerms) o seletor `@a[level=2..]` não enxerga
// todos os OPs, então ele fica só como último recurso. Também valem isOp() e
// AURORA_EXTRA_OPS.
//
// Instalação: copie este arquivo para <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `aurora`.

const AURORA_BIOME_NAMESPACE = 'aurora_mortis' // só biomas deste mod
const AURORA_CHECK_EVERY_TICKS = 10            // checa a cada 0,5 s
const AURORA_ENTER_COOLDOWN_TICKS = 600        // evita spam ao andar na borda do bioma (30 s)
const AURORA_EXIT_COOLDOWN_TICKS = 600         // idem, com contador separado
const AURORA_ANNOUNCE_ON_JOIN = false          // true = avisa também quando o jogador loga já dentro do bioma

// Operadores sem OP vanilla (por exemplo, staff só com LuckPerms) podem ser
// listados aqui pelo nome exato da conta.
const AURORA_EXTRA_OPS = []

const AURORA_NBT_LAST_BIOME = 'aurora_last_biome'
const AURORA_NBT_ENTER_MSG = 'aurora_last_biome_enter_msg'
const AURORA_NBT_EXIT_MSG = 'aurora_last_biome_exit_msg'

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
 * Nomes dos operadores segundo o próprio servidor, em minúsculas.
 *
 * `getPlayerList().getOps().getUserList()` devolve a lista carregada do
 * ops.json no start e atualizada por /op e /deop em memória — é a mesma lista
 * que o comando /op usa, então não precisa ler arquivo (o filtro de classes do
 * KubeJS bloqueia java.nio.file.Files) nem recarregar o script.
 */
function auroraServerOpNames(auroraServerArg) {
    var auroraNames = []
    try {
        var auroraKeys = auroraServerArg.getPlayerList().getOps().getUserList()
        for (var auroraIdx = 0; auroraIdx < auroraKeys.length; auroraIdx++) {
            auroraNames.push(String(auroraKeys[auroraIdx]).toLowerCase())
        }
    } catch (auroraErr) {
        console.warn('[aurora] nao consegui ler a lista de OPs do servidor: ' + auroraErr)
    }
    return auroraNames
}

/** true se o jogador é operador pela lista do servidor, pela lista extra ou por isOp(). */
function auroraIsStaff(auroraTargetArg, auroraOpNamesArg) {
    var auroraName = ''
    try {
        auroraName = String(auroraTargetArg.profile.name)
    } catch (auroraErr) {
        return false
    }
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
    const auroraPlayers = auroraServerArg.players

    for (var auroraIdx = 0; auroraIdx < auroraPlayers.size(); auroraIdx++) {
        var auroraTarget = auroraPlayers.get(auroraIdx)
        if (!auroraIsStaff(auroraTarget, auroraOpNames)) continue

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

PlayerEvents.tick(event => {
    const auroraPlayer = event.player
    const auroraTick = auroraPlayer.server.tickCount

    if (auroraTick % AURORA_CHECK_EVERY_TICKS !== 0) return

    const auroraBiomeId = auroraBiomeIdAt(auroraPlayer)
    const auroraData = auroraPlayer.persistentData
    const auroraLastBiome = auroraData.getString(AURORA_NBT_LAST_BIOME)

    if (auroraBiomeId === auroraLastBiome) return

    // Guarda o bioma atual antes de decidir se avisa
    auroraData.putString(AURORA_NBT_LAST_BIOME, auroraBiomeId)

    const auroraNowIsMod = auroraBiomeId.startsWith(AURORA_BIOME_NAMESPACE + ':')
    const auroraLastIsMod = auroraLastBiome.startsWith(AURORA_BIOME_NAMESPACE + ':')

    // Primeira leitura (login): só registra a referência, sem anunciar
    if (!auroraLastBiome) {
        if (!AURORA_ANNOUNCE_ON_JOIN || !auroraNowIsMod) return
    }

    const auroraX = Math.floor(auroraPlayer.x)
    const auroraY = Math.floor(auroraPlayer.y)
    const auroraZ = Math.floor(auroraPlayer.z)
    const auroraDim = auroraDimensionOf(auroraPlayer)
    const auroraName = auroraPlayer.profile.name

    // Saída de um bioma do mod para um bioma que não é do mod
    if (auroraLastIsMod && !auroraNowIsMod) {
        if (auroraCooldownAtivo(auroraData, AURORA_NBT_EXIT_MSG, auroraTick, AURORA_EXIT_COOLDOWN_TICKS)) return
        auroraData.putLong(AURORA_NBT_EXIT_MSG, auroraTick)

        const auroraExitJson = auroraBiomeJson(auroraName, 'saiu do', auroraLastBiome, auroraX, auroraY, auroraZ, auroraDim)
        const auroraExitPlain = '[Aurora] ' + auroraName + ' saiu do bioma ' + auroraLastBiome +
            ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ')'
        const auroraExitSent = auroraTellOps(auroraPlayer.server, auroraExitJson, auroraExitPlain)

        console.info('[aurora] ' + auroraName + ' saiu de ' + auroraLastBiome + ' -> ' + auroraBiomeId +
            ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ') ops=' + auroraExitSent.count +
            ' [' + auroraExitSent.names.join(',') + ']')
        return
    }

    // Só interessa bioma do mod
    if (!auroraNowIsMod) return

    // Cooldown para não floodar quando o jogador cruza a borda do bioma
    if (auroraCooldownAtivo(auroraData, AURORA_NBT_ENTER_MSG, auroraTick, AURORA_ENTER_COOLDOWN_TICKS)) return
    auroraData.putLong(AURORA_NBT_ENTER_MSG, auroraTick)

    const auroraEnterJson = auroraBiomeJson(auroraName, 'entrou no', auroraBiomeId, auroraX, auroraY, auroraZ, auroraDim)
    const auroraEnterPlain = '[Aurora] ' + auroraName + ' entrou no bioma ' + auroraBiomeId +
        ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ')'
    const auroraEnterSent = auroraTellOps(auroraPlayer.server, auroraEnterJson, auroraEnterPlain)

    console.info('[aurora] ' + auroraName + ' entrou em ' + auroraBiomeId +
        ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ') ops=' + auroraEnterSent.count +
        ' [' + auroraEnterSent.names.join(',') + ']')
})
