import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { config, validateConfig } from './config.js';
import * as store from './store.js';
import * as auth from './auth.js';
import * as ui from './ui.js';
import {
  HttpError, appendChunk, cleanupStaleUploads, completeUpload, listPendingUploads, oneShotUpload, startUpload, uploadStatus,
} from './uploads.js';
import { resumePendingVerifications } from './verify.js';

// ---------- utilidades HTTP ----------

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function redirect(res, to, headers = {}) {
  res.writeHead(303, { Location: to, ...headers });
  res.end();
}

async function readBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Corpo da requisição grande demais.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readForm(req) {
  return new URLSearchParams(await readBody(req));
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { throw new HttpError(404, 'Backup não encontrado.'); }
}

function clientIp(req) {
  // Atrás de proxy, o último IP do X-Forwarded-For é o que o proxy viu (os anteriores podem ser
  // inventados). Sem proxy, o cabeçalho inteiro pode ser inventado, então vale só o IP da conexão.
  if (config.trustProxy) {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || '';
}

function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const proto = auth.isHttps(req) ? 'https' : 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Bloqueia POST do painel vindo de outro site.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === host;
  } catch { return false; }
}

async function sendFile(req, res, filePath, downloadName) {
  const st = await fsp.stat(filePath);
  const total = st.size;
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${downloadName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  };
  let start = 0;
  let end = total - 1;
  let status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && total > 0) {
    if (m[1] === '') { start = Math.max(0, total - Number(m[2])); }
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])); }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  headers['Content-Length'] = total === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || total === 0) return res.end();
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------- API (sistemas enviando backups) ----------

async function handleApi(req, res, url) {
  const client = await store.findClientByToken(auth.bearerToken(req));
  if (!client) return json(res, 401, { error: 'Token inválido.' });

  const p = url.pathname;
  let m;
  if (p === '/api/ping' && req.method === 'GET') {
    return json(res, 200, { ok: true, client: client.id, keep: client.keep, chunkSize: config.chunkSize });
  }
  if (p === '/api/upload' && (req.method === 'PUT' || req.method === 'POST')) {
    return json(res, 201, await oneShotUpload(client, url.searchParams, req));
  }
  if (p === '/api/uploads' && req.method === 'POST') {
    return json(res, 201, await startUpload(client, await readJsonBody(req)));
  }
  if ((m = /^\/api\/uploads\/([a-f0-9]{32})$/.exec(p))) {
    if (req.method === 'GET') return json(res, 200, await uploadStatus(client, m[1]));
    if (req.method === 'PUT') return json(res, 200, await appendChunk(client, m[1], url.searchParams.get('offset'), req));
  }
  if ((m = /^\/api\/uploads\/([a-f0-9]{32})\/complete$/.exec(p)) && req.method === 'POST') {
    return json(res, 201, await completeUpload(client, m[1], await readJsonBody(req)));
  }
  return json(res, 404, { error: 'Rota não encontrada.' });
}

// ---------- painel ----------

async function homeData() {
  const clients = [];
  for (const c of await store.listClients()) {
    const backups = await store.listBackups(c.id);
    clients.push({
      ...c,
      count: backups.length,
      totalSize: backups.reduce((s, b) => s + (b.size || 0), 0),
      last: backups[0] || null,
    });
  }
  clients.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { clients, disk: await store.diskUsage() };
}

async function clientData(id) {
  const client = await store.getClient(id);
  if (!client) throw new HttpError(404, 'Cliente não encontrado.');
  return { client, token: store.readToken(client), backups: await store.listBackups(id), pending: await listPendingUploads(id) };
}

async function handlePanel(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/login') {
    if (method === 'GET') return auth.isLoggedIn(req) ? redirect(res, '/') : send(res, 200, ui.loginPage());
    if (method === 'POST') {
      const ip = clientIp(req);
      if (auth.loginBlocked(ip)) return send(res, 429, ui.loginPage('Muitas tentativas. Espere 15 minutos.'));
      const form = await readForm(req);
      if (!auth.checkPassword(form.get('password'))) {
        auth.registerFailure(ip);
        return send(res, 401, ui.loginPage('Senha incorreta.'));
      }
      auth.clearFailures(ip);
      return redirect(res, '/', { 'Set-Cookie': auth.sessionCookie(req) });
    }
  }

  if (!auth.isLoggedIn(req)) {
    return method === 'GET' ? redirect(res, '/login') : send(res, 401, ui.loginPage('Sessão expirada. Entre de novo.'));
  }
  if (method === 'POST' && !sameOrigin(req)) return send(res, 403, ui.errorPage(403, 'Origem não permitida.'));

  if (p === '/logout' && method === 'POST') return redirect(res, '/login', { 'Set-Cookie': auth.clearCookie() });

  if (p === '/' && method === 'GET') return send(res, 200, ui.homePage(await homeData()));

  if (p === '/clientes' && method === 'POST') {
    const form = await readForm(req);
    try {
      const { client } = await store.createClient({ name: form.get('name'), keep: form.get('keep') });
      return redirect(res, `/clientes/${client.id}`);
    } catch (err) {
      return send(res, 400, ui.homePage({ ...(await homeData()), error: err.message }));
    }
  }

  let m;
  if ((m = /^\/clientes\/([a-z0-9-]+)$/.exec(p))) {
    const id = m[1];
    if (method === 'GET') return send(res, 200, ui.clientPage({ ...(await clientData(id)), baseUrl: baseUrl(req) }));
    if (method === 'POST') {
      const form = await readForm(req);
      try {
        await store.updateClient(id, { name: form.get('name'), keep: form.get('keep') });
        return redirect(res, `/clientes/${id}`);
      } catch (err) {
        return send(res, 400, ui.clientPage({ ...(await clientData(id)), baseUrl: baseUrl(req), error: err.message }));
      }
    }
  }

  if ((m = /^\/clientes\/([a-z0-9-]+)\/token$/.exec(p)) && method === 'POST') {
    await store.regenerateToken(m[1]);
    return redirect(res, `/clientes/${m[1]}`);
  }

  if ((m = /^\/clientes\/([a-z0-9-]+)\/excluir$/.exec(p)) && method === 'POST') {
    const form = await readForm(req);
    if (form.get('confirm') !== m[1]) {
      return send(res, 400, ui.clientPage({ ...(await clientData(m[1])), baseUrl: baseUrl(req), error: `Para excluir, digite exatamente "${m[1]}".` }));
    }
    await store.deleteClient(m[1]);
    return redirect(res, '/');
  }

  if ((m = /^\/clientes\/([a-z0-9-]+)\/arquivos\/([^/]+)$/.exec(p)) && (method === 'GET' || method === 'HEAD')) {
    const file = decodePart(m[2]);
    let meta;
    try { meta = await store.readMeta(m[1], file); } catch { throw new HttpError(404, 'Backup não encontrado.'); }
    return sendFile(req, res, store.backupPath(m[1], file), meta.originalName || file);
  }

  if ((m = /^\/clientes\/([a-z0-9-]+)\/arquivos\/([^/]+)\/excluir$/.exec(p)) && method === 'POST') {
    await store.deleteBackup(m[1], decodePart(m[2]));
    return redirect(res, `/clientes/${m[1]}`);
  }

  return send(res, 404, ui.errorPage(404, 'Página não encontrada.'));
}

// ---------- servidor ----------

// O helper de envio fica público para o projeto do cliente baixar com curl (não tem segredo nenhum).
const HELPER_ROUTE = '/cliente/enviar-backup.mjs';
const HELPER_FILE = new URL('../cliente/enviar-backup.mjs', import.meta.url);
const FONTS_DIR = new URL('./fonts/', import.meta.url);

async function sendFont(res, name) {
  let data;
  try { data = await fsp.readFile(new URL(name, FONTS_DIR)); } catch { return send(res, 404, 'Não encontrado.'); }
  return send(res, 200, data, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' });
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true });
      const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
      if (font && req.method === 'GET') return await sendFont(res, font[1]);
      if (url.pathname === HELPER_ROUTE && (req.method === 'GET' || req.method === 'HEAD')) {
        return send(res, 200, req.method === 'HEAD' ? '' : await fsp.readFile(HELPER_FILE), { 'Content-Type': 'text/javascript; charset=utf-8' });
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await handlePanel(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : /inválid|não encontrado/i.test(err.message) ? 404 : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.destroy();
      if (url.pathname.startsWith('/api/')) return json(res, status, { error: err.message, ...(err.extra || {}) });
      return send(res, status, ui.errorPage(status, status === 500 ? 'Erro interno.' : err.message));
    }
  });
  // Uploads de muitos GB levam horas: sem limite de tempo por requisição.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  return server;
}

export async function start() {
  validateConfig();
  await store.init();
  await resumePendingVerifications();
  await cleanupStaleUploads();
  setInterval(() => cleanupStaleUploads().catch((e) => console.error(e)), 3600_000).unref();
  const server = createServer();
  server.listen(config.port, () => console.log(`Cofre de Backups ouvindo na porta ${config.port} (dados em ${config.dataDir})`));
  // No container o Node é o PID 1 e ignora SIGTERM sem handler: o deploy esperava 30 s e matava à força.
  // Sair na hora é seguro: os JSON são gravados com rename, uploads em pedaços retomam e a
  // verificação interrompida recomeça no próximo início.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, () => {
      console.log(`[${sig}] encerrando`);
      server.close();
      server.closeAllConnections?.();
      setTimeout(() => process.exit(0), 200).unref();
    });
  }
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  start().catch((err) => { console.error(err.message); process.exit(1); });
}
