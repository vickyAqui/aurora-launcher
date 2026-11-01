# AppImage no Linux — solução de problemas

Guia para quando o `Aurora-Studios-<versão>.AppImage` não abre em distribuições baseadas em
Ubuntu/Debian (ZorinOS, Ubuntu, Mint, Pop!\_OS, elementary...).

## 1. Primeiro: rode pelo terminal

Abrir pelo terminal mostra o erro real, que o duplo-clique esconde.

```bash
cd ~/Downloads            # ou a pasta onde o arquivo está
chmod +x Aurora-Studios-*.AppImage
./Aurora-Studios-*.AppImage
```

Se aparecer uma janela, o problema era só a permissão de execução.

## 2. "Permission denied"

O AppImage precisa ser executável:

```bash
chmod +x Aurora-Studios-*.AppImage
```

No gerenciador de arquivos (GNOME Files / Nautilus): clique com o botão direito → **Propriedades** →
**Permissões** → marque **Permitir executar o arquivo como um programa**.

## 3. "dlopen(): error loading libfuse.so.2" ou nada acontece

O AppImage usa FUSE para montar a aplicação. O Ubuntu 22.04+ (e o ZorinOS 17+) não instala o
`libfuse2` por padrão.

```bash
# ZorinOS 17 / Ubuntu 22.04
sudo apt update && sudo apt install libfuse2

# ZorinOS 18 / Ubuntu 24.04 (pacote renomeado)
sudo apt update && sudo apt install libfuse2t64
```

Se não souber a versão:

```bash
sudo apt install libfuse2 || sudo apt install libfuse2t64
```

## 4. "The SUID sandbox helper binary was found, but is not configured correctly"

O Ubuntu 24.04+ restringe _user namespaces_ via AppArmor, e o sandbox do Electron deixa de
funcionar dentro do AppImage. Teste:

```bash
./Aurora-Studios-*.AppImage --no-sandbox
```

Se abrir, o problema é o sandbox. Para uso diário, crie um atalho `.desktop` com `--no-sandbox` ou
instale a versão `.deb` (quando disponível), que configura o sandbox corretamente.

> `--no-sandbox` reduz o isolamento do processo. Use só se as outras opções não funcionarem.

## 5. Contornar o FUSE sem instalar nada

O AppImage pode ser extraído e executado direto:

```bash
./Aurora-Studios-*.AppImage --appimage-extract
./squashfs-root/AppRun
```

Isso funciona mesmo sem `libfuse2`. Para criar um atalho, use o caminho
`~/Downloads/squashfs-root/AppRun`.

## 6. Erro de biblioteca (`GLIBC_2.xx not found`, `libX11`, `libgbm`...)

- Confirme a arquitetura: `uname -m` deve ser `x86_64` (o AppImage publicado é 64 bits Intel/AMD).
- Instale as bibliotecas gráficas básicas:

```bash
sudo apt install libgtk-3-0 libnss3 libasound2 libgbm1 libxss1
```

- Se o erro citar `GLIBC_2.39` ou superior, o AppImage foi compilado numa versão mais nova que a sua.
  Nesse caso é preciso uma build feita em Ubuntu 22.04 — abra uma issue.

## 7. Ver o log do launcher

O launcher grava log com `electron-log`:

```bash
find ~/.config -iname "main.log" 2>/dev/null
```

O caminho costuma ser `~/.config/Aurora Studios/logs/main.log`. Anexe o final desse arquivo ao pedir
ajuda.

## Resumo rápido

| Sintoma                      | Causa provável   | Solução                    |
| ---------------------------- | ---------------- | -------------------------- |
| Duplo-clique não faz nada    | sem permissão    | `chmod +x`                 |
| "error loading libfuse.so.2" | falta FUSE       | `libfuse2` / `libfuse2t64` |
| "SUID sandbox helper..."     | AppArmor/userns  | `--no-sandbox` ou `.deb`   |
| Abre e fecha na hora         | driver gráfico   | `--disable-gpu`            |
| `GLIBC_2.xx not found`       | build muito nova | build em Ubuntu 22.04      |
