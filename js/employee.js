/* ==========================================================================
   [YOUR_COMPANY] · Panel de Taller (empleado.html)
   Autenticación simple + configurador paramétrico con exportación real.
   Depende de: config.js, geometry-engine.js, pricing.js, sqlpyme-api.js,
               plan-generator.js, js/employee-viewer.js (module, expone
               window.EmployeeViewer)
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  /* ------------------------------------------------------------------
     0. AUTENTICACIÓN
     Nota: es una barrera de cliente para uso interno, no seguridad real.
     Para control de acceso serio, valida contra tu backend / SSO.
     ------------------------------------------------------------------ */
  function setupAuth() {
    const overlay = $('#authOverlay');
    const form = $('#authForm');
    const input = $('#authPassword');
    const error = $('#authError');
    const app = $('#employeeApp');

    function unlock() {
      overlay.classList.remove('is-open');
      app.hidden = false;
      requestAnimationFrame(() => window.EmployeeViewer?.resize?.());
      document.dispatchEvent(new CustomEvent('iwt:employee-unlocked'));
    }

    const C = EMPLOYEE_CONFIG;
    const submitBtn = form.querySelector('button[type="submit"]');
    const lockKey = `${C.sessionKey}_lock`;
    const guard = AuthPolicy.createLoginGuard({
      maxAttempts: C.maxAttempts,
      lockoutMs: C.lockoutMs,
      store: {
        get: () => { try { return JSON.parse(localStorage.getItem(lockKey)); } catch (_) { return null; } },
        set: (s) => { try { localStorage.setItem(lockKey, JSON.stringify(s)); } catch (_) { /* modo privado */ } },
        clear: () => { try { localStorage.removeItem(lockKey); } catch (_) { /* no-op */ } },
      },
    });

    // Los mensajes se muestran con textContent (nunca innerHTML).
    const showLock = (ms) => { error.textContent = `Demasiados intentos. Vuelve a probar en ${Math.ceil(ms / 60000)} min.`; };

    async function sha256Hex(text) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** true = credenciales válidas. En modo 'server' el backend decide y aplica su propio bloqueo. */
    async function checkPassword(password) {
      if (C.authMode === 'server') {
        const res = await fetch(C.loginEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (res.status === 429) throw Object.assign(new Error('locked'), { locked: true });
        if (!res.ok) return false;
        const { token } = await res.json();
        try { sessionStorage.setItem(`${C.sessionKey}_token`, String(token)); } catch (_) { /* no-op */ }
        return true;
      }
      return (await sha256Hex(password)) === C.passwordHash;
    }

    let sessionOk = false;
    try { sessionOk = sessionStorage.getItem(C.sessionKey) === '1'; } catch (_) { /* no-op */ }
    if (sessionOk) unlock();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const locked = guard.remainingLockMs();
      if (locked > 0) { showLock(locked); return; }
      const password = input.value;
      input.value = '';

      // Política de longitud: ni se intenta una clave corta (no gasta intentos).
      if (!AuthPolicy.meetsLength(password, C.minPasswordLength)) {
        error.textContent = `La contraseña debe tener más de ${C.minPasswordLength - 1} caracteres.`;
        input.focus();
        return;
      }

      submitBtn.disabled = true;
      try {
        if (await checkPassword(password)) {
          guard.recordSuccess();
          try { sessionStorage.setItem(C.sessionKey, '1'); } catch (_) { /* modo privado */ }
          error.textContent = '';
          unlock();
          return;
        }
        const { attemptsLeft, locked: nowLocked } = guard.recordFailure();
        if (nowLocked) showLock(C.lockoutMs);
        else error.textContent = `Contraseña incorrecta. Intentos restantes: ${attemptsLeft}.`;
      } catch (err) {
        error.textContent = err.locked ? 'Demasiados intentos. Inténtalo más tarde.' : 'No se pudo validar el acceso.';
      } finally {
        submitBtn.disabled = false;
        input.focus();
      }
    });

    $('#logoutBtn').addEventListener('click', () => {
      try { sessionStorage.removeItem(C.sessionKey); sessionStorage.removeItem(`${C.sessionKey}_token`); } catch (_) { /* no-op */ }
      window.location.reload();
    });
  }

  /* ------------------------------------------------------------------
     1. CONFIGURADOR PARAMÉTRICO (misma lógica que el público + exportación)
     ------------------------------------------------------------------ */
  function setupConfigurator() {
    const form = $('#configForm');
    let cfg = defaultPartConfig();

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

    /** Igual que en el configurador público: el color depende del material. */
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

    function segmentOptions(uptoIndex) {
      const opts = [{ id: 'base', label: 'Chapa base' }];
      for (let i = 0; i < uptoIndex; i++) opts.push({ id: `bend${i + 1}`, label: `Pliegue ${i + 1}` });
      return opts;
    }
    const allSegmentOptions = () => segmentOptions(cfg.bends.length);

    function renderBends() {
      const list = $('#bendsList');
      if (!cfg.bends.length) { list.innerHTML = '<p class="help-text">Sin pliegues: la pieza sale plana.</p>'; return; }
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
      if (!cfg.cuts.length) { list.innerHTML = '<p class="help-text">Sin cortes internos.</p>'; return; }
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
        if (field === 'shape') renderCuts();
      } else {
        cfg.cuts[i][field] = Utils.toFloat(e.target.value, cfg.cuts[i][field]);
      }
      update();
    };
    $('#cutsList').addEventListener('input', onCutField);
    $('#cutsList').addEventListener('change', onCutField);

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

    function renderMachineBadge(machine) {
      const badge = $('#machineBadge');
      if (!machine) { badge.className = 'machine-badge is-error'; badge.innerHTML = '⚠ Fuera del rango de fabricación (Línea A / Línea B)'; return; }
      badge.className = `machine-badge is-${machine.id}`;
      badge.innerHTML = `<span class="dot"></span>Enrutado a: <b>${Utils.escapeHTML(machine.label)}</b><small>${Utils.escapeHTML(machine.formats)}</small>`;
    }

    /** Escribe de vuelta en los inputs de cada corte el X/Y ya saneado. */
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
      cfg = q.config;

      if (cfg.material !== lastMaterial) {
        renderFinishOptions(cfg.material);
        lastMaterial = cfg.material;
      }
      syncCutPositionInputs();

      $('#priceTotal').textContent = Utils.money(q.subtotal);
      $('#priceUnit').textContent = Utils.money(q.unitPrice);
      $('#metaWeight').textContent = `${Utils.number(q.metrics.totalWeightKg, 1)} kg`;
      $('#metaArea').textContent = `${Utils.number(q.metrics.areaM2, 3)} m²`;
      $('#metaPerimeter').textContent = `${Utils.number(q.metrics.perimeterM, 2)} m`;
      $('#weightBadge').textContent = `${Utils.number(q.metrics.weightKg, 2)} kg/ud`;
      const mat = PRICING.materials[cfg.material];
      if (mat.colors) {
        const col = mat.colors.find((c) => c.key === cfg.finish) || mat.colors[0];
        $('#finishName').textContent = col.label;
      } else {
        $('#finishName').textContent = 'Este material no se pinta: se sirve en su acabado metálico natural.';
      }
      renderMachineBadge(q.machine);

      window.EmployeeViewer?.update?.(q.config);
    }

    renderOptions();
    renderFinishOptions(cfg.material);
    writeForm(cfg);
    renderBends();
    renderCuts();

    initPricing().then(() => {
      $('#tariffStamp').textContent = 'Tarifas SQLpyme sincronizadas';
      Object.entries(PRICING.materials).forEach(([key, m]) => {
        const el = document.querySelector(`[data-price-for="material:${key}"]`);
        if (el) el.textContent = `${Utils.money(m.pricePerKg)}/kg`;
      });
      update();
    });

    document.addEventListener('iwt:employee-unlocked', () => window.EmployeeViewer?.update?.(current?.config || cfg));
    window.addEventListener('iwt:employee-viewer-ready', () => { if (current) window.EmployeeViewer.update(current.config); });

    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', (e) => e.preventDefault());

    /* ---- Exportación real de archivos (única página con estos botones) ---- */
    // Plantilla pública: las descargas de fabricación están DESACTIVADAS a propósito
    // (los exportadores reales no se distribuyen; ver README).
    ['#dlPlan', '#dlStl', '#dlGlb'].forEach((sel) => {
      $(sel).addEventListener('click', () => Utils.toast('Descarga desactivada en la plantilla pública (solo frontend).', 'info', 4500));
    });
  }

  $('#companyLegal').textContent = `${COMPANY.legalName} · CIF ${COMPANY.taxId}`;
  // ▶ Rotar / ⏸ Pausar: solo cambian autoRotate; la órbita manual
  // (arrastrar + rueda) sigue activa en ambos estados.
  document.querySelectorAll('#viewerWrap [data-rotate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.dataset.rotate === 'on';
      window.EmployeeViewer?.setAutoRotate?.(on);
      document.querySelectorAll('#viewerWrap [data-rotate]').forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  /* ------------------------------------------------------------------
     Visor de archivos externos (.stl) — EXCLUSIVO del Panel de Taller.
     La carga real (STLLoader) vive en js/employee-viewer.js (módulo ES, que
     es donde se importa Three.js); aquí solo va la interfaz del operario.
     ------------------------------------------------------------------ */
  function setupExternalLoader() {
    const input = $('#externalFile');
    const pick = $('#externalPick');
    const back = $('#externalBack');
    const info = $('#externalInfo');
    const tag = $('#externalTag');
    const wrap = $('#viewerWrap');
    const fmt = (n) => Utils.number(n, n < 100 ? 1 : 0);

    let loaded = null;                        // último modelo externo mostrado
    function setExternalUI(result) {
      loaded = result;
      const on = !!result;
      back.hidden = !on;
      tag.hidden = !on;
      $('#externalName').textContent = on ? result.name : '';
      info.innerHTML = on
        ? `<b>${Utils.escapeHTML(result.name)}</b> · ${Utils.number(result.triangles, 0)} triángulos · `
          + `${fmt(result.sizeMm.x)} × ${fmt(result.sizeMm.y)} × ${fmt(result.sizeMm.z)} mm`
        : '';
      pick.textContent = on ? '⤒ Cargar otro modelo .stl' : '⤒ Cargar modelo externo .stl';
    }

    async function load(file) {
      if (!file) return;
      if (!window.EmployeeViewer?.loadExternalSTL) return Utils.toast('El visor 3D aún se está cargando', 'error');
      info.textContent = `Leyendo ${file.name}…`;
      try {
        const result = await window.EmployeeViewer.loadExternalSTL(file);
        setExternalUI(result);
        Utils.toast('Modelo externo cargado en el visor');
      } catch (err) {
        console.error('[IWT] Error al cargar el .stl', err);
        setExternalUI(loaded);                // el visor conserva lo que ya mostraba
        Utils.toast(err.message || 'No se pudo abrir el archivo', 'error', 5000);
      } finally {
        input.value = '';                     // permite volver a cargar el mismo archivo
      }
    }

    input.addEventListener('change', () => load(input.files[0]));
    pick.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    back.addEventListener('click', () => {
      window.EmployeeViewer?.clearExternal?.();
      setExternalUI(null);
      Utils.toast('De vuelta al diseño paramétrico');
    });

    // Atajo: arrastrar y soltar el .stl directamente sobre el visor
    ['dragenter', 'dragover'].forEach((ev) => wrap.addEventListener(ev, (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      wrap.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => wrap.addEventListener(ev, () => wrap.classList.remove('is-dragover')));
    wrap.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      load(e.dataTransfer.files[0]);
    });
  }

  setupAuth();
  setupConfigurator();
  setupExternalLoader();
}());
