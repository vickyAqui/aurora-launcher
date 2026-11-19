// Botania: MAX_DIST=20 e constante compilada; o bind e feito direto no BlockEntity quando se usa o Bastao da Floresta.
// Create: limites ja ajustados no arquivo /world/serverconfig/create-server.toml (128), aplicados no boot.
var auroraBlockPos = null

function auroraPos(x, y, z) {
    if (auroraBlockPos == null) {
        try { auroraBlockPos = Java.loadClass('net.minecraft.core.BlockPos') }
        catch (e) { return new BlockPos(x, y, z) }
    }
    return new auroraBlockPos(x, y, z)
}

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

        var srcBE = level.getBlockEntity(auroraPos(sx, sy, sz))
        var dstBE = level.getBlockEntity(pos)
        if (!srcBE || !dstBE) return
        if (String(srcBE.getClass().getName()).indexOf('LuminizerBlockEntity') < 0) return
        if (String(dstBE.getClass().getName()).indexOf('LuminizerBlockEntity') < 0) return

        var f = srcBE.getClass().getDeclaredField('bindPos')
        f.setAccessible(true)
        f.set(srcBE, auroraPos(pos.getX(), pos.getY(), pos.getZ()))
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
