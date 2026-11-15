// Clientes ficam em DATA_DIR/clientes.json; backups ficam em DATA_DIR/backups/<cliente>/.
// Cada backup tem um arquivo irmão "<nome>.meta.json" com nome original, tamanho, status e sha256.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export const dirs = {
  get backups() { return path.join(config.dataDir, 'backups'); },
  get tmp() { return path.join(config.dataDir, 'tmp'); },
  get clientsFile() { return path.join(config.dataDir, 'clientes.json'); },
};

const META = '.meta.json';

// Mutex simples: as operações que alteram estado rodam uma de cada vez.
let chain = Promise.resolve();
export function serialized(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export async function init() {
  try {
    await fsp.mkdir(dirs.backups, { recursive: true });
    await fsp.mkdir(dirs.tmp, { recursive: true });
    if (!fs.existsSync(dirs.clientsFile)) await writeJson(dirs.clientsFile, []);
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      throw new Error(`Sem permissão para gravar em ${config.dataDir}. No Docker, o cofre roda como o usuário node (uid 1000): `
        + 'se o volume é uma pasta do servidor, rode "sudo chown -R 1000:1000 <pasta>".');
    }
    throw err;
  }
}

export async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

export async function writeJson(file, data) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
  return `bk_${crypto.randomBytes(24).toString('base64url')}`;
}

// O token fica guardado criptografado (AES-256-GCM, chave derivada do SESSION_SECRET) para o
// painel poder mostrá-lo sempre. A validação continua pelo hash.
function tokenKey() {
  return crypto.createHash('sha256').update(`cofre-token:${config.sessionSecret}`).digest();
}

function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function readToken(client) {
  try {
    const [iv, tag, data] = String(client.tokenEnc || '').split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return hashToken(token) === client.tokenHash ? token : null;
  } catch {
    return null;
  }
}

function slugify(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cliente';
}

export function parseKeep(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 1000) throw new Error('A retenção precisa ser um número entre 1 e 1000.');
  return n;
}

function cleanName(value) {
  const name = String(value || '').trim().slice(0, 80);
  if (!name) throw new Error('Informe o nome do cliente.');
  return name;
}

// ---------- clientes ----------

export async function listClients() {
  return readJson(dirs.clientsFile);
}

export async function getClient(id) {
  return (await listClients()).find((c) => c.id === id) || null;
}

export async function findClientByToken(token) {
  if (!token) return null;
  const wanted = Buffer.from(hashToken(token), 'hex');
  for (const c of await listClients()) {
    const have = Buffer.from(c.tokenHash, 'hex');
    if (have.length === wanted.length && crypto.timingSafeEqual(have, wanted)) return c;
  }
  return null;
}

export function createClient({ name, keep }) {
  return serialized(async () => {
    const list = await listClients();
    const clean = cleanName(name);
    const base = slugify(clean);
    let id = base;
    for (let i = 2; list.some((c) => c.id === id); i++) id = `${base}-${i}`;
    const token = newToken();
    const client = {
      id,
      name: clean,
      keep: parseKeep(keep),
      tokenHash: hashToken(token),
      tokenEnc: encryptToken(token),
      createdAt: new Date().toISOString(),
    };
    list.push(client);
    await writeJson(dirs.clientsFile, list);
    await fsp.mkdir(clientDir(id), { recursive: true });
    return { client, token };
  });
}

export async function updateClient(id, { name, keep }) {
  await serialized(async () => {
    const list = await listClients();
    const client = list.find((c) => c.id === id);
    if (!client) throw new Error('Cliente não encontrado.');
    client.name = cleanName(name);
    client.keep = parseKeep(keep);
    await writeJson(dirs.clientsFile, list);
  });
  await applyRetention(id);
}

export function regenerateToken(id) {
  return serialized(async () => {
    const list = await listClients();
    const client = list.find((c) => c.id === id);
    if (!client) throw new Error('Cliente não encontrado.');
    const token = newToken();
    client.tokenHash = hashToken(token);
    client.tokenEnc = encryptToken(token);
    await writeJson(dirs.clientsFile, list);
    return token;
  });
}

export function deleteClient(id) {
  return serialized(async () => {
    const list = await listClients();
    if (!list.some((c) => c.id === id)) throw new Error('Cliente não encontrado.');
    await writeJson(dirs.clientsFile, list.filter((c) => c.id !== id));
    await fsp.rm(clientDir(id), { recursive: true, force: true });
  });
}

// ---------- backups ----------

export function clientDir(clientId) {
  if (!/^[a-z0-9-]+$/.test(clientId)) throw new Error('Cliente inválido.');
  return path.join(dirs.backups, clientId);
}

export function backupPath(clientId, file) {
  if (!/^[A-Za-z0-9._-]+$/.test(file) || file.endsWith(META) || file.startsWith('.')) {
    throw new Error('Arquivo inválido.');
  }
  return path.join(clientDir(clientId), file);
}

export async function readMeta(clientId, file) {
  return readJson(backupPath(clientId, file) + META);
}

export async function writeMeta(clientId, file, meta) {
  await writeJson(backupPath(clientId, file) + META, meta);
}

export async function listBackups(clientId) {
  let names;
  try {
    names = await fsp.readdir(clientDir(clientId));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names) {
    if (name.endsWith(META) || name.endsWith('.tmp')) continue;
    try {
      const meta = await readMeta(clientId, name);
      out.push({ file: name, ...meta });
    } catch {
      // arquivo sem meta (não deveria acontecer): mostra o básico
      const st = await fsp.stat(path.join(clientDir(clientId), name)).catch(() => null);
      if (st?.isFile()) out.push({ file: name, originalName: name, size: st.size, createdAt: st.mtime.toISOString(), status: 'ok' });
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export async function deleteBackup(clientId, file) {
  const p = backupPath(clientId, file);
  await fsp.rm(p, { force: true });
  await fsp.rm(p + META, { force: true });
}

// Mantém os últimos N backups válidos. Tudo que for mais antigo que o N-ésimo válido sai
// (inclusive os corrompidos). Backups ainda em verificação nunca são apagados.
// Se não houver N válidos, nenhum válido é apagado. Corrompidos também ficam limitados aos
// N mais recentes, para um sistema que só manda arquivo ruim não encher o disco.
export function applyRetention(clientId) {
  return serialized(async () => {
    const client = await getClient(clientId);
    if (!client) return [];
    const all = await listBackups(clientId);
    const valid = all.filter((b) => b.status === 'ok');
    const cutoff = valid.length > client.keep ? valid[client.keep - 1].createdAt : '';
    const extraBad = new Set(all.filter((b) => b.status === 'corrompido').slice(client.keep).map((b) => b.file));
    const removed = [];
    for (const b of all) {
      if (b.status !== 'verificando' && (b.createdAt < cutoff || extraBad.has(b.file))) {
        await deleteBackup(clientId, b.file);
        removed.push(b.file);
      }
    }
    if (removed.length) console.log(`[retenção] ${clientId}: apagados ${removed.join(', ')}`);
    return removed;
  });
}

export async function diskUsage() {
  try {
    const s = await fsp.statfs(config.dataDir);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}
