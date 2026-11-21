// Dano no bioma Crawler Nest (mod The Deep Void).
//
// Enquanto o jogador estiver em "the_deep_void:crawler_nest" ele perde 2
// corações (4 pontos de vida) a cada 2 segundos. O primeiro dano acontece no
// exato tick em que ele entra no bioma; se sair e voltar, o contador zera e ele
// leva o dano de entrada novamente.
//
// O dano é aplicado diretamente na vida com setHealth(). Ele não passa pelo
// sistema de dano vanilla, portanto ignora armadura, encantamentos de proteção,
// resistência, absorção, invulnerabilidade (i-frames) e escudo.
// Não existe imunidade de 0,5 s entre os danos: o intervalo é controlado só
// pelo contador deste script (40 ticks = 2 s).
// Jogadores em criativo ou espectador ficam de fora (o dano fica feio e não
// faz sentido pra quem não está sobrevivendo).
//
// Comando de controle (somente OP, nivel 2):
//   /auroracrawler on     - liga o dano
//   /auroracrawler off    - desliga o dano
//   /auroracrawler status - mostra o estado atual
// O estado fica salvo no NBT do servidor e sobrevive a reload/restart.
// O comando funciona já após /kubejs reload server_scripts, sem reiniciar.
//
// Instalação: copie este arquivo para <servidor>/kubejs/server_scripts/
// Aplicar sem reiniciar: /kubejs reload server_scripts
//
// NOTA: no Rhino do KubeJS, `const`/`let` de um script vazam para o escopo
// global e colidem com os de outro script. Por isso todos os nomes internos
// levam o prefixo `aurora`.

const AURORA_CRAWLER_BIOME = 'the_deep_void:crawler_nest'
const AURORA_CRAWLER_CHECK_EVERY_TICKS = 10    // checa a cada 0,5 s
const AURORA_CRAWLER_DAMAGE_EVERY_TICKS = 40   // 2 s entre cada dano
const AURORA_CRAWLER_DAMAGE_AMOUNT = 4         // 2 corações = 4 pontos de vida

const AURORA_CRAWLER_NBT_INSIDE = 'aurora_crawler_inside'
const AURORA_CRAWLER_NBT_LAST = 'aurora_crawler_last_dmg'
const AURORA_CRAWLER_NBT_OFF = 'aurora_crawler_off'

/** ID do bioma na posição atual, ex.: "the_deep_void:crawler_nest" */
function auroraCrawlerBiomeId(auroraPlayerArg) {
    const auroraKey = auroraPlayerArg.level.getBiome(auroraPlayerArg.blockPosition()).unwrapKey()
    return auroraKey.isPresent() ? String(auroraKey.get().location()) : ''
}

/**
 * O tickCount do servidor zera no restart, mas o NBT do jogador não. Um valor
 * salvo maior que o tick atual é resto de sessão anterior: descarta e zera.
 */
function auroraCrawlerUltimoTick(auroraDataArg, auroraTickArg) {
    const auroraLast = auroraDataArg.getLong(AURORA_CRAWLER_NBT_LAST)
    if (auroraLast > auroraTickArg) {
        auroraDataArg.putLong(AURORA_CRAWLER_NBT_LAST, 0)
        return 0
    }
    return auroraLast
}

/** Estado global ligado/desligado, salvo no NBT do servidor. */
function auroraCrawlerAtivo(auroraServerArg) {
    return !auroraServerArg.persistentData.getBoolean(AURORA_CRAWLER_NBT_OFF)
}

/**
 * Criativo e espectador não levam dano. Apenas sobrevivência e aventura.
 * `isCreative()` e `isSpectator()` são métodos vanilla confirmados neste
 * servidor (o campo `gameType` NÃO é exposto ao Rhino do KubeJS aqui).
 */
function auroraCrawlerPodeDanar(auroraPlayerArg) {
    return !auroraPlayerArg.isCreative() && !auroraPlayerArg.isSpectator()
}

/** Dano direto: ignora armadura, resistência, absorção, i-frames e escudo. */
function auroraCrawlerAplicarDano(auroraPlayerArg) {
    const auroraVida = auroraPlayerArg.getHealth()
    if (auroraVida <= 0) return
    auroraPlayerArg.setHealth(Math.max(0, auroraVida - AURORA_CRAWLER_DAMAGE_AMOUNT))
}

function auroraCrawlerAvaliar(auroraPlayerArg, auroraTickArg) {
    const auroraDentro = auroraCrawlerBiomeId(auroraPlayerArg) === AURORA_CRAWLER_BIOME
    const auroraData = auroraPlayerArg.persistentData
    const auroraLast = auroraCrawlerUltimoTick(auroraData, auroraTickArg)
    const auroraJaEstava = auroraData.getBoolean(AURORA_CRAWLER_NBT_INSIDE)

    // Saiu do bioma OU mudou pra criativo/espectador: zera o contador. Assim,
    // ao voltar pro bioma ou pra sobrevivência, o dano recomeça do início.
    if (!auroraDentro || !auroraCrawlerPodeDanar(auroraPlayerArg)) {
        if (auroraJaEstava) {
            auroraData.putBoolean(AURORA_CRAWLER_NBT_INSIDE, false)
            auroraData.putLong(AURORA_CRAWLER_NBT_LAST, 0)
        }
        return
    }

    const auroraDeveDanar = !auroraJaEstava || auroraLast <= 0 ||
        auroraTickArg - auroraLast >= AURORA_CRAWLER_DAMAGE_EVERY_TICKS

    if (auroraDeveDanar) {
        auroraCrawlerAplicarDano(auroraPlayerArg)
        auroraData.putBoolean(AURORA_CRAWLER_NBT_INSIDE, true)
        auroraData.putLong(AURORA_CRAWLER_NBT_LAST, auroraTickArg)
    }
}

PlayerEvents.tick(event => {
    const auroraPlayer = event.player

    if (!auroraCrawlerAtivo(auroraPlayer.server)) {
        // Enquanto desligado, limpa o estado por jogador. Assim, ao religar,
        // o primeiro dano volta a acontecer na entrada do bioma.
        const auroraData = auroraPlayer.persistentData
        if (auroraData.getBoolean(AURORA_CRAWLER_NBT_INSIDE)) {
            auroraData.putBoolean(AURORA_CRAWLER_NBT_INSIDE, false)
            auroraData.putLong(AURORA_CRAWLER_NBT_LAST, 0)
        }
        return
    }

    const auroraTick = auroraPlayer.server.tickCount

    if (auroraTick % AURORA_CRAWLER_CHECK_EVERY_TICKS !== 0) return

    try {
        auroraCrawlerAvaliar(auroraPlayer, auroraTick)
    } catch (auroraErr) {
        console.error('[aurora-crawler] ERRO em ' + auroraPlayer.profile.name + ': ' + auroraErr)
    }
})

/** Responde ao comando tanto no chat quanto no console do painel. */
function auroraCrawlerResponder(auroraSourceArg, auroraMsgArg) {
    try {
        auroraSourceArg.sendSuccess(Text.of(auroraMsgArg), false)
    } catch (auroraErr) {
        console.warn('[aurora-crawler] não consegui responder ao comando: ' + auroraErr)
    }
}

/** Ação em si, usada tanto pelo comando registrado quanto pelo interceptador. */
function auroraCrawlerExecutar(auroraServerArg, auroraAcaoArg, auroraSourceArg) {
    if (auroraAcaoArg === 'on') {
        auroraServerArg.persistentData.putBoolean(AURORA_CRAWLER_NBT_OFF, false)
        auroraCrawlerResponder(auroraSourceArg, '[aurora-crawler] Dano do Crawler Nest ATIVADO.')
    } else if (auroraAcaoArg === 'off') {
        auroraServerArg.persistentData.putBoolean(AURORA_CRAWLER_NBT_OFF, true)
        auroraCrawlerResponder(auroraSourceArg, '[aurora-crawler] Dano do Crawler Nest DESATIVADO.')
    } else {
        var auroraEstado = auroraCrawlerAtivo(auroraServerArg) ? 'ATIVADO' : 'DESATIVADO'
        auroraCrawlerResponder(auroraSourceArg, '[aurora-crawler] Estado atual: ' + auroraEstado)
        auroraCrawlerResponder(auroraSourceArg, '[aurora-crawler] Criativo/espectador ficam isentos.')
    }
}

// Registro normal: dá autocomplete e ajuda no /help. Só acontece na subida do
// servidor, por isso sozinho não bastaria pra um reload de scripts.
ServerEvents.commandRegistry(event => {
    const auroraCommands = event.commands

    event.register(
        auroraCommands.literal('auroracrawler')
            .requires(auroraSource => auroraSource.hasPermission(2))
            .then(auroraCommands.literal('on').executes(auroraCtx =>
                auroraCrawlerExecutar(auroraCtx.source.server, 'on', auroraCtx.source)))
            .then(auroraCommands.literal('off').executes(auroraCtx =>
                auroraCrawlerExecutar(auroraCtx.source.server, 'off', auroraCtx.source)))
            .then(auroraCommands.literal('status').executes(auroraCtx =>
                auroraCrawlerExecutar(auroraCtx.source.server, 'status', auroraCtx.source)))
    )
})

// Este evento dispara para QUALQUER comando digitado, mesmo um ainda não
// registrado no dispatcher (é o que acontece logo após um reload). Assim o
// /auroracrawler funciona na hora, sem precisar reiniciar o servidor.
// O cancel() abaixo impede a mensagem de "comando desconhecido".
ServerEvents.command(event => {
    var auroraAcao = ''
    var auroraSource = null

    try {
        // Aqui usa var de propósito: o Rhino reclama de redeclaration se um
        // const/let for reexecutado várias vezes no mesmo escopo de evento.
        var auroraInput = String(event.input || '').replace(/^\/+/, '').trim()
        var auroraPartes = auroraInput.split(/\s+/)
        if (auroraPartes[0].toLowerCase() !== 'auroracrawler') return

        auroraAcao = auroraPartes.length > 1 ? auroraPartes[1].toLowerCase() : ''
        if (auroraAcao !== '' && auroraAcao !== 'on' && auroraAcao !== 'off' && auroraAcao !== 'status') return

        auroraSource = event.parseResults.context.source
        if (!auroraSource.hasPermission(2)) return

        auroraCrawlerExecutar(event.server, auroraAcao === '' ? 'status' : auroraAcao, auroraSource)
    } catch (auroraErr) {
        console.error('[aurora-crawler] ERRO no comando: ' + auroraErr)
        return
    }

    // Fora do try: cancel() lança uma exceção interna de controle do KubeJS.
    return event.cancel()
})
