// Aviso de bioma do Aurora Mortis — visível SOMENTE para operadores.
//
// Quando um jogador entra em um bioma do mod Aurora Mortis (namespace
// "aurora_mortis"), os operadores online recebem uma mensagem com o nome do
// jogador, o bioma, as coordenadas e a dimensão. Biomas de outros mods e
// biomas vanilla são ignorados.
//
// Instalação: copie este arquivo para <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `aurora`.

const AURORA_BIOME_NAMESPACE = 'aurora_mortis' // só biomas deste mod
const AURORA_CHECK_EVERY_TICKS = 10            // checa a cada 0,5 s
const AURORA_COOLDOWN_TICKS = 600              // evita spam ao andar na borda do bioma (30 s)
const AURORA_ANNOUNCE_ON_JOIN = false          // true = avisa também quando o jogador loga já dentro do bioma

const AURORA_NBT_LAST_BIOME = 'aurora_last_biome'
const AURORA_NBT_LAST_MSG = 'aurora_last_biome_msg'

/** Id do bioma onde o jogador está, ex.: "aurora_mortis:dominio_do_caos" */
function auroraBiomeIdAt(auroraPlayerArg) {
    const auroraKey = auroraPlayerArg.level.getBiome(auroraPlayerArg.blockPosition()).unwrapKey()
    return auroraKey.isPresent() ? String(auroraKey.get().location()) : 'minecraft:the_void'
}

/** Dimensão do jogador, ex.: "minecraft:overworld" */
function auroraDimensionOf(auroraPlayerArg) {
    return String(auroraPlayerArg.level.dimension.location())
}

/** Envia a mensagem apenas para quem tem OP (nível 2+) */
function auroraTellOps(auroraPlayerArg, auroraMessage) {
    const auroraPlayers = auroraPlayerArg.server.players
    // `var` (e não `const`/`let`) porque o Rhino do KubeJS acusa
    // "redeclaration of var" quando um const é recriado a cada iteração.
    for (var auroraIdx = 0; auroraIdx < auroraPlayers.size(); auroraIdx++) {
        var auroraTarget = auroraPlayers.get(auroraIdx)
        if (auroraTarget.isOp()) auroraTarget.tell(auroraMessage)
    }
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

    // Primeira leitura (login): só registra a referência, sem anunciar
    if (!auroraLastBiome && !AURORA_ANNOUNCE_ON_JOIN) return

    // Só interessa bioma do mod
    if (!auroraBiomeId.startsWith(AURORA_BIOME_NAMESPACE + ':')) return

    // Cooldown para não floodar quando o jogador cruza a borda do bioma
    const auroraLastMsg = auroraData.getLong(AURORA_NBT_LAST_MSG)
    if (auroraLastMsg > 0 && auroraTick - auroraLastMsg < AURORA_COOLDOWN_TICKS) return
    auroraData.putLong(AURORA_NBT_LAST_MSG, auroraTick)

    const auroraX = Math.floor(auroraPlayer.x)
    const auroraY = Math.floor(auroraPlayer.y)
    const auroraZ = Math.floor(auroraPlayer.z)
    const auroraDim = auroraDimensionOf(auroraPlayer)
    const auroraName = auroraPlayer.profile.name

    const auroraMessage = Text.gold('[Aurora] ')
        .append(Text.white(auroraName))
        .append(Text.gray(' entrou no bioma '))
        .append(Text.aqua(Text.translate('biome.' + auroraBiomeId.replace(':', '.'))))
        .append(Text.darkGray(' (' + auroraBiomeId + ') '))
        .append(Text.gray('@ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' em ' + auroraDim))

    auroraTellOps(auroraPlayer, auroraMessage)
    console.info('[aurora] ' + auroraName + ' entrou em ' + auroraBiomeId + ' @ ' + auroraX + ' ' + auroraY + ' ' + auroraZ + ' (' + auroraDim + ')')
})
