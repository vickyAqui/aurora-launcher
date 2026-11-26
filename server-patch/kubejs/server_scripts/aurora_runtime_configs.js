// Aplica configuracoes de mods que nao tem reload e so leem a config no boot.
// Mantido via KubeJS para evitar restart do servidor.
var auroraRuntimeConfigsApplied = false

function auroraSetBoolean(holder, fieldName, value, label) {
    try {
        var f = holder.getClass().getDeclaredField(fieldName)
        f.setAccessible(true)
        var cv = f.get(holder)
        var antes = cv.get()
        cv.set(value)
        console.info('[aurora-configs] ' + label + ': ' + antes + ' -> ' + cv.get())
    } catch (e) {
        console.warn('[aurora-configs] ' + label + ' erro: ' + e)
    }
}

ServerEvents.tick((event) => {
    if (auroraRuntimeConfigsApplied) return
    auroraRuntimeConfigsApplied = true

    // AllTheLeaks: le o JSON uma vez no boot; reflection aplica sem restart
    try {
        var ATL = Java.loadClass('dev.uncandango.alltheleaks.config.ATLProperties')
        var atl = ATL.get()
        // ingredientDedupe desligado: no cliente ele gera 1066 ATLUnsupportedOperation
        // em JEI/Hexerei. O servidor nao roda JEI, mas mantemos os dois lados alinhados.
        atl.ingredientDedupe = false
        atl.resourceLocationDedupe = true
        console.info('[aurora-configs] AllTheLeaks dedupe: ' + atl.ingredientDedupe + '/' + atl.resourceLocationDedupe)
    } catch (e) { console.warn('[aurora-configs] AllTheLeaks erro: ' + e) }

    // AI-Improvements: ForgeConfigSpec so e relido no boot
    try {
        var AI = Java.loadClass('com.builtbroken.ai.improvements.ConfigMain')
        var c = AI.CONFIG
        auroraSetBoolean(c, 'removeFishSwim', true, 'AI peixe remove_swim')
        auroraSetBoolean(c, 'removeFishFollowLeader', true, 'AI peixe remove_follow_leader')
        auroraSetBoolean(c, 'removeRandomMove', true, 'AI lula remove_random_move')
        var ff = c.getClass().getDeclaredField('removeLookRandom')
        ff.setAccessible(true)
        auroraSetBoolean(ff.get(c), 'configValue', true, 'AI remove_look_random')
    } catch (e) { console.warn('[aurora-configs] AI-Improvements erro: ' + e) }
})
