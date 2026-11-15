// Upload em pedaços com retomada:
//   POST /api/uploads              { filename, size, sha256? } -> { id, offset, chunkSize }
//   PUT  /api/uploads/:id?offset=N corpo = bytes a partir de N    -> { offset }
//   GET  /api/uploads/:id                                         -> { offset, size }
//   POST /api/uploads/:id/complete { sha256? }                    -> { file, status }
// Os bytes vão para DATA_DIR/tmp/<id>.part; ao concluir, o arquivo é movido para a pasta do cliente.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import { backupPath, clientDir, diskUsage, dirs, readJson, writeJson, writeMeta } from './store.js';
import { enqueueVerify } from './verify.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const busy = new Set();

function partPath(id) { return path.join(dirs.tmp, `${id}.part`); }
function infoPath(id) { return path.join(dirs.tmp, `${id}.json`); }

export function safeFilename(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const clean = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-120);
  return clean || 'backup.bin';
}

function checkSha(value) {
  if (value == null || value === '') return null;
  const v = String(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(v)) throw new HttpError(400, 'sha256 inválido (esperado hex com 64 caracteres).');
  return v;
}

async function sizeOf(file) {
  try { return (await fsp.stat(file)).size; } catch (err) { if (err.code === 'ENOENT') return 0; throw err; }
}

async function loadInfo(client, id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new HttpError(404, 'Upload não encontrado.');
  let info;
  try { info = await readJson(infoPath(id)); } catch { throw new HttpError(404, 'Upload não encontrado.'); }
  if (info.clientId !== client.id) throw new HttpError(404, 'Upload não encontrado.');
  return info;
}

export async function startUpload(client, body) {
  const size = Number(body?.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new HttpError(400, 'Informe "size" (tamanho em bytes).');
  const disk = await diskUsage();
  if (disk && disk.free < size) throw new HttpError(507, 'O disco do cofre não tem espaço para este backup.');
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const info = {
    id, clientId: client.id, filename: safeFilename(body?.filename), originalName: String(body?.filename || '').slice(0, 200),
    size, expectedSha256: checkSha(body?.sha256), createdAt: now, updatedAt: now,
  };
  await fsp.writeFile(partPath(id), '');
  await writeJson(infoPath(id), info);
  return { id, offset: 0, size, chunkSize: config.chunkSize };
}

export async function uploadStatus(client, id) {
  const info = await loadInfo(client, id);
  return { id, offset: await sizeOf(partPath(id)), size: info.size, chunkSize: config.chunkSize };
}

export async function appendChunk(client, id, offsetParam, req) {
  const info = await loadInfo(client, id);
  if (busy.has(id)) throw new HttpError(409, 'Já existe um pedaço sendo enviado para este upload.');
  busy.add(id);
  let diskFull = false;
  try {
    const current = await sizeOf(partPath(id));
    const offset = Number(offsetParam);
    if (!Number.isSafeInteger(offset) || offset !== current) {
      throw new HttpError(409, `Offset errado: o servidor está em ${current}.`, { offset: current });
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && current + declared > info.size) {
      throw new HttpError(400, 'Este pedaço passa do tamanho total declarado.', { offset: current });
    }
    // Se a conexão cair no meio, o que chegou fica gravado; o cliente consulta o offset e continua dali.
    await pipeline(req, fs.createWriteStream(partPath(id), { flags: 'a' })).catch((err) => {
      if (err.code === 'ENOSPC') diskFull = true;
    });
    const after = await sizeOf(partPath(id));
    if (diskFull) {
      await fsp.truncate(partPath(id), current);
      throw new HttpError(507, 'O disco do cofre está cheio.', { offset: current });
    }
    if (after > info.size) {
      await fsp.truncate(partPath(id), current);
      throw new HttpError(400, 'Este pedaço passa do tamanho total declarado.', { offset: current });
    }
    info.updatedAt = new Date().toISOString();
    await writeJson(infoPath(id), info);
    return { id, offset: after, size: info.size };
  } finally {
    busy.delete(id);
  }
}

export async function completeUpload(client, id, body) {
  const info = await loadInfo(client, id);
  if (busy.has(id)) throw new HttpError(409, 'Ainda há um pedaço sendo enviado.');
  busy.add(id);
  try {
    const current = await sizeOf(partPath(id));
    if (current !== info.size) {
      throw new HttpError(409, `Upload incompleto: ${current} de ${info.size} bytes.`, { offset: current });
    }
    const expected = checkSha(body?.sha256) || info.expectedSha256;
    const result = await finalize(client.id, partPath(id), { ...info, expectedSha256: expected });
    await fsp.rm(infoPath(id), { force: true });
    return result;
  } finally {
    busy.delete(id);
  }
}

// Upload direto numa requisição só (útil para curl e arquivos pequenos).
export async function oneShotUpload(client, query, req) {
  const tmp = path.join(dirs.tmp, `direto-${crypto.randomBytes(16).toString('hex')}.part`);
  const expectedSha256 = checkSha(query.get('sha256'));
  const filename = query.get('filename') || 'backup.bin';
  try {
    await pipeline(req, fs.createWriteStream(tmp));
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    if (err.code === 'ENOSPC') throw new HttpError(507, 'O disco do cofre está cheio.');
    throw new HttpError(400, 'A conexão caiu antes de terminar o envio.');
  }
  const size = await sizeOf(tmp);
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared !== size) {
    await fsp.rm(tmp, { force: true });
    throw new HttpError(400, `Recebidos ${size} de ${declared} bytes.`);
  }
  return finalize(client.id, tmp, {
    filename: safeFilename(filename), originalName: filename.slice(0, 200), size, expectedSha256,
  });
}

async function finalize(clientId, fromPath, { filename, originalName, size, expectedSha256 }) {
  await fsp.mkdir(clientDir(clientId), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = `${stamp}_${crypto.randomBytes(2).toString('hex')}__${filename}`;
  const meta = {
    originalName: originalName || filename,
    size,
    createdAt: new Date().toISOString(),
    status: 'verificando',
    expectedSha256: expectedSha256 || null,
    sha256: null,
  };
  await writeMeta(clientId, file, meta);
  await fsp.rename(fromPath, backupPath(clientId, file));
  enqueueVerify(clientId, file);
  return { file, size, status: meta.status };
}

export async function listPendingUploads(clientId) {
  const out = [];
  for (const name of await fsp.readdir(dirs.tmp).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    try {
      const info = await readJson(path.join(dirs.tmp, name));
      if (info.clientId !== clientId) continue;
      out.push({ ...info, received: await sizeOf(partPath(info.id)) });
    } catch { /* ignora */ }
  }
  return out;
}

// Apaga uploads abandonados (sem novidade há STALE_UPLOAD_HOURS) e restos de uploads diretos.
export async function cleanupStaleUploads() {
  const limit = Date.now() - config.staleUploadHours * 3600_000;
  for (const name of await fsp.readdir(dirs.tmp).catch(() => [])) {
    const p = path.join(dirs.tmp, name);
    try {
      if (name.endsWith('.json')) {
        const info = await readJson(p);
        if (busy.has(info.id)) continue;
        if (Date.parse(info.updatedAt) < limit) {
          await fsp.rm(partPath(info.id), { force: true });
          await fsp.rm(p, { force: true });
          console.log(`[limpeza] upload abandonado removido: ${info.clientId}/${info.filename}`);
        }
      } else if (name.startsWith('direto-')) {
        const st = await fsp.stat(p);
        if (st.mtimeMs < limit) await fsp.rm(p, { force: true });
      }
    } catch { /* ignora */ }
  }
}
