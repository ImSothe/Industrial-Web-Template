const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository, SQL_GET_TARIFFS, SQL_INSERT_ORDER, TARIFF_KEYS } = require('../db');

/** Doble de mssql que registra cada consulta y sus parámetros. */
function fakePool(recordset = []) {
  const calls = [];
  return {
    calls,
    request() {
      const params = {};
      const req = {
        input(name, type, value) { params[name] = { type, value }; return req; },
        async query(text) { calls.push({ text, params }); return { recordset }; },
      };
      return req;
    },
  };
}
const sql = { Bit: 'Bit', MAX: 'MAX', VarChar: (n) => `VarChar(${n})`, NVarChar: (n) => `NVarChar(${n})`, Decimal: (p, s) => `Decimal(${p},${s})` };

test('SQL text is constant and has no interpolated values', () => {
  for (const text of [SQL_GET_TARIFFS, SQL_INSERT_ORDER]) {
    assert.ok(!/\$\{|' *\+|" *\+/.test(text));
    assert.ok(/@\w+/.test(text));
  }
});

test('hostile input goes into parameters, never into the SQL string', async () => {
  const pool = fakePool();
  const repo = createRepository(pool, sql);
  const evil = "x'); DROP TABLE dbo.web_orders;--";
  await repo.saveOrder({ orderId: evil, email: `${evil}@a.com`, name: evil, taxId: evil, total: '12.5', payload: { n: evil } });
  const { text, params } = pool.calls[0];
  assert.equal(text, SQL_INSERT_ORDER);
  assert.ok(!text.includes('DROP'));
  assert.equal(params.orderId.value, evil.slice(0, 40));
  assert.equal(params.total.value, 12.5);
  assert.equal(params.total.type, 'Decimal(12,2)');
});

test('getTariffs only returns whitelisted numeric keys', async () => {
  const pool = fakePool([
    { tariff_key: 'iva', tariff_value: '0.21' },
    { tariff_key: 'precio_kg_acero', tariff_value: 1.35 },
    { tariff_key: 'evil_key', tariff_value: 1 },
    { tariff_key: 'coste_plegado_ud', tariff_value: 'NaN' },
  ]);
  const out = await createRepository(pool, sql).getTariffs();
  assert.deepEqual(out, { iva: 0.21, precio_kg_acero: 1.35 });
  assert.equal(pool.calls[0].params.keys.value, TARIFF_KEYS.join(','));
});
