# Aurora Admin — adaptar o EML AdminTool ao nosso fluxo

## Objetivo

Transformar o EML AdminTool em **nosso** painel: a página onde a equipe cuida de usuários/PIN
e publica o modpack. O storage dos arquivos passa a ser o **GitHub Releases**, não o disco do
servidor. Assim o painel pode rodar em hosting gratuito sem disco persistente e sem cartão.

O launcher **não muda**: continua lendo `MODPACK_URL`
(`.../releases/download/modpack/modpack.json`). A integração com AdminTool feita em `4024699`
fica desligada (sem `AURORA_ADMIN_URL`), como está hoje.

## Por que o GitHub

- Os 1,2 GB do modpack já estão na tag `modpack` como assets de release.
- Release assets saem pela CDN do GitHub, com HTTPS, sem limite de banda LFS e sem custo.
- `scripts/publish-modpack.mjs` já sabe reconcilar assets, calcular `size`/`sha1`, gerar o
  `modpack.json` e publicar sem deixar o manifesto faltando.
- O disco some do problema: não precisamos mais de Postgres no Render nem de volume.

## Arquitetura

```
Equipe -> Aurora Admin (fork do EML AdminTool)
            |  usuários, PIN, permissões (Postgres - Neon free na nuvem)
            |  página /dashboard/aurora (nossa)
            v
       GitHub API (token fine-grained guardado no servidor)
            |  upload/delete de assets da release `modpack`
            |  regera `modpack.json`
            v
       Launcher -> MODPACK_URL -> jogadores
```

- **Fork**: `vickyAqui/EML-AuroraTools` (repo separado, sob controle da Aurora).
- **Banco**: manter o Prisma/Postgres do AdminTool para login/PIN/profiles. Na nuvem, usar
  Postgres gratuito externo (Neon/Supabase); localmente, o Compose atual já serve.
- **Storage**: módulo novo `$lib/server/github-storage.ts` no fork, portando
  `assetNameFor`, `buildManifestEntries`, `validateManifest` e a reconciliação de
  `scripts/modpack-utils.mjs` + `scripts/publish-modpack.mjs` deste repo.
- **Página nova**: `/dashboard/aurora` com a identidade visual da Aurora, usando o login e a
  permissão `Files Updater` que o AdminTool já tem. Ações: listar assets, enviar arquivo,
  remover arquivo, **Publicar versão** (gera e sobe o `modpack.json`).
- **Hosting**: Render Web Service **free** (Docker, sem cartão, sem disco; o filesystem é
  efêmero mas não guardamos mais nada nele). Hibernação só deixa o painel lento no primeiro
  acesso — os jogadores não são afetados porque baixam direto do GitHub.

## Segurança

- Token GitHub **fine-grained**, só `Contents: read/write` no repo do modpack. Nunca vai para
  o navegador, o repo ou o chat; fica como segredo do serviço (`GH_TOKEN`).
- Equipe continua recebendo só PIN + `Files Updater`. Bootstraps/Maintenance/News/Backgrounds
  seguem desligados.
- Rodízio do token e do PIN documentado no fork.

## O que NÃO muda agora

- `package.json` continua `1.2.9`; sem tag/release.
- Nenhum restart do servidor de jogo, `/reload` ou upload para o servidor.
- `cleaning.enabled=false`, slider de RAM e args JVM extras intactos.
- O launchConfig com AdminTool continua no código, mas inativo.

## Fases

1. **Fork + adapter**: usar `vickyAqui/EML-AuroraTools`, adicionar `github-storage.ts`, as rotas
   `/api/aurora/*` e a página `/dashboard/aurora`. Manter o resto do AdminTool intacto.
2. **Teste local**: usar o Compose atual com um Postgres local e um token de teste; enviar um
   arquivo pequeno, publicar, conferir se o `modpack.json` gerado casa com o nosso.
3. **Nuvem**: Render free + Neon free; configurar `ORIGIN`, `ALLOWED_ORIGINS`, `DATABASE_URL`,
   `GH_TOKEN`; validar HTTPS e login.
4. **Equipe**: criar contas com PIN e aprovar só `Files Updater`.
5. **Só com aval depois**: bump/release do launcher, se um dia quisermos embutir a URL do painel.

## Pendências para começar

- ~~Onde criar o fork~~: `vickyAqui/EML-AuroraTools`.
- Como o token será entregue ao servidor (variável de ambiente no painel do host, nunca no chat).
- Definir se a página Aurora substitui de vez o **Files Updater** nativo ou convive com ele (o
  nativo continuaria escrevendo no disco efêmero e não serve mais para produção).
