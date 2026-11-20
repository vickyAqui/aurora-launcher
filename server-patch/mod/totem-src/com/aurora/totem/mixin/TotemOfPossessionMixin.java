package com.aurora.totem.mixin;

import com.aurora.totem.registry.ModParticles;
import net.minecraft.core.particles.ParticleOptions;
import net.minecraft.world.level.Level;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(targets = "com.github.alexmodguy.alexscaves.server.item.TotemOfPossessionItem")
public class TotemOfPossessionMixin {
    @Redirect(
            method = "m_5929_",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/world/level/Level;m_7106_(Lnet/minecraft/core/particles/ParticleOptions;DDDDDD)V"),
            remap = false
    )
    private void aurora$swapTotemParticle(Level level, ParticleOptions options,
                                          double x, double y, double z,
                                          double dx, double dy, double dz) {
        level.addParticle(ModParticles.TOTEM_VIOLA.get(), x, y, z, dx, dy, dz);
    }
}
