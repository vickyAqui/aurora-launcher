package com.aurora.totem.client;

import com.aurora.totem.AuroraTotemMod;
import com.aurora.totem.registry.ModParticles;
import net.minecraft.client.Camera;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.Particle;
import net.minecraft.client.particle.ParticleProvider;
import net.minecraft.client.particle.ParticleRenderType;
import net.minecraft.client.particle.SpriteSet;
import net.minecraft.client.particle.TextureSheetParticle;
import net.minecraft.core.particles.SimpleParticleType;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RegisterParticleProvidersEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

@Mod.EventBusSubscriber(modid = AuroraTotemMod.MODID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
public class ClientParticleSetup {
    @SubscribeEvent
    public static void onRegisterProviders(RegisterParticleProvidersEvent event) {
        event.registerSpriteSet(ModParticles.TOTEM_VIOLA.get(), TotemParticleProvider::new);
    }

    public static class TotemParticleProvider implements ParticleProvider<SimpleParticleType> {
        private final SpriteSet sprites;

        public TotemParticleProvider(SpriteSet sprites) {
            this.sprites = sprites;
        }

        @Override
        public Particle createParticle(SimpleParticleType type, ClientLevel level,
                                       double x, double y, double z,
                                       double dx, double dy, double dz) {
            TextureSheetParticle particle = new TextureSheetParticle(level, x, y, z, dx, dy, dz) {
                {
                    this.lifetime = 24 + level.random.nextInt(12);
                    this.gravity = 0.01F;
                    this.hasPhysics = false;
                    this.pickSprite(sprites);
                    this.setSize(0.45F, 0.45F);
                }

                @Override
                public ParticleRenderType getRenderType() {
                    return ParticleRenderType.PARTICLE_SHEET_TRANSLUCENT;
                }

                @Override
                public void tick() {
                    super.tick();
                    this.alpha = 1.0F - (float) this.age / (float) this.lifetime;
                }
            };
            return particle;
        }
    }
}
