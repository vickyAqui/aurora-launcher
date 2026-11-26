// Guard de estabilidade: impede o spawn NATURAL de mobs que quebram o Bloodmoon
// neste Arclight. O Bloodmoon adiciona BreakDoorGoal a todo mob que nasce; o
// vanilla rejeita mobs sem navegacao terrestre com
// "IllegalArgumentException: Unsupported mob type for DoorInteractGoal".
// Isto NAO remove mods e NAO remove entidades existentes: apenas cancela o
// spawn natural antes do mob entrar no mundo (equivale ao BadMobs, mas em runtime).
// Spawners, ovos e chunks ja gerados continuam funcionando normalmente.
var auroraGuardBloqueios = 0
// Java.loadClass e caro no Rhino; este checkSpawn roda para todo spawn natural.
var auroraGuardForgeRegistries = null

var AURORA_GUARD_IDS = [
    'alexsmobs:skelewag'
]

function auroraGuardEntityId(entity) {
    try {
        var rl = entity.getType().getRegistryName()
        if (rl != null) return String(rl)
    } catch (e) {}
    try {
        if (!auroraGuardForgeRegistries) {
            auroraGuardForgeRegistries = Java.loadClass('net.minecraftforge.registries.ForgeRegistries')
        }
        var rl2 = auroraGuardForgeRegistries.ENTITIES.getKey(entity.getType())
        if (rl2 != null) return String(rl2)
    } catch (e2) {}
    return ''
}

EntityEvents.checkSpawn(event => {
    var auroraGuardCancelar = false
    try {
        // Somente spawn natural; spawners e ovos nao sao afetados.
        if (String(event.getType().name()) !== 'NATURAL') return

        var id = auroraGuardEntityId(event.getEntity())
        for (var i = 0; i < AURORA_GUARD_IDS.length; i++) {
            if (id !== AURORA_GUARD_IDS[i]) continue
            auroraGuardBloqueios++
            if (auroraGuardBloqueios <= 10 || auroraGuardBloqueios % 100 === 0) {
                console.info('[aurora-guard] spawn natural cancelado: ' + id +
                    ' (total=' + auroraGuardBloqueios + ')')
            }
            auroraGuardCancelar = true
            break
        }
    } catch (e) {
        console.warn('[aurora-guard] erro no evento: ' + e)
    }
    // Fora do try: cancel() lanca excecao de controle do KubeJS.
    if (auroraGuardCancelar) return event.cancel()
})
