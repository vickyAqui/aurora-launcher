package com.aurorastudios.vicky;

import net.minecraftforge.fml.common.Mod;

/**
 * Mod de recursos: existe apenas para que o Forge carregue os assets do jar
 * (modelo e textura do Caldeirao Futuro) como pack de recursos do mod.
 *
 * Nao registra blocos, itens nem eventos. O pack de mods nao aparece na tela de
 * resource packs, entao o jogador nao consegue desativar o modelo.
 */
@Mod(AuroraVicky.MOD_ID)
public final class AuroraVicky {
    public static final String MOD_ID = "aurora_vicky";

    public AuroraVicky() {
        // Sem inicializacao: o conteudo do mod sao os assets em assets/.
    }
}
