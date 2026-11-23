package com.aurorastudios.vicky.pronouns;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

/** Shared text utilities: sanitising player input and turning § codes into styled components. */
public final class PronounText {
    public static final int MAX_LENGTH = 32;
    public static final char SECTION = '§';

    private PronounText() {
    }

    /** Keeps only visible characters and valid Minecraft formatting codes. */
    public static String sanitize(String raw) {
        if (raw == null) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < raw.length() && out.length() < MAX_LENGTH; i++) {
            char c = raw.charAt(i);
            if (c == SECTION && i + 1 < raw.length()) {
                char code = raw.charAt(i + 1);
                if (isValidCode(code)) {
                    out.append(SECTION).append(code);
                    i++;
                }
                continue;
            }
            if (c < 0x20 || c == 0x7f) {
                continue;
            }
            out.append(c);
        }
        return out.toString();
    }

    private static boolean isValidCode(char code) {
        return "0123456789abcdefklmnor".indexOf(Character.toLowerCase(code)) >= 0;
    }

    /** Parses legacy § codes into a Component with real styles (colour, bold, italic, ...). */
    public static Component parse(String raw) {
        MutableComponent result = Component.m_237119_();
        Style current = Style.f_131099_;
        StringBuilder text = new StringBuilder();

        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == SECTION && i + 1 < raw.length()) {
                ChatFormatting formatting = ChatFormatting.m_126645_(raw.charAt(i + 1));
                if (formatting != null) {
                    if (text.length() > 0) {
                        result.m_7220_(Component.m_237113_(text.toString()).m_6270_(current));
                        text.setLength(0);
                    }
                    current = formatting == ChatFormatting.RESET
                            ? Style.f_131099_
                            : current.m_131140_(formatting);
                    i++;
                    continue;
                }
            }
            text.append(c);
        }
        if (text.length() > 0) {
            result.m_7220_(Component.m_237113_(text.toString()).m_6270_(current));
        }
        return result;
    }
}
