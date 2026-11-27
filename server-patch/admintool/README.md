# EML AdminTool — instância local da Aurora

Painel web da EML para gerenciar arquivos do launcher e dar acesso controlado à equipe.
Esta instância é **local**: roda na sua máquina com Docker e não é exposta à internet.

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

## Sons custom para `/playsound`

Modelo em `server-patch/admintool/resourcepack/`. Para criar um som novo:

1. Coloque o arquivo em `assets/aurora_sounds/sounds/<nome>.ogg` (**`.ogg`, não `.mp3`**).
2. Adicione a entrada em `assets/aurora_sounds/sounds.json`:

```json
{
  "entrada": {
    "category": "player",
    "sounds": [{ "name": "aurora_sounds:entrada", "stream": false }]
  }
}
```

3. Comprima o **conteúdo** da pasta `resourcepack` (não a pasta em si) em `aurora_sounds.zip`.
4. No painel, **Files Updater** → envie o zip para `resourcepacks/aurora_sounds.zip`.
5. Para tocar: `/playsound aurora_sounds:entrada @a` (use `@a`, evite `@s`).

### Ponto importante

O launcher continua baixando o manifesto fixo do GitHub Releases, então **o zip enviado ao
painel local não chega automaticamente nos clients**. Para que todo mundo ouça o som custom,
escolha uma destas opções:

- **Servidor força o pack:** hospede `aurora_sounds.zip` publicamente e configure
  `resource-pack=<url>` e `require-resource-pack=true` no `server.properties` (restart manual seu).
- **Som dentro do `aurora_vicky`:** os `.ogg` e o `sounds.json` entram no jar do mod; exige
  rebuild e publicação de nova versão do jar (só com autorização sua).
- **Instalação manual:** cada jogador coloca o zip em `resourcepacks/` e ativa o pack.

Sons **vanilla** (`minecraft:ambient.cave`, etc.) já funcionam com `/playsound` hoje, sem pack.

## Estado

Nada disso foi enviado ao servidor de jogo. Nenhuma versão do launcher foi alterada.
O painel é apenas a instância local; upload, restart do servidor e release continuam manuais.
