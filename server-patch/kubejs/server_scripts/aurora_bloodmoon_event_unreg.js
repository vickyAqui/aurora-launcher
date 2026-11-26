// Corrige o Bloodmoon sem editar o jar (o painel rejeita jars modificados).
// O modulo registra MobBlockBreakerProcedure.onEntityJoinLevel no EVENT_BUS da
// Forge; esse handler injeta BreakDoorGoal em qualquer mob que nasce e derruba
// o servidor quando o mob nao tem navegacao terrestre (ex.: skelewag).
// Aqui removemos apenas esse listener, mantendo o mod instalado e ativo.
var auroraBmUnregDone = false

ServerEvents.tick(event => {
    if (auroraBmUnregDone) return
    auroraBmUnregDone = true
    try {
        var classe = Java.loadClass('net.foufakirby.bloodmoon.procedures.mobs.MobBlockBreakerProcedure')
        var forge = Java.loadClass('net.minecraftforge.common.MinecraftForge')
        var bus = forge.EVENT_BUS
        bus.unregister(classe)
        console.info('[aurora-bm-unreg] listener MobBlockBreakerProcedure removido do EVENT_BUS')
    } catch (e) {
        console.warn('[aurora-bm-unreg] falha ao remover listener: ' + e)
    }
})
