# Aurora Studios Launcher

**Launcher oficial da Aurora Studios — a sua porta de entrada para a Terra dos Sonhos.**

Built with **Electron + Vite**, powered by [EML Lib](https://github.com/Electron-Minecraft-Launcher/EML-Lib-v2).

![Aurora Studios](.github/assets/screenshot.png)

[<p align="center"><img src="https://img.shields.io/badge/platforms-Windows,_macOS,_Linux-0077DA?style=for-the-badge&color=0077DA">](#plataformas)
[<img src="https://img.shields.io/badge/version-1.3.9-7c6cff?style=for-the-badge&color=7c6cff">](package.json)</p>

---

## Introduction

O **Aurora Studios Launcher** é um launcher moderno e rápido para o servidor Minecraft Aurora Studios, construído sobre **Electron + Vite** e **EML Lib**.

## Features

- **Performance**: Built on **Vite**, oferecendo inicialização instantânea e Hot-Module-Replacement (HMR).
- **Autenticação Microsoft**: Integração completa do fluxo oficial de login via EML Lib.
- **Gerenciamento de arquivos**: Download inteligente dos arquivos do jogo (Java, bibliotecas, assets, mods) com validação de hash via EML Lib.
- **Auto-update**: Sistema de atualização automática via GitHub Releases.
- **Skin & cape**: Visualize e equipe skins e capes diretamente no launcher.

## Instalação & Desenvolvimento

### Pré-requisitos

- **Node.js** (v18 ou superior)
- **npm** (ou Yarn/Pnpm)

### Setup

1.  Clone o repositório:

    ```bash
    git clone https://github.com/vickyAqui/aurora-launcher.git
    cd aurora-launcher
    ```

2.  Instale as dependências:

    ```bash
    npm install
    ```

    _Nota: instala automaticamente o `eml-lib` e as ferramentas de build._

3.  Inicie em modo desenvolvimento:

    ```bash
    npm run dev
    ```

    Uma janela do Electron abrirá com hot-reload ativado.

## Configuração

### Modpack

O manifest do modpack e os arquivos são distribuídos via GitHub Releases.

#### Como Atualizar o Modpack

O modpack é sincronizado entre o repositório e os clientes via um arquivo `modpack.json` (manifest). Cada mod tem hash SHA1 e tamanho registrados, garantindo integridade.

**Fluxo rápido (dia a dia)**:

1.  Adicione/remova `.jar` na pasta `./modpack`.
2.  Gere o manifest localmente:

    ```bash
    npm run modpack:build
    ```

3.  Faça commit e push do `modpack.json` atualizado — o launcher baixa automaticamente.

**Fluxo completo (quando precisar subir novos mods)**:

1.  Configure o token (só na primeira vez):

    ```bash
    export GH_TOKEN="seu_token_aqui"
    ```

2.  Publique os mods + manifest no GitHub Releases:

    ```bash
    npm run modpack:publish
    ```

3.  Copie o `modpack.json` gerado pra raiz do repo e faça commit + push.

> **Scripts disponíveis**:
> - `modpack:build` — gera `modpack.json` localmente (rápido, sem upload)
> - `modpack:publish` — sobe mods no GitHub Releases e gera o manifest (lento, para novos mods)
> - `modpack:update` — recalcula hashes de mods já hospedados (sem reenviar arquivos)

### Customização de ícones

Para alterar a identidade visual, substitua os arquivos da pasta `build/`:

- `icon.png`: Ícone padrão (512x512).
- `icon.ico`: Para Windows.
- `icon.icns`: Para macOS.
- `background.png`: Fundo do instalador DMG (macOS).

### Build (distribuição)

| Plataforma | Comando               | Formato de saída           |
| ---------- | --------------------- | -------------------------- |
| Windows    | `npm run release:win` | `.exe` (instalador NSIS)   |
| macOS      | `npm run release:mac` | `.dmg` (imagem de disco)   |
| Linux      | `npm run release:lin` | `.AppImage`                |

Os arquivos compilados ficam na pasta `release/`.

## Contribuindo

Contribuições são bem-vindas! Para mudanças grandes, abra uma issue primeiro para discutir o que deseja alterar.
