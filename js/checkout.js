/* ==========================================================================
   [YOUR_COMPANY] · Checkout (checkout.html)
   Carrito + facturación B2B + pasarela simulada + ENVÍO REAL DEL PEDIDO
   Al confirmar: genera en memoria el plano (DXF) y el modelo 3D (STL) de
   cada pieza, los codifica en Base64 y hace un POST con TODO el pedido en
   JSON a WEBHOOK_URL (js/config.js) -> CRM / ERP / Zapier / Make / n8n.
   Depende de: config.js, pricing.js, sqlpyme-api.js, cart.js, plan-generator.js,
               email-service.js, checkout-export.js (módulo: STL en memoria)
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const form = $('#checkoutForm');
  let items = [];
  let submitting = false;                 // candado anti doble clic

  /* ======================================================================
     VALIDADORES
     ====================================================================== */
  const Validators = {
    /* NIF (DNI), NIE y CIF españoles con dígito de control */
    nif(value) {
      const v = String(value).toUpperCase().replace(/[\s-]/g, '');
      const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
      if (/^\d{8}[A-Z]$/.test(v)) return letters[parseInt(v.slice(0, 8), 10) % 23] === v[8];
      if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
        const n = parseInt('XYZ'.indexOf(v[0]) + v.slice(1, 8), 10);
        return letters[n % 23] === v[8];
      }
      if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
        const digits = v.slice(1, 8);
        let sum = 0;
        for (let i = 0; i < 7; i++) {
          let d = parseInt(digits[i], 10);
          if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
          sum += d;
        }
        const ctrl = (10 - (sum % 10)) % 10;
        const ctrlLetter = 'JABCDEFGHI'[ctrl];
        const last = v[8];
        if ('PQRSNW'.includes(v[0])) return last === ctrlLetter;
        if ('ABEH'.includes(v[0])) return last === String(ctrl);
        return last === String(ctrl) || last === ctrlLetter;
      }
      return false;
    },
    luhn(num) {
      const s = String(num).replace(/\D/g, '');
      if (s.length < 13 || s.length > 19) return false;
      let sum = 0; let dbl = false;
      for (let i = s.length - 1; i >= 0; i--) {
        let d = parseInt(s[i], 10);
        if (dbl) { d *= 2; if (d > 9) d -= 9; }
        sum += d; dbl = !dbl;
      }
      return sum % 10 === 0;
    },
  };

  /* ======================================================================
     1. FORMULARIO DE FACTURACIÓN (desde BILLING_FIELDS)
     ====================================================================== */
  function renderBillingFields() {
    const esc = Utils.escapeHTML;
    $('#billingFields').innerHTML = BILLING_FIELDS.map((f) => {
      const id = `bill_${f.name}`;
      const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required aria-required="true"' : ''}
        ${f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}
        ${f.inputmode ? `inputmode="${esc(f.inputmode)}"` : ''} aria-describedby="${id}_err"`;
      let control;
      if (f.type === 'textarea') control = `<textarea class="textarea" ${common}></textarea>`;
      else if (f.type === 'select') {
        control = `<select class="select" ${common}><option value="">Selecciona…</option>${(f.options || [])
          .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`;
      } else control = `<input class="input" type="${esc(f.type || 'text')}" ${common}>`;
      return `
        <div class="form-field ${f.span === 'full' ? 'span-full' : 'span-half'}" data-field="${esc(f.name)}">
          <label for="${id}">${esc(f.label)} ${f.required ? '<span class="req">*</span>' : ''}</label>
          ${control}
          <span class="error-text" id="${id}_err">${esc(f.errorMessage || 'Campo obligatorio')}</span>
        </div>`;
    }).join('');

    BILLING_FIELDS.forEach((f) => {
      const el = $(`#bill_${f.name}`);
      if (f.uppercase) el.addEventListener('input', () => { el.value = el.value.toUpperCase(); });
      el.addEventListener('blur', () => validateField(f));
      el.addEventListener('input', () => {
        if (el.closest('.form-field').classList.contains('is-invalid')) validateField(f);
      });
    });
  }

  function validateField(f) {
    const el = $(`#bill_${f.name}`);
    const wrap = el.closest('.form-field');
    const value = el.value.trim();
    let ok = true;
    if (f.required && !value) ok = false;
    else if (value && f.pattern && !new RegExp(f.pattern).test(value)) ok = false;
    else if (value && f.validate && Validators[f.validate] && !Validators[f.validate](value)) ok = false;
    wrap.classList.toggle('is-invalid', !ok);
    el.setAttribute('aria-invalid', String(!ok));
    return ok;
  }

  function collectBilling() {
    const data = {};
    BILLING_FIELDS.forEach((f) => {
      let v = $(`#bill_${f.name}`).value.trim();
      if (f.uppercase) v = v.toUpperCase();
      data[f.name] = v;
    });
    return data;
  }

  /* ======================================================================
     2. PAGO (tarjeta estilo Stripe / 60 días)
     ====================================================================== */
  const paymentMethod = () => (form.paymentMethod.value || 'card');

  function detectBrand(num) {
    if (/^4/.test(num)) return 'VISA';
    if (/^(5[1-5]|2[2-7])/.test(num)) return 'MASTERCARD';
    if (/^3[47]/.test(num)) return 'AMEX';
    return '';
  }

  function setupCard() {
    const num = $('#cardNumber'); const exp = $('#cardExp'); const cvc = $('#cardCvc'); const name = $('#cardName');
    const visual = $('#cardVisual');

    num.addEventListener('input', () => {
      const digits = num.value.replace(/\D/g, '').slice(0, 19);
      const brand = detectBrand(digits);
      num.value = brand === 'AMEX'
        ? digits.replace(/^(\d{0,4})(\d{0,6})(\d{0,5}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '))
        : digits.replace(/(\d{4})(?=\d)/g, '$1 ');
      $('#brandTag').textContent = brand;
      $('#cvBrand').textContent = brand || 'CARD';
      const masked = (digits + '•'.repeat(Math.max(0, 16 - digits.length))).replace(/(.{4})(?=.)/g, '$1 ');
      $('#cvNumber').textContent = masked;
      clearCardError();
    });
    exp.addEventListener('input', (e) => {
      let d = exp.value.replace(/\D/g, '').slice(0, 4);
      if (d.length === 1 && Number(d) > 1) d = `0${d}`;
      exp.value = d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : (d.length === 2 && e.inputType !== 'deleteContentBackward' ? `${d} / ` : d);
      $('#cvExp').textContent = exp.value.replace(/\s/g, '') || 'MM/AA';
      clearCardError();
    });
    cvc.addEventListener('input', () => {
      cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4);
      $('#cvCvc').textContent = cvc.value || '•••';
      clearCardError();
    });
    cvc.addEventListener('focus', () => visual.classList.add('is-flipped'));
    cvc.addEventListener('blur', () => visual.classList.remove('is-flipped'));
    name.addEventListener('input', () => {
      $('#cvHolder').textContent = name.value.toUpperCase() || 'NOMBRE APELLIDO';
      clearCardError();
    });
  }

  function clearCardError() {
    $('#cardError').textContent = '';
    $('#cardFields').classList.remove('is-invalid');
  }

  function validateCard() {
    const digits = $('#cardNumber').value.replace(/\D/g, '');
    const brand = detectBrand(digits);
    const [mm, yy] = $('#cardExp').value.replace(/\s/g, '').split('/');
    const cvc = $('#cardCvc').value;
    const errors = [];
    if ($('#cardName').value.trim().length < 3) errors.push('titular');
    if (!Validators.luhn(digits)) errors.push('número de tarjeta');
    const month = Number(mm); const year = 2000 + Number(yy);
    const now = new Date();
    const expValid = month >= 1 && month <= 12 && yy && yy.length === 2
      && (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1));
    if (!expValid) errors.push('fecha de caducidad');
    if (!(brand === 'AMEX' ? /^\d{4}$/ : /^\d{3}$/).test(cvc)) errors.push('CVC');
    if (errors.length) {
      $('#cardError').textContent = `Revisa: ${errors.join(', ')}.`;
      $('#cardFields').classList.add('is-invalid');
      return null;
    }
    return { brand: brand || 'CARD', last4: digits.slice(-4), digits };
  }

  function setupPaymentTabs() {
    $('#net60Pct').textContent = `${PRICING.paymentMethods.net60.surchargePercent}%`;
    if (PRICING.paymentMethods.net60.surchargePercent) {
      $('#net60Label').textContent = `Transferencia · +${PRICING.paymentMethods.net60.surchargePercent}% recargo`;
    }
    $$('input[name="paymentMethod"]').forEach((r) => r.addEventListener('change', () => {
      const isCard = paymentMethod() === 'card';
      $('#cardPanel').hidden = !isCard;
      $('#net60Panel').hidden = isCard;
      renderTotals();
    }));
  }

  /* ======================================================================
     3. RESUMEN DEL CARRITO
     ====================================================================== */
  function partIcon(cfg) {
    const flangeL = cfg.bends.length >= 1; const flangeR = cfg.bends.length >= 2;
    const hasCircular = cfg.cuts.some((k) => k.shape === 'circular');
    return `<svg viewBox="0 0 40 40" fill="none" stroke="#c9ced4" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
      <path d="${flangeL ? 'M8 12 L8 28' : 'M4 28 L8 28'} L32 28 ${flangeR ? 'L32 12' : 'L36 28'}"/>
      ${hasCircular ? '<circle cx="20" cy="22" r="2.5" stroke="#6eacdf"/>' : ''}</svg>`;
  }

  function renderCart() {
    const list = $('#cartList');
    const esc = Utils.escapeHTML;
    $('#emptyState').hidden = items.length > 0;
    $('#totals').hidden = items.length === 0;

    list.innerHTML = items.map((it) => {
      const c = it.config;
      const m = PRICING.materials[c.material];
      const cutSummary = Object.entries(
        c.cuts.reduce((acc, k) => { acc[k.shape] = (acc[k.shape] || 0) + 1; return acc; }, {}),
      ).map(([shape, n]) => `${n}× ${PRICING.cutouts[shape].icon}`).join(' ');
      const machine = it.machine;
      return `
        <li class="cart-item" data-id="${esc(it.id)}">
          <div class="cart-thumb">${partIcon(c)}</div>
          <div>
            <h3>${esc(c.reference)}</h3>
            <div class="specs">
              ${esc(m.short)} · ${Number(c.thickness)} mm · ${Number(c.width)}×${Number(c.length)} mm<br>
              ${c.bends.length} pliegue(s) ${cutSummary ? `· ${cutSummary}` : ''}<br>
              ${esc(materialFinishLabel(c))} · ${Utils.money(it.quote.unitPrice)}/ud${it.quote.discountPercent ? ` · −${it.quote.discountPercent}%` : ''}<br>
              <span class="${machine ? '' : 'accent'}">${machine ? `→ ${esc(machine.label)}` : '⚠ Fuera de rango de fabricación'}</span>
            </div>
          </div>
          <div class="price">${Utils.money(it.quote.subtotal)}</div>
          <div class="item-actions">
            <span class="qty-mini">
              <button type="button" data-qty="-1" aria-label="Menos unidades">−</button>
              <input type="number" min="1" max="${PRICING.limits.maxQuantity}" value="${Number(c.quantity)}" aria-label="Cantidad" data-qty-input>
              <button type="button" data-qty="1" aria-label="Más unidades">+</button>
            </span>
            <button type="button" class="icon-btn danger" data-action="remove">Eliminar</button>
          </div>
        </li>`;
    }).join('');
    renderTotals();
  }

  function renderTotals() {
    const t = calculateCartTotals(items, paymentMethod());
    $('#tSubtotal').textContent = Utils.money(t.subtotal);
    const ship = $('#tShipping');
    ship.textContent = t.shipping === 0 && items.length ? 'Gratis' : Utils.money(t.shipping);
    ship.classList.toggle('free', t.shipping === 0 && items.length > 0);
    $('#tSurchargeRow').hidden = !t.surcharge;
    $('#tSurcharge').textContent = Utils.money(t.surcharge);
    $('#tBase').textContent = Utils.money(t.taxBase);
    $('#tVatLabel').textContent = `IVA (${Math.round(PRICING.vatRate * 100)}%)`;
    $('#tVat').textContent = Utils.money(t.vat);
    $('#tTotal').textContent = Utils.money(t.total);
    $('#tWeight').textContent = `${Utils.number(t.weightKg, 1)} kg`;
    $('#payLabel').textContent = paymentMethod() === 'card'
      ? `Pagar ${Utils.money(t.total)}`
      : `Confirmar pedido · ${Utils.money(t.total)}`;
    const anyOutOfRange = items.some((it) => !it.machine);
    $('#payBtn').disabled = items.length === 0 || anyOutOfRange;
    return t;
  }

  function setupCartActions() {
    const list = $('#cartList');
    const changeQty = (li, qty) => {
      const updated = CartStore.update(li.dataset.id, { quantity: qty });
      if (updated) { items = CartStore.read(); renderCart(); }
    };
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.cart-item');
      if (!li) return;
      const item = items.find((it) => it.id === li.dataset.id);
      const qtyBtn = e.target.closest('[data-qty]');
      if (qtyBtn) {
        changeQty(li, Math.max(1, item.config.quantity + Number(qtyBtn.dataset.qty)));
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'remove') {
        CartStore.remove(item.id);
        items = CartStore.read();
        renderCart();
        Utils.toast('Pieza eliminada del carrito');
      }
    });
    list.addEventListener('change', (e) => {
      if (!e.target.matches('[data-qty-input]')) return;
      changeQty(e.target.closest('.cart-item'), Utils.clamp(Utils.toInt(e.target.value, 1), 1, PRICING.limits.maxQuantity));
    });
  }

  /* ======================================================================
     4. ENVÍO DEL PEDIDO
     ====================================================================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function newOrderId() {
    const d = new Date();
    const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `CPL-${ymd}-${rnd}`;
  }

  function setStep(name, state) {
    const li = $(`#processSteps [data-step="${name}"]`);
    li.classList.remove('is-active', 'is-done');
    if (state) li.classList.add(state);
    if (state === 'is-done') li.querySelector('.st').textContent = '✓';
  }

  /* Simulación de pasarela (sustituir por Stripe en producción) */
  async function authorizePayment(method, card, total) {
    await sleep(900);
    if (method === 'card') {
      if (card.digits.endsWith('0002')) throw new Error('Tarjeta rechazada por el banco emisor.');
      return { status: 'authorized', method, brand: card.brand, last4: card.last4, amount: total, ref: `pi_sim_${Date.now().toString(36)}` };
    }
    return { status: 'pending_invoice', method, amount: total, dueDays: 60 };
  }

  /* ======================================================================
     5. ARCHIVOS EN MEMORIA + BASE64 + WEBHOOK (CRM / ERP)
     ====================================================================== */
  /** Blob -> Base64 puro (sin el prefijo "data:...;base64,"). */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        resolve(url.slice(url.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(blob);
    });
  }

  /** Espera al módulo de exportación 3D (checkout-export.js); null si no carga. */
  function whenPartExportReady(timeoutMs = 15000) {
    if (window.IwtPartExport) return Promise.resolve(window.IwtPartExport);
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(window.IwtPartExport || null); };
      const timer = setTimeout(done, timeoutMs);
      window.addEventListener('iwt:part-export-ready', done, { once: true });
    });
  }

  async function fileEntry(blob, filename) {
    return {
      filename,
      mimeType: blob.type || 'application/octet-stream',
      encoding: 'base64',
      sizeBytes: blob.size,
      data: await blobToBase64(blob),
    };
  }

  /**
   * Genera, EN MEMORIA, los archivos de fabricación de cada pieza:
   *   plan  -> plano DXF (patrón plano con cortes y líneas de plegado)
   *   model -> modelo 3D STL binario en milímetros
   * Devuelve [{ planBlob, planFile, modelFile, modelError }] en el orden de items.
   */
  async function buildItemFiles(orderId) {
    const exporter = await whenPartExportReady();
    return Promise.all(items.map(async (it, i) => {
      const base = `${orderId}_${String(i + 1).padStart(2, '0')}_${Utils.slug(it.config.reference)}`;
      const planBlob = generatePlanFile(it.config);
      const planFile = await fileEntry(planBlob, `${base}.dxf`);
      let modelFile = null;
      let modelError = null;
      try {
        if (!exporter) throw new Error('módulo 3D no disponible');
        modelFile = await fileEntry(exporter.stl(it.config), `${base}.stl`);
      } catch (err) {
        // El pedido no se bloquea: el plano 2D es el documento de fabricación;
        // el STL se puede regenerar en el Panel de Taller con la misma config.
        modelError = err.message || String(err);
        console.warn(`[IWT] STL no generado para la pieza ${i + 1}:`, err);
      }
      return { planBlob, planFile, modelFile, modelError };
    }));
  }

  /** JSON del pedido para el CRM / ERP. Nunca incluye datos de tarjeta completos. */
  function buildOrderPayload({ orderId, createdAt, billing, totals, method, payment, files }) {
    return {
      event: 'order.created',
      schemaVersion: 1,
      source: { site: COMPANY.website, page: window.location.href, userAgent: navigator.userAgent },
      order: {
        id: orderId,
        createdAt,
        currency: PRICING.currency || 'EUR',
        itemCount: items.length,
      },
      customer: billing,
      payment: {
        method,
        label: PRICING.paymentMethods[method].label,
        status: payment.status,
        cardBrand: payment.brand || null,
        cardLast4: payment.last4 || null,
        reference: payment.ref || null,
        dueDays: payment.dueDays || null,
      },
      totals,
      items: items.map((it, i) => {
        const c = it.config;
        const f = files[i];
        return {
          line: i + 1,
          reference: c.reference,
          quantity: c.quantity,
          material: { key: c.material, label: PRICING.materials[c.material].label, finish: materialFinishLabel(c), finishKey: c.finish || null },
          thicknessMm: c.thickness,
          blank: { widthMm: c.width, lengthMm: c.length },
          bends: c.bends.map((b, j) => ({
            id: `bend${j + 1}`, on: b.parent, edge: b.edge, direction: b.direction,
            angleDeg: b.angle, flangeLengthMm: b.flangeLength,
          })),
          cuts: c.cuts.map((k, j) => ({
            id: `cut${j + 1}`, panel: k.segment, shape: k.shape,
            xMm: k.x, yMm: k.y, rotationDeg: k.rotation,
            ...(k.shape === 'rectangular' ? { widthMm: k.w, heightMm: k.h } : k.shape === 'circular' ? { diameterMm: k.w } : { sideMm: k.w }),
          })),
          notes: c.notes || '',
          machine: it.machine ? { id: it.machine.id, label: it.machine.label } : null,
          price: {
            unit: it.quote.unitPrice,
            subtotal: it.quote.subtotal,
            discountPercent: it.quote.discountPercent || 0,
          },
          config: c,                                   // configuración completa (reconstruible 1:1)
          files: { plan: f.planFile, model: f.modelFile, modelError: f.modelError },
        };
      }),
    };
  }

  /** POST real al webhook. Lanza error si la red falla o el receptor no responde 2xx. */
  async function postOrderToWebhook(payload) {
    const opts = typeof WEBHOOK_OPTIONS !== 'undefined' ? WEBHOOK_OPTIONS : {};
    const body = JSON.stringify(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 45000);
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': opts.sendAsTextPlain ? 'text/plain;charset=UTF-8' : 'application/json',
          ...(opts.headers || {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(`[IWT] Webhook ${res.status}:`, detail.slice(0, 500));
        throw new Error(`No se ha podido registrar el pedido (código ${res.status}). Inténtalo de nuevo o contacta con ${COMPANY.email}.`);
      }
      const text = await res.text().catch(() => '');
      let response = text;
      try { response = JSON.parse(text); } catch (_) { /* respuesta no JSON (Zapier: texto) */ }
      return { status: res.status, bytes: body.length, response };
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('El envío del pedido ha tardado demasiado. Inténtalo de nuevo.');
      if (err instanceof TypeError) throw new Error('No se pudo contactar con el sistema de pedidos. Revisa tu conexión e inténtalo de nuevo.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Estado visual del botón: "Enviando pedido…" y bloqueado mientras dura. */
  function setSubmitting(on) {
    submitting = on;
    const btn = $('#payBtn');
    btn.classList.toggle('is-loading', on);
    btn.setAttribute('aria-busy', String(on));
    btn.disabled = on;
    if (on) $('#payLabel').textContent = 'Enviando pedido…';
    else renderTotals();                                  // restaura etiqueta y disabled reales
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting || !items.length) return;               // anti doble clic / doble Enter

    // Validación facturación
    const invalid = BILLING_FIELDS.filter((f) => !validateField(f));
    let card = null;
    const method = paymentMethod();
    if (method === 'card') card = validateCard();
    const net60ok = method !== 'net60' || $('#net60Accept').checked;
    const termsOk = $('#acceptTerms').checked;
    $('#termsError').textContent = termsOk ? '' : 'Debes aceptar las condiciones de venta.';
    if (!net60ok) Utils.toast('Acepta las condiciones del pago a 60 días', 'error');

    if (invalid.length || (method === 'card' && !card) || !net60ok || !termsOk) {
      const firstInvalid = invalid.length ? $(`#bill_${invalid[0].name}`) : (!card && method === 'card' ? $('#cardNumber') : null);
      firstInvalid?.focus();
      if (invalid.length) Utils.toast('Revisa los datos de facturación', 'error');
      return;
    }

    setSubmitting(true);
    const overlay = $('#processOverlay');
    $$('#processSteps li').forEach((li) => { li.className = ''; li.querySelector('.st').textContent = ''; });
    overlay.classList.add('is-open');

    try {
      // 1. Validación
      setStep('validate', 'is-active');
      const billing = collectBilling();
      items = CartStore.read();                         // precios re-calculados, nunca los guardados
      if (items.some((it) => !it.machine)) throw new Error('Alguna pieza queda fuera del rango de fabricación actual.');
      const totals = calculateCartTotals(items, method);
      await sleep(500);
      setStep('validate', 'is-done');

      // 2. Pago
      setStep('payment', 'is-active');
      const payment = await authorizePayment(method, card, totals.total);
      setStep('payment', 'is-done');

      // 3. Documentación técnica EN MEMORIA: plano DXF + modelo STL -> Base64
      setStep('package', 'is-active');
      const orderId = newOrderId();
      const createdAt = new Date().toISOString();
      const files = await buildItemFiles(orderId);
      const planBlobs = files.map((f) => ({ blob: f.planBlob, filename: f.planFile.filename }));
      setStep('package', 'is-done');

      // 4. Envío REAL del pedido (JSON + archivos Base64) al CRM / ERP
      setStep('send', 'is-active');
      const payload = buildOrderPayload({ orderId, createdAt, billing, totals, method, payment, files });
      let webhook = null;
      if (WEBHOOK_URL) {
        webhook = await postOrderToWebhook(payload);
      } else {
        /* eslint-disable no-console */
        console.groupCollapsed('%c[IWT] WEBHOOK_URL vacío: modo demo, el pedido NO se ha enviado', 'color:#6eacdf;font-weight:bold');
        console.log('JSON que se enviaría por POST (%s KB):', Utils.number(JSON.stringify(payload).length / 1024, 1));
        console.log(payload);
        console.groupEnd();
      }
      const formData = {
        ...billing,
        order: {
          id: orderId,
          createdAt,
          items: items.map((it) => ({
            id: it.id, config: it.config, quote: it.quote, machine: it.machine,
            planFilename: it.plan.filename, planSource: it.plan.source,
          })),
          totals,
          payment: {
            method, label: PRICING.paymentMethods[method].label, status: payment.status,
            cardBrand: payment.brand || null, cardLast4: payment.last4 || null, ref: payment.ref || null,
          },
        },
      };
      // Email opcional (EMAIL_CONFIG): con webhook activo solo si se configuró
      // un proveedor real; sin webhook, se mantiene el flujo de demo.
      let result;
      if (!webhook || EMAIL_CONFIG.provider !== 'simulate') {
        result = await processOrderAndSendEmail(formData, planBlobs);
      }
      const attachments = files.flatMap((f) => [f.planFile, f.modelFile].filter(Boolean))
        .map((f) => ({ filename: f.filename, size: f.sizeBytes }));
      result = {
        ...(result || {}),
        message: 'Pedido procesado. Tu fabricación ya está en marcha.',
        sentTo: webhook ? 'Sistema de pedidos (CRM / ERP)' : (result?.sentTo || EMAIL_CONFIG.officeEmail),
        attachments,
        pieces: items.length,
        simulated: !webhook && (result?.simulated ?? true),
        webhook,
      };
      setStep('send', 'is-done');
      await sleep(350);

      // Guardar resumen (sin documentación técnica ni datos de tarjeta) y vaciar carrito
      try {
        localStorage.setItem(STORAGE_KEYS.lastOrder, JSON.stringify({
          id: orderId, createdAt: formData.order.createdAt, total: totals.total, company: billing.company, email: billing.email,
        }));
      } catch (_) { /* no crítico */ }
      CartStore.clear();

      overlay.classList.remove('is-open');
      showSuccess(orderId, billing, result, totals);
    } catch (err) {
      console.error('[IWT] Error en el pedido', err);
      overlay.classList.remove('is-open');
      Utils.toast(err.message || 'No se pudo procesar el pedido', 'error', 6000);
      setSubmitting(false);                                // el carrito se conserva: se puede reintentar
    }
  }

  function showSuccess(orderId, billing, result, totals) {
    const esc = Utils.escapeHTML;
    $('#successTitle').textContent = result.message;
    $('#successOrderId').textContent = `Nº de pedido ${orderId} · ${Utils.money(totals.total)}`;
    $('#successText').textContent = EMAIL_CONFIG.sendCustomerConfirmation
      ? `Hemos enviado la confirmación a ${billing.email}.`
      : 'Oficina Técnica revisará tu pedido en breve.';
    $('#sentList').innerHTML = `<div><span>Destino</span><span>${esc(result.sentTo)}</span></div>`
      + `<div><span>Piezas enviadas a fábrica</span><span>${result.pieces}</span></div>`
      + `<div><span>Archivos de fabricación</span><span>${result.attachments.length}</span></div>`
      + (result.simulated ? '<div><span class="accent">Modo simulación</span><span>ver consola</span></div>' : '');

    items = [];
    submitting = false;
    renderCart();
    $('#successOverlay').classList.add('is-open');
    $('#successOverlay a').focus();
  }

  /* ======================================================================
     INIT — espera las tarifas SQLpyme antes de calcular ningún total
     ====================================================================== */
  async function init() {
    $('#year').textContent = new Date().getFullYear();
    $('#companyLegal').textContent = `${COMPANY.legalName} · CIF ${COMPANY.taxId}`;
    $('#companyContact').textContent = `${COMPANY.email} · ${COMPANY.phone}`;

    renderBillingFields();
    setupCard();

    const summary = $('#summaryTitle').closest('.summary');
    summary.classList.add('is-loading');
    $('#payBtn').disabled = true;

    await initPricing();     // <- espera al ERP (o aplica tarifas de emergencia)

    summary.classList.remove('is-loading');
    items = CartStore.read();
    setupPaymentTabs();
    setupCartActions();
    renderCart();

    form.addEventListener('submit', onSubmit);
    $('#acceptTerms').addEventListener('change', () => { $('#termsError').textContent = ''; });
    window.addEventListener('storage', () => { items = CartStore.read(); renderCart(); });
  }

  init();

  // Exponer para depuración / integración externa
  window.IwtCheckout = { processOrderAndSendEmail, Validators, buildOrderPayload, postOrderToWebhook };
}());
