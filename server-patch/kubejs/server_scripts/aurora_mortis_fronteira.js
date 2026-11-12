// Aviso pessoal de fronteira — só para o jogador que cruzou.
//
// Quando o jogador entra ou sai de um bioma do mod Aurora Mortis (namespace
// "aurora_mortis"), ele mesmo recebe:
//   "Atenção: Você está ultrapassando uma fronteira!!"
//
// Também vale para a passagem entre dois biomas do mod (ex.: do domínio da
// criatividade para o domínio do caos). Biomas vanilla e de outros mods não
// geram aviso por si só.
//
// Este script é independente de aurora_mortis_biomes.js (que avisa os OPs).
// Ele usa chaves de NBT próprias, então os dois podem rodar juntos sem
// interferência.
//
// Instalação: <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `auroraFronteira`/`AURORA_FRONTEIRA_`.

const AURORA_FRONTEIRA_NAMESPACE = 'aurora_mortis'
const AURORA_FRONTEIRA_CHECK_EVERY_TICKS = 10 // checa a cada 0,5 s
const AURORA_FRONTEIRA_COOLDOWN_TICKS = 60    // evita spam ao andar na borda (3 s)

const AURORA_FRONTEIRA_NBT_LAST_BIOME = 'aurora_fronteira_last_biome'
const AURORA_FRONTEIRA_NBT_LAST_MSG = 'aurora_fronteira_last_msg'

/** Id do bioma onde o jogador está, ex.: "aurora_mortis:dominio_do_caos" */
function auroraFronteiraBiomeIdAt(auroraFronteiraPlayer) {
    const auroraFronteiraKey = auroraFronteiraPlayer.level.getBiome(auroraFronteiraPlayer.blockPosition()).unwrapKey()
    return auroraFronteiraKey.isPresent() ? String(auroraFronteiraKey.get().location()) : 'minecraft:the_void'
}

/** true se o id do bioma pertence ao mod Aurora Mortis */
function auroraFronteiraIsModBiome(auroraFronteiraBiomeId) {
    return auroraFronteiraBiomeId.startsWith(AURORA_FRONTEIRA_NAMESPACE + ':')
}

PlayerEvents.tick(event => {
    const auroraFronteiraPlayer = event.player
    const auroraFronteiraTick = auroraFronteiraPlayer.server.tickCount

    if (auroraFronteiraTick % AURORA_FRONTEIRA_CHECK_EVERY_TICKS !== 0) return

    const auroraFronteiraBiome = auroraFronteiraBiomeIdAt(auroraFronteiraPlayer)
    const auroraFronteiraData = auroraFronteiraPlayer.persistentData
    const auroraFronteiraLast = auroraFronteiraData.getString(AURORA_FRONTEIRA_NBT_LAST_BIOME)

    if (auroraFronteiraBiome === auroraFronteiraLast) return

    // Guarda o bioma atual antes de decidir se avisa
    auroraFronteiraData.putString(AURORA_FRONTEIRA_NBT_LAST_BIOME, auroraFronteiraBiome)

    // Primeira leitura (login): só registra a referência, sem anunciar
    if (!auroraFronteiraLast) return

    // A fronteira só interessa se pelo menos um dos lados é bioma do mod
    if (!auroraFronteiraIsModBiome(auroraFronteiraBiome) && !auroraFronteiraIsModBiome(auroraFronteiraLast)) return

    // Cooldown para não floodar quando o jogador cruza a borda várias vezes
    const auroraFronteiraLastMsg = auroraFronteiraData.getLong(AURORA_FRONTEIRA_NBT_LAST_MSG)
    if (auroraFronteiraLastMsg > 0 && auroraFronteiraTick - auroraFronteiraLastMsg < AURORA_FRONTEIRA_COOLDOWN_TICKS) return
    auroraFronteiraData.putLong(AURORA_FRONTEIRA_NBT_LAST_MSG, auroraFronteiraTick)

    // Só o jogador que cruzou recebe
    auroraFronteiraPlayer.tell(Text.darkRed('Atenção: Você está ultrapassando uma fronteira!!').bold())
    console.info('[aurora-fronteira] ' + auroraFronteiraPlayer.profile.name + ': ' + auroraFronteiraLast + ' -> ' + auroraFronteiraBiome)
})
