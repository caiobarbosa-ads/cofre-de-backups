# Cofre de Backups

Um painel pequeno e auto-hospedado que recebe os arquivos de backup dos seus sistemas e guarda **os últimos N de cada um**. Quando chega um backup novo e válido, os mais antigos que passam de N são apagados sozinhos.

Feito para quem tem alguns sistemas rodando (em VPS, Coolify, EasyPanel, Vercel com cron…) e quer um lugar único, simples e seu para guardar os backups, sem depender de S3, Google Drive ou serviço pago.

- **Zero dependências**: Node puro, sem banco de dados e sem build. Os clientes ficam num JSON e os backups no disco.
- **Sem limite de tamanho**: o upload vai em pedaços e retoma de onde parou se a conexão cair. Já foi usado com backups de vários GB.
- **Integridade conferida**: o sha256 de cada backup é calculado no cofre e comparado com o que o sistema enviou. Um backup corrompido não conta para a retenção, então nunca derruba os bons.
- **Retenção segura**: nunca apaga backups válidos enquanto não houver N válidos. Corrompidos também ficam limitados aos N mais recentes, para um sistema com problema não encher o disco.
- **Um token por sistema**: cada cliente envia com o próprio token e só enxerga os próprios uploads.
- **Prompt pronto para agentes de IA**: a página de cada cliente traz um prompt para colar no Claude Code, Codex ou similar, aberto no projeto do sistema. O agente implementa a geração, o envio e o agendamento do backup.

## Como funciona

```
 seu sistema ──(gera o backup)──> enviar-backup.mjs ──HTTPS, em pedaços──> Cofre de Backups
                                                                              │
                                                     confere o sha256, guarda os últimos N
                                                     e apaga os mais antigos
```

1. Você sobe o cofre num servidor e cria um **cliente** para cada sistema no painel.
2. Cada cliente recebe um **token**. O sistema usa esse token para enviar os arquivos.
3. O cofre confere cada arquivo e aplica a retenção. Você acompanha tudo e baixa os backups pelo painel.

O cofre **não gera** o backup: ele recebe o arquivo que o seu sistema gerou (um `pg_dump`, um `.tar.gz` com os uploads etc.). O prompt da página do cliente orienta o agente a criar essa parte também.

> **Onde instalar:** de preferência numa máquina diferente da que roda os seus sistemas. Um backup guardado no mesmo servidor protege contra erro no banco, mas não contra a perda do servidor inteiro.

## Instalação

Você precisa de um servidor com Docker (ou Node 22+) e espaço em disco para `N × tamanho do backup × número de sistemas`. O uso do disco aparece no topo do painel.

Antes de tudo, gere o `SESSION_SECRET` (um texto aleatório e longo). Qualquer máquina com Node serve:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sem Node, use `openssl rand -hex 32`.

### Opção 1: Docker Compose

```bash
git clone https://github.com/caiobarbosa-ads/cofre-de-backups.git cofre-backups
cd cofre-backups
cp .env.example .env
```

Edite o `.env` e preencha `ADMIN_PASSWORD` (pelo menos 12 caracteres) e `SESSION_SECRET`. Depois suba o cofre:

```bash
docker compose up -d --build
docker compose logs -f   # deve aparecer "Cofre de Backups ouvindo na porta 3000"
```

O painel abre em `http://localhost:3000`. A porta fica presa ao `127.0.0.1` de propósito, para o painel não ficar exposto na internet sem HTTPS. Para acessar de fora, siga [Publicando com HTTPS](#publicando-com-https).

Para testar numa VPS antes de configurar o domínio, abra um túnel SSH do seu computador (`ssh -L 3000:localhost:3000 usuario@sua-vps`) e acesse `http://localhost:3000`.

### Opção 2: Coolify, EasyPanel ou similar

1. Crie uma aplicação apontando para este repositório (ou para o seu fork), com build por **Dockerfile**.
2. Monte um **volume persistente em `/data`**. Sem isso, os backups somem a cada deploy. Prefira um volume gerenciado pela plataforma (volume nomeado). Se usar uma pasta do servidor (bind mount), dê a posse ao usuário do container: `sudo chown -R 1000:1000 /caminho/da/pasta`.
3. Defina as variáveis de ambiente:
   - `ADMIN_PASSWORD` e `SESSION_SECRET` (obrigatórias);
   - `TRUST_PROXY=1`, porque a plataforma já coloca um proxy na frente;
   - `PUBLIC_URL=https://backups.seudominio.com`, com o endereço que você vai usar.
4. Aponte um domínio com HTTPS para a porta `3000`. A plataforma cuida do certificado.
5. Faça o deploy e siga os [primeiros passos](#primeiros-passos).

### Opção 3: Sem Docker

Com Node 22 ou mais novo, em Linux, macOS ou Windows:

```bash
cp .env.example .env      # no Windows: copy .env.example .env
# edite o .env: ADMIN_PASSWORD e SESSION_SECRET
node --env-file=.env src/server.js
```

Os dados ficam em `./data`. Para rodar como serviço, use systemd, pm2 ou o agendador do seu sistema.

## Publicando com HTTPS

**Não exponha o cofre sem HTTPS**: a senha do painel e os tokens viajam em todas as requisições. Coloque um proxy na frente e defina `TRUST_PROXY=1` e `PUBLIC_URL` no `.env`.

O proxy precisa aceitar corpos de pelo menos 16 MB (o tamanho de cada pedaço) e repassar o cabeçalho `X-Forwarded-Proto`.

**Caddy** (gera o certificado sozinho):

```
backups.seudominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Nginx** (o certificado fica por sua conta, com certbot por exemplo):

```nginx
server {
    listen 443 ssl;
    server_name backups.seudominio.com;
    # ssl_certificate ... ; ssl_certificate_key ... ;

    client_max_body_size 0;          # o padrão de 1 MB barraria os pedaços do upload
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Coolify e EasyPanel já fazem isso com o Traefik deles. Só lembre que o Traefik do Coolify corta requisições que levam mais de 60 s: é por isso que os pedaços têm 16 MB.

## Primeiros passos

1. Abra o painel e entre com a `ADMIN_PASSWORD`.
2. Em **Novo cliente**, dê um nome ao sistema (ex.: "Loja virtual") e diga quantos backups guardar.
3. Na página do cliente, o card **Conectar o sistema** mostra o token e um prompt pronto. Copie o prompt e cole no agente de IA aberto no projeto do sistema. Ou faça à mão, como explicado em [Conectando um sistema](#conectando-um-sistema).
4. Teste a conexão: `curl -H "Authorization: Bearer <token>" https://backups.seudominio.com/api/ping`.
5. Depois do primeiro envio, confira se o backup aparece como **Válido** no painel.

> O prompt leva o token em texto. Ao colar no agente, o token vai para o provedor da IA. Se isso incomoda, apague a linha do token antes de colar e configure `BACKUP_TOKEN` direto no ambiente do sistema.

## Conectando um sistema

O jeito mais fácil é o helper `cliente/enviar-backup.mjs` (sem dependências, Node 18+). O próprio cofre serve o arquivo em `/cliente/enviar-backup.mjs`:

```bash
curl -o enviar-backup.mjs https://backups.seudominio.com/cliente/enviar-backup.mjs
BACKUP_URL=https://backups.seudominio.com BACKUP_TOKEN=bk_... node enviar-backup.mjs /caminho/backup.dump
```

Ou dentro do código:

```js
import { enviarBackup } from './enviar-backup.mjs';

await enviarBackup('/caminho/backup.dump', {
  url: process.env.BACKUP_URL,
  token: process.env.BACKUP_TOKEN,
  nome: 'banco.dump', // opcional: nome que aparece no painel
});
```

O helper manda em pedaços, tenta de novo com espera crescente quando a rede ou o cofre falham e confere o sha256 no fim. Guarde `BACKUP_URL` e `BACKUP_TOKEN` em variáveis de ambiente, nunca no código.

Para agendar, use o que a plataforma do sistema oferecer: cron do servidor, tarefa agendada do Coolify, um endpoint chamado pelo [cron-job.org](https://cron-job.org) etc.

Sistemas em outras linguagens podem seguir o protocolo da [API](#api) direto. O prompt da página do cliente traz o passo a passo.

**Teste rápido** com arquivos pequenos, numa requisição só:

```bash
curl -T backup.dump -H "Authorization: Bearer bk_..." "https://backups.seudominio.com/api/upload?filename=backup.dump"
```

Use isso só para arquivos que sobem em menos de 1 minuto, porque proxies como o Traefik cortam requisições longas.

> **Dica:** se o sistema roda no mesmo servidor que o cofre, use o endereço interno do container (rede Docker) como `BACKUP_URL`. É mais rápido e não passa pelo proxy.

## Restaurando um backup

Pelo painel: abra o cliente e clique em **Baixar**. O arquivo sai exatamente como o sistema enviou, com o nome original. A restauração em si depende do sistema (por exemplo, `pg_restore` para um `pg_dump -Fc`).

Direto pelo disco, se o painel estiver fora do ar, os arquivos estão em `DATA_DIR/backups/<cliente>/`. No Docker Compose, copie de dentro do container:

```bash
docker compose cp cofre:/data/backups ./backups-copiados
```

## Atualizando

```bash
git pull
docker compose up -d --build
```

No Coolify ou EasyPanel, faça um novo deploy. Os dados ficam no volume e não são afetados.

## Configuração

| Variável | Padrão | O que faz |
|---|---|---|
| `ADMIN_PASSWORD` | (obrigatória) | Senha do painel, com pelo menos 12 caracteres em produção. Trocar a senha derruba todas as sessões abertas. |
| `SESSION_SECRET` | (obrigatória no Docker) | Assina o login e protege os tokens guardados. Fora do Docker, sem ela, o cofre usa um valor aleatório: o login cai e os tokens somem do painel a cada reinício. |
| `PUBLIC_URL` | deduzido da requisição | Endereço público do cofre, usado no prompt e nos exemplos. Recomendado em produção. |
| `TRUST_PROXY` | desligado | Ligue (`1`) atrás de um proxy, para o limite de tentativas de login usar o IP real. Sem proxy, deixe desligado. |
| `CHUNK_SIZE_MB` | `16` | Tamanho de cada pedaço do upload. Cada pedaço precisa subir antes do tempo-limite do proxy. |
| `STALE_UPLOAD_HOURS` | `48` | Uploads parados há mais que isso são descartados. |
| `TIMEZONE` | `America/Sao_Paulo` | Fuso das datas mostradas no painel. |
| `DATA_DIR` | `./data` (`/data` no Docker) | Onde ficam clientes e backups. |
| `PORT` | `3000` | Porta HTTP. No Docker Compose, mude a porta no mapeamento do `docker-compose.yml`. |

## API

Todas as rotas usam o cabeçalho `Authorization: Bearer <token do cliente>`.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/ping` | Testa o token. Devolve `{ ok, client, keep, chunkSize }`. |
| POST | `/api/uploads` | Inicia um upload `{ filename, size, sha256? }` e devolve `{ id, offset, size, chunkSize }`. |
| PUT | `/api/uploads/:id?offset=N` | Envia os bytes a partir de N (corpo cru, `application/octet-stream`) e devolve `{ id, offset, size }`. |
| GET | `/api/uploads/:id` | Até onde o cofre já recebeu, para retomar: `{ id, offset, size, chunkSize }`. |
| POST | `/api/uploads/:id/complete` | Conclui `{ sha256? }` e devolve `{ file, size, status }`. O backup entra como "verificando" e vira "válido" ou "corrompido". Depois disso, o `id` deixa de existir (404). |
| PUT ou POST | `/api/upload?filename=x&sha256=y` | Upload direto numa requisição só. |

| Código | Quando |
|---|---|
| `400` | `size` ausente, sha256 ou JSON inválido, pedaço que passa do tamanho declarado |
| `401` | Token inválido |
| `404` | Upload não encontrado (id errado, de outro cliente, já concluído ou descartado por inatividade) |
| `409` | Offset errado (o corpo traz `{ offset }` com a posição certa), pedaço já em andamento ou upload incompleto ao concluir |
| `413` | Corpo JSON acima de 64 KB. Se aparecer no envio dos pedaços, quem está recusando é o proxy (veja o Nginx acima) |
| `507` | Disco do cofre sem espaço |

## Estrutura no disco

```
DATA_DIR/clientes.json                                clientes, retenção, hash e token cifrado
DATA_DIR/backups/<cliente>/<data>_<xxxx>__<nome>      os backups
DATA_DIR/backups/<cliente>/<...>.meta.json            nome original, tamanho, status e sha256
DATA_DIR/tmp/<id>.part e <id>.json                    uploads em andamento
```

Para fazer backup do próprio cofre, copie o `DATA_DIR` e guarde o `SESSION_SECRET` junto. Sem o mesmo segredo, os tokens continuam funcionando, mas não aparecem mais no painel.

## Segurança

- O painel tem uma senha só (`ADMIN_PASSWORD`), com limite de 10 tentativas erradas por IP a cada 15 minutos.
- Os tokens são validados pelo hash sha256. Uma cópia cifrada (AES-256-GCM, chave derivada do `SESSION_SECRET`) fica guardada para o painel poder mostrar o token de novo.
- Os formulários do painel recusam envios vindos de outros sites, e as páginas não podem ser abertas dentro de iframes.
- Os backups são guardados como chegam. Se eles têm dados sensíveis, **cifre o arquivo antes de enviar** (por exemplo com `age` ou `gpg`). Assim, nem quem tiver acesso ao servidor do cofre consegue ler.
- O helper `/cliente/enviar-backup.mjs` é público de propósito: ele não tem segredo nenhum.
- Encontrou uma falha de segurança? Abra uma issue sem detalhes sensíveis pedindo um contato privado.

## Desenvolvimento

```bash
ADMIN_PASSWORD=senha-de-teste npm run dev   # http://localhost:3000, dados em ./data
npm test
```

No PowerShell: `$env:ADMIN_PASSWORD="senha-de-teste"; npm run dev`.

O código fica em `src/`: `server.js` (rotas), `uploads.js` (upload em pedaços), `verify.js` (sha256 e retenção), `store.js` (clientes e disco) e `ui.js` (telas renderizadas no servidor, sem framework). Contribuições são bem-vindas: abra uma issue ou um pull request.

## Licença

[MIT](LICENSE). As fontes IBM Plex em `src/fonts/` usam a [SIL Open Font License](src/fonts/OFL-IBMPlex.txt).
