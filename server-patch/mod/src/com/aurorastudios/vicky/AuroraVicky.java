package com.aurorastudios.vicky;

import com.aurora.totem.registry.ModParticles;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

/**
 * Mod de recursos: carrega os assets do jar (modelo e textura do Caldeirao
 * Futuro) como pack de recursos do mod e registra a particula customizada do
 * Totem of Possession.
 *
 * O pack de mods nao aparece na tela de resource packs, entao o jogador nao
 * consegue desativar o modelo nem a particula por ali.
 */
@Mod(AuroraVicky.MOD_ID)
public final class AuroraVicky {
    public static final String MOD_ID = "aurora_vicky";

    public AuroraVicky() {
        ModParticles.PARTICLES.register(FMLJavaModLoadingContext.get().getModEventBus());
    }
}
