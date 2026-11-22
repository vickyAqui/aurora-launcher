// Spawn natural dos mobs do Born in Chaos restrito ao bioma de pesadelo.
//
// Todos os mobs do mod (namespace `born_in_chaos_v1`) podem nascer somente em:
//   - aurora_mortis:dominio_do_pesadelo
//   - aurora_mortis:dominio_de_olhos_do_pesadelo
//   - aurora_mortis:pesadelo
// Fora desses biomas o spawn natural é cancelado. Spawners, ovos de spawn e
// spawns vindos de chunks gerados não são afetados: só MobSpawnType.NATURAL.
//
// A lista de entidades é lida do registro do Forge, então novos mobs do mod
// entram automaticamente, sem precisar atualizar este script.
//
// Comandos (também funcionam no console do painel, sem a barra):
//   /bornspawns           mostra o estado, os biomas liberados e o total de mobs
//   /bornspawns on|off    reativa/desativa o bloqueio em quente

var AURORA_BORN_SPAWNS_ENABLED = true
var AURORA_BORN_SPAWNS_NAMESPACE = 'born_in_chaos_v1'
var AURORA_BORN_SPAWNS_BIOMES = [
    'aurora_mortis:dominio_do_pesadelo',
    'aurora_mortis:dominio_de_olhos_do_pesadelo',
    'aurora_mortis:pesadelo'
]

var auroraBornSpawnsMobs = null
var auroraBornSpawnsChecked = 0
var auroraBornSpawnsBlocked = 0
var auroraBornSpawnsRegistries = null

function auroraBornSpawnsRegistriesClass() {
    if (auroraBornSpawnsRegistries == null) {
        auroraBornSpawnsRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
    }
    return auroraBornSpawnsRegistries
}

function auroraBornSpawnsBiomeId(level, pos) {
    try {
        var key = level.getBiome(pos).unwrapKey()
        return key.isPresent() ? String(key.get().location()) : 'minecraft:the_void'
    } catch (e) {
        return ''
    }
}

function auroraBornSpawnsAllowed(biome) {
    for (var i = 0; i < AURORA_BORN_SPAWNS_BIOMES.length; i++) {
        if (biome === AURORA_BORN_SPAWNS_BIOMES[i]) return true
    }
    return false
}

function auroraBornSpawnsEntityId(entity) {
    try {
        var rl = auroraBornSpawnsRegistriesClass().ENTITIES.getKey(entity.getType())
        return rl == null ? '' : String(rl)
    } catch (e) {
        return ''
    }
}

function auroraBornSpawnsEntityIds() {
    if (auroraBornSpawnsMobs != null) return auroraBornSpawnsMobs
    var ids = []
    try {
        var keys = auroraBornSpawnsRegistriesClass().ENTITIES.getKeys().iterator()
        while (keys.hasNext()) {
            var id = String(keys.next())
            if (id.indexOf(AURORA_BORN_SPAWNS_NAMESPACE + ':') === 0) ids.push(id)
        }
    } catch (e) {
        console.warn('[aurora-born-spawns] falha ao ler registro: ' + e)
    }
    console.info('[aurora-born-spawns] mobs do mod detectados: ' + ids.length)
    auroraBornSpawnsMobs = ids
    return ids
}

function auroraBornSpawnsIsModMob(id) {
    if (id.indexOf(AURORA_BORN_SPAWNS_NAMESPACE + ':') !== 0) return false
    var ids = auroraBornSpawnsEntityIds()
    for (var i = 0; i < ids.length; i++) {
        if (ids[i] === id) return true
    }
    return ids.length === 0
}

EntityEvents.checkSpawn((event) => {
    if (!AURORA_BORN_SPAWNS_ENABLED) return
    var auroraBornSpawnsCancelar = false
    try {
        // Só spawn natural do mundo; spawners e chunk gen ficam de fora.
        if (String(event.getType().name()) !== 'NATURAL') return
        var entity = event.getEntity()
        var id = auroraBornSpawnsEntityId(entity)
        if (!auroraBornSpawnsIsModMob(id)) return

        auroraBornSpawnsChecked++
        var biome = auroraBornSpawnsBiomeId(event.getLevel(), entity.blockPosition())
        if (auroraBornSpawnsAllowed(biome)) return

        auroraBornSpawnsBlocked++
        if (auroraBornSpawnsBlocked <= 5 || auroraBornSpawnsBlocked % 100 === 0) {
            console.info('[aurora-born-spawns] bloqueado ' + id + ' em ' + biome +
                ' (total ' + auroraBornSpawnsBlocked + ')')
        }
        auroraBornSpawnsCancelar = true
    } catch (e) {
        console.warn('[aurora-born-spawns] erro no evento: ' + e)
    }
    // Fora do try: cancel() lança exceção de controle do KubeJS.
    if (auroraBornSpawnsCancelar) return event.cancel()
})

/** Responde ao comando tanto no chat quanto no console do painel. */
function auroraBornSpawnsReply(source, msg) {
    try {
        source.sendSuccess(Text.of(msg), false)
    } catch (e) {
        console.info('[aurora-born-spawns] ' + msg)
    }
}

function auroraBornSpawnsStatus() {
    var status = AURORA_BORN_SPAWNS_ENABLED ? '§aATIVO' : '§cDESATIVADO'
    return '§6[Aurora] Born in Chaos spawn: ' + status +
        ' §7| mobs: ' + auroraBornSpawnsEntityIds().length +
        ' | verificados: ' + auroraBornSpawnsChecked +
        ' | bloqueados: ' + auroraBornSpawnsBlocked
}

function auroraBornSpawnsCommand(source, acao) {
    if (acao === 'on') {
        AURORA_BORN_SPAWNS_ENABLED = true
        auroraBornSpawnsReply(source, '§a[Aurora] Spawn do Born in Chaos restrito ao Pesadelo.')
    } else if (acao === 'off') {
        AURORA_BORN_SPAWNS_ENABLED = false
        auroraBornSpawnsReply(source, '§e[Aurora] Bloqueio desativado (spawn normal do mod).')
    } else if (acao === 'status' || acao === '') {
        auroraBornSpawnsReply(source, auroraBornSpawnsStatus())
        for (var i = 0; i < AURORA_BORN_SPAWNS_BIOMES.length; i++) {
            auroraBornSpawnsReply(source, '§7  liberado: ' + AURORA_BORN_SPAWNS_BIOMES[i])
        }
    } else {
        auroraBornSpawnsReply(source, '[aurora-born-spawns] Use /bornspawns on|off|status.')
    }
}

// Registro normal (para /help e autocomplete após restart).
ServerEvents.commandRegistry((event) => {
    var literal = event.commands.literal

    event.register(literal('bornspawns')
        .requires((src) => src.hasPermission(2))
        .then(literal('on').executes((ctx) => {
            auroraBornSpawnsCommand(ctx.source, 'on')
        }))
        .then(literal('off').executes((ctx) => {
            auroraBornSpawnsCommand(ctx.source, 'off')
        }))
        .then(literal('status').executes((ctx) => {
            auroraBornSpawnsCommand(ctx.source, 'status')
        }))
        .executes((ctx) => {
            auroraBornSpawnsCommand(ctx.source, 'status')
        })
    )

    event.register(literal('aurorabornspawns')
        .requires((src) => src.hasPermission(2))
        .executes((ctx) => {
            auroraBornSpawnsCommand(ctx.source, 'status')
        })
    )
})

// Interceptador: funciona na hora, sem restart, inclusive no console do painel.
ServerEvents.command((event) => {
    try {
        var auroraInput = String(event.input || '').replace(/^\/+/, '').trim()
        var auroraPartes = auroraInput.split(/\s+/)
        var auroraNome = auroraPartes[0].toLowerCase()
        if (auroraNome !== 'bornspawns' && auroraNome !== 'aurorabornspawns') return

        var auroraSource = event.parseResults.context.source
        if (!auroraSource.hasPermission(2)) return
        var auroraAcao = auroraPartes.length > 1 ? auroraPartes[1].toLowerCase() : 'status'
        auroraBornSpawnsCommand(auroraSource, auroraAcao)
    } catch (auroraErr) {
        console.error('[aurora-born-spawns] ERRO no comando: ' + auroraErr)
        return
    }
    // Fora do try: cancel() lança uma exceção de controle do KubeJS.
    return event.cancel()
})
