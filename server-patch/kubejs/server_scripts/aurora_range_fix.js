// Aumenta limites de distancia sem restart.
// Botania: MAX_DIST=20 e constante compilada; o bind e feito direto no BlockEntity quando se usa o Bastao da Floresta.
// Create: maxChainConveyorLength / maxCartCouplingLength / maxTrackPlacementLength -> 128.
var auroraRangeInit = false

function auroraBlockPos(x, y, z) {
    try {
        return new BlockPos(x, y, z)
    } catch (e) {
        var C = Java.loadClass('net.minecraft.core.BlockPos')
        return new C(x, y, z)
    }
}

ServerEvents.tick((event) => {
    if (auroraRangeInit) return
    auroraRangeInit = true
    try {
        var AC = Java.loadClass('com.simibubi.create.infrastructure.config.AllConfigs')
        var kin = AC.server().kinetics
        var nomes = ['maxChainConveyorLength', 'maxCartCouplingLength']
        for (var i = 0; i < nomes.length; i++) {
            try {
                var cfg = kin.getClass().getDeclaredField(nomes[i])
                cfg.setAccessible(true)
                var val = cfg.get(kin)
                val.set(128)
                console.info('[aurora-range] Create ' + nomes[i] + ' = ' + val.get())
            } catch (e) {
                console.warn('[aurora-range] Create ' + nomes[i] + ' erro: ' + e)
            }
        }
        try {
            var tr = AC.server().trains.maxTrackPlacementLength
            tr.set(128)
            console.info('[aurora-range] Create maxTrackPlacementLength = ' + tr.get())
        } catch (e) {
            console.warn('[aurora-range] Create maxTrackPlacementLength erro: ' + e)
        }
    } catch (e) {
        console.warn('[aurora-range] Create config erro: ' + e)
    }
})

BlockEvents.rightClicked((event) => {
    try {
        var block = event.block
        var level = block.level
        if (!level || level.isClientSide) return
        var player = event.entity
        if (!player.isShiftKeyDown()) return
        var stack = event.item
        if (!stack || stack.isEmpty()) return

        var nbt = null
        try { nbt = stack.getTag() } catch (e) {}
        if (!nbt) { try { nbt = stack.nbt } catch (e) {} }
        if (!nbt || !nbt.contains('boundTileY')) return

        var sx = nbt.getInt('boundTileX')
        var sy = nbt.getInt('boundTileY')
        var sz = nbt.getInt('boundTileZ')
        if (sy === -2147483648) return

        var pos = block.pos
        var dx = pos.getX() - sx
        var dy = pos.getY() - sy
        var dz = pos.getZ() - sz
        var distSq = dx * dx + dy * dy + dz * dz
        if (distSq <= 400) return
        if (distSq > 10000) return

        var srcBE = level.getBlockEntity(auroraBlockPos(sx, sy, sz))
        var dstBE = level.getBlockEntity(pos)
        if (!srcBE || !dstBE) return
        if (String(srcBE.getClass().getName()).indexOf('LuminizerBlockEntity') < 0) return
        if (String(dstBE.getClass().getName()).indexOf('LuminizerBlockEntity') < 0) return

        var f = srcBE.getClass().getDeclaredField('bindPos')
        f.setAccessible(true)
        f.set(srcBE, auroraBlockPos(pos.getX(), pos.getY(), pos.getZ()))
        srcBE.setChanged()
        try {
            var VPD = Java.loadClass('vazkii.botania.api.internal.VanillaPacketDispatcher')
            VPD.dispatchTEToNearbyPlayers(srcBE)
        } catch (e) {}
        nbt.putInt('boundTileY', -2147483648)
        event.cancel()
        console.info('[aurora-range] Luminizer bindado a ' + Math.sqrt(distSq).toFixed(1) + ' blocos (limite 100)')
    } catch (e) {
        console.warn('[aurora-range] Luminizer erro: ' + e)
    }
})
