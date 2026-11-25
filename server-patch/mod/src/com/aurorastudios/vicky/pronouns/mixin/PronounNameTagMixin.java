package com.aurorastudios.vicky.pronouns.mixin;

import com.aurorastudios.vicky.pronouns.PronounClientCache;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.joml.Matrix4f;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Draws the pronoun as a second, smaller line right after the vanilla name tag.
 * We inject just before the name tag's popPose(), so the pose stack is already
 * translated to head height and billboarded toward the camera.
 */
@Mixin(EntityRenderer.class)
public class PronounNameTagMixin {
    private static final Logger LOGGER = LogManager.getLogger("AuroraPronounsRender");
    private static long aurora$ultimoLog = 0L;
    private static final float SCALE = 0.72F;
    private static final float LINE_Y = 15.0F;

    @Inject(
            method = "m_7649_(Lnet/minecraft/world/entity/Entity;Lnet/minecraft/network/chat/Component;"
                    + "Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/MultiBufferSource;I)V",
            at = @At(value = "INVOKE", target = "Lcom/mojang/blaze3d/vertex/PoseStack;m_85849_()V"),
            remap = false
    )
    private void aurora$drawPronoun(Entity entity, Component name, PoseStack poseStack,
                                    MultiBufferSource buffer, int packedLight, CallbackInfo ci) {
        if (!(entity instanceof Player)) {
            return;
        }
        Component pronoun = PronounClientCache.get(entity.m_20148_());
        if (pronoun == null) {
            return;
        }
        long agora = System.currentTimeMillis();
        if (agora - aurora$ultimoLog > 5000L) {
            aurora$ultimoLog = agora;
            LOGGER.info("[aurora-pronouns] DESENHANDO '{}' em {}", pronoun.getString(), entity.m_7755_().getString());
        }

        Font font = Minecraft.m_91087_().f_91062_;
        poseStack.m_85836_();
        poseStack.m_85841_(SCALE, SCALE, SCALE);

        Matrix4f matrix = poseStack.m_85850_().m_252922_();
        float x = -font.m_92852_(pronoun) / 2.0F;

        // Same two passes as the vanilla name tag: faint through walls, then solid.
        font.m_272077_(pronoun, x, LINE_Y, 0x20FFFFFF, false, matrix, buffer,
                Font.DisplayMode.SEE_THROUGH, 0, packedLight);
        font.m_272077_(pronoun, x, LINE_Y, 0xFFFFFFFF, false, matrix, buffer,
                Font.DisplayMode.NORMAL, 0, packedLight);

        poseStack.m_85849_();
    }
}
