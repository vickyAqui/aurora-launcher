# Perfil Horizon (experimental) — plano

Status: **planejamento**. Nada aqui está implementado.

Objetivo: oferecer o Horizon como uma experiência **separada e opcional** dentro do launcher da
Aurora, sem tocar no perfil Forge 1.20.1 que os jogadores usam hoje.

## 1. Premissas

- O Horizon **não substitui** o modpack atual. Ele roda Minecraft Java **26.3**, não carrega jars
  Java/Forge e não tem os ~302 mods da Aurora.
- O perfil Forge continua sendo o produto principal. O Horizon entra como "laboratório".
- O launcher atual tem **um único perfil** (`DEFAULT_PROFILE`) e o seletor de perfis foi removido de
  propósito. A integração **não** deve reintroduzir seletor: entra como um card/seção própria.
- A conta Microsoft do jogador é autenticada pelo launcher da Aurora via `eml-lib`. O Horizon tem
  login próprio (device code) e **não reaproveita** esse token; o jogador vai precisar entrar de novo
  no Horizon.
- O Horizon é um projeto de terceiros (MIT, não oficial). Precisamos deixar isso explícito na UI.

## 2. Fatos verificados no Horizon (30/10/2026)

| Item               | Situação                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Versão alvo        | Minecraft Java 26.3                                                                            |
| Distribuição       | launcher próprio, canal **Nightly**                                                            |
| Assets do launcher | Windows x64 `.zip`, macOS arm64 `.dmg`/`.zip`, Linux x86_64 `.tar.gz`                          |
| Verificação        | GitHub publica `digest` SHA-256 por asset e um `SHA256SUMS`                                    |
| CLI                | `horizon-launcher` com `install`, `prepare`, `play`, `server`, `instance ...`, `mcp`           |
| Instâncias         | `instance create/select/version/export` — permite uma instância "Aurora" fixada numa versão    |
| Mods               | `.hmod` (dados/assets) e `.hnmod` (Rust nativo); **jars Java não rodam**                       |
| Servidor           | `horizon-server`, `server.properties`, online/offline mode, sem Docker publicado               |
| Conta              | o cliente Horizon ainda não entra em conta Microsoft; servidores online exigem cliente vanilla |
| Paridade           | 100% nos harnesses internos, mas **833 lacunas visíveis** abertas                              |

Consequências diretas:

1. Um modpack Forge **não pode ser portado** para o Horizon sem reescrever cada mod.
2. O servidor Horizon **não é** o servidor Arclight/Forge atual: é outro mundo, outra porta, outra
   comunidade.
3. O caminho barato é **orquestrar o launcher oficial do Horizon**, não reimplementar nada.

## 3. Arquitetura escolhida

```
Launcher Aurora (Electron)
├── perfil Forge 1.20.1  ← intocado (prepareMods + eml-lib)
└── módulo Horizon (novo)
    ├── baixa o launcher oficial (zip/dmg/tar.gz) do GitHub
    ├── verifica SHA-256 contra o digest publicado
    ├── extrai em <gameDir>/horizon/launcher/
    └── chama a CLI:
        horizon-launcher install latest
        horizon-launcher prepare
        horizon-launcher instance create "Aurora Horizon"
        horizon-launcher instance version "Aurora Horizon" <tag fixada>
        horizon-launcher instance select "Aurora Horizon"
        horizon-launcher play --instance "Aurora Horizon"
```

O Horizon se atualiza sozinho. A Aurora **não** mexe nos arquivos dele; só instala, abre e mostra
status. Isso reduz o custo de manutenção a quase zero quando o Horizon muda.

## 4. Fases

### Fase 0 — Spike de validação (1–2 dias)

Antes de escrever código de produto, provar que o fluxo funciona numa máquina limpa.

- [ ] Baixar `horizon-launcher-windows-x64.zip`, conferir o SHA-256 e extrair.
- [ ] Rodar `horizon-launcher versions` e `horizon-launcher install latest`.
- [ ] Rodar `horizon-launcher prepare --minecraft <pasta do launcher oficial>` com um 26.3 instalado.
- [ ] Criar instância, selecionar e abrir com `play --instance`.
- [ ] Testar `instance version` para fixar uma versão e ver se o `play` respeita.
- [ ] Medir: tempo de download, tamanho em disco, memória, se abre sem admin.
- [ ] Testar o status ping do servidor Horizon com o `ServerStatus` atual (protocolo 26.3).

**Critério de saída:** o jogo abre e dá para entrar num mundo, sem intervenção manual além do login
no Horizon. Se falhar aqui, o plano para.

### Fase 1 — Integração mínima no launcher (2–3 dias)

Entrega: card "Horizon (Experimental)" na home, com instalar/abrir/desinstalar. Sem modpack ainda.

Arquivos:

- `electron/const.ts`: `HORIZON` com repo, tag fixada, nomes de asset por plataforma.
- `electron/handlers/horizon.ts` (novo):
  - `horizon:status` → instalado?, versão, pasta, plataforma suportada.
  - `horizon:install` → baixa, verifica SHA-256, extrai, roda `install latest` e `prepare`.
  - `horizon:launch` → garante instância e chama `play --instance`.
  - `horizon:open_folder` / `horizon:uninstall`.
  - Tudo com `spawn` sem shell, caminhos absolutos e timeout.
- `electron/main.ts`: registrar o handler.
- `electron/preload.ts` + `src/ipc.ts`: tipos da API.
- `src/views/horizon.ts` (novo) + `index.html`: card com estados
  (indisponível / não instalado / baixando / pronto / erro).
- `src/views/home.ts`: só o ponto de montagem, sem mexer no fluxo do Play.
- `tests/horizon.test.ts`: download verificado, hash errado recusado, plataforma sem asset.

Regras:

- **Nunca** executar binário sem conferir o SHA-256 publicado.
- Plataformas sem asset (macOS Intel, Linux ARM) mostram "não suportado", não erro genérico.
- Nada de `shell: true`; argumentos em array.
- Se o Horizon não estiver instalado, o card não bloqueia nem altera o Play.

**Critério de saída:** jogador clica em "Instalar Horizon", vê progresso, e o jogo abre.

### Fase 2 — Conteúdo Aurora no Horizon (3–5 dias, opcional)

Entrega: instância "Aurora Horizon" com identidade própria (nome, ícone, packs, ajustes).

O que dá para levar sem portar código:

- [ ] Resource packs (texturas, fontes, UI) — suportados.
- [ ] Data packs (receitas, loot, worldgen) — suportados.
- [ ] `.hmod` próprios: blocos/itens novos via `data/<id>/horizon/block|item/*.json`
      (ex.: blocos decorativos da Aurora, itens de evento).
- [ ] Configurações iniciais: `options.txt`, `horizon-mods.txt`, presets gráficos.
- [ ] Empacotar tudo num zip versionado e publicar num release `horizon` (separado de `modpack`).
- [ ] `horizon:install` baixa e copia para a pasta da instância.

Não entra nesta fase: portar Alex's Mobs, Create, Apotheosis etc. Isso é o pipeline de "port de
modpack" do próprio Horizon, com agentes e harness, e não tem prazo razoável.

**Critério de saída:** abrir o Horizon já com o pack da Aurora aplicado.

### Fase 3 — Servidor Horizon separado (2–4 dias, opcional)

Entrega: um servidor Horizon paralelo, para testar com a comunidade.

- [ ] Provisionar host/porta separada (não reutilizar `79.182.128.137:25565`).
- [ ] `horizon-server` com `online_mode` conforme o suporte de conta do momento.
- [ ] `server.properties`, whitelist, EULA, backups e restart automático.
- [ ] Card do launcher mostra status do servidor Horizon (host/porta próprios).
- [ ] Deixar claro no Discord/site que é **outro servidor**, não o survival da Aurora.

Atenção: servidor Horizon 26.3 **não aceita** cliente Forge 1.20.1 e vice-versa.

**Critério de saída:** dois jogadores entram, conversam e o mundo persiste após restart.

### Fase 4 — Polimento (contínuo)

- [ ] Logs do Horizon em `logs/` do launcher (sem misturar com os do Forge).
- [ ] Botão "Abrir pasta do Horizon" e "Ver versão".
- [ ] Aviso de experimental no primeiro uso (uma vez).
- [ ] Estatísticas de tempo de jogo separadas por perfil.
- [ ] Checagem de atualização do Horizon semanal (só aviso, quem atualiza é ele).

## 5. Riscos

| Risco                                  | Impacto                 | Mitigação                                                                                    |
| -------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| Horizon ainda tem 833 lacunas visíveis | Jogador encontra bugs   | Rotular como experimental, não promover como substituto                                      |
| Canal Nightly, API/CLI pode mudar      | Integração quebra       | Fixar versão na instância e tratar falha de CLI como "indisponível"                          |
| Cliente Horizon sem login Microsoft    | Sem servidores online   | Servidor offline/LAN/tailnet na fase 3                                                       |
| Duas contas (Aurora e Horizon)         | Fricção no primeiro uso | Explicar na UI; não tentar reutilizar token                                                  |
| Binário de terceiros                   | Segurança               | HTTPS + SHA-256 do GitHub + versão fixada + sem shell                                        |
| Duplicar modpack/servidor/suporte      | Custo operacional       | Fases 2–3 só depois de validação real de uso                                                 |
| Licença/marca                          | Legal                   | MIT preservada, créditos ao Horizon, aviso de não oficial, não redistribuir assets da Mojang |

## 6. Fora de escopo

- Substituir o Forge 1.20.1 pelo Horizon.
- Portar os 302 mods atuais.
- Unificar servidor Forge e servidor Horizon.
- Reimplementar o launcher do Horizon dentro do Electron.
- Reaproveitar `eml-lib` para lançar o Horizon (ele é específico de Java).

## 7. Decisões pendentes

1. **Distribuição:** baixar o launcher oficial do Horizon ou apontar para o site
   (`playhorizon.dev/download`)? Baixar dá experiência integrada; apontar é mais simples e sempre
   atualizado.
2. **Versão:** fixar uma tag do Horizon por release da Aurora ou seguir `latest`?
3. **Conteúdo da fase 2:** pack próprio (`.hmod`/data packs) ou só um pack de texturas + ajustes?
4. **Servidor:** hospedar de verdade ou só documentar como o jogador cria o dele?

## 8. Estimativa

| Fase                  | Esforço  | Risco       |
| --------------------- | -------- | ----------- |
| 0 — spike             | 1–2 dias | baixo       |
| 1 — integração mínima | 2–3 dias | baixo/médio |
| 2 — conteúdo          | 3–5 dias | médio       |
| 3 — servidor          | 2–4 dias | médio/alto  |
| 4 — polimento         | contínuo | baixo       |

Recomendação: fazer **0 e 1** primeiro. Só seguir para 2 e 3 se houver jogadores usando o perfil
experimental de verdade.
