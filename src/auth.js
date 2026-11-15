import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'cofre_sessao';

// A senha entra na chave: trocar ADMIN_PASSWORD derruba todas as sessões abertas.
function sign(value) {
  return crypto.createHmac('sha256', `${config.sessionSecret}:${config.adminPassword}`).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkPassword(password) {
  const a = crypto.createHash('sha256').update(String(password || '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted === true;
}

export function sessionCookie(req) {
  const expires = Date.now() + config.sessionDays * 86400_000;
  const value = `${expires}.${sign(String(expires))}`;
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isLoggedIn(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const [expires, sig] = raw.split('.');
  return Boolean(sig) && safeEqual(sig, sign(expires)) && Number(expires) > Date.now();
}

// Freio simples contra tentativa de senha: 10 erros por IP em 15 minutos.
const failures = new Map();
export function loginBlocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > 15 * 60_000) { failures.delete(ip); return false; }
  return f.count >= 10;
}
export function registerFailure(ip) {
  if (failures.size > 10_000) {
    for (const [key, v] of failures) if (Date.now() - v.first > 15 * 60_000) failures.delete(key);
  }
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60_000) failures.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}
export function clearFailures(ip) { failures.delete(ip); }

export function bearerToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  return m ? m[1].trim() : null;
}
