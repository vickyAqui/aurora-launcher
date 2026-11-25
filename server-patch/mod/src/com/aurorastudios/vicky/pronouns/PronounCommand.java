package com.aurorastudios.vicky.pronouns;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;

import java.util.UUID;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/** /pronome <texto> — each player picks their own pronoun. /pronome limpar removes it. */
public final class PronounCommand {
    private static final Logger LOGGER = LogManager.getLogger("AuroraPronouns");
    private PronounCommand() {
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.m_82127_("pronome")
                .then(Commands.m_82129_("texto", StringArgumentType.greedyString())
                        .executes(PronounCommand::set))
                .then(Commands.m_82127_("limpar")
                        .executes(PronounCommand::clear))
                .executes(PronounCommand::help));
    }

    private static int set(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack source = ctx.getSource();
        ServerPlayer player = playerFrom(source);
        if (player == null) {
            source.m_243053_(Component.m_237113_("§cApenas jogadores podem usar /pronome."));
            return 0;
        }

        String raw = PronounText.sanitize(StringArgumentType.getString(ctx, "texto"));
        if (raw.isEmpty()) {
            source.m_243053_(Component.m_237113_("§cDigite um texto valido para o pronome."));
            return 0;
        }

        UUID uuid = player.m_20148_();
        LOGGER.info("[aurora-pronouns] /pronome definido para {} ({}): '{}'", player.m_20148_(), player.m_7755_().getString(), raw);
        PronounStorage.set(uuid, raw);
        PronounNetwork.sendToAll(uuid, raw);

        MutableComponent feedback = Component.m_237113_("§aPronome definido: ");
        feedback.m_7220_(PronounText.parse(raw));
        source.m_243053_(feedback);
        return 1;
    }

    private static int clear(CommandContext<CommandSourceStack> ctx) {
        CommandSourceStack source = ctx.getSource();
        ServerPlayer player = playerFrom(source);
        if (player == null) {
            source.m_243053_(Component.m_237113_("§cApenas jogadores podem usar /pronome."));
            return 0;
        }

        UUID uuid = player.m_20148_();
        PronounStorage.remove(uuid);
        PronounNetwork.sendToAll(uuid, "");
        source.m_243053_(Component.m_237113_("§aPronome removido."));
        return 1;
    }

    private static int help(CommandContext<CommandSourceStack> ctx) {
        ctx.getSource().m_243053_(Component.m_237113_(
                "§eUso: §f/pronome <texto> §7(defina seu pronome)\n"
                        + "§eUso: §f/pronome limpar §7(remove o pronome)\n"
                        + "§7Exemplo: §f/pronome §d§dela/ela§r"));
        return 1;
    }

    private static ServerPlayer playerFrom(CommandSourceStack source) {
        try {
            return source.m_81375_();
        } catch (CommandSyntaxException e) {
            return null;
        }
    }
}
