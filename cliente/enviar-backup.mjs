// Envia um arquivo de backup para o Cofre de Backups, em pedaços e com retomada.
// Sem dependências (Node 18+). Copie este arquivo para o seu sistema.
//
// Como CLI:
//   BACKUP_URL=https://backups.seudominio.com BACKUP_TOKEN=bk_... node enviar-backup.mjs /caminho/backup.dump
//
// Como módulo:
//   import { enviarBackup } from './enviar-backup.mjs';
//   await enviarBackup('/caminho/backup.dump', { url: process.env.BACKUP_URL, token: process.env.BACKUP_TOKEN });

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function enviarBackup(arquivo, { url, token, nome, tentativas = 10, aoProgredir } = {}) {
  if (!url || !token) throw new Error('Informe url e token (BACKUP_URL e BACKUP_TOKEN).');
  const base = url.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };

  async function api(method, rota, { body, json } = {}) {
    const res = await fetch(base + rota, {
      method,
      headers: json ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: json ? JSON.stringify(json) : body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Erro de rede ou 5xx (cofre reiniciando, proxy) vale nova tentativa; 4xx não.
  const temporario = (err) => !err.status || err.status >= 500;
  async function insistir(fn) {
    for (let falhas = 0; ; ) {
      try { return await fn(falhas); } catch (err) {
        if (!temporario(err) || ++falhas > tentativas) throw err;
        await sleep(Math.min(30_000, 1000 * 2 ** falhas));
      }
    }
  }

  const fh = await fs.open(arquivo, 'r');
  try {
    const { size } = await fh.stat();
    const filename = nome || path.basename(arquivo);
    const up = await insistir(() => api('POST', '/api/uploads', { json: { filename, size } }));
    const chunkSize = up.chunkSize;
    const buffer = Buffer.alloc(Math.min(chunkSize, Math.max(size, 1)));
    const hash = crypto.createHash('sha256');
    let hashedUpTo = 0;
    let offset = 0;

    // Calcula o hash de trechos que o servidor já tem mas que ainda não passaram pelo hash local.
    async function hashAte(fim) {
      while (hashedUpTo < fim) {
        const n = Math.min(buffer.length, fim - hashedUpTo);
        const { bytesRead } = await fh.read(buffer, 0, n, hashedUpTo);
        hash.update(buffer.subarray(0, bytesRead));
        hashedUpTo += bytesRead;
      }
    }

    while (offset < size) {
      const n = Math.min(chunkSize, size - offset);
      let falhas = 0;
      for (;;) {
        try {
          await hashAte(offset);
          const { bytesRead } = await fh.read(buffer, 0, n, offset);
          const pedaco = buffer.subarray(0, bytesRead);
          const r = await api('PUT', `/api/uploads/${up.id}?offset=${offset}`, { body: pedaco });
          if (r.offset === offset + bytesRead && hashedUpTo === offset) {
            hash.update(pedaco);
            hashedUpTo = r.offset;
          }
          offset = r.offset;
          break;
        } catch (err) {
          if (err.status && err.status < 500 && err.status !== 409) throw err;
          if (++falhas > tentativas) throw err;
          await sleep(Math.min(30_000, 1000 * 2 ** falhas));
          // Pergunta ao servidor até onde ele recebeu e continua dali.
          try { offset = (await api('GET', `/api/uploads/${up.id}`)).offset; } catch { /* tenta de novo */ }
        }
      }
      aoProgredir?.({ enviado: offset, total: size });
    }

    await hashAte(size);
    const sha256 = hash.digest('hex');
    const fim = await insistir(async (falhas) => {
      try {
        return await api('POST', `/api/uploads/${up.id}/complete`, { json: { sha256 } });
      } catch (err) {
        // 404 numa nova tentativa: a anterior chegou ao cofre e só a resposta se perdeu.
        if (err.status === 404 && falhas > 0) return { status: 'verificando' };
        throw err;
      }
    });
    return { ...fim, sha256 };
  } finally {
    await fh.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('Uso: BACKUP_URL=... BACKUP_TOKEN=... node enviar-backup.mjs <arquivo>');
    process.exit(2);
  }
  let ultimo = -1;
  enviarBackup(arquivo, {
    url: process.env.BACKUP_URL,
    token: process.env.BACKUP_TOKEN,
    aoProgredir: ({ enviado, total }) => {
      const pct = total ? Math.floor((enviado / total) * 100) : 100;
      if (pct !== ultimo) { ultimo = pct; process.stdout.write(`\rEnviando... ${pct}%`); }
    },
  }).then(
    (r) => { console.log(`\nEnviado: ${r.file || 'recebido pelo cofre'} (sha256 ${r.sha256})`); },
    (err) => { console.error(`\nFalhou: ${err.message}`); process.exit(1); },
  );
}
