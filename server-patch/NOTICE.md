# Aviso de modificação

Este diretório contém uma build **não oficial e modificada** do mod **meds and herbs
2.0.3**, de autoria de **ChebyPattern** (https://modrinth.com/mod/meds-and-herbs).

## Atribuição e licença

- Autor original: ChebyPattern
- Página do mod: https://modrinth.com/mod/meds-and-herbs
- Licença listada pelo autor no Modrinth: **Apache License 2.0**
- Licença declarada no `META-INF/mods.toml` do jar 2.0.3: **Academic Free License v3.0**
- Os textos das duas licenças estão em `licenses/`.

## Modificação

O jar `mods/meds_and_herbs-1.20.1-2.0.3.jar` é uma versão modificada do jar oficial
2.0.3. A única alteração é a neutralização, via bytecode, de 264 chamadas que
aplicavam/removiam efeitos e alteravam `AttributeInstance.setBaseValue`:

- 180 chamadas a `LivingEntity.addEffect(MobEffectInstance)`
- 75 chamadas a `LivingEntity.removeEffect(MobEffect)`
- 9 chamadas a `AttributeInstance.setBaseValue(double)`

Nenhum outro conteúdo foi alterado. Todos os recursos (texturas, modelos, receitas,
`mods.toml`, etc.) são byte a byte idênticos aos do jar original, e a estrutura das
815 classes (anotações, campos, assinaturas de métodos, `maxStack`/`maxLocals`)
também é idêntica.

Esta build é destinada ao servidor dedicado do usuário. Não é afiliada, endossada ou
suportada pelo autor original. É fornecida "como está", sem garantias.
