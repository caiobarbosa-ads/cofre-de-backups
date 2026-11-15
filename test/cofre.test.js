import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cofre-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'senha-teste';
process.env.SESSION_SECRET = 'segredo-teste';
process.env.CHUNK_SIZE_MB = '1';

const { createServer } = await import('../src/server.js');
const store = await import('../src/store.js');
const { verifyIdle } = await import('../src/verify.js');
const { enviarBackup } = await import('../cliente/enviar-backup.mjs');

let server;
let base;

before(async () => {
  await store.init();
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function waitVerify() {
  for (let i = 0; i < 200 && !verifyIdle(); i++) await new Promise((r) => setTimeout(r, 25));
}

async function tmpFile(bytes) {
  const p = path.join(dataDir, `origem-${crypto.randomBytes(4).toString('hex')}.bin`);
  const buf = crypto.randomBytes(bytes);
  await fs.writeFile(p, buf);
  return { p, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

test('token inválido é recusado', async () => {
  const res = await fetch(`${base}/api/ping`, { headers: { Authorization: 'Bearer errado' } });
  assert.equal(res.status, 401);
});

test('upload em pedaços com o helper, sha256 conferido', async () => {
  const { token } = await store.createClient({ name: 'Cliente Pedaços', keep: 3 });
  const { p, sha } = await tmpFile(2.5 * 1024 * 1024); // 3 pedaços de 1 MB
  const r = await enviarBackup(p, { url: base, token, nome: 'banco.dump' });
  assert.equal(r.sha256, sha);
  await waitVerify();
  const list = await store.listBackups('cliente-pedacos');
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'ok');
  assert.equal(list[0].sha256, sha);
  assert.equal(list[0].originalName, 'banco.dump');
});

test('offset errado devolve 409 com o offset do servidor', async () => {
  const { token } = await store.createClient({ name: 'Cliente Offset', keep: 3 });
  const h = { Authorization: `Bearer ${token}` };
  const up = await (await fetch(`${base}/api/uploads`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'x.bin', size: 10 }),
  })).json();
  let res = await fetch(`${base}/api/uploads/${up.id}?offset=0`, { method: 'PUT', headers: h, body: Buffer.alloc(4) });
  assert.equal((await res.json()).offset, 4);
  res = await fetch(`${base}/api/uploads/${up.id}?offset=0`, { method: 'PUT', headers: h, body: Buffer.alloc(4) });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).offset, 4);
  // concluir antes de terminar é recusado
  res = await fetch(`${base}/api/uploads/${up.id}/complete`, { method: 'POST', headers: h });
  assert.equal(res.status, 409);
  // outro cliente não enxerga este upload
  const outro = await store.createClient({ name: 'Intruso', keep: 1 });
  res = await fetch(`${base}/api/uploads/${up.id}`, { headers: { Authorization: `Bearer ${outro.token}` } });
  assert.equal(res.status, 404);
});

test('sha256 divergente marca como corrompido e não gira a retenção', async () => {
  const { token } = await store.createClient({ name: 'Cliente Hash', keep: 1 });
  const { p } = await tmpFile(1000);
  const res = await fetch(`${base}/api/upload?filename=a.bin&sha256=${'0'.repeat(64)}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: await fs.readFile(p),
  });
  assert.equal(res.status, 201);
  await waitVerify();
  const [b] = await store.listBackups('cliente-hash');
  assert.equal(b.status, 'corrompido');
});

test('corrompidos não se acumulam: ficam só os N mais recentes', async () => {
  const { token } = await store.createClient({ name: 'Cliente Ruim', keep: 2 });
  for (let i = 1; i <= 4; i++) {
    const res = await fetch(`${base}/api/upload?filename=r${i}.bin&sha256=${'0'.repeat(64)}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: crypto.randomBytes(100),
    });
    assert.equal(res.status, 201);
    await waitVerify();
    await new Promise((r) => setTimeout(r, 5));
  }
  const list = await store.listBackups('cliente-ruim');
  assert.deepEqual(list.map((b) => [b.originalName, b.status]), [['r4.bin', 'corrompido'], ['r3.bin', 'corrompido']]);
});

test('painel manda cabeçalhos de segurança', async () => {
  const res = await fetch(`${base}/login`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('retenção: mantém os últimos N e apaga o mais antigo', async () => {
  const { token } = await store.createClient({ name: 'Cliente Retenção', keep: 2 });
  const enviados = [];
  for (let i = 1; i <= 4; i++) {
    const { p } = await tmpFile(500);
    const res = await fetch(`${base}/api/upload?filename=b${i}.bin`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: await fs.readFile(p),
    });
    enviados.push((await res.json()).file);
    await waitVerify();
    await new Promise((r) => setTimeout(r, 5)); // garante createdAt diferente
  }
  let list = await store.listBackups('cliente-retencao');
  assert.deepEqual(list.map((b) => b.originalName), ['b4.bin', 'b3.bin']);

  // diminuir a retenção apaga o excedente na hora
  await store.updateClient('cliente-retencao', { name: 'Cliente Retenção', keep: 1 });
  list = await store.listBackups('cliente-retencao');
  assert.deepEqual(list.map((b) => b.originalName), ['b4.bin']);
});

test('painel exige login e baixa arquivo com Range', async () => {
  let res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');

  res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=errada',
  });
  assert.equal(res.status, 401);

  res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=senha-teste',
  });
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie').split(';')[0];

  res = await fetch(`${base}/`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Cliente Retenção/);

  const [b] = await store.listBackups('cliente-retencao');
  const original = await fs.readFile(store.backupPath('cliente-retencao', b.file));
  res = await fetch(`${base}/clientes/cliente-retencao/arquivos/${b.file}`, { headers: { cookie, range: 'bytes=10-19' } });
  assert.equal(res.status, 206);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), original.subarray(10, 20));

  // caminho malicioso não sai da pasta
  res = await fetch(`${base}/clientes/cliente-retencao/arquivos/..%2F..%2Fclientes.json`, { headers: { cookie } });
  assert.equal(res.status, 404);
});

test('criar cliente leva à página dele com token e prompt prontos', async () => {
  let res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=senha-teste',
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const form = (body) => ({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, body });

  res = await fetch(`${base}/clientes`, form('name=Cliente+Prompt&keep=3'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/clientes/cliente-prompt');

  let html = await (await fetch(`${base}/clientes/cliente-prompt`, { headers: { cookie } })).text();
  const token = html.match(/id="tok"[^>]*value="(bk_[\w-]+)"/)?.[1];
  assert.ok(token, 'token aparece na página');
  assert.match(html, /<textarea id="prompt"/);
  assert.ok(html.includes(`${base}/cliente/enviar-backup.mjs`), 'prompt aponta para o helper');
  assert.match(html, /últimos 3 backups válidos/);
  assert.equal((await store.findClientByToken(token))?.id, 'cliente-prompt');

  // novo token: a página passa a mostrar o novo e o antigo deixa de valer
  res = await fetch(`${base}/clientes/cliente-prompt/token`, form(''));
  assert.equal(res.status, 303);
  html = await (await fetch(`${base}/clientes/cliente-prompt`, { headers: { cookie } })).text();
  const novo = html.match(/id="tok"[^>]*value="(bk_[\w-]+)"/)?.[1];
  assert.ok(novo && novo !== token);
  assert.equal(await store.findClientByToken(token), null);

  // cliente antigo, sem token guardado: oferece gerar um
  const list = await store.listClients();
  delete list.find((c) => c.id === 'cliente-prompt').tokenEnc;
  await store.writeJson(store.dirs.clientsFile, list);
  html = await (await fetch(`${base}/clientes/cliente-prompt`, { headers: { cookie } })).text();
  assert.doesNotMatch(html, /id="tok"/);
  assert.match(html, /Gerar token/);
});

test('fontes são públicas e não saem da pasta', async () => {
  let res = await fetch(`${base}/fonts/ibm-plex-sans-latin-wght-normal.woff2`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  res = await fetch(`${base}/fonts/nao-existe.woff2`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/fonts/..%2Fui.js`, { redirect: 'manual' });
  assert.notEqual(res.status, 200);
});

test('helper de envio é público', async () => {
  const res = await fetch(`${base}/cliente/enviar-backup.mjs`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export async function enviarBackup/);
});

test('sem TRUST_PROXY, X-Forwarded-For inventado não burla o limite de login', async () => {
  const { config } = await import('../src/config.js');
  assert.equal(config.trustProxy, false);
  const tentar = (ip) => fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip }, body: 'password=errada',
  });
  for (let i = 0; i < 10; i++) assert.equal((await tentar(`10.0.0.${i}`)).status, 401);
  assert.equal((await tentar('10.0.0.99')).status, 429);
  const auth = await import('../src/auth.js');
  auth.clearFailures('127.0.0.1');
  auth.clearFailures('::ffff:127.0.0.1');
});

test('com TRUST_PROXY, o limite vale por IP vindo do proxy', async () => {
  const { config } = await import('../src/config.js');
  config.trustProxy = true;
  try {
    const tentar = (ip) => fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': ip }, body: 'password=errada',
    });
    for (let i = 0; i < 10; i++) await tentar('203.0.113.7');
    assert.equal((await tentar('203.0.113.7')).status, 429);
    assert.equal((await tentar('203.0.113.8')).status, 401);
  } finally {
    config.trustProxy = false;
  }
});

test('PUBLIC_URL é usada no prompt', async () => {
  const { config } = await import('../src/config.js');
  config.publicUrl = 'https://backups.exemplo.com';
  try {
    const login = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=senha-teste',
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    await store.createClient({ name: 'Cliente Url', keep: 1 });
    const html = await (await fetch(`${base}/clientes/cliente-url`, { headers: { cookie } })).text();
    assert.ok(html.includes('URL: https://backups.exemplo.com'));
    assert.ok(!html.includes(base));
  } finally {
    config.publicUrl = '';
  }
});

test('upload maior que o espaço livre é recusado com 507 logo no início', async () => {
  const { token } = await store.createClient({ name: 'Cliente Grande', keep: 1 });
  const res = await fetch(`${base}/api/uploads`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'enorme.bin', size: Number.MAX_SAFE_INTEGER }),
  });
  assert.equal(res.status, 507);
});
