/* ==========================================================================
   Seguridad del servidor (sin dependencias): contraseñas, bloqueo, tokens,
   nombres de archivo y validación de planos. Todo es testeable por separado.
   ========================================================================== */
const crypto = require('crypto');
const path = require('path');
const AuthPolicy = require('../js/auth-policy.js');   // misma política que el cliente

const MIN_PASSWORD_LENGTH = 13;                        // "más de 12 caracteres"
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000;

/* ---------- Contraseñas: scrypt con sal (formato "scrypt$salt$hash") ---------- */
function hashPassword(password) {
  if (!AuthPolicy.meetsLength(password, MIN_PASSWORD_LENGTH)) {
    throw new Error(`La contraseña debe tener más de ${MIN_PASSWORD_LENGTH - 1} caracteres.`);
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  if (!AuthPolicy.meetsLength(password, MIN_PASSWORD_LENGTH)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);       // tiempo constante
}

/* ---------- Bloqueo por intentos fallidos, por clave (IP) ---------- */
function createLoginLimiter({ maxAttempts = MAX_ATTEMPTS, lockoutMs = LOCKOUT_MS, now = Date.now } = {}) {
  const guards = new Map();
  const guardFor = (key) => {
    if (!guards.has(key)) {
      let state = null;
      guards.set(key, AuthPolicy.createLoginGuard({
        maxAttempts, lockoutMs, now,
        store: { get: () => state, set: (s) => { state = s; }, clear: () => { state = null; } },
      }));
    }
    return guards.get(key);
  };
  return {
    remainingLockMs: (key) => guardFor(key).remainingLockMs(),
    recordFailure: (key) => guardFor(key).recordFailure(),
    recordSuccess: (key) => guardFor(key).recordSuccess(),
  };
}

/* ---------- Token de sesión firmado (HMAC-SHA256, caduca) ---------- */
function signToken(secret, ttlMs = 8 * 60 * 60 * 1000, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + ttlMs, n: crypto.randomBytes(8).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(secret, token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now; } catch { return false; }
}

/* ---------- Archivos: anti path traversal ---------- */
/** Nombre seguro: sin directorios, solo [A-Za-z0-9_-], extensión de una lista cerrada. */
function safeFileName(name, allowedExt = ['dxf', 'stl', 'glb']) {
  const base = String(name ?? '').split(/[\\/]/).pop();   // quita "../" y rutas Windows/POSIX
  const m = /^(.*)\.([A-Za-z0-9]{2,4})$/.exec(base);
  const ext = m ? m[2].toLowerCase() : '';
  if (!allowedExt.includes(ext)) throw new Error('Extensión de archivo no permitida');
  const stem = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 80) || 'file';
  return `${stem}.${ext}`;
}

/** Resuelve `name` dentro de `rootDir` y falla si el resultado se sale de él. */
function resolveInside(rootDir, name) {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, safeFileName(name));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Ruta fuera del directorio permitido');
  return target;
}

/** Un DXF de texto empieza por el par de grupo "0 / SECTION" y termina con EOF. */
function looksLikeDxf(buffer) {
  const head = buffer.subarray(0, 64).toString('latin1').replace(/\r/g, '');
  const tail = buffer.subarray(Math.max(0, buffer.length - 64)).toString('latin1');
  return /^\s*0\n\s*SECTION/.test(head) && /EOF\s*$/.test(tail) && !buffer.includes(0);
}

/* ---------- Texto para emails: sin saltos de línea (header injection) ---------- */
const singleLine = (v, max = 200) => String(v ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, max);
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = {
  MIN_PASSWORD_LENGTH, MAX_ATTEMPTS, LOCKOUT_MS,
  hashPassword, verifyPassword, createLoginLimiter, signToken, verifyToken,
  safeFileName, resolveInside, looksLikeDxf, singleLine, escapeHTML,
};
