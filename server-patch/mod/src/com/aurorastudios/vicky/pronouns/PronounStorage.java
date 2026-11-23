package com.aurorastudios.vicky.pronouns;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraftforge.fml.loading.FMLPaths;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Server-side persistence: UUID -> raw pronoun text, stored in config/aurora_pronouns.json. */
public final class PronounStorage {
    private static final Logger LOGGER = LogManager.getLogger("AuroraVicky/Pronouns");
    private static final Map<String, String> DATA = new LinkedHashMap<>();
    private static Path file;

    private PronounStorage() {
    }

    public static synchronized void load() {
        file = FMLPaths.CONFIGDIR.get().resolve("aurora_pronouns.json");
        DATA.clear();
        if (!Files.isRegularFile(file)) {
            return;
        }
        try {
            JsonElement parsed = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8));
            if (!parsed.isJsonObject()) {
                return;
            }
            JsonObject root = parsed.getAsJsonObject();
            for (Map.Entry<String, JsonElement> entry : root.entrySet()) {
                JsonElement value = entry.getValue();
                if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
                    DATA.put(entry.getKey(), PronounText.sanitize(value.getAsString()));
                }
            }
            LOGGER.info("Loaded {} pronoun(s)", DATA.size());
        } catch (Exception e) {
            LOGGER.error("Could not read {}: {}", file, e.toString());
        }
    }

    public static synchronized void set(UUID uuid, String raw) {
        DATA.put(uuid.toString(), PronounText.sanitize(raw));
        save();
    }

    public static synchronized void remove(UUID uuid) {
        DATA.remove(uuid.toString());
        save();
    }

    public static synchronized Map<String, String> all() {
        return new LinkedHashMap<>(DATA);
    }

    public static synchronized void save() {
        if (file == null) {
            return;
        }
        JsonObject root = new JsonObject();
        DATA.forEach(root::addProperty);
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, root.toString(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            LOGGER.error("Could not write {}: {}", file, e.toString());
        }
    }
}
