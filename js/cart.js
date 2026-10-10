/* ==========================================================================
   [YOUR_COMPANY] · Carrito persistente en localStorage
   Cada ítem: { id, createdAt, config, quote, machine, plan: { filename, content, source } }
   Depende de: js/config.js, js/pricing.js (con tarifas ya cargadas -> initPricing())
   ========================================================================== */

const CartStore = {
  key: STORAGE_KEYS.cart,

  /** Lectura completa: re-sanea y re-calcula precios. Requiere tarifas cargadas. */
  read() {
    try {
      const raw = localStorage.getItem(this.key);
      const data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      // Re-sanea y re-calcula: nunca confiar en precios guardados en el navegador
      return data
        .filter((it) => it && it.config && it.plan && typeof it.plan.content === 'string')
        .map((it) => {
          const config = sanitizePartConfig(it.config);
          const quote = calculateQuote(config);
          return { ...it, config, quote, machine: quote.machine };
        });
    } catch (err) {
      console.warn('[IWT] Carrito corrupto, se reinicia.', err);
      return [];
    }
  },

  /** Nº de piezas sin recalcular precio: seguro para pintar el badge antes de tener tarifas. */
  peekCount() {
    try {
      const raw = localStorage.getItem(this.key);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data.length : 0;
    } catch (err) {
      return 0;
    }
  },

  write(items) {
    try {
      localStorage.setItem(this.key, JSON.stringify(items));
      window.dispatchEvent(new CustomEvent('iwt:cart-change', { detail: { count: items.length } }));
      return true;
    } catch (err) {
      // QuotaExceededError (~5 MB por dominio) o modo privado
      console.error('[IWT] No se pudo guardar el carrito', err);
      Utils.toast('No se pudo guardar el carrito (almacenamiento lleno). Elimina alguna pieza.', 'error');
      return false;
    }
  },

  add({ config, planContent, planFilename, planSource = 'generated' }) {
    const items = this.read();
    const cfg = sanitizePartConfig(config);
    const quote = calculateQuote(cfg);
    const item = {
      id: Utils.uid('item'),
      createdAt: new Date().toISOString(),
      config: cfg,
      quote,
      machine: quote.machine,
      plan: { filename: planFilename, content: planContent, source: planSource },
    };
    items.push(item);
    return this.write(items) ? item : null;
  },

  update(id, patch) {
    const items = this.read();
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    const config = sanitizePartConfig({ ...items[idx].config, ...patch });
    const quote = calculateQuote(config);
    items[idx] = { ...items[idx], config, quote, machine: quote.machine };
    this.write(items);
    return items[idx];
  },

  remove(id) {
    this.write(this.read().filter((it) => it.id !== id));
  },

  clear() {
    this.write([]);
  },

  count() {
    return this.read().length;
  },
};
