/* ==========================================================================
   [YOUR_COMPANY] · Configurador público (index.html)
   Depende de: config.js, geometry-engine.js, pricing.js, sqlpyme-api.js,
               cart.js, plan-generator.js, GSAP
   Comunica con la escena 3D mediante el evento 'iwt:config-change',
   que lleva la configuración COMPLETA (chapa base + cadena de pliegues +
   cortes) para que el visor construya la malla EXACTA (js/part-mesh-builder.js).
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const form = $('#configForm');
  if (!form) return;


  /* Estado vivo: la configuración completa se mantiene aquí (no en el DOM). */
  let cfg = defaultPartConfig();

  /* ------------------------------------------------------------------
     1. Render de opciones estáticas (materiales, espesores, acabados)
     ------------------------------------------------------------------ */
  function renderOptions() {
    $('#materialOptions').innerHTML = Object.entries(PRICING.materials).map(([key, m]) => {
      const chip = m.color || (m.colors && m.colors[0].hex) || '#9aa1a9';
      return `
      <input type="radio" name="material" id="mat_${key}" value="${key}">
      <label for="mat_${key}">
        <span class="swatch-metal" style="background:linear-gradient(135deg, ${chip}, #3a3f46)"></span>
        <span>${Utils.escapeHTML(m.short)}<small data-price-for="material:${key}">…</small></span>
      </label>`;
    }).join('');

    $('#thickness').innerHTML = PRICING.thicknesses
      .map((t) => `<option value="${t}">${Utils.number(t, t % 1 ? 1 : 0)} mm</option>`).join('');

    const L = PRICING.limits;
    Object.assign($('#width'), { min: L.minWidth, max: L.maxWidth });
    Object.assign($('#length'), { min: L.minLength, max: L.maxLength });
    Object.assign($('#quantity'), { max: L.maxQuantity });
  }

  /** El selector de color depende del material: Acero/Inox/Galvanizado no
   * se pintan (se ocultan los swatches); Aluminio/Prelacado muestran SU
   * propia carta de colores. Hay que re-renderizarlo cada vez que cambia
   * el material. */
  function renderFinishOptions(materialKey) {
    const mat = PRICING.materials[materialKey];
    const wrap = $('#finishOptions').closest('.field-group');
    if (!mat.colors) {
      wrap.classList.add('is-disabled');
      $('#finishOptions').innerHTML = '';
      $('#finishName').textContent = 'Este material no se pinta: se sirve en su acabado metálico natural.';
      return;
    }
    wrap.classList.remove('is-disabled');
    $('#finishOptions').innerHTML = mat.colors.map((f) => `
      <input type="radio" name="finish" id="fin_${f.key}" value="${f.key}">
      <label for="fin_${f.key}" title="${Utils.escapeHTML(f.label)}" style="background:${f.hex}">
        <span class="sr-only">${Utils.escapeHTML(f.label)}</span></label>`).join('');
    const current = cfg.finish;
    const valid = mat.colors.some((f) => f.key === current) ? current : mat.colors[0].key;
    const input = $(`#fin_${valid}`); if (input) input.checked = true;
  }

  function paintTariffHints() {
    Object.entries(PRICING.materials).forEach(([key, m]) => {
      const el = document.querySelector(`[data-price-for="material:${key}"]`);
      if (el) el.textContent = `${Utils.money(m.pricePerKg)}/kg`;
    });
  }

  /* ------------------------------------------------------------------
     2. Listas dinámicas: PLIEGUES (encadenados) y CORTES (posición libre)
     ------------------------------------------------------------------ */
  function segmentOptions(uptoIndex) {
    const opts = [{ id: 'base', label: 'Chapa base' }];
    for (let i = 0; i < uptoIndex; i++) opts.push({ id: `bend${i + 1}`, label: `Pliegue ${i + 1}` });
    return opts;
  }
  function allSegmentOptions() { return segmentOptions(cfg.bends.length); }

  function renderBends() {
    const list = $('#bendsList');
    if (!cfg.bends.length) {
      list.innerHTML = '<p class="help-text">Sin pliegues: la pieza sale plana.</p>';
      return;
    }
    list.innerHTML = cfg.bends.map((b, i) => {
      const opts = segmentOptions(i);
      return `
      <div class="repeater-row" data-index="${i}">
        <div class="repeater-row-head"><b>Pliegue ${i + 1}</b><button type="button" class="icon-btn danger" data-remove-bend="${i}">Eliminar</button></div>
        <div class="field-row-3">
          <div><label class="field-label">Sobre</label>
            <select class="select" data-bend-field="parent">${opts.map((o) => { const full = o.id !== b.parent && !firstFreeEdge(cfg.bends, o.id, i); return `<option value="${o.id}" ${o.id === b.parent ? 'selected' : ''} ${full ? 'disabled' : ''}>${Utils.escapeHTML(o.label)}${full ? ' · sin bordes libres' : ''}</option>`; }).join('')}</select></div>
          <div><label class="field-label">Borde</label>
            <select class="select" data-bend-field="edge">${(() => { const used = occupiedEdges(cfg.bends, b.parent, i); return edgeOptionsFor(b.parent).map(([v, l]) => { const busy = used.has(v); return `<option value="${v}" ${v === b.edge ? 'selected' : ''} ${busy ? 'disabled' : ''}>${l}${busy ? ' · ocupado' : ''}</option>`; }).join(''); })()}</select></div>
          <div><label class="field-label">Dirección</label>
            <select class="select" data-bend-field="direction">
              <option value="up" ${b.direction === 'up' ? 'selected' : ''}>Hacia arriba</option>
              <option value="down" ${b.direction === 'down' ? 'selected' : ''}>Hacia abajo</option>
            </select></div>
        </div>
        <div class="field-row">
          <div><label class="field-label">Ángulo</label>
            <div class="input-suffix"><input class="input" type="number" min="0" max="180" step="1" data-bend-field="angle" value="${b.angle}"><span>°</span></div></div>
          <div><label class="field-label">Largo del ala</label>
            <div class="input-suffix"><input class="input" type="number" min="5" max="500" step="1" data-bend-field="flangeLength" value="${b.flangeLength}"><span>mm</span></div></div>
        </div>
      </div>`;
    }).join('');
  }

  function shapeSizeFields(k) {
    if (k.shape === 'rectangular') {
      return `
        <div><label class="field-label">Ancho</label><div class="input-suffix"><input class="input" type="number" min="1" step="1" data-cut-field="w" value="${k.w}"><span>mm</span></div></div>
        <div><label class="field-label">Alto</label><div class="input-suffix"><input class="input" type="number" min="1" step="1" data-cut-field="h" value="${k.h}"><span>mm</span></div></div>`;
    }
    const label = k.shape === 'triangular' ? 'Lado' : 'Diámetro';
    return `<div><label class="field-label">${label}</label><div class="input-suffix"><input class="input" type="number" min="1" step="1" data-cut-field="w" value="${k.w}"><span>mm</span></div></div>`;
  }

  function renderCuts() {
    const list = $('#cutsList');
    const opts = allSegmentOptions();
    if (!cfg.cuts.length) {
      list.innerHTML = '<p class="help-text">Sin cortes internos.</p>';
      return;
    }
    list.innerHTML = cfg.cuts.map((k, i) => `
      <div class="repeater-row" data-index="${i}">
        <div class="repeater-row-head"><b>${PRICING.cutouts[k.shape].icon} Corte ${i + 1}</b><button type="button" class="icon-btn danger" data-remove-cut="${i}">Eliminar</button></div>
        <div class="field-row-3">
          <div><label class="field-label">Panel</label>
            <select class="select" data-cut-field="segment">${opts.map((o) => `<option value="${o.id}" ${o.id === k.segment ? 'selected' : ''}>${Utils.escapeHTML(o.label)}</option>`).join('')}</select></div>
          <div><label class="field-label">Forma</label>
            <select class="select" data-cut-field="shape">${Object.entries(PRICING.cutouts).map(([key, d]) => `<option value="${key}" ${key === k.shape ? 'selected' : ''}>${d.icon} ${Utils.escapeHTML(d.label)}</option>`).join('')}</select></div>
          <div><label class="field-label">Rotación</label>
            <div class="input-suffix"><input class="input" type="number" step="1" data-cut-field="rotation" value="${k.rotation}"><span>°</span></div></div>
        </div>
        <div class="field-row-3">
          <div><label class="field-label">X</label><div class="input-suffix"><input class="input" type="number" step="1" data-cut-field="x" value="${k.x}"><span>mm</span></div></div>
          <div><label class="field-label">Y</label><div class="input-suffix"><input class="input" type="number" step="1" data-cut-field="y" value="${k.y}"><span>mm</span></div></div>
          ${shapeSizeFields(k)}
        </div>
      </div>`).join('');
  }

  $('#addBend').addEventListener('click', () => {
    if (cfg.bends.length >= PRICING.bending.maxBends) return Utils.toast('Nº máximo de pliegues alcanzado', 'error');
    // Un borde solo admite UN pliegue: se elige un panel con borde libre.
    const slot = nextFreeBendSlot(cfg.bends);
    if (!slot) return Utils.toast('No quedan bordes libres: cada borde admite un solo pliegue', 'error');
    cfg.bends.push({ ...slot, direction: 'up', angle: 90, flangeLength: 40 });
    renderBends(); renderCuts(); update();
  });
  $('#addCut').addEventListener('click', () => {
    cfg.cuts.push({ segment: 'base', shape: 'circular', x: 0, y: 0, rotation: 0, w: 12, h: 12 });
    renderCuts(); update();
  });

  $('#bendsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-bend]');
    if (!btn) return;
    const removed = removeBendCascade(cfg, Number(btn.dataset.removeBend));
    const extra = [];
    if (removed.bends > 1) extra.push(`${removed.bends - 1} pliegue(s) que colgaban de él`);
    if (removed.cuts) extra.push(`${removed.cuts} corte(s) hechos en ellos`);
    if (extra.length) Utils.toast(`También se han eliminado ${extra.join(' y ')}.`);
    renderBends(); renderCuts(); update();
  });
  const onBendField = (e) => {
    const field = e.target.dataset.bendField;
    if (!field) return;
    const i = Number(e.target.closest('.repeater-row').dataset.index);
    cfg.bends[i][field] = (field === 'angle' || field === 'flangeLength') ? Utils.toFloat(e.target.value, cfg.bends[i][field]) : e.target.value;
    if (field === 'parent') {
      // El borde debe existir en el nuevo panel (sobre un ala no hay 'Abajo')
      // y estar LIBRE: un borde solo admite un pliegue.
      const b = cfg.bends[i];
      const valid = edgeOptionsFor(b.parent).map(([v]) => v);
      if (!valid.includes(b.edge) || occupiedEdges(cfg.bends, b.parent, i).has(b.edge)) {
        b.edge = firstFreeEdge(cfg.bends, b.parent, i) || valid[0];
      }
    }
    if (e.type === 'change' && (field === 'parent' || field === 'edge')) {
      // Repinta TODOS los selectores: lo que este pliegue ocupa/libera se
      // deshabilita/habilita en los demás. Se devuelve el foco al mismo campo.
      renderBends();
      $(`#bendsList .repeater-row[data-index="${i}"] [data-bend-field="${field}"]`)?.focus();
    }
    update();
  };
  $('#bendsList').addEventListener('input', onBendField);
  $('#bendsList').addEventListener('change', onBendField);

  $('#cutsList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-cut]');
    if (!btn) return;
    cfg.cuts.splice(Number(btn.dataset.removeCut), 1);
    renderCuts(); update();
  });
  const onCutField = (e) => {
    const field = e.target.dataset.cutField;
    if (!field) return;
    const i = Number(e.target.closest('.repeater-row').dataset.index);
    if (field === 'segment' || field === 'shape') {
      cfg.cuts[i][field] = e.target.value;
      if (field === 'shape') renderCuts();   // los campos de tamaño cambian según la forma
    } else {
      cfg.cuts[i][field] = Utils.toFloat(e.target.value, cfg.cuts[i][field]);
    }
    update();
  };
  $('#cutsList').addEventListener('input', onCutField);
  $('#cutsList').addEventListener('change', onCutField);

  /* ------------------------------------------------------------------
     3. Leer / escribir los campos simples del formulario
     ------------------------------------------------------------------ */
  function readForm() {
    const fd = new FormData(form);
    return {
      reference: fd.get('reference') || 'Pieza sin referencia',
      material: fd.get('material'), thickness: fd.get('thickness'),
      width: fd.get('width'), length: fd.get('length'),
      finish: fd.get('finish'), quantity: fd.get('quantity'), notes: fd.get('notes'),
      bends: cfg.bends, cuts: cfg.cuts,
    };
  }

  function writeForm(c) {
    $('#reference').value = c.reference;
    const mat = $(`#mat_${c.material}`); if (mat) mat.checked = true;
    $('#thickness').value = String(c.thickness);
    $('#width').value = c.width;
    $('#length').value = c.length;
    const fin = $(`#fin_${c.finish}`); if (fin) fin.checked = true;
    $('#quantity').value = c.quantity;
    $('#notes').value = c.notes;
  }

  function validateDimensions(raw) {
    const L = PRICING.limits;
    const w = Utils.toFloat(raw.width, NaN);
    const l = Utils.toFloat(raw.length, NaN);
    const errors = [];
    if (!(w >= L.minWidth && w <= L.maxWidth)) errors.push(`Ancho entre ${L.minWidth} y ${L.maxWidth} mm`);
    if (!(l >= L.minLength && l <= L.maxLength)) errors.push(`Largo entre ${L.minLength} y ${L.maxLength} mm`);
    $('#dimError').textContent = errors.join(' · ');
    return errors.length === 0;
  }

  /* ------------------------------------------------------------------
     4. Enrutado de máquina (indicador visual en vivo)
     ------------------------------------------------------------------ */
  function renderMachineBadge(machine) {
    const badge = $('#machineBadge');
    if (!badge) return;
    if (!machine) {
      badge.className = 'machine-badge is-error';
      badge.innerHTML = '⚠ Fuera del rango de fabricación actual';
      return;
    }
    badge.className = `machine-badge is-${machine.id}`;
    badge.innerHTML = `<span class="dot"></span>Enrutado a: <b>${Utils.escapeHTML(machine.label)}</b><small>${Utils.escapeHTML(machine.formats)}</small>`;
  }

  /* ------------------------------------------------------------------
     5. Actualizar precio + visor 3D
     ------------------------------------------------------------------ */
  /** Escribe de vuelta en los inputs de cada corte el X/Y ya saneado —
   * si el usuario lo saca del panel, el valor topa visiblemente con el borde. */
  function syncCutPositionInputs() {
    const dims = computeSegmentDims(cfg.width, cfg.length, cfg.bends);
    const m = cutEdgeMargin(cfg.thickness);
    document.querySelectorAll('#cutsList .repeater-row').forEach((row, i) => {
      const cut = cfg.cuts[i];
      if (!cut) return;
      const panel = dims[cut.segment] || dims.base;
      const max = maxCutSize(cut, panel.width, panel.length, cfg.thickness);
      const { hx, hy } = cutHalfExtents(cut);
      const set = (field, value, attrs) => {
        const el = row.querySelector(`[data-cut-field="${field}"]`);
        if (!el) return;
        Object.entries(attrs || {}).forEach(([k, v]) => { el[k] = Utils.round2(v); });
        if (Number(el.value) !== value) el.value = value;
      };
      set('w', cut.w, { max: max.w });
      set('h', cut.h, { max: max.h });
      set('x', cut.x, { min: -(panel.width / 2 - hx - m), max: panel.width / 2 - hx - m });
      set('y', cut.y, { min: -(panel.length / 2 - hy - m), max: panel.length / 2 - hy - m });
    });
  }

  let current = null;
  let lastMaterial = null;
  function update() {
    if (!isPricingReady()) return;
    const raw = readForm();
    validateDimensions(raw);
    const q = calculateQuote(raw);
    current = q;
    cfg = q.config;   // la config saneada (ids de pliegues/cortes canónicos, X/Y de cortes ya limitados) pasa a ser la fuente de verdad

    if (cfg.material !== lastMaterial) {
      renderFinishOptions(cfg.material);
      lastMaterial = cfg.material;
    }
    syncCutPositionInputs();

    $('#priceTotal').textContent = Utils.money(q.subtotal);
    $('#priceUnit').textContent = Utils.money(q.unitPrice);
    $('#metaWeight').textContent = `${Utils.number(q.metrics.totalWeightKg, 1)} kg`;
    $('#metaArea').textContent = `${Utils.number(q.metrics.areaM2, 3)} m²`;
    $('#metaDiscount').textContent = q.discountPercent ? `−${q.discountPercent}%` : '—';
    $('#weightBadge').textContent = `${Utils.number(q.metrics.weightKg, 2)} kg/ud`;
    const mat = PRICING.materials[cfg.material];
    if (mat.colors) {
      const col = mat.colors.find((c) => c.key === cfg.finish) || mat.colors[0];
      $('#finishName').textContent = col.label;
    } else {
      $('#finishName').textContent = 'Este material no se pinta: se sirve en su acabado metálico natural.';
    }

    renderMachineBadge(q.machine);

    const rows = q.lines.map((l) => `
      <tr><td>${Utils.escapeHTML(l.label)}<small>${Utils.escapeHTML(l.detail)}</small></td><td>${Utils.money(l.amount)}</td></tr>`);
    rows.push(`<tr><td>Precio unitario × ${q.quantity}</td><td>${Utils.money(q.partsTotal)}</td></tr>`);
    if (q.discount) rows.push(`<tr class="discount"><td>Descuento volumen (${q.discountPercent}%)</td><td>−${Utils.money(q.discount)}</td></tr>`);
    rows.push(`<tr><td>Preparación de fabricación<small>una vez por referencia</small></td><td>${Utils.money(q.setup)}</td></tr>`);
    rows.push(`<tr class="total"><td>Total (sin IVA)</td><td>${Utils.money(q.subtotal)}</td></tr>`);
    $('#breakdownBody').innerHTML = rows.join('');

    $('#addToCart').disabled = !q.machine;

    window.IWT_LAST_CONFIG = q.config;
    window.dispatchEvent(new CustomEvent('iwt:config-change', { detail: q.config }));
  }

  /* ------------------------------------------------------------------
     6. Tramitar pedido -> localStorage -> checkout.html
     ------------------------------------------------------------------ */
  async function onSubmit(e) {
    e.preventDefault();
    const raw = readForm();
    if (!validateDimensions(raw)) {
      Utils.toast('Revisa las medidas de la chapa base', 'error');
      $('#width').focus();
      return;
    }
    const btn = $('#addToCart');
    btn.classList.add('is-loading');
    btn.disabled = true;
    try {
      const sanitized = sanitizePartConfig(raw);
      const machine = routeMachine(resolveGeometry(sanitized).machineLengthRef);
      if (!machine) throw new Error('Esta pieza queda fuera del rango de fabricación actual.');

      const blob = generatePlanFile(sanitized);            // <- tu algoritmo (js/plan-generator.js)
      const planContent = await blob.text();
      const planFilename = planFilenameFor(sanitized);

      const item = CartStore.add({ config: sanitized, planContent, planFilename, planSource: 'generated' });
      if (!item) throw new Error('No se pudo guardar');
      Utils.toast('Pedido añadido. Redirigiendo al checkout…', 'success', 1200);
      setTimeout(() => { window.location.href = 'checkout.html'; }, 450);
    } catch (err) {
      console.error(err);
      Utils.toast(err.message || 'Error al tramitar el pedido. Inténtalo de nuevo.', 'error');
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------
     7. UI general de la landing
     ------------------------------------------------------------------ */
  function setupLandingUI() {
    const setCount = () => {
      const n = CartStore.peekCount();
      const el = $('#cartCount');
      el.textContent = n; el.dataset.count = n;
    };
    setCount();
    window.addEventListener('iwt:cart-change', setCount);
    window.addEventListener('storage', setCount);

    $('#year').textContent = new Date().getFullYear();
    $('#companyLegal').textContent = COMPANY.legalName;
    $('#freeShip').textContent = Utils.money(PRICING.shipping.freeFrom);

    const header = $('#siteHeader');
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Si el módulo 3D no carga (sin conexión a CDN), no bloquear la web
    setTimeout(() => $('#loader')?.classList.add('is-done'), 4000);

    if (window.gsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      gsap.utils.toArray('.reveal').forEach((el) => {
        gsap.from(el, {
          opacity: 0, y: 40, duration: 1.1, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
        });
      });
    }
  }

  /* ------------------------------------------------------------------
     Init — espera las tarifas SQLpyme antes de permitir calcular precios
     ------------------------------------------------------------------ */
  async function init() {
    renderOptions();
    renderFinishOptions(cfg.material);
    writeForm(cfg);
    renderBends();
    renderCuts();
    setupLandingUI();

    const priceBox = $('#priceTotal').closest('.price-box');
    priceBox.classList.add('is-loading');
    $('#addToCart').disabled = true;
    $('#priceTotal').textContent = 'Consultando SQLpyme…';

    await initPricing();     // <- espera al ERP (o aplica tarifas de emergencia)

    priceBox.classList.remove('is-loading');
    paintTariffHints();
    update();

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', onSubmit);
  }

  init();
}());
