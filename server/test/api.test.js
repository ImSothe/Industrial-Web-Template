const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../index');
const { hashPassword } = require('../security');

const PASSWORD = 'correct horse battery';
const env = {
  EMPLOYEE_PASSWORD_HASH: hashPassword(PASSWORD),
  SESSION_SECRET: 's'.repeat(40),
  OFFICE_EMAIL: 'office@your-company.example',
  MAIL_FROM: 'orders@your-company.example',
};

async function withServer(opts, fn) {
  const server = http.createServer(createApp({ env, ...opts }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}
const login = (base, password) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
});

test('login: right password gives a token', () => withServer({}, async (base) => {
  const res = await login(base, PASSWORD);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).token);
}));

test('login: 3 wrong passwords lock the client, even the right one is refused afterwards', () => withServer({}, async (base) => {
  assert.equal((await login(base, 'wrong password 1')).status, 401);
  assert.equal((await login(base, 'wrong password 2')).status, 401);
  assert.equal((await login(base, 'wrong password 3')).status, 429);
  const locked = await login(base, PASSWORD);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
}));

test('login: short password is a failure and never succeeds', () => withServer({}, async (base) => {
  assert.equal((await login(base, 'short')).status, 401);
  assert.equal((await login(base, 12345)).status, 401);
}));

test('static server does not expose server/ files, .env or package.json', () => withServer({}, async (base) => {
  for (const p of ['/server/index.js', '/server/.env', '/package.json', '/.git/config', '/js/../server/index.js']) {
    const res = await fetch(`${base}${p}`);
    assert.notEqual(res.status, 200, p);
  }
  assert.equal((await fetch(`${base}/js/config.js`)).status, 200);
  assert.equal((await fetch(`${base}/`)).status, 200);
}));

test('tariffs: 503 without ERP, data with a repository', async () => {
  await withServer({}, async (base) => assert.equal((await fetch(`${base}/api/tariffs`)).status, 503));
  const repository = { getTariffs: async () => ({ iva: 0.21 }) };
  await withServer({ repository }, async (base) => assert.equal((await (await fetch(`${base}/api/tariffs`)).json()).iva, 0.21));
});

function orderForm(fileName, content) {
  const fd = new FormData();
  fd.append('order', JSON.stringify({ billing: { email: 'buyer@example.com', fullName: 'Buyer' }, order: { id: 'ORD-1', total: 10 }, email: { text: '<b>x</b>' } }));
  fd.append('plans', new Blob([content]), fileName);
  return fd;
}

test('orders: traversal filename is sanitized and fake DXF content is rejected', () => {
  const sent = [];
  const transporter = { sendMail: async (m) => { sent.push(m); } };
  return withServer({ transporter }, async (base) => {
    const ok = await fetch(`${base}/api/orders`, { method: 'POST', body: orderForm('../../etc/evil.dxf', '0\nSECTION\n2\nENTITIES\n0\nEOF\n') });
    assert.equal(ok.status, 200);
    assert.equal(sent[0].attachments[0].filename, 'evil.dxf');
    assert.ok(!sent[0].html.includes('<b>'));                       // html del navegador escapado

    const bad = await fetch(`${base}/api/orders`, { method: 'POST', body: orderForm('plan.dxf', 'MZ not a dxf') });
    assert.equal(bad.status, 400);
    assert.equal(sent.length, 1);
  });
});
