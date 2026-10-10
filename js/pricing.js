/* ==========================================================================
   [YOUR_COMPANY] · Motor de presupuestos + utilidades compartidas
   Depende de: js/config.js, js/sqlpyme-api.js, js/geometry-engine.js
   ========================================================================== */

const Utils = {
  money(value) {
    return new Intl.NumberFormat(PRICING.locale, {
      style: 'currency', currency: PRICING.currency,
    }).format(Number.isFinite(value) ? value : 0);
  },
  number(value, decimals = 2) {
    return new Intl.NumberFormat(PRICING.locale, {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value);
  },
  round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  },
  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  },
  toInt(value, fallback = 0) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  },
  toFloat(value, fallback = 0) {
    const n = parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  },
  /* Escapa texto para insertarlo en HTML (anti-XSS con datos de localStorage) */
  escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },
  uid(prefix = 'id') {
    const rnd = (crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2, 10));
    return `${prefix}_${Date.now().toString(36)}${rnd}`;
  },
  slug(str) {
    return String(str || 'pieza')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .toLowerCase().slice(0, 40) || 'pieza';
  },
  /**
   * Nombre de archivo seguro (anti path traversal): solo [A-Za-z0-9._-], sin
   * separadores ni "..", extensión de una lista cerrada y longitud acotada.
   * Lanza si la extensión no está permitida; nunca devuelve rutas.
   */
  safeFileName(name, allowedExt = ['dxf', 'stl', 'glb']) {
    const base = String(name ?? '').split(/[\\/]/).pop();                 // descarta cualquier ruta
    const m = /^(.*)\.([A-Za-z0-9]{2,4})$/.exec(base);
    const ext = m ? m[2].toLowerCase() : '';
    if (!allowedExt.includes(ext)) throw new Error('Extensión de archivo no permitida.');
    const stem = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 80) || 'file';
    return `${stem}.${ext}`;
  },
  downloadBlob(blob, filename) {
    const safeName = Utils.safeFileName(filename);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
  toast(message, type = 'info', ms = 3600) {
    let host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => el.remove(), 400);
    }, ms);
  },
};

/* --------------------------------------------------------------------------
   TARIFAS DINÁMICAS (SQLpyme)
   ------------------------------------------------------------------------
   initPricing() se llama UNA VEZ al cargar cada página (index/checkout/
   empleado) y espera la respuesta del ERP antes de dejar calcular ningún
   precio. calculateQuote() lanza un error si se invoca antes de tiempo,
   así el bug se detecta de inmediato en vez de mostrar un precio a 0 €.
   -------------------------------------------------------------------------- */
let tariffsReady = false;
let tariffsPromise = null;

function isPricingReady() { return tariffsReady; }

/** Vuelca el JSON del ERP sobre el catálogo estático de PRICING. */
function applyTariffs(t) {
  PRICING.vatRate = t.iva ?? PRICING.vatRate;
  PRICING.setupFee = t.coste_preparacion_cnc ?? PRICING.setupFee;

  PRICING.materials.acero.pricePerKg = t.precio_kg_acero;
  PRICING.materials.inox.pricePerKg = t.precio_kg_inox;
  PRICING.materials.aluminio.pricePerKg = t.precio_kg_aluminio;
  PRICING.materials.prelacado.pricePerKg = t.precio_kg_prelacado;
  PRICING.materials.galvanizado.pricePerKg = t.precio_kg_galvanizado;

  PRICING.materials.acero.cutPerMeter = t.coste_corte_metro_acero;
  PRICING.materials.inox.cutPerMeter = t.coste_corte_metro_inox;
  PRICING.materials.aluminio.cutPerMeter = t.coste_corte_metro_aluminio;
  PRICING.materials.prelacado.cutPerMeter = t.coste_corte_metro_prelacado;
  PRICING.materials.galvanizado.cutPerMeter = t.coste_corte_metro_galvanizado;

  PRICING.bending.pricePerBend = t.coste_plegado_ud;

  PRICING.cutouts.circular.price = t.coste_corte_circular_ud;
  PRICING.cutouts.rectangular.price = t.coste_corte_rectangular_ud;
  PRICING.cutouts.triangular.price = t.coste_corte_triangular_ud;

  // El color (Aluminio/Prelacado) no tiene coste aparte: el €/kg del
  // material YA es su precio final, igual que en el catálogo de referencia.
  PRICING.paymentMethods.net60.surchargePercent = (t.recargo_pago_60_dias ?? 0.02) * 100;
}

/**
 * Obtiene las tarifas vigentes del ERP (SQLpyme) y las aplica a PRICING.
 * Si el ERP no responde, usa FALLBACK_TARIFFS para no bloquear la web.
 * Idempotente por página: llamadas repetidas reutilizan la misma promesa.
 */
function initPricing() {
  if (tariffsPromise) return tariffsPromise;
  tariffsPromise = fetchPreciosSQLpyme()
    .then((tariffs) => { applyTariffs(tariffs); return tariffs; })
    .catch((err) => {
      console.error('[IWT] SQLpyme no disponible, se usan tarifas de emergencia.', err);
      applyTariffs(FALLBACK_TARIFFS);
      return FALLBACK_TARIFFS;
    })
    .then((tariffs) => {
      tariffsReady = true;
      window.dispatchEvent(new CustomEvent('iwt:tariffs-ready', { detail: tariffs }));
      return tariffs;
    });
  return tariffsPromise;
}

/* --------------------------------------------------------------------------
   ENRUTADO AUTOMÁTICO DE MÁQUINA (ver js/config.js -> MACHINES)
   -------------------------------------------------------------------------- */
function routeMachine(lengthMm) {
  const L = Utils.toFloat(lengthMm, 0);
  if (L > 0 && L <= MACHINES.lineA.maxLength) return MACHINES.lineA;
  if (L > MACHINES.lineA.maxLength && L <= MACHINES.lineB.maxLength) return MACHINES.lineB;
  return null;   // fuera del rango de fabricación actual
}

/* --------------------------------------------------------------------------
   Configuración por defecto, saneado y resolución de la geometría
   (chapa base + cadena de pliegues + cortes) -> ver js/geometry-engine.js
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   calculateQuote(config) -> desglose completo del precio
   ------------------------------------------------------------------------
   Precio unitario =
       material   = área total(m², base + pliegues) × espesor(m) × densidad × €/kg × merma
     + corte      = perímetro total de corte(m) × €/m material × factorEspesor
     + cortes int = Σ (nº cortes por forma × €/unidad) × factorEspesor
     + plegado    = nº pliegues × €/pliegue × factorEspesorPlegado
   (elegir un color en Aluminio/Prelacado no tiene coste aparte — igual que
   en el catálogo de referencia, el €/kg del material ya es el precio final)
   Total piezas = unitario × cantidad − descuento volumen + preparación
   -------------------------------------------------------------------------- */
function calculateQuote(rawConfig) {
  if (!tariffsReady) {
    throw new Error('Las tarifas SQLpyme aún no se han cargado. Llama a initPricing() antes de calcular precios.');
  }
  const cfg = sanitizePartConfig(rawConfig);
  const geo = resolveGeometry(cfg);
  const mat = PRICING.materials[cfg.material];
  const t = cfg.thickness;

  const areaM2 = geo.totalAreaM2;
  const weightKg = areaM2 * (t / 1000) * mat.density;
  const perimeterM = geo.totalPerimeterM;
  const cutFactor = 1 + Math.max(0, t - 1) * PRICING.thicknessCutFactor;
  const bendFactor = 1 + Math.max(0, t - 1) * PRICING.bending.thicknessFactor;

  const lines = [];
  const add = (key, label, amount, detail = '') => {
    lines.push({ key, label, detail, amount: Utils.round2(amount) });
  };

  add('material', `Material · ${mat.short}`, weightKg * mat.pricePerKg * PRICING.wasteFactor,
    `${Utils.number(weightKg, 3)} kg × ${Utils.money(mat.pricePerKg)}/kg`);
  add('cut', 'Corte de contorno', perimeterM * mat.cutPerMeter * cutFactor,
    `${Utils.number(perimeterM, 2)} m × ${Utils.money(mat.cutPerMeter * cutFactor)}/m`);

  const cutsByShape = {};
  geo.cuts.forEach((k) => { cutsByShape[k.shape] = (cutsByShape[k.shape] || 0) + 1; });
  Object.entries(PRICING.cutouts).forEach(([key, def]) => {
    const n = cutsByShape[key] || 0;
    if (n > 0) add(`cutout_${key}`, def.label, n * def.price * cutFactor,
      `${n} × ${Utils.money(def.price * cutFactor)}`);
  });

  if (geo.bendCount > 0) {
    add('bend', 'Plegado CNC', geo.bendCount * PRICING.bending.pricePerBend * bendFactor,
      `${geo.bendCount} × ${Utils.money(PRICING.bending.pricePerBend * bendFactor)}`);
  }
  const unitPrice = Utils.round2(lines.reduce((s, l) => s + l.amount, 0));
  const partsTotal = unitPrice * cfg.quantity;
  const tier = [...PRICING.quantityDiscounts]
    .sort((a, b) => b.minQty - a.minQty)
    .find((d) => cfg.quantity >= d.minQty);
  const discountPercent = tier ? tier.percent : 0;
  const discount = Utils.round2(partsTotal * (discountPercent / 100));
  const setup = PRICING.setupFee;
  const subtotal = Utils.round2(partsTotal - discount + setup);
  const machine = routeMachine(geo.machineLengthRef);

  return {
    config: cfg,
    geometry: geo,
    machine,
    lines,
    unitPrice,
    quantity: cfg.quantity,
    partsTotal: Utils.round2(partsTotal),
    discountPercent,
    discount,
    setup,
    subtotal,
    metrics: {
      areaM2: Utils.round2(areaM2 * 1000) / 1000,
      weightKg: Utils.round2(weightKg * 1000) / 1000,
      totalWeightKg: Utils.round2(weightKg * cfg.quantity),
      perimeterM: Utils.round2(perimeterM),
    },
  };
}

/* Totales del carrito (portes, recargo forma de pago, IVA) */
function calculateCartTotals(items, paymentMethod = 'card') {
  const subtotal = Utils.round2(items.reduce((s, it) => s + (it.quote ? it.quote.subtotal : 0), 0));
  const ship = PRICING.shipping;
  const shipping = items.length === 0 ? 0 : (subtotal >= ship.freeFrom ? 0 : ship.flat);
  const pm = PRICING.paymentMethods[paymentMethod] || PRICING.paymentMethods.card;
  const surcharge = Utils.round2((subtotal + shipping) * (pm.surchargePercent / 100));
  const taxBase = Utils.round2(subtotal + shipping + surcharge);
  const vat = Utils.round2(taxBase * PRICING.vatRate);
  const total = Utils.round2(taxBase + vat);
  const weightKg = Utils.round2(items.reduce((s, it) => s + (it.quote ? it.quote.metrics.totalWeightKg : 0), 0));
  return { subtotal, shipping, surcharge, surchargePercent: pm.surchargePercent, taxBase, vat, total, weightKg };
}
