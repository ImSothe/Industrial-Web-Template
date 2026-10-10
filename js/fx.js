/* ==========================================================================
   [YOUR_COMPANY] · Capa de efectos de la landing (solo index.html)
   Scroll suave (Lenis) + intro del hero + banda de materiales + cursor,
   botones magnéticos, foco de luz, precio que rueda…
   No toca la lógica de negocio. Depende de: GSAP, ScrollTrigger y, para el
   precio, de Utils (js/pricing.js). Con prefers-reduced-motion o sin GSAP todo
   cae a la web estática de siempre.
   Comparte con el módulo 3D del index el objeto window.IWT_FX:
     k   -> progreso de la entrada de la pieza (0 → 1)
     vel -> velocidad de scroll en px/frame (para el zoom de cámara)
   ========================================================================== */
(function () {
  'use strict';

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  const animated = hasGsap && !reduce;

  const FX = window.IWT_FX = { k: animated ? 0 : 1, vel: 0 };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const loader = $('#loader');
  let loaded = false;
  let finished = false;
  let counting = false;
  let lenis = null;

  /* ------------------------------------------------------------------
     Loader: contador 0 → 100 que se llena, y barrido de salida
     ------------------------------------------------------------------ */
  function finish() {
    if (finished) return;
    finished = true;
    if (loader) loader.classList.add('is-done');
    if (animated) playIntro();
  }
  window.__fxLoaderDone = () => { loaded = true; if (!counting) finish(); };

  if (loader) {
    new MutationObserver(() => { if (loader.classList.contains('is-done')) finish(); })
      .observe(loader, { attributes: true, attributeFilter: ['class'] });
  }

  function runCounter() {
    const box = $('.loader-inner', loader);
    if (!box) return;
    const num = document.createElement('p');
    num.className = 'loader-count';
    num.setAttribute('aria-hidden', 'true');
    num.innerHTML = '<span id="loaderCount">0</span><small>%</small>';
    box.insertBefore(num, $('.loader-bar', box));
    const label = $('#loaderCount');
    counting = true;
    const t0 = performance.now();
    const DUR = 1500;
    (function step(now) {
      if (finished) return;
      const p = clamp((now - t0) / DUR, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const shown = loaded ? eased : Math.min(0.99, eased);
      loader.style.setProperty('--p', `${shown * 100}%`);
      loader.style.setProperty('--r', shown);
      label.textContent = Math.round(shown * 100);
      if (p >= 1 && loaded) {
        label.textContent = '100';
        setTimeout(finish, 280);
        return;
      }
      requestAnimationFrame(step);
    }(t0));
  }
  if (animated && loader) runCounter();
  // Si algo falla y nadie cierra el loader, la web nunca se queda bloqueada
  setTimeout(() => { if (FX.k === 0) FX.k = 1; finish(); }, 7000);

  if (!animated) return;   // ← sin GSAP o con movimiento reducido: nada más

  gsap.registerPlugin(ScrollTrigger);

  /* ------------------------------------------------------------------
     Scroll suave (Lenis) sincronizado con GSAP
     ------------------------------------------------------------------ */
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.95, smoothWheel: true });
    window.__lenis = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
      FX.vel = lenis.velocity || 0;
    });
    gsap.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        const target = id.length > 1 ? $(id) : null;
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { duration: 1.9, easing: (t) => 1 - Math.pow(1 - t, 4) });
      });
    });
  }

  /* ------------------------------------------------------------------
     Progreso de scroll, cabecera que se esconde, enlace activo
     ------------------------------------------------------------------ */
  const bar = document.createElement('div');
  bar.className = 'fx-progress';
  bar.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'fx-grain';
  grain.setAttribute('aria-hidden', 'true');
  document.body.append(bar, grain);

  const header = $('#siteHeader');
  const setBar = gsap.quickSetter(bar, 'scaleX');
  let lastY = window.scrollY;
  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    setBar(max > 0 ? window.scrollY / max : 0);
    const dy = window.scrollY - lastY;
    if (header && Math.abs(dy) > 6) {
      header.classList.toggle('is-hidden', dy > 0 && window.scrollY > 520);
      lastY = window.scrollY;
    }
    if (header && window.scrollY < 200) header.classList.remove('is-hidden');
  }, { passive: true });

  [['laser', 'top 50%', 'bottom 50%'], ['fold', 'top 50%', 'bottom 50%'], ['configurator', 'top 50%', 'bottom bottom']].forEach(([id, start, end]) => {
    const link = $(`.nav-link[href="#${id}"]`);
    if (!link) return;
    ScrollTrigger.create({ trigger: `#${id}`, start, end, onToggle: (st) => link.classList.toggle('is-current', st.isActive) });
  });

  /* ------------------------------------------------------------------
     Titulares: letras (hero) y líneas (resto) con máscara
     ------------------------------------------------------------------ */
  function splitLines(el) {
    const parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = '';
    return parts.map((html) => {
      const line = document.createElement('span');
      line.className = 'ln';
      const inner = document.createElement('span');
      inner.className = 'ln-in';
      inner.innerHTML = html.trim();
      line.appendChild(inner);
      el.appendChild(line);
      return inner;
    });
  }

  function splitHeadline(h) {
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    const chars = [];
    $$(':scope > span', h).forEach((group) => {
      const text = group.textContent;
      const total = text.replace(/ /g, '').length;
      let idx = 0;
      group.classList.add('fx-split');
      group.setAttribute('aria-hidden', 'true');
      group.textContent = '';
      const line = document.createElement('span');
      line.className = 'fx-line';
      text.split(' ').forEach((word, wi, all) => {
        const w = document.createElement('span');
        w.className = 'fx-word';
        Array.from(word).forEach((ch) => {
          const c = document.createElement('span');
          c.className = 'fx-char';
          c.textContent = ch;
          c.style.setProperty('--bs', `${total * 100}%`);
          c.style.setProperty('--bp', total > 1 ? `${(idx / (total - 1)) * 100}%` : '0%');
          idx += 1;
          w.appendChild(c);
          chars.push(c);
        });
        line.appendChild(w);
        if (wi < all.length - 1) line.appendChild(document.createTextNode(' '));
      });
      group.appendChild(line);
    });
    $$('br', h).forEach((b) => b.remove());
    return chars;
  }

  /* ---- Hero: estado inicial oculto (el loader lo tapa) ---- */
  const hero = $('#hero');
  const heroChars = hero ? splitHeadline($('.display', hero)) : [];
  const heroRest = hero ? [$('.eyebrow', hero), $('.lead', hero), ...$$('.hero-cta .btn', hero)] : [];
  const heroStats = hero ? $$('.hero-stats > div', hero) : [];
  const scrollHint = hero ? $('.scroll-hint', hero) : null;
  if (hero) {
    gsap.set(heroChars, { yPercent: 118, rotate: 7, transformOrigin: '0% 100%' });
    gsap.set(heroRest, { opacity: 0, y: 34 });
    gsap.set(heroStats, { opacity: 0, y: 28 });
    if (scrollHint) gsap.set(scrollHint, { opacity: 0 });
  }

  function playIntro() {
    gsap.to(FX, { k: 1, duration: 2.8, ease: 'expo.out', delay: 0.1 });
    if (!hero) return;
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.to(heroChars, { yPercent: 0, rotate: 0, duration: 1.6, stagger: { each: 0.03 } }, 0.2)
      .to(heroRest, { opacity: 1, y: 0, duration: 1.2, stagger: 0.09 }, 0.75)
      .to(heroStats, { opacity: 1, y: 0, duration: 1.1, stagger: 0.09 }, 1.15);
    if (scrollHint) tl.to(scrollHint, { opacity: 1, duration: 1.2 }, 1.8);
  }

  /* ---- Tarjetas de la historia (corte / plegado) ---- */
  $$('.story-card').forEach((card) => {
    const h2 = $('.h2', card);
    const lines = h2 ? splitLines(h2) : [];
    const items = [$('.eyebrow', card), $('.lead', card), ...$$('.spec-list li', card), $('.readout', card), $('.progress-track', card)].filter(Boolean);
    gsap.set(lines, { yPercent: 112 });
    gsap.set(items, { opacity: 0, y: 28 });
    const tl = gsap.timeline({
      defaults: { ease: 'expo.out' },
      scrollTrigger: { trigger: card.closest('.story'), start: 'top 38%', toggleActions: 'play none none reverse' },
    });
    tl.to(items[0], { opacity: 1, y: 0, duration: 0.9 }, 0)
      .to(lines, { yPercent: 0, duration: 1.3, stagger: 0.12 }, 0.05)
      .to(items.slice(1), { opacity: 1, y: 0, duration: 1, stagger: 0.07 }, 0.35);
  });

  /* ---- Configurador: título por líneas + el panel entra en cascada ---- */
  const cfgTitle = $('.config-intro .h2');
  if (cfgTitle) {
    const lines = splitLines(cfgTitle);
    gsap.from(lines, {
      yPercent: 112, duration: 1.3, stagger: 0.12, ease: 'expo.out',
      scrollTrigger: { trigger: cfgTitle, start: 'top 85%', once: true },
    });
  }
  const panel = $('#configForm');
  if (panel) {
    const kids = $$(':scope > .panel-head, :scope > .field-group, :scope > .price-box, :scope > .actions', panel);
    gsap.from(kids, {
      opacity: 0, y: 24, duration: 0.9, stagger: 0.06, ease: 'expo.out', clearProps: 'transform,opacity',
      scrollTrigger: { trigger: panel, start: 'top 78%', once: true },
    });
  }

  /* ------------------------------------------------------------------
     Cursor, foco de luz y botones magnéticos (solo con ratón)
     ------------------------------------------------------------------ */
  if (finePointer) {
    const spot = document.createElement('div');
    spot.className = 'fx-spot';
    spot.setAttribute('aria-hidden', 'true');
    const bg = $('.bg-grid');
    if (bg) bg.after(spot); else document.body.prepend(spot);

    const ring = document.createElement('div');
    ring.className = 'fx-cursor';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<span></span>';
    const dot = document.createElement('div');
    dot.className = 'fx-dot';
    dot.setAttribute('aria-hidden', 'true');
    document.body.append(ring, dot);
    const label = $('span', ring);

    const rx = gsap.quickTo(ring, 'x', { duration: 0.55, ease: 'power3' });
    const ry = gsap.quickTo(ring, 'y', { duration: 0.55, ease: 'power3' });
    const dx = gsap.quickTo(dot, 'x', { duration: 0.08, ease: 'none' });
    const dy = gsap.quickTo(dot, 'y', { duration: 0.08, ease: 'none' });
    const sx = gsap.quickTo(spot, 'x', { duration: 1.1, ease: 'power3' });
    const sy = gsap.quickTo(spot, 'y', { duration: 1.1, ease: 'power3' });
    const hoverSel = 'a, button, .btn, label, summary, select, input, textarea, [role="button"]';

    window.addEventListener('pointermove', (e) => {
      rx(e.clientX); ry(e.clientY); dx(e.clientX); dy(e.clientY); sx(e.clientX); sy(e.clientY);
      ring.classList.add('is-on'); dot.classList.add('is-on'); spot.classList.add('is-on');
      const tag = e.target.closest ? e.target.closest('[data-cursor]') : null;
      const link = !tag && e.target.closest ? e.target.closest(hoverSel) : null;
      ring.classList.toggle('is-label', !!tag);
      ring.classList.toggle('is-link', !!link);
      dot.classList.toggle('is-hidden', !!tag);
      label.textContent = tag ? tag.dataset.cursor : '';
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => {
      ring.classList.remove('is-on'); dot.classList.remove('is-on'); spot.classList.remove('is-on');
    });

    $$('.hero-cta .btn, .cart-btn').forEach((el) => {
      const mx = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'elastic.out(1, 0.45)' });
      const my = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'elastic.out(1, 0.45)' });
      el.classList.add('is-magnet');
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.32);
        my((e.clientY - (r.top + r.height / 2)) * 0.45);
      });
      el.addEventListener('pointerleave', () => { mx(0); my(0); });
    });
  }

  /* ------------------------------------------------------------------
     Precio: los números ruedan hasta el nuevo importe
     ------------------------------------------------------------------ */
  function parseMoney(text) {
    const raw = (text.match(/\d[\d.,\s ]*/) || [''])[0].replace(/[\s ]/g, '').replace(/[.,]$/, '');
    if (!raw) return null;
    const dec = raw.match(/[.,](\d{1,2})$/);
    const n = dec ? `${raw.slice(0, dec.index).replace(/[.,]/g, '')}.${dec[1]}` : raw.replace(/[.,]/g, '');
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
  }

  function rollMoney(el) {
    if (!el || typeof Utils === 'undefined' || !Utils.money) return;
    let shown = parseMoney(el.textContent);
    let tween = null;
    const obs = new MutationObserver(() => {
      const text = el.textContent;
      const target = parseMoney(text);
      if (tween) { tween.kill(); tween = null; }
      if (target === null) { shown = null; return; }
      if (shown === null || Math.abs(target - shown) < 0.005) { shown = target; return; }
      const state = { v: shown };
      el.classList.remove('is-tick');
      void el.offsetWidth;
      el.classList.add('is-tick');
      tween = gsap.to(state, {
        v: target, duration: 0.9, ease: 'expo.out',
        onUpdate: () => { shown = state.v; el.textContent = Utils.money(state.v); obs.takeRecords(); },
        onComplete: () => { shown = target; el.textContent = text; obs.takeRecords(); tween = null; },
      });
    });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
  }
  rollMoney($('#priceTotal'));
  rollMoney($('#priceUnit'));

  window.addEventListener('load', () => ScrollTrigger.refresh());
}());
