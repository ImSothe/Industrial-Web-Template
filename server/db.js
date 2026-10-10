/* ==========================================================================
   Acceso al ERP / base de datos SQL Server (SQLpyme, Mpyme...).
   REGLA ÚNICA: ningún valor externo se concatena en una sentencia SQL.
   Todo va como parámetro con nombre y tipo (@name) mediante request.input();
   el texto SQL es una constante. Los nombres de tabla/columna no se pueden
   parametrizar, así que salen de una lista cerrada (TABLES), nunca de la entrada.
   ========================================================================== */
const TABLES = Object.freeze({
  tariffs: 'dbo.erp_tariffs',     // clave: tariff_key (varchar), valor: tariff_value (decimal)
  orders: 'dbo.web_orders',
});

/** Claves de tarifa que la web acepta del ERP (el resto se ignora). */
const TARIFF_KEYS = Object.freeze([
  'iva', 'coste_preparacion_cnc', 'coste_plegado_ud', 'recargo_pago_60_dias',
  'coste_corte_circular_ud', 'coste_corte_rectangular_ud', 'coste_corte_triangular_ud',
  ...['acero', 'inox', 'aluminio', 'prelacado', 'galvanizado'].flatMap((m) => [`precio_kg_${m}`, `coste_corte_metro_${m}`]),
]);

const SQL_GET_TARIFFS = `SELECT tariff_key, tariff_value FROM ${TABLES.tariffs} WHERE active = @active AND tariff_key IN (SELECT value FROM STRING_SPLIT(@keys, ','))`;
const SQL_INSERT_ORDER = `INSERT INTO ${TABLES.orders} (order_id, customer_email, customer_name, tax_id, total_amount, payload_json, created_at)
VALUES (@orderId, @email, @name, @taxId, @total, @payload, SYSUTCDATETIME())`;

/**
 * `pool` es un mssql.ConnectionPool (o un doble en los tests). `sql` aporta los
 * tipos (sql.Bit, sql.VarChar(n), sql.Decimal(p, s), sql.NVarChar(MAX)).
 */
function createRepository(pool, sql) {
  return {
    async getTariffs() {
      const result = await pool.request()
        .input('active', sql.Bit, 1)
        .input('keys', sql.VarChar(2000), TARIFF_KEYS.join(','))
        .query(SQL_GET_TARIFFS);
      const out = {};
      for (const row of result.recordset) {
        const value = Number(row.tariff_value);
        if (TARIFF_KEYS.includes(row.tariff_key) && Number.isFinite(value)) out[row.tariff_key] = value;
      }
      return out;
    },

    async saveOrder({ orderId, email, name, taxId, total, payload }) {
      await pool.request()
        .input('orderId', sql.VarChar(40), String(orderId).slice(0, 40))
        .input('email', sql.VarChar(254), String(email).slice(0, 254))
        .input('name', sql.NVarChar(120), String(name ?? '').slice(0, 120))
        .input('taxId', sql.VarChar(20), String(taxId ?? '').slice(0, 20))
        .input('total', sql.Decimal(12, 2), Number(total))
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload ?? {}))
        .query(SQL_INSERT_ORDER);
    },
  };
}

/** Conexión real (solo si hay variables de entorno; nunca credenciales en el código). */
async function connectFromEnv(env = process.env) {
  if (!env.DB_SERVER) return null;
  const sql = require('mssql');                              // dependencia opcional
  const pool = await new sql.ConnectionPool({
    server: env.DB_SERVER,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: env.DB_TRUST_CERT === 'true' },
    pool: { max: 5, idleTimeoutMillis: 30000 },
  }).connect();
  return { pool, sql };
}

module.exports = { TABLES, TARIFF_KEYS, SQL_GET_TARIFFS, SQL_INSERT_ORDER, createRepository, connectFromEnv };
