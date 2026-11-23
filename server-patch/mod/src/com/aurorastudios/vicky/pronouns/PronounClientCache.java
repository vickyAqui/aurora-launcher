package com.aurorastudios.vicky.pronouns;

import net.minecraft.network.chat.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Client-side mirror of the server data. Empty text means "no pronoun" (entry removed). */
public final class PronounClientCache {
    private static final Map<UUID, Component> CACHE = new ConcurrentHashMap<>();

    private PronounClientCache() {
    }

    public static void set(UUID uuid, String raw) {
        if (raw == null || raw.isEmpty()) {
            CACHE.remove(uuid);
        } else {
            CACHE.put(uuid, PronounText.parse(raw));
        }
    }

    public static Component get(UUID uuid) {
        return CACHE.get(uuid);
    }
}
