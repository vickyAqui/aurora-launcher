package com.aurora.totem.registry;

import com.aurorastudios.vicky.AuroraVicky;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModParticles {
    public static final DeferredRegister<net.minecraft.core.particles.ParticleType<?>> PARTICLES =
            DeferredRegister.create(ForgeRegistries.PARTICLE_TYPES, AuroraVicky.MOD_ID);

    public static final RegistryObject<SimpleParticleType> TOTEM_VIOLA =
            PARTICLES.register("totem_viola", () -> new SimpleParticleType(false));
}
