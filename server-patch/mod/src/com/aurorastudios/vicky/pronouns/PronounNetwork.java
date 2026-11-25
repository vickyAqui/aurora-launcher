package com.aurorastudios.vicky.pronouns;

import com.aurorastudios.vicky.AuroraVicky;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.simple.SimpleChannel;

import java.util.UUID;
import java.util.function.Supplier;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/** One small packet used both for setting and for clearing a pronoun. */
public final class PronounNetwork {
    private static final Logger LOGGER = LogManager.getLogger("AuroraPronouns");
    private static final String VERSION = "1";
    private static SimpleChannel channel;

    private PronounNetwork() {
    }

    public static void init() {
        channel = NetworkRegistry.newSimpleChannel(
                new ResourceLocation(AuroraVicky.MOD_ID, "pronouns"),
                () -> VERSION,
                VERSION::equals,
                VERSION::equals
        );
        channel.messageBuilder(SetPronounPacket.class, 0)
                .encoder(SetPronounPacket::encode)
                .decoder(SetPronounPacket::decode)
                .consumerMainThread(SetPronounPacket::handle)
                .add();
    }

    public static void sendToAll(UUID uuid, String raw) {
        LOGGER.info("[aurora-pronouns] sendToAll uuid={} raw='{}'", uuid, raw);
        channel.send(PacketDistributor.ALL.noArg(), new SetPronounPacket(uuid, raw));
    }

    public static void sendTo(ServerPlayer player, UUID uuid, String raw) {
        LOGGER.info("[aurora-pronouns] sendTo {} uuid={} raw='{}'", player.m_7755_().getString(), uuid, raw);
        channel.send(PacketDistributor.PLAYER.with(() -> player), new SetPronounPacket(uuid, raw));
    }

    public static final class SetPronounPacket {
        private final UUID uuid;
        private final String raw;

        public SetPronounPacket(UUID uuid, String raw) {
            this.uuid = uuid;
            this.raw = raw == null ? "" : raw;
        }

        public static void encode(SetPronounPacket packet, FriendlyByteBuf buf) {
            buf.m_130077_(packet.uuid);
            buf.m_130072_(packet.raw, PronounText.MAX_LENGTH + 1);
        }

        public static SetPronounPacket decode(FriendlyByteBuf buf) {
            return new SetPronounPacket(buf.m_130259_(), buf.m_130277_());
        }

        public static void handle(SetPronounPacket packet, Supplier<NetworkEvent.Context> ctx) {
            ctx.get().setPacketHandled(true);
            LOGGER.info("[aurora-pronouns] packet recebido uuid={} raw='{}'", packet.uuid, packet.raw);
            PronounClientCache.set(packet.uuid, packet.raw);
        }
    }
}
