package com.aurora.totem.registry;

import com.aurora.totem.AuroraTotemMod;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModParticles {
    public static final DeferredRegister<net.minecraft.core.particles.ParticleType<?>> PARTICLES =
            DeferredRegister.create(ForgeRegistries.PARTICLE_TYPES, AuroraTotemMod.MODID);

    public static final RegistryObject<SimpleParticleType> TOTEM_VIOLA =
            PARTICLES.register("totem_viola", () -> new SimpleParticleType(false));
}
