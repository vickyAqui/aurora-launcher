#!/usr/bin/env python3
"""Inventário do modpack para avaliar um port ao Horizon.

Lê cada jar de `modpack/mods/`, extrai metadados (id, nome, versão, licença, dependências)
e sinais de conteúdo (blocos, itens, entidades, worldgen, GUI, mixins), e grava:

  docs/horizon-inventory.csv  — uma linha por mod
  docs/horizon-inventory.md   — resumo por tier e por licença

O tier é uma **heurística** a partir dos sinais do jar, não uma classificação oficial:
serve para separar candidatos, não para decidir sozinho o esforço de port.

Uso: python scripts/horizon-inventory.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
import tomllib
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODS_DIR = ROOT / "modpack" / "mods"
CSV_PATH = ROOT / "docs" / "horizon-inventory.csv"
MD_PATH = ROOT / "docs" / "horizon-inventory.md"

# Dependências que não são mods de conteúdo e não entram na lista.
IGNORED_DEPS = {
    "minecraft",
    "forge",
    "neoforge",
    "fabricloader",
    "fabric",
    "java",
    "javafml",
    "lowcodefml",
}

TIER_ORDER = ["deep", "machines", "logic", "data", "library", "client", "none"]
TIER_LABEL = {
    "deep": "deep (entidades/worldgen)",
    "machines": "machines (GUI/block entities)",
    "logic": "logic (mixins/comportamento)",
    "data": "data (só registries)",
    "library": "library (API/base para outros mods)",
    "client": "client (GUI sem conteúdo)",
    "none": "none (performance/ferramenta)",
}

# Bibliotecas conhecidas: dependem delas, mas elas mesmas não são conteúdo.
# Sem esta lista, uma lib com alguns assets de exemplo (GeckoLib, Citadel) cairia em "deep".
LIBRARY_IDS = {
    "accessories",
    "architectury",
    "athena",
    "baguettelib",
    "balm",
    "blueprint",
    "bookshelf",
    "citadel",
    "cloth_config",
    "corgilib",
    "creativecore",
    "cupboard",
    "curios",
    "deltaboxlib",
    "duclib",
    "framework",
    "ftblibrary",
    "fusion",
    "geckolib",
    "gtbcs_spell_lib",
    "irons_lib",
    "jinxedlib",
    "kotlinforforge",
    "konkrete",
    "lionfishapi",
    "lithostitched",
    "lodestone",
    "mantle",
    "monolib",
    "moonlight",
    "patchouli",
    "placebo",
    "playeranimator",
    "puzzleslib",
    "raccooncore",
    "recipes_lib",
    "resourcefullib",
    "rhino",
    "searchables",
    "sophisticatedcore",
    "supermartijn642configlib",
    "supermartijn642corelib",
    "tenshilib",
    "terrablender",
    "txnilib",
    "unilib",
    "watermedia",
    "yungsapi",
}
LICENSE_ORDER = ["permissive", "copyleft", "restrictive", "arr", "custom", "unknown"]
LICENSE_LABEL = {
    "permissive": "permissiva (MIT/Apache/BSD/CC0...)",
    "copyleft": "copyleft (GPL/LGPL/MPL...)",
    "restrictive": "restritiva (NC/ND)",
    "arr": "All Rights Reserved",
    "custom": "custom",
    "unknown": "desconhecida",
}


def license_class(license_text: str | None) -> str:
    if not license_text:
        return "unknown"
    text = license_text.lower()
    compact = re.sub(r"[^a-z]", "", text)
    if not compact or compact in {"notspecified", "nolicense", "unknown", "none"}:
        return "unknown"
    # Restritivas primeiro: NC/ND e licenças "source-available" sem derivados.
    if "non-commercial" in text or "noncommercial" in text or "no-derivatives" in text:
        return "restrictive"
    if re.search(r"\b(nc|nd)\b", text) or "polyformstrict" in compact or "polyformnoncommercial" in compact:
        return "restrictive"
    if "allrightsreserved" in compact or compact in {"arr", "proprietary"}:
        return "arr"
    # Nomes por extenso ("GNU Lesser General Public License") não batem com a sigla.
    if (
        re.search(r"\b(a?gpl|lgpl|mpl|epl|cddl|osl)", text)
        or "general public license" in text
        or "mozilla public license" in text
    ):
        return "copyleft"
    if re.search(r"\b(mit|apache|bsd|cc0|cc-by|isc|unlicense|zlib|wtfpl|artistic|afl)", text) or "academicfree" in compact:
        return "permissive"
    return "custom"


def tier_of(row: dict) -> str:
    if row["mod_id"] in LIBRARY_IDS:
        return "library"
    # Itens/modelos sozinhos não são conteúdo de mundo: ferramentas de cliente também têm ícones.
    content = any(row[key] > 0 for key in ("blockstates", "entity_tex", "worldgen", "recipes", "loot"))
    if not content:
        return "client" if row["gui_tex"] > 0 else "none"
    if row["entity_tex"] >= 5 or row["worldgen_deep"] > 0:
        return "deep"
    if row["gui_tex"] > 0:
        return "machines"
    if row["mixins"] > 0 or row["refmap"] > 0:
        return "logic"
    return "data"


def scan_entries(zf: zipfile.ZipFile) -> dict:
    counts = {
        "entries": 0,
        "classes": 0,
        "blockstates": 0,
        "block_models": 0,
        "item_models": 0,
        "block_tex": 0,
        "item_tex": 0,
        "entity_tex": 0,
        "gui_tex": 0,
        "recipes": 0,
        "loot": 0,
        "worldgen": 0,
        "worldgen_deep": 0,
        "tags": 0,
        "mixins": 0,
        "refmap": 0,
        "sounds": 0,
        "lang": 0,
    }
    for name in zf.namelist():
        counts["entries"] += 1
        if name.endswith(".class"):
            counts["classes"] += 1
        elif name.startswith("assets/") and "/blockstates/" in name:
            counts["blockstates"] += 1
        elif name.startswith("assets/") and "/models/block/" in name:
            counts["block_models"] += 1
        elif name.startswith("assets/") and "/models/item/" in name:
            counts["item_models"] += 1
        elif name.startswith("assets/") and "/textures/block/" in name:
            counts["block_tex"] += 1
        elif name.startswith("assets/") and "/textures/item/" in name:
            counts["item_tex"] += 1
        elif name.startswith("assets/") and "/textures/entity/" in name:
            counts["entity_tex"] += 1
        elif name.startswith("assets/") and "/textures/gui/" in name:
            counts["gui_tex"] += 1
        elif name.startswith("data/") and "/recipes/" in name:
            counts["recipes"] += 1
        elif name.startswith("data/") and "/loot_tables/" in name:
            counts["loot"] += 1
        elif name.startswith("data/") and "/worldgen/" in name:
            counts["worldgen"] += 1
            category = name.split("/worldgen/", 1)[1].split("/", 1)[0]
            if category in {"biome", "dimension", "dimension_type"}:
                counts["worldgen_deep"] += 1
        elif name.startswith("data/") and "/tags/" in name:
            counts["tags"] += 1
        elif name.endswith(".mixins.json") or "/mixins." in name:
            counts["mixins"] += 1
        elif name.endswith("refmap.json"):
            counts["refmap"] += 1
        elif name.startswith("assets/") and name.endswith("/sounds.json"):
            counts["sounds"] += 1
        elif name.startswith("assets/") and "/lang/" in name:
            counts["lang"] += 1
    return counts


def read_forge_meta(zf: zipfile.ZipFile) -> dict | None:
    for path in ("META-INF/mods.toml", "META-INF/neoforge.mods.toml"):
        try:
            raw = zf.read(path)
        except KeyError:
            continue
        try:
            data = tomllib.loads(raw.decode("utf-8", errors="replace"))
        except tomllib.TOMLDecodeError:
            return {"parse_error": path}
        mods = data.get("mods") or []
        first = mods[0] if mods else {}
        deps: set[str] = set()
        for entries in (data.get("dependencies") or {}).values():
            for dep in entries or []:
                dep_id = str(dep.get("modId", "")).strip()
                if dep_id and dep_id.lower() not in IGNORED_DEPS:
                    deps.add(dep_id)
        return {
            "mod_id": str(first.get("modId", "")).strip(),
            "name": str(first.get("displayName") or first.get("modId") or "").strip(),
            "version": str(first.get("version", "")).strip(),
            "license": str(data.get("license", "")).strip(),
            "deps": deps,
        }
    return None


def read_fabric_meta(zf: zipfile.ZipFile) -> dict | None:
    try:
        data = json.loads(zf.read("fabric.mod.json").decode("utf-8", errors="replace"))
    except (KeyError, json.JSONDecodeError):
        return None
    deps = {str(k) for k in (data.get("depends") or {}) if str(k).lower() not in IGNORED_DEPS}
    return {
        "mod_id": str(data.get("id", "")).strip(),
        "name": str(data.get("name") or data.get("id") or "").strip(),
        "version": str(data.get("version", "")).strip(),
        "license": str(data.get("license", "")).strip(),
        "deps": deps,
    }


def inspect(path: Path) -> dict:
    row = {"file": path.name, "size": path.stat().st_size}
    try:
        with zipfile.ZipFile(path) as zf:
            row.update(scan_entries(zf))
            meta = read_forge_meta(zf) or read_fabric_meta(zf) or {}
            if not meta:
                meta = read_fabric_meta(zf) or {}
    except (zipfile.BadZipFile, OSError) as err:
        row.update({key: 0 for key in ("entries", "classes", "blockstates", "block_models", "item_models",
                                       "block_tex", "item_tex", "entity_tex", "gui_tex", "recipes", "loot",
                                       "worldgen", "worldgen_deep", "tags", "mixins", "refmap", "sounds", "lang")})
        row["error"] = str(err)
        meta = {}

    row["mod_id"] = meta.get("mod_id", "")
    row["name"] = meta.get("name", "") or path.name
    row["version"] = meta.get("version", "")
    row["license"] = meta.get("license", "")
    row["license_class"] = license_class(row["license"])
    row["deps"] = ";".join(sorted(meta.get("deps", set())))
    row["tier"] = tier_of(row)
    return row


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def main() -> int:
    if not MODS_DIR.is_dir():
        print(f"pasta não encontrada: {MODS_DIR}", file=sys.stderr)
        return 1

    files = sorted(p for p in MODS_DIR.iterdir() if p.is_file() and (p.suffix == ".jar" or p.name.endswith(".jar.disabled")))
    rows = [inspect(path) for path in files]

    columns = [
        "file", "mod_id", "name", "version", "license", "license_class", "tier",
        "classes", "blockstates", "block_models", "item_models", "block_tex", "item_tex",
        "entity_tex", "gui_tex", "recipes", "loot", "worldgen", "worldgen_deep", "tags", "mixins", "refmap",
        "sounds", "lang", "size", "deps", "error",
    ]
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(rows, key=lambda r: (TIER_ORDER.index(r["tier"]), LICENSE_ORDER.index(r["license_class"]), r["name"].lower())):
            writer.writerow(row)

    tier_counts = Counter(row["tier"] for row in rows)
    license_counts = Counter(row["license_class"] for row in rows)
    cross = Counter((row["tier"], row["license_class"]) for row in rows)
    dep_counts = Counter(dep for row in rows for dep in row["deps"].split(";") if dep)

    total_classes = sum(row["classes"] for row in rows)
    total_size = sum(row["size"] for row in rows)
    with_content = sum(1 for row in rows if row["tier"] in {"deep", "machines", "logic", "data"})
    shortlist = [
        row for row in rows
        if row["license_class"] in {"permissive", "copyleft"} and row["tier"] in {"data", "logic"}
    ]
    shortlist.sort(key=lambda r: (TIER_ORDER.index(r["tier"]), r["classes"]))

    lines = [
        "# Inventário do modpack para o Horizon",
        "",
        "Gerado por `python scripts/horizon-inventory.py`. Não editar à mão.",
        "",
        f"- Mods: **{len(rows)}**",
        f"- Tamanho: **{total_size / 1024 / 1024:.1f} MB**",
        f"- Classes Java: **{total_classes:,}**".replace(",", "."),
        f"- Com conteúdo (blocos/itens/entidades/worldgen): **{with_content}**",
        f"- Bibliotecas e ferramentas (sem conteúdo): **{len(rows) - with_content}**",
        "",
        "## Por tier (heurística)",
        "",
        md_table(["tier", "mods"], [[TIER_LABEL[t], tier_counts.get(t, 0)] for t in TIER_ORDER]),
        "",
        "> O tier vem dos sinais do jar (assets, classes, mixins), não de uma análise do código.",
        "> Serve para separar candidatos; o esforço real de port precisa ser medido mod a mod.",
        "",
        "## Por licença",
        "",
        md_table(["licença", "mods"], [[LICENSE_LABEL[l], license_counts.get(l, 0)] for l in LICENSE_ORDER]),
        "",
        "## Tier × licença",
        "",
        md_table(
            ["tier"] + [LICENSE_LABEL[l].split(" ")[0] for l in LICENSE_ORDER],
            [[TIER_LABEL[t].split(" ")[0]] + [cross.get((t, l), 0) for l in LICENSE_ORDER] for t in TIER_ORDER],
        ),
        "",
        "## Candidatos para prova de conceito",
        "",
        "Mods de conteúdo `data`/`logic` com licença permissiva ou copyleft (os mais baratos de portar):",
        "",
        md_table(
            ["mod", "tier", "licença", "classes", "blocos", "receitas", "deps"],
            [
                [
                    row["name"],
                    row["tier"],
                    row["license_class"],
                    row["classes"],
                    row["blockstates"],
                    row["recipes"],
                    row["deps"][:80],
                ]
                for row in shortlist[:40]
            ],
        ),
        "",
        "## Dependências mais comuns",
        "",
        md_table(["mod", "quantos dependem"], [[dep, count] for dep, count in dep_counts.most_common(20)]),
        "",
        "## Maiores por classes",
        "",
        md_table(
            ["mod", "classes", "tier", "licença"],
            [[row["name"], row["classes"], row["tier"], row["license_class"]] for row in sorted(rows, key=lambda r: -r["classes"])[:20]],
        ),
    ]
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"{len(rows)} mods -> {CSV_PATH.relative_to(ROOT)}")
    print(f"resumo -> {MD_PATH.relative_to(ROOT)}")
    print("tiers:", dict(tier_counts))
    print("licenças:", dict(license_counts))
    print("candidatos data/logic com licença ok:", len(shortlist))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
