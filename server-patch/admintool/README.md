# EML AdminTool — instância local da Aurora

Painel web da EML para gerenciar arquivos do launcher e dar acesso controlado à equipe.
A instância local roda na sua máquina com Docker; há também um Blueprint para subir a mesma
imagem no Render (`render.yaml` na raiz do repo). Nada foi aplicado em nuvem ainda.

## Subir o painel

Pré-requisito: Docker Desktop com Compose v2 (já detectado nesta máquina).

```powershell
cd C:\Users\galax\Desktop\aurora-launcher
docker compose -f server-patch/admintool/docker-compose.yml up -d
```

Acesso:

- Local: `http://localhost:8080`
- Na rede local: `http://192.168.15.12:8080`

O `ORIGIN` do `.env` precisa ser exatamente o endereço usado no navegador, senão o login falha.
Se o IP da máquina mudar, edite `server-patch/admintool/.env` (`ORIGIN` e `ALLOWED_ORIGINS`)
e rode `docker compose -f server-patch/admintool/docker-compose.yml restart`.

Para equipe na mesma rede, pode ser necessário liberar a porta 8080 no firewall do Windows.
Fora da rede (internet), o painel **não** estará disponível — seria preciso VPS + domínio + HTTPS.

## Primeira configuração (uma vez)

1. Abra `http://localhost:8080` — o assistente aparece sozinho.
2. Idioma: inglês (não há português).
3. Senha do banco: use o botão **Generate**; não precisa anotar.
4. Conta admin: crie com o nome da Aurora.
5. Entrar com essa conta.

## Dar acesso à equipe

Em **Settings**:

- Copie o **PIN code** e mande **somente** para as pessoas de confiança.
- Cada pessoa cria a própria conta em *Create an account* com esse PIN.
- A conta fica em **Pending users** até você aprovar.
- Ao aprovar, marque **apenas `Files Updater`**. Não marque Bootstraps, Maintenance,
  News, Backgrounds nem permissões de perfil que não sejam o da Aurora.
- Troque o PIN periodicamente (o novo PIN não afeta contas já aprovadas).

## Sons custom da Aurora

O caminho oficial é pelo **Aurora Admin**: `/dashboard/aurora` → **Sons do Aurora**.
O painel publica os arquivos na release `modpack` junto com o modpack, e o launcher os baixa
para `<diretório do jogo>/kubejs/assets/aurora_vicky/` na próxima abertura.

1. Escolha um ID simples, por exemplo `entrada` (letras minúsculas, números e `_`).
2. Selecione o arquivo `.ogg` (**não `.mp3`**, limite de 32 MB).
3. Clique em **Enviar som**. O painel grava o arquivo em
   `kubejs/assets/aurora_vicky/sounds/<id>.ogg` e mantém o
   `kubejs/assets/aurora_vicky/sounds.json` com o evento `aurora_vicky:<id>`.
4. Clique em **Publicar modpack.json** para levar os arquivos ao manifesto da release.
5. Para tocar: `/playsound aurora_vicky:entrada @a` (use `@a`, evite `@s`).
6. Para remover, use o botão da lista de sons e publique o manifesto novamente.

Não é preciso reiniciar o servidor, rodar `/reload` ou `/kubejs reload`, nem reconstruir o
jar `aurora_vicky`. Quem já estiver no jogo precisa abrir pelo launcher de novo para receber
os arquivos.

### Por que não o zip de resource pack

O modelo antigo em `resourcepack/` continua apenas como referência para testes locais. Um zip em
`resourcepacks/` **não é ativado automaticamente** pelas jogadoras, e o force-pack do servidor
foi descartado por problemas de cache e recusa de clientes. Por isso o painel agora usa os
assets do KubeJS no namespace `aurora_vicky`.

O launcher não apaga arquivos antigos de som quando um ID é renomeado ou removido, porque a
limpeza geral está desativada. Para **atualizar** um som, reenvie com o **mesmo ID**.

Sons **vanilla** (`minecraft:ambient.cave`, etc.) já funcionam com `/playsound` hoje, sem pack.

## Conectar o launcher ao painel

O launcher **não** estava conectado: ele lê o manifesto de
`https://github.com/vickyAqui/aurora-launcher/releases/download/modpack/modpack.json` e usa
`electron-updater` (GitHub Releases) para o `.exe`. O código já suporta o AdminTool, mas começa
desligado — sem URL configurada nada muda para os jogadores.

### Como ativar (sem recompilar)

Crie `<appData>/aurora-admin-tool.json` (no Windows, `%APPDATA%\aurora-admin-tool.json`):

```json
{
  "url": "https://painel.seudominio.com",
  "slug": "aurora-studios"
}
```

Ou use `AURORA_ADMIN_URL` (e opcionalmente `AURORA_ADMIN_SLUG`) no processo do launcher.
A URL precisa ser **acessível pelos jogadores** e usar HTTPS na internet.

O launcher passa a ler:

```
<url>/api/files-updater/<slug>
```

— que é o mesmo endpoint usado pelo `eml-lib`. Se o painel falhar, ele cai automaticamente para o
manifesto do GitHub e mantém o último manifesto em cache por 60 s. A versão/loader continuam
`1.20.1` / Forge `1.20.1-47.4.10`, e o manifesto filtrado pelas escolhas de mods do jogador é
preservado.

### No painel

1. Crie/edite o perfil com **slug exatamente `aurora-studios`**, Forge `1.20.1-47.4.10` e IP
   `79.182.128.137:25565`.
2. Envie o conteúdo para o Files Updater mantendo a estrutura do jogo:
   `mods/`, `config/`, `kubejs/assets/minecraft/...`, `resourcepacks/aurora_sounds.zip`.
3. **Não envie** `options.txt`, `config/cpm.json`, `user_jvm_args.txt`, `disabled-mods.json`,
   `logs/`, `saves/` — o launcher reaplica esses arquivos e o upload sobrescreveria o jogador.
4. Deleções no Files Updater também propagam. Cuidado ao remover arquivos.

### Expor na internet (Render)

O `render.yaml` na raiz sobe a **mesma imagem oficial** do AdminTool `2.7.2`, com Postgres
gerenciado e HTTPS em `https://aurora-admintool.onrender.com`. O único arquivo extra é um
Dockerfile de 4 linhas em `server-patch/admintool/render/` que troca o entrypoint: o original
fica preso esperando o host `dbs:5432`, que só existe no docker-compose local.

Passo a passo:

1. Render Dashboard → **New → Blueprint** → conecte este repo; ele encontra `render.yaml` na raiz.
2. Use planos **Starter** para web e banco. O plano free hiberna (o primeiro fetch do launcher
   levaria ~1 min ou falharia).
3. Confira `ORIGIN` e `ALLOWED_ORIGINS` no Blueprint. Se o nome `aurora-admintool` já estiver
   tomado, a URL muda — ajuste as duas variáveis e o JSON dos clients.
4. Na primeira visita, faça o assistente inicial (senha do banco é gerada pelo Render; não anote).
5. Crie o perfil `aurora-studios` e envie os arquivos pelo Files Updater.
6. Coloque a URL em `%APPDATA%\aurora-admin-tool.json` e teste um cliente antes de falar para a
   equipe.

O disco persistente de 10 GB é montado em `/app/storage`; o entrypoint cria links para
`/app/files`, `/app/env` e `/app/data` (o Render permite só um disco por serviço). O container
`upd` **não** vai para o Render: ele precisa de `/var/run/docker.sock`. Para atualizar o painel,
troque a tag no Dockerfile e sincronize o Blueprint.

Alternativa sem nuvem: Cloudflare Tunnel apontando para `http://localhost:8080`, com `ORIGIN`
igual à URL pública. O painel local continua intacto.

### Bootstraps

Não migrar agora. O `.exe` continua sendo distribuído por GitHub Releases/`electron-updater`.
Bootstraps exigiria publicar os 3 arquivos por plataforma com `.yml` na versão exata do
`package.json`, com risco de update loop; a permissão ficaria só com você.

## Estado

Código preparado: `electron/admintool.ts`, `electron/launchConfig.ts`, `electron/const.ts`,
`electron/handlers/mods.ts` e `electron/handlers/launcher.ts`. Build e testes focados passaram.
Blueprint Render preparado em `render.yaml` + `server-patch/admintool/render/`, sem aplicar.
Nada foi enviado ao servidor de jogo; nenhuma versão/tag/release foi criada. A conexão só vale
para quem tiver a URL configurada e o painel exposto.
