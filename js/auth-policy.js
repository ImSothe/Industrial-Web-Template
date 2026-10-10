/* ==========================================================================
   Política de acceso (pura, sin DOM): longitud mínima + bloqueo por fallos.
   Se usa en el navegador (window.AuthPolicy) y en los tests de Node.
   El servidor (server/security.js) aplica las MISMAS reglas: esta copia solo
   da feedback inmediato; un atacante puede saltarse el cliente.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuthPolicy = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** "Más de 12 caracteres": 13 o más (se cuentan puntos de código, no UTF-16). */
  function meetsLength(password, minLength = 13) {
    return typeof password === 'string' && [...password].length >= minLength;
  }

  /**
   * Contador de intentos fallidos. `store` es { get(), set(state), clear() }
   * (localStorage en el navegador, un Map en el servidor). Tras `maxAttempts`
   * fallos seguidos bloquea `lockoutMs`; un acierto lo reinicia.
   */
  function createLoginGuard({ maxAttempts = 3, lockoutMs = 15 * 60 * 1000, store, now = Date.now }) {
    const read = () => {
      const s = store.get();
      return s && Number.isFinite(s.fails) ? { fails: s.fails, lockedUntil: Number(s.lockedUntil) || 0 } : { fails: 0, lockedUntil: 0 };
    };
    return {
      /** ms restantes de bloqueo (0 = libre). */
      remainingLockMs() {
        const { lockedUntil } = read();
        return Math.max(0, lockedUntil - now());
      },
      recordFailure() {
        const s = read();
        if (s.lockedUntil && s.lockedUntil <= now()) { s.fails = 0; s.lockedUntil = 0; }   // el bloqueo ya expiró
        s.fails += 1;
        if (s.fails >= maxAttempts) s.lockedUntil = now() + lockoutMs;
        store.set(s);
        return { attemptsLeft: Math.max(0, maxAttempts - s.fails), locked: s.lockedUntil > now() };
      },
      recordSuccess() { store.clear(); },
    };
  }

  return { meetsLength, createLoginGuard };
}));
