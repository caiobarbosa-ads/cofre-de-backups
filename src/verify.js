// Calcula o sha256 de cada backup recebido (um por vez, para não disputar disco),
// compara com o hash enviado pelo sistema (se houver) e só então aplica a retenção.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { applyRetention, backupPath, listBackups, listClients, readMeta, writeMeta } from './store.js';

const queue = [];
let running = false;

export function enqueueVerify(clientId, file) {
  queue.push({ clientId, file });
  if (!running) run();
}

export function verifyIdle() {
  return !running && queue.length === 0;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function run() {
  running = true;
  while (queue.length) {
    const { clientId, file } = queue.shift();
    try {
      const meta = await readMeta(clientId, file);
      const sha256 = await sha256File(backupPath(clientId, file));
      const ok = !meta.expectedSha256 || meta.expectedSha256.toLowerCase() === sha256;
      meta.sha256 = sha256;
      meta.status = ok ? 'ok' : 'corrompido';
      meta.verifiedAt = new Date().toISOString();
      await writeMeta(clientId, file, meta);
      console.log(`[verificação] ${clientId}/${file}: ${meta.status}`);
      await applyRetention(clientId);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[verificação] erro em ${clientId}/${file}:`, err.message);
    }
  }
  running = false;
}

// Ao iniciar, retoma backups que ficaram "verificando" porque o processo reiniciou.
export async function resumePendingVerifications() {
  for (const c of await listClients()) {
    for (const b of await listBackups(c.id)) {
      if (b.status === 'verificando') enqueueVerify(c.id, b.file);
    }
  }
}
