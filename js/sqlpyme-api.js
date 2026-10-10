/* ==========================================================================
   [YOUR_COMPANY] · Cliente de tarifas SQLpyme (ERP)
   --------------------------------------------------------------------------
   fetchPreciosSQLpyme() simula la llamada al ERP y devuelve las tarifas
   actuales en un JSON plano. El configurador NUNCA calcula un precio antes
   de recibir esta respuesta (ver js/pricing.js -> initPricing()).

   >>> PASO A PRODUCCIÓN <<<
   Sustituye el cuerpo de la función por una llamada fetch() real al ERP:
   descomenta el bloque "PRODUCCIÓN" y borra el bloque "SIMULACIÓN". La forma
   del JSON de respuesta debe mantenerse (o ajusta applyTariffs() en pricing.js).
   Depende de: js/config.js (SQLPYME_CONFIG, FALLBACK_TARIFFS)
   ========================================================================== */

async function fetchPreciosSQLpyme() {
  /* ---------------- PRODUCCIÓN: SQLPYME_CONFIG.mode === 'api' ------------
     El navegador NUNCA habla con la base de datos: llama a GET /api/tariffs de
     TU servidor (server/index.js), que consulta el ERP con sentencias
     parametrizadas (server/db.js). */
  if (SQLPYME_CONFIG.mode === 'api') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SQLPYME_CONFIG.timeoutMs);
    try {
      const res = await fetch(SQLPYME_CONFIG.endpoint, {
        method: 'GET',
        headers: SQLPYME_CONFIG.apiKey ? { [SQLPYME_CONFIG.apiKeyHeader]: SQLPYME_CONFIG.apiKey } : {},
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`ERP respondió ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- SIMULACIÓN (modo 'simulate', por defecto) ------------- */
  await new Promise((resolve) => setTimeout(resolve, SQLPYME_CONFIG.simulateLatencyMs));

  // Pequeña variación aleatoria (±1,5 %) para simular un ERP vivo, no un mock estático.
  const jitter = (base) => Utils.round2(base * (1 + (Math.random() * 0.03 - 0.015)));

  return {
    fuente: 'ERP (simulado, valores ficticios)',
    actualizado: new Date().toISOString(),
    moneda: 'EUR',
    iva: 0.21,
    coste_preparacion_cnc: 20,

    precio_kg_acero: jitter(1.00),
    precio_kg_inox: jitter(3.00),
    precio_kg_aluminio: jitter(4.00),
    precio_kg_prelacado: jitter(2.00),
    precio_kg_galvanizado: jitter(1.50),

    coste_corte_metro_acero: jitter(1.00),
    coste_corte_metro_inox: jitter(1.50),
    coste_corte_metro_aluminio: jitter(1.25),
    coste_corte_metro_prelacado: jitter(1.00),
    coste_corte_metro_galvanizado: jitter(1.00),

    coste_plegado_ud: jitter(1.00),

    coste_corte_circular_ud: jitter(0.50),
    coste_corte_rectangular_ud: jitter(0.50),
    coste_corte_triangular_ud: jitter(0.75),

    recargo_pago_60_dias: 0.02,
  };
  /* ------------------------------------------------------------------------ */
}
