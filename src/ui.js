// Telas do painel, renderizadas no servidor. Sem framework e sem build.
// Visual: preto e branco, cor só em estados, IBM Plex, bordas finas e cantos pequenos.

import { config } from './config.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: config.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export function formatDate(iso) {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

function ago(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

// Ícones (traço do Lucide). A forma distingue o status mesmo sem cor.
const svg = (d) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  ok: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  bad: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
  wait: svg('<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/>'),
};

const STATUS = {
  ok: ['Válido', 'ok'],
  verificando: ['Verificando', 'wait'],
  corrompido: ['Corrompido', 'bad'],
};

function statusBadge(status) {
  const [label, cls] = STATUS[status] || [status, 'wait'];
  return `<span class="st ${cls}">${ICON[cls]}${esc(label)}</span>`;
}

const CSS = `
@font-face{font-family:"IBM Plex Sans";src:url(/fonts/ibm-plex-sans-latin-wght-normal.woff2) format("woff2");font-weight:100 700;font-display:swap}
@font-face{font-family:"IBM Plex Mono";src:url(/fonts/ibm-plex-mono-latin-400-normal.woff2) format("woff2");font-weight:400;font-display:swap}
:root{--ink:#0b0b0c;--paper:#fff;--subtle:#fafafa;--muted:#f4f4f5;--line:#e4e4e7;--control:#8d8d96;--text-2:#52525b;--text-3:#71717a;
--danger:#b42318;--danger-bg:#fef3f2;--ok:#0f7b45;--control-h:2.25rem;--topbar-h:3.25rem;color-scheme:light}
@media (pointer:coarse){:root{--control-h:2.75rem}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 "IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:#d4d4d8}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:4px}
a{color:inherit;text-underline-offset:2px}
h1,h2{font-weight:600;letter-spacing:-.01em;margin:0}
h1{font-size:20px;line-height:1.3}h2{font-size:14px}
p{margin:0}
.t2{color:var(--text-2)}.t3{color:var(--text-3)}.small{font-size:13px}.num{font-variant-numeric:tabular-nums}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}

.topbar{position:sticky;top:0;z-index:40;height:var(--topbar-h);border-bottom:1px solid var(--line);background:var(--paper)}
.topbar .in{max-width:1100px;margin:0 auto;height:100%;display:flex;align-items:center;justify-content:space-between;padding:0 24px}
.brand{font-size:15px;font-weight:600;letter-spacing:-.01em;text-decoration:none}.brand span{font-weight:400;color:var(--text-2)}
main{max-width:1100px;margin:0 auto;padding:24px 24px 64px}

.ph{margin-bottom:24px}
.crumb{font-size:13px;color:var(--text-2);margin-bottom:4px}.crumb a{text-decoration:none}.crumb a:hover{color:var(--ink);text-decoration:underline}
.ph p{margin-top:4px;color:var(--text-2)}

.card{border:1px solid var(--line);border-radius:8px;background:var(--paper);margin-bottom:16px;overflow:clip}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:8px 16px;border-bottom:1px solid var(--line)}
.card-h p{margin-top:2px}
.card-b{padding:16px}
.card-b>*+*{margin-top:12px}
.empty{padding:28px 16px;text-align:center;color:var(--text-2)}

table{width:100%;border-collapse:collapse;text-align:left}
th{background:var(--subtle);border-bottom:1px solid var(--line);padding:8px 12px;font-size:12px;font-weight:500;color:var(--text-2);white-space:nowrap}
td{height:2.75rem;padding:6px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th:first-child,td:first-child{padding-left:16px}th:last-child,td:last-child{padding-right:16px}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--subtle)}
.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
td a.name{font-weight:500;text-decoration:none}td a.name:hover{text-decoration:underline}

.st{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.st svg{flex-shrink:0}.st.ok svg{color:var(--ok)}.st.bad{color:var(--danger)}.st.wait{color:var(--text-2)}
.badge{display:inline-flex;align-items:center;border-radius:4px;padding:2px 6px;font-size:12px;font-weight:500;background:var(--muted);color:var(--text-2)}

label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500}
.hint{font-size:13px;font-weight:400;color:var(--text-2)}
.control{width:100%;min-height:var(--control-h);border:1px solid var(--control);border-radius:6px;background:var(--paper);color:var(--ink);padding:0 10px;font:inherit;font-size:14px;font-weight:400}
.control::placeholder{color:var(--text-3)}
.control:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink)}
.control[readonly]{background:var(--subtle)}
textarea.control{padding:8px 10px;line-height:1.55;resize:vertical;display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px}
@media (pointer:coarse){.control{font-size:16px}}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:var(--control-h);padding:0 14px;border-radius:6px;border:1px solid transparent;font:inherit;font-size:14px;font-weight:500;white-space:nowrap;cursor:pointer;text-decoration:none;background:var(--ink);color:var(--paper)}
.btn:hover{background:#2b2b30}
.btn.sec{background:var(--paper);color:var(--ink);border-color:var(--control)}.btn.sec:hover{background:var(--muted)}
.btn.ghost{background:transparent;color:var(--ink)}.btn.ghost:hover{background:var(--muted)}
.btn.danger{background:var(--danger)}.btn.danger:hover{background:#8f1c13}
.btn.sm{min-height:32px;padding:0 10px;font-size:13px}
.link{border:0;background:none;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.link.danger{color:var(--danger)}
form.inline{display:inline;margin:0}

.fields{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
.copy{display:flex;gap:8px}.copy .control{flex:1;min-width:0}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.spread{justify-content:space-between}
.bar{height:6px;background:var(--muted);border-radius:99px;overflow:hidden}.bar>div{height:100%;background:var(--ink)}
.alert{border:1px solid #f5b5ae;background:var(--danger-bg);color:var(--danger);border-radius:6px;padding:10px 12px;margin-bottom:16px}
pre{background:var(--subtle);border:1px solid var(--line);border-radius:6px;padding:10px 12px;overflow-x:auto;font:12.5px/1.55 "IBM Plex Mono",ui-monospace,monospace;margin:8px 0 0}
details summary{cursor:pointer;color:var(--text-2);font-size:13px}details summary:hover{color:var(--ink)}
.sep{border-top:1px solid var(--line);margin:16px -16px 0;padding:16px 16px 0}

.login{max-width:360px;margin:16vh auto 0;padding:0 16px}
.login .card-b>*+*{margin-top:14px}

@media (max-width:720px){
  .topbar .in,main{padding-left:16px;padding-right:16px}
  table.stack thead{display:none}
  table.stack tr{display:grid;grid-template-columns:1fr auto;gap:4px 12px;padding:12px 16px;border-bottom:1px solid var(--line)}
  table.stack tbody tr:last-child{border-bottom:0}
  table.stack td{height:auto;border:0;padding:0!important;background:none!important}
  table.stack .c-main{grid-column:1/-1}
  table.stack .c-bar{grid-column:1/-1;width:auto!important;padding:4px 0!important}
  table.stack .c-end{text-align:right}
  .fields>label{flex:1 1 100%!important;width:auto!important}
  .fields>.btn{width:100%}
}
`;

function layout(title, body, { loggedIn = true } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="preload" href="/fonts/ibm-plex-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<title>${esc(title)} · Cofre de Backups</title><style>${CSS}</style></head><body>
${loggedIn ? `<header class="topbar"><div class="in"><a class="brand" href="/">Cofre <span>de Backups</span></a>
<form method="post" action="/logout" class="inline"><button class="btn ghost sm" type="submit">Sair</button></form></div></header>` : ''}
${loggedIn ? `<main>${body}</main>` : body}
<script>
document.addEventListener('submit',e=>{const m=e.target.dataset.confirm;if(m&&!confirm(m))e.preventDefault()});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-copy]');if(!b)return;
  const el=document.getElementById(b.dataset.copy);const text=el.value??el.textContent;
  try{await navigator.clipboard.writeText(text)}catch{el.select?.();document.execCommand('copy')}
  const old=b.textContent;b.textContent='Copiado';setTimeout(()=>b.textContent=old,1600);
});
</script>
</body></html>`;
}

function pageHeader(title, { crumb, desc } = {}) {
  return `<header class="ph">${crumb ? `<div class="crumb"><a href="/">Clientes</a> / <span style="color:var(--ink)">${esc(title)}</span></div>` : ''}
<h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</header>`;
}

export function loginPage(error) {
  return layout('Entrar', `<div class="login">
<div class="brand" style="display:block;margin-bottom:16px">Cofre <span>de Backups</span></div>
<div class="card"><div class="card-b">
<h1>Entrar</h1>
${error ? `<div class="alert" style="margin:0">${esc(error)}</div>` : ''}
<form method="post" action="/login" style="display:flex;flex-direction:column;gap:12px">
<label>Senha<input class="control" type="password" name="password" autofocus required autocomplete="current-password"></label>
<button class="btn" type="submit">Entrar</button></form>
</div></div></div>`, { loggedIn: false });
}

export function homePage({ clients, disk, error }) {
  const used = disk ? disk.total - disk.free : 0;
  const pct = disk && disk.total ? Math.round((used / disk.total) * 100) : 0;
  const rows = clients.map((c) => `<tr>
<td class="c-main"><a class="name" href="/clientes/${esc(c.id)}">${esc(c.name)}</a></td>
<td class="r t2">${c.count} de ${c.keep}</td>
<td class="r">${formatBytes(c.totalSize)}</td>
<td class="c-end">${c.last ? `${statusBadge(c.last.status)} <span class="small t3">· ${ago(c.last.createdAt)}</span>` : '<span class="t3">Nenhum ainda</span>'}</td>
</tr>`).join('');
  return layout('Clientes', `
${pageHeader('Clientes', { desc: disk ? `Disco: ${formatBytes(used)} de ${formatBytes(disk.total)} usados (${pct}%) · ${formatBytes(disk.free)} livres` : '' })}
${error ? `<div class="alert">${esc(error)}</div>` : ''}
<div class="card">
${clients.length ? `<table class="stack"><thead><tr><th>Cliente</th><th class="r">Backups</th><th class="r">Espaço</th><th>Último backup</th></tr></thead>
<tbody>${rows}</tbody></table>` : '<p class="empty">Nenhum cliente ainda. Crie o primeiro abaixo.</p>'}
</div>
<div class="card"><div class="card-h"><h2>Novo cliente</h2></div><div class="card-b">
<form method="post" action="/clientes" class="fields">
<label style="flex:1 1 260px">Nome<input class="control" name="name" required maxlength="80" placeholder="Ex.: Loja virtual"></label>
<label style="width:160px">Manter os últimos<input class="control num" name="keep" type="number" min="1" max="1000" value="7" required></label>
<button class="btn" type="submit">Criar cliente</button>
</form></div></div>`);
}

// Prompt pronto para colar no projeto do cliente: o agente de lá implementa o envio dos backups.
export function connectPrompt({ client, token, baseUrl }) {
  return `Implemente o envio automático de backups deste sistema para o meu Cofre de Backups.

## Dados do cofre
- URL: ${baseUrl}
- Token deste cliente: ${token}
- Cliente no cofre: ${client.name} (${client.id})
- O cofre guarda os últimos ${client.keep} backups válidos deste cliente e apaga os mais antigos sozinho. Não implemente rotação do lado de cá.

Guarde a URL e o token em variáveis de ambiente (BACKUP_URL e BACKUP_TOKEN), nunca no código nem no git. Se o projeto tiver .env.example, documente as duas lá sem o valor real.

## O que fazer
1. Descubra como este sistema gera backup hoje. Se ainda não gera, crie a geração: banco de dados (PostgreSQL: pg_dump -Fc; MySQL: mysqldump | gzip; SQLite: .backup), arquivos enviados pelos usuários e qualquer estado persistente. Junte tudo num arquivo só (.tar.gz, por exemplo) se houver mais de uma parte.
2. Depois que o arquivo for gerado, envie para o cofre (veja abaixo).
3. Agende para rodar todo dia (cron, agendador do framework ou tarefa agendada da plataforma onde o sistema roda).
4. Registre em log o início, o fim, o tamanho e qualquer erro. Se o envio falhar, tente de novo algumas vezes com espera crescente.
5. Apague o arquivo temporário local só depois do envio confirmado.
6. Teste com um backup real e confirme que ele aparece como "válido" no painel do cofre.

## Como enviar
### Se o projeto tem Node 18+ (recomendado)
Baixe o helper oficial, que não tem dependências, manda em pedaços, retoma se a conexão cair e confere o sha256:

  curl -o enviar-backup.mjs ${baseUrl}/cliente/enviar-backup.mjs

Uso no código:

  import { enviarBackup } from './enviar-backup.mjs';
  await enviarBackup('/caminho/backup.tar.gz', {
    url: process.env.BACKUP_URL,
    token: process.env.BACKUP_TOKEN,
    nome: 'backup.tar.gz', // opcional: nome que aparece no painel
  });

Ou pela linha de comando: BACKUP_URL=... BACKUP_TOKEN=... node enviar-backup.mjs /caminho/backup.tar.gz

### Outras linguagens: protocolo em pedaços
Todas as requisições levam o cabeçalho Authorization: Bearer <BACKUP_TOKEN>.
1. POST ${baseUrl}/api/uploads com JSON {"filename": "backup.tar.gz", "size": <bytes>, "sha256": "<hex, opcional>"}. A resposta traz {"id", "offset", "chunkSize"}.
2. Envie o arquivo em pedaços de chunkSize bytes: PUT ${baseUrl}/api/uploads/<id>?offset=<posição> com os bytes crus no corpo (Content-Type: application/octet-stream). Se responder 409, o corpo traz {"offset"} com a posição certa: continue dali.
3. Se a conexão cair, GET ${baseUrl}/api/uploads/<id> devolve até onde o cofre já recebeu.
4. No fim, POST ${baseUrl}/api/uploads/<id>/complete com {"sha256": "<hex do arquivo inteiro>"}.
Cada requisição precisa terminar em menos de 60 segundos (proxies como o Traefik do Coolify cortam requisições mais longas), por isso não mande o arquivo inteiro numa requisição só.

## Teste de conexão
  curl -H "Authorization: Bearer ${token}" ${baseUrl}/api/ping
Deve responder {"ok":true,"client":"${client.id}",...}.`;
}

function connectCard({ client, token, baseUrl }) {
  if (!token) {
    return `<div class="card"><div class="card-h"><h2>Conectar o sistema</h2></div><div class="card-b">
<p class="t2">Não dá para mostrar o token atual: o <span class="mono">SESSION_SECRET</span> mudou ou não está definido (o token continua funcionando). Defina um <span class="mono">SESSION_SECRET</span> fixo e gere um novo token para ver o token e o prompt. O antigo para de funcionar.</p>
<form method="post" action="/clientes/${esc(client.id)}/token" data-confirm="Gerar um novo token? O atual para de funcionar na hora."><button class="btn" type="submit">Gerar token</button></form>
</div></div>`;
  }
  return `<div class="card"><div class="card-h"><div><h2>Conectar o sistema</h2>
<p class="small t2">Cole o prompt no agente (Claude Code, Codex…) aberto no projeto do cliente. Ele já leva o token.</p></div>
<button class="btn" type="button" data-copy="prompt">Copiar prompt</button></div>
<div class="card-b">
<textarea id="prompt" class="control" readonly rows="8" aria-label="Prompt para o projeto do cliente">${esc(connectPrompt({ client, token, baseUrl }))}</textarea>
<label>Token
<div class="copy"><input id="tok" class="control mono" readonly value="${esc(token)}" onfocus="this.select()"><button class="btn sec" type="button" data-copy="tok">Copiar</button></div></label>
<details><summary>Testar com curl</summary>
<pre>curl -H "Authorization: Bearer ${esc(token)}" ${esc(baseUrl)}/api/ping</pre>
<p class="small t2" style="margin-top:8px">Para mandar um arquivo pequeno na mão (até 1 minuto de envio):</p>
<pre>curl -T backup.dump -H "Authorization: Bearer ${esc(token)}" "${esc(baseUrl)}/api/upload?filename=backup.dump"</pre></details>
</div></div>`;
}

export function clientPage({ client, token, backups, pending, baseUrl, error }) {
  const total = backups.reduce((s, b) => s + (b.size || 0), 0);
  const rows = backups.map((b) => `<tr>
<td class="c-main" style="word-break:break-word">${esc(b.originalName)}</td>
<td class="t2 num" style="white-space:nowrap">${formatDate(b.createdAt)}</td>
<td class="r c-end">${formatBytes(b.size)}</td>
<td>${statusBadge(b.status)}</td>
<td class="r c-end"><a href="/clientes/${esc(client.id)}/arquivos/${encodeURIComponent(b.file)}">Baixar</a>
<span class="t3">&nbsp;·&nbsp;</span><form class="inline" method="post" action="/clientes/${esc(client.id)}/arquivos/${encodeURIComponent(b.file)}/excluir" data-confirm="Excluir este backup? Não dá para desfazer.">
<button class="link danger" type="submit">Excluir</button></form></td></tr>`).join('');
  const pend = pending.map((p) => {
    const pct = p.size ? Math.floor((p.received / p.size) * 100) : 0;
    return `<tr><td class="c-main" style="word-break:break-word">${esc(p.originalName || p.filename)}</td>
<td class="c-bar" style="width:30%"><div class="bar"><div style="width:${pct}%"></div></div></td>
<td class="r">${formatBytes(p.received)} de ${formatBytes(p.size)} (${pct}%)</td><td class="r t3 c-end">${ago(p.updatedAt)}</td></tr>`;
  }).join('');

  return layout(client.name, `
${pageHeader(client.name, { crumb: true, desc: `${backups.length} ${backups.length === 1 ? 'backup' : 'backups'} · ${formatBytes(total)} · guarda os últimos ${client.keep}` })}
${error ? `<div class="alert">${esc(error)}</div>` : ''}

${connectCard({ client, token, baseUrl })}

${pending.length ? `<div class="card"><div class="card-h"><h2>Recebendo agora</h2></div><table class="stack"><tbody>${pend}</tbody></table></div>` : ''}

<div class="card"><div class="card-h"><h2>Backups</h2><span class="small t2">${backups.length} de ${client.keep}</span></div>
${backups.length ? `<table class="stack"><thead><tr><th>Arquivo</th><th>Recebido em</th><th class="r">Tamanho</th><th>Status</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>` : '<p class="empty">Nenhum backup recebido ainda.</p>'}
</div>

<div class="card"><div class="card-h"><h2>Configuração</h2></div><div class="card-b">
<form method="post" action="/clientes/${esc(client.id)}" class="fields">
<label style="flex:1 1 260px">Nome<input class="control" name="name" value="${esc(client.name)}" required maxlength="80"></label>
<label style="width:160px">Manter os últimos<input class="control num" name="keep" type="number" min="1" max="1000" value="${client.keep}" required></label>
<button class="btn" type="submit">Salvar</button></form>
<p class="small t2">Quando chega um backup novo e válido, os que passam desse número são apagados, do mais antigo para o mais novo. Diminuir o número apaga os excedentes na hora.</p>
</div></div>

<div class="card"><div class="card-h"><h2>Zona de perigo</h2></div><div class="card-b">
<div class="row spread"><p class="small t2">Gerar um novo token desconecta o sistema até ele receber o novo.</p>
<form method="post" action="/clientes/${esc(client.id)}/token" data-confirm="Gerar um novo token? O atual para de funcionar na hora."><button class="btn sec" type="submit">Gerar novo token</button></form></div>
<form method="post" action="/clientes/${esc(client.id)}/excluir" class="fields sep" data-confirm="Excluir o cliente e TODOS os backups dele?">
<label style="flex:1 1 260px"><span>Para excluir o cliente e todos os backups, digite <span class="mono">${esc(client.id)}</span></span><input class="control" name="confirm" autocomplete="off"></label>
<button class="btn danger" type="submit">Excluir cliente</button></form>
</div></div>`);
}

export function errorPage(status, message) {
  return layout('Erro', `${pageHeader(String(status))}<div class="card"><div class="card-b"><p>${esc(message)}</p><p><a href="/">Voltar para os clientes</a></p></div></div>`);
}
