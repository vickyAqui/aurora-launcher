package com.aurorastudios.vicky;

import com.aurora.totem.registry.ModParticles;
import com.aurorastudios.vicky.pronouns.PronounCommand;
import com.aurorastudios.vicky.pronouns.PronounNetwork;
import com.aurorastudios.vicky.pronouns.PronounStorage;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

import java.util.UUID;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * Mod de recursos: carrega os assets do jar (modelo e textura do Caldeirao
 * Futuro) como pack de recursos do mod e registra a particula customizada do
 * Totem of Possession.
 *
 * Tambem cuida dos pronomes: comando /pronome, persistencia por UUID e o
 * segundo nome menor desenhado abaixo da name tag no cliente.
 *
 * O pack de mods nao aparece na tela de resource packs, entao o jogador nao
 * consegue desativar o modelo nem a particula por ali.
 */
@Mod(AuroraVicky.MOD_ID)
public final class AuroraVicky {
    public static final String MOD_ID = "aurora_vicky";
    private static final Logger LOGGER = LogManager.getLogger("AuroraPronouns");

    public AuroraVicky() {
        LOGGER.info("[aurora-pronouns] === MOD CARREGADO (aurora_vicky 1.0.5) ===");
        ModParticles.PARTICLES.register(FMLJavaModLoadingContext.get().getModEventBus());

        // The channel must be created during mod construction, before the
        // network registry is locked.
        PronounNetwork.init();

        IEventBus forgeBus = MinecraftForge.EVENT_BUS;
        forgeBus.addListener(AuroraVicky::registerCommands);
        forgeBus.addListener(AuroraVicky::onServerStarted);
        forgeBus.addListener(AuroraVicky::onPlayerLogin);
        forgeBus.addListener(AuroraVicky::onServerStopping);
    }

    private static void registerCommands(RegisterCommandsEvent event) {
        PronounCommand.register(event.getDispatcher());
    }

    private static void onServerStarted(ServerStartedEvent event) {
        PronounStorage.load();
    }

    private static void onServerStopping(ServerStoppingEvent event) {
        PronounStorage.save();
    }

    private static void onPlayerLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer player)) {
            return;
        }
        LOGGER.info("[aurora-pronouns] jogador logado: {} ({} pronomes salvos)",
                player.m_7755_().getString(), PronounStorage.all().size());
        PronounStorage.all().forEach((stored, raw) ->
                PronounNetwork.sendTo(player, UUID.fromString(stored), raw));
    }
}
