import path from 'node:path';
import crypto from 'node:crypto';

const MB = 1024 * 1024;
const PLACEHOLDER_PASSWORDS = new Set(['troque-esta-senha', 'admin', 'senha', 'password', '123456']);
const truthy = (v) => /^(1|true|sim|yes)$/i.test(String(v || '').trim());

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  chunkSize: Math.max(1, Number(process.env.CHUNK_SIZE_MB) || 16) * MB,
  staleUploadHours: Math.max(1, Number(process.env.STALE_UPLOAD_HOURS) || 48),
  timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
  // Endereço público do cofre (ex.: https://backups.seudominio.com), usado no prompt e nos exemplos.
  // Sem ele, o endereço é deduzido dos cabeçalhos da requisição.
  publicUrl: String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  // Só confie no X-Forwarded-For quando houver um proxy na frente (Traefik, Caddy, Nginx).
  trustProxy: truthy(process.env.TRUST_PROXY),
  production: process.env.NODE_ENV === 'production',
  sessionDays: 7,
};

export function validateConfig() {
  if (!config.adminPassword) {
    throw new Error('Defina a variável ADMIN_PASSWORD (senha do painel).');
  }
  if (PLACEHOLDER_PASSWORDS.has(config.adminPassword.toLowerCase())) {
    throw new Error('ADMIN_PASSWORD ainda está com um valor de exemplo. Escolha uma senha de verdade.');
  }
  if (config.adminPassword.length < 12) {
    if (config.production) throw new Error('ADMIN_PASSWORD precisa ter pelo menos 12 caracteres.');
    console.warn('[aviso] ADMIN_PASSWORD tem menos de 12 caracteres. Em produção (NODE_ENV=production) o cofre não inicia assim.');
  }
  if (config.publicUrl && !/^https?:\/\/[^/]+/.test(config.publicUrl)) {
    throw new Error('PUBLIC_URL precisa começar com https:// (ex.: https://backups.seudominio.com).');
  }
  if (!config.sessionSecret) {
    const gen = `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
    if (config.production) throw new Error(`Defina a variável SESSION_SECRET. Gere uma com: ${gen}`);
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[aviso] SESSION_SECRET não definido: usando um aleatório. Os logins caem e os tokens somem do painel a cada reinício.');
  }
}
