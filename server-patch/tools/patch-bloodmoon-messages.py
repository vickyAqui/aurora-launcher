"""Troca as mensagens hardcoded do Bloodmoon Update 1.4.1.

O mod grava as duas mensagens direto no constant pool de
BloodmoonUtils.class, entao nao ha config nem traducao para editar. Este
script reescreve apenas essas duas entradas UTF-8 e reconstrui o jar.

Uso:
    python server-patch/tools/patch-bloodmoon-messages.py <jar-original> <jar-saida>
"""

import struct
import sys
import zipfile
from pathlib import Path

TARGET = "net/foufakirby/bloodmoon/util/common/BloodmoonUtils.class"

REPLACEMENTS = {
    "§c💀 A bloodmoon is rising... Beware of the monsters... 💀": "§4§lA Raiva clama por uma resolução",
    "The strange moon is fading": "§4§lA Raiva se acalma...",
}


def decode_modified_utf8(raw: bytes) -> str:
    """UTF-8 do class file: suplementares vem como par de surrogates."""
    return raw.decode("utf-8", "surrogatepass").encode("utf-16", "surrogatepass").decode("utf-16")


def encode_modified_utf8(text: str) -> bytes:
    """Escrita UTF-8 usada pelo JVM no constant pool (surrogate pairs)."""
    out = bytearray()
    for char in text:
        codepoint = ord(char)
        if codepoint == 0:
            out += b"\xc0\x80"
        elif codepoint < 0x80:
            out.append(codepoint)
        elif codepoint < 0x800:
            out += bytes((0xC0 | codepoint >> 6, 0x80 | codepoint & 0x3F))
        elif codepoint < 0x10000:
            out += bytes(
                (0xE0 | codepoint >> 12, 0x80 | (codepoint >> 6) & 0x3F, 0x80 | codepoint & 0x3F)
            )
        else:
            codepoint -= 0x10000
            for unit in (0xD800 + (codepoint >> 10), 0xDC00 + (codepoint & 0x3FF)):
                out += bytes((0xE0 | unit >> 12, 0x80 | (unit >> 6) & 0x3F, 0x80 | unit & 0x3F))
    return bytes(out)


def patch_class(data: bytes) -> tuple[bytes, int]:
    count = struct.unpack_from(">H", data, 8)[0]
    cursor = 10
    entries = []
    changed = 0

    index = 1
    while index < count:
        start = cursor
        tag = data[cursor]
        if tag == 1:
            length = struct.unpack_from(">H", data, cursor + 1)[0]
            text = decode_modified_utf8(data[cursor + 3 : cursor + 3 + length])
            cursor += 3 + length
            if text in REPLACEMENTS:
                new_text = REPLACEMENTS[text]
                new_raw = encode_modified_utf8(new_text)
                entries.append(b"\x01" + struct.pack(">H", len(new_raw)) + new_raw)
                print(f"  {text!r}\n    -> {new_text!r}")
                changed += 1
            else:
                entries.append(data[start:cursor])
        elif tag in (7, 8, 16, 19, 20):
            cursor += 3
            entries.append(data[start:cursor])
        elif tag == 15:
            cursor += 4
            entries.append(data[start:cursor])
        elif tag in (3, 4, 9, 10, 11, 12, 17, 18):
            cursor += 5
            entries.append(data[start:cursor])
        elif tag in (5, 6):
            cursor += 9
            entries.append(data[start:cursor])
            index += 1  # long/double ocupam duas posicoes no constant pool
        else:
            raise ValueError(f"tag de constant pool desconhecida: {tag} em {start}")

        index += 1

    return data[:10] + b"".join(entries) + data[cursor:], changed


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])

    with zipfile.ZipFile(source) as original:
        if TARGET not in original.namelist():
            raise SystemExit(f"classe nao encontrada no jar: {TARGET}")
        patched_class, changed = patch_class(original.read(TARGET))
        if changed != len(REPLACEMENTS):
            raise SystemExit(f"esperava {len(REPLACEMENTS)} mensagens, achei {changed}")

        destination.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(destination, "w") as patched:
            for info in original.infolist():
                data = patched_class if info.filename == TARGET else original.read(info.filename)
                patched.writestr(info, data)

    print(f"jar patchado: {destination} ({destination.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
