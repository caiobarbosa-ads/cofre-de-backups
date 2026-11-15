// Validação da configuração na subida. Cada caso roda num processo separado, porque a config é lida no import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function validate(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-config-'));
  const code = `import('./src/config.js').then(({ validateConfig }) => { validateConfig(); console.log('ok'); })
    .catch((e) => { console.log('erro: ' + e.message); });`;
  const clean = { ...process.env };
  for (const k of ['ADMIN_PASSWORD', 'SESSION_SECRET', 'NODE_ENV', 'PUBLIC_URL', 'TRUST_PROXY']) delete clean[k];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, env: { ...clean, DATA_DIR: dataDir, ...env }, encoding: 'utf8',
  });
  fs.rmSync(dataDir, { recursive: true, force: true });
  return { out: r.stdout.trim(), err: r.stderr };
}

const secret = 'a'.repeat(64);

test('sem senha não inicia', () => {
  assert.match(validate({}).out, /^erro: Defina a variável ADMIN_PASSWORD/);
});

test('senha de exemplo não inicia', () => {
  assert.match(validate({ ADMIN_PASSWORD: 'troque-esta-senha', SESSION_SECRET: secret }).out, /valor de exemplo/);
});

test('em produção exige senha de 12 caracteres e SESSION_SECRET', () => {
  assert.match(validate({ NODE_ENV: 'production', ADMIN_PASSWORD: 'curta', SESSION_SECRET: secret }).out, /12 caracteres/);
  assert.match(validate({ NODE_ENV: 'production', ADMIN_PASSWORD: 'uma-senha-bem-longa' }).out, /Defina a variável SESSION_SECRET/);
  assert.equal(validate({ NODE_ENV: 'production', ADMIN_PASSWORD: 'uma-senha-bem-longa', SESSION_SECRET: secret }).out, 'ok');
});

test('fora de produção só avisa', () => {
  const r = validate({ ADMIN_PASSWORD: 'curta' });
  assert.equal(r.out, 'ok');
  assert.match(r.err, /menos de 12 caracteres/);
  assert.match(r.err, /SESSION_SECRET não definido/);
});

test('PUBLIC_URL inválida não inicia', () => {
  assert.match(validate({ ADMIN_PASSWORD: 'uma-senha-bem-longa', SESSION_SECRET: secret, PUBLIC_URL: 'backups.exemplo.com' }).out, /PUBLIC_URL/);
  assert.equal(validate({ ADMIN_PASSWORD: 'uma-senha-bem-longa', SESSION_SECRET: secret, PUBLIC_URL: 'https://backups.exemplo.com/' }).out, 'ok');
});
