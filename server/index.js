/* ==========================================================================
   Industrial Web Template · API de pedidos, tarifas y acceso de taller
     POST /api/auth/login    { password }  -> { token }   (>12 car., bloqueo a los 3 fallos)
     GET  /api/tariffs                     -> tarifas del ERP (consulta parametrizada)
     POST /api/orders        multipart: order (JSON) + plans (.dxf)
   También sirve la web estática, pero SOLO index/checkout/empleado, css/ y js/
   (nunca el resto del repositorio: server/, .env, .git...).
   ========================================================================== */
require('dotenv').config();
const path = require('path');
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const security = require('./security');
const { createRepository, connectFromEnv } = require('./db');

const ROOT = path.join(__dirname, '..');
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

function createApp({ env = process.env, repository = null, transporter = null } = {}) {
  const app = express();
  const OFFICE_EMAIL = env.OFFICE_EMAIL;                       // el destino lo decide el servidor, no el navegador
  const TOKEN_SECRET = env.SESSION_SECRET || '';
  const limiter = security.createLoginLimiter();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY === 'true');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use(cors({ origin: env.ALLOWED_ORIGIN || 'http://localhost:8080' }));

  /* ---- Estático con lista blanca ---- */
  for (const page of ['index.html', 'checkout.html', 'empleado.html']) {
    app.get(`/${page === 'index.html' ? '' : page}`, (_req, res) => res.sendFile(path.join(ROOT, page)));
  }
  app.use('/css', express.static(path.join(ROOT, 'css'), { dotfiles: 'deny', index: false }));
  app.use('/js', express.static(path.join(ROOT, 'js'), { dotfiles: 'deny', index: false }));

  /* ---- Login del Panel de Taller ---- */
  app.post('/api/auth/login', express.json({ limit: '1kb' }), (req, res) => {
    const key = req.ip;
    const locked = limiter.remainingLockMs(key);
    if (locked > 0) {
      res.set('Retry-After', String(Math.ceil(locked / 1000)));
      return res.status(429).json({ ok: false, error: 'Demasiados intentos' });
    }
    if (!env.EMPLOYEE_PASSWORD_HASH || TOKEN_SECRET.length < 32) {
      return res.status(503).json({ ok: false, error: 'Acceso no configurado' });
    }
    const password = req.body && req.body.password;
    // Una clave que incumple la política cuenta como fallo: no hay atajo para sondear.
    const ok = typeof password === 'string' && password.length <= 256 && security.verifyPassword(password, env.EMPLOYEE_PASSWORD_HASH);
    if (!ok) {
      const { locked: nowLocked } = limiter.recordFailure(key);
      return res.status(nowLocked ? 429 : 401).json({ ok: false, error: nowLocked ? 'Demasiados intentos' : 'Credenciales no válidas' });
    }
    limiter.recordSuccess(key);
    res.json({ ok: true, token: security.signToken(TOKEN_SECRET) });
  });

  /* ---- Tarifas del ERP ---- */
  app.get('/api/tariffs', async (_req, res) => {
    if (!repository) return res.status(503).json({ ok: false, error: 'ERP no configurado' });
    try {
      res.json({ fuente: 'ERP', actualizado: new Date().toISOString(), moneda: 'EUR', ...(await repository.getTariffs()) });
    } catch (err) {
      console.error('[tariffs] error', err.message);
      res.status(502).json({ ok: false, error: 'ERP no disponible' });
    }
  });

  /* ---- Pedidos ---- */
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 20, fields: 5 },
    fileFilter: (_req, file, cb) => cb(null, /\.dxf$/i.test(file.originalname)),
  });

  app.post('/api/orders', upload.array('plans', 20), async (req, res) => {
    try {
      const payload = JSON.parse(String(req.body.order || '{}').slice(0, 2_000_000));
      const { billing = {}, order = {}, email = {} } = payload;
      if (!isEmail(billing.email)) return res.status(400).json({ ok: false, error: 'Email de cliente no válido' });
      if (!req.files || req.files.length === 0) return res.status(400).json({ ok: false, error: 'Faltan los planos DXF' });
      if (!OFFICE_EMAIL || !transporter) return res.status(500).json({ ok: false, error: 'Correo no configurado' });

      // Nombres saneados (sin rutas) y contenido que realmente parece un DXF.
      const attachments = req.files.map((f) => {
        if (!security.looksLikeDxf(f.buffer)) throw Object.assign(new Error('bad-dxf'), { status: 400 });
        return { filename: security.safeFileName(f.originalname, ['dxf']), content: f.buffer, contentType: 'application/dxf' };
      });

      // IMPORTANTE (producción): recalcula aquí el precio con la misma lógica que js/pricing.js.
      // Nunca confíes en importes que llegan del navegador.
      const orderId = security.singleLine(order.id, 40);
      const safeHtml = security.escapeHTML(String(email.text || '')).replace(/\n/g, '<br>');   // el HTML del navegador no se reenvía tal cual

      if (repository) {
        await repository.saveOrder({
          orderId, email: billing.email, name: billing.fullName, taxId: billing.taxId,
          total: order.total, payload: { lines: order.lines || [] },
        });
      }

      await transporter.sendMail({
        from: env.MAIL_FROM, to: OFFICE_EMAIL, replyTo: billing.email,
        subject: security.singleLine(email.subject || `Nuevo pedido ${orderId}`),
        text: email.text, html: safeHtml, attachments,
      });
      if (payload.sendCustomerConfirmation) {
        await transporter.sendMail({
          from: env.MAIL_FROM, to: billing.email,
          subject: security.singleLine(`Confirmación de pedido ${orderId}`),
          text: `Hola ${security.singleLine(billing.fullName, 80)},\n\nHemos recibido tu pedido ${orderId}.\n\n${email.text || ''}`,
          html: safeHtml, attachments: payload.attachPlansToCustomer ? attachments : [],
        });
      }
      res.json({ ok: true, orderId, files: attachments.length });
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ ok: false, error: 'Archivo de plano no válido' });
      console.error('[orders] error', err.message);
      res.status(500).json({ ok: false, error: 'No se pudo procesar el pedido' });
    }
  });

  return app;
}

async function main() {
  const PORT = Number(process.env.PORT || 3000);
  const db = await connectFromEnv().catch((err) => { console.error('[db] sin conexión:', err.message); return null; });
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  createApp({ repository: db ? createRepository(db.pool, db.sql) : null, transporter })
    .listen(PORT, () => console.log(`Industrial Web Template en http://localhost:${PORT}`));
}

if (require.main === module) main();
module.exports = { createApp };
