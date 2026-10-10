/* ==========================================================================
   [YOUR_COMPANY] · Configuración global de la plataforma
   --------------------------------------------------------------------------
   ESTE ES EL ÚNICO ARCHIVO QUE NECESITAS TOCAR PARA:
     1. Cambiar el enrutado de máquinas (largos/formatos)   -> MACHINES
     2. Modificar catálogo (materiales, cortes, acabados...) -> PRICING
        (los PRECIOS en sí llegan en vivo desde el ERP, ver js/sqlpyme-api.js)
     3. Configurar el correo de Oficina Técnica y el envío   -> EMAIL_CONFIG
     4. Añadir / quitar campos del formulario de facturación -> BILLING_FIELDS
     5. Cambiar la contraseña del modo Taller/Empleado       -> EMPLOYEE_CONFIG
   Se carga como <script> clásico en index.html, checkout.html y empleado.html.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Datos de empresa (aparecen en emails y pie de página)
   -------------------------------------------------------------------------- */
const COMPANY = {
  name: '[YOUR_COMPANY]',
  legalName: '[YOUR_COMPANY] S.L.',
  taxId: 'B00000000',
  email: 'info@your-company.example',
  phone: '+34 900 000 000',
  address: 'Polígono Industrial, Nave 12 · 00000 (España)',
  website: 'https://your-company.example',
};

/* --------------------------------------------------------------------------
   1) ENRUTADO AUTOMÁTICO DE MÁQUINA
   El configurador asigna la línea de producción según el LARGO de la pieza.
   Ajusta los umbrales aquí si cambia el parque de máquinas.
   -------------------------------------------------------------------------- */
const MACHINES = {
  lineA: {
    id: 'lineA',
    label: 'Línea A',
    short: 'LÍNEA A',
    maxLength: 3000,                 // mm — hasta 3000 de largo
    maxWidth: 2500,                  // mm
    formats: 'Formatos hasta 3000 × 2500 mm',
  },
  lineB: {
    id: 'lineB',
    label: 'Línea B',
    short: 'LÍNEA B',
    minLength: 3000,                 // mm — a partir de aquí (exclusive)
    maxLength: 6000,                 // mm
    maxWidth: 2500,                  // mm
    formats: 'Formatos de 6000 × 1250 a 6000 × 2500 mm',
  },
};

/* --------------------------------------------------------------------------
   Colores de catálogo — EXTRAÍDOS TAL CUAL del catálogo de referencia (FAMILIES /
   COL_ALU / COL_PRE). Solo Aluminio y Prelacado se pintan; Acero, Inox y
   Galvanizado se sirven en su acabado metálico natural (colors: null más
   abajo, sin selector de color en la interfaz). `metal: true` = acabado
   metalizado (usa el mismo aspecto 3D que la pieza sin pintar en la web
   piloto: metalness 0.6/roughness 0.38 frente a 0.18/0.58 de un color liso
   — ver resolveMaterialLook() en js/geometry-engine.js). Elegir un color no
   tiene coste aparte: el €/kg del material YA es el precio final, igual que
   en el catálogo de referencia.
   -------------------------------------------------------------------------- */
const COL_ALU = [
  { key: 'natural', label: 'Natural', hex: '#cfd2d4', metal: true },
  { key: 'anodizado', label: 'Anodizado', hex: '#c3c6c9', metal: true },
  { key: 'silver-9006', label: 'Silver 9006', hex: '#9ea1a4', metal: true },
  { key: 'blanco', label: 'Blanco', hex: '#f1f1ee' },
  { key: 'gris-7016', label: 'Gris 7016', hex: '#383e42' },
  { key: 'gris-7024', label: 'Gris 7024', hex: '#45484b' },
  { key: 'gris-7037', label: 'Gris 7037', hex: '#7d7f7f' },
  { key: 'azul-5005', label: 'Azul 5005', hex: '#134a80' },
  { key: 'negro-9011', label: 'Negro 9011', hex: '#1b1e21' },
];
const COL_PRE = [
  { key: 'blanco-pirineo-1006', label: 'Blanco Pirineo 1006', hex: '#eae7dd' },
  { key: 'blanco-ostra-1000', label: 'Blanco Ostra 1000', hex: '#ece7da' },
  { key: 'blanco-9010', label: 'Blanco 9010', hex: '#f2f0ea' },
  { key: 'rojo-teja-7001', label: 'Rojo Teja 7001', hex: '#9b3b2c' },
  { key: 'rojo-oxido-3009', label: 'Rojo Óxido 3009', hex: '#6f3529' },
  { key: 'verde-navarra-3000', label: 'Verde Navarra 3000', hex: '#33623f' },
  { key: 'verde-claro-3001', label: 'Verde Claro 3001', hex: '#6d9a55' },
  { key: 'azul-5010', label: 'Azul 5010', hex: '#155a80' },
  { key: 'azul-5008', label: 'Azul 5008', hex: '#28343d' },
  { key: 'crema-bidasoa-2002', label: 'Crema Bidasoa 2002', hex: '#e3d6b6' },
  { key: 'arena-2000', label: 'Arena 2000', hex: '#d8c79a' },
  { key: 'tabaco-2005', label: 'Tabaco 2005', hex: '#6b4a33' },
  { key: 'silver-metalic-9006', label: 'Silver Metalic 9006', hex: '#a0a3a5', metal: true },
  { key: 'gris-perla', label: 'Gris Perla', hex: '#b9bbbc' },
  { key: 'negro-9005', label: 'Negro 9005', hex: '#17181a' },
  { key: 'ardesia-7024', label: 'Ardesia 7024', hex: '#45484b' },
  { key: 'imitacion-teja-8004', label: 'Imitación Teja 8004', hex: '#8a4a2e' },
  { key: 'imit-madera-iroko', label: 'Imit. Madera Iroko', hex: '#6a4526' },
];

/* --------------------------------------------------------------------------
   2) CATÁLOGO Y TARIFAS
   Los importes (pricePerKg, cutPerMeter, price, pricePerBend, vatRate,
   surchargePercent, setupFee) empiezan en `null` y se rellenan en tiempo de
   ejecución con fetchPreciosSQLpyme() (ver js/sqlpyme-api.js y js/pricing.js
   -> applyTariffs()). El resto (catálogo, textos, aspecto 3D, límites de
   máquina) es fijo y se edita aquí.
   -------------------------------------------------------------------------- */
const PRICING = {
  currency: 'EUR',
  locale: 'es-ES',
  vatRate: null,               // <- SQLpyme: iva

  setupFee: null,              // <- SQLpyme: coste_preparacion_cnc
  wasteFactor: 1.15,           // +15 % de merma de chapa (retales) — catálogo, no ERP

  // Límites combinados de las dos líneas de producción (mm)
  limits: {
    minWidth: 20, maxWidth: 2500,
    minLength: 20, maxLength: 6000,
    maxQuantity: 5000,
  },

  // --- MATERIALES (calcado del catálogo de referencia: FAMILIES) -----------------------
  // pricePerKg / cutPerMeter -> vienen del ERP (SQLpyme)
  // density (kg/m³), color/roughness/metalness -> aspecto 3D SOLO si `colors`
  // es null (metal natural, sin pintar). Si `colors` trae un array, el
  // material se pinta y el aspecto sale de resolveMaterialLook() según el
  // color elegido (ver js/geometry-engine.js) — nunca de estos 3 campos.
  materials: {
    acero: {
      label: 'Acero S235 / S275', short: 'Acero',
      density: 7850, pricePerKg: null, cutPerMeter: null,
      color: '#8a8f98', roughness: 0.5, metalness: 0.55,
      colors: null,           // no se pinta
    },
    inox: {
      label: 'Inoxidable AISI 304', short: 'Inox 304',
      density: 8000, pricePerKg: null, cutPerMeter: null,
      color: '#ccd2da', roughness: 0.26, metalness: 0.85,
      colors: null,           // no se pinta
    },
    aluminio: {
      label: 'Aluminio (lacado)', short: 'Aluminio',
      density: 2700, pricePerKg: null, cutPerMeter: null,
      colors: COL_ALU,        // se pinta — carta de colores del aluminio
    },
    prelacado: {
      label: 'Prelacado', short: 'Prelacado',
      density: 7850, pricePerKg: null, cutPerMeter: null,
      colors: COL_PRE,        // se pinta — carta de colores del prelacado
    },
    galvanizado: {
      label: 'Galvanizado / Aluzinc', short: 'Galvaniz.',
      density: 7850, pricePerKg: null, cutPerMeter: null,
      color: '#a8adb4', roughness: 0.42, metalness: 0.6,
      colors: null,           // no se pinta
    },
  },

  // Espesores disponibles (mm) — catálogo
  thicknesses: [0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25],
  // Cada mm por encima de 1 mm encarece el corte (+25 %/mm) y los cortes internos
  thicknessCutFactor: 0.25,

  // --- CORTES INTERNOS (precio por unidad -> ERP) --------------------------
  cutouts: {
    circular:    { label: 'Redondo',     icon: '◯', price: null },
    rectangular: { label: 'Rectangular', icon: '▭', price: null },
    triangular:  { label: 'Triangular',  icon: '△', price: null },
  },

  // --- PLEGADO --------------------------------------------------------------
  bending: {
    pricePerBend: null,        // <- SQLpyme: coste_plegado_ud
    thicknessFactor: 0.15,     // +15 % por cada mm por encima de 1 mm — catálogo
    maxBends: 8,
    minAngle: 30, maxAngle: 150,
  },

  // --- DESCUENTOS POR VOLUMEN (sobre el precio de las piezas) — catálogo ----
  quantityDiscounts: [
    { minQty: 10,  percent: 5 },
    { minQty: 50,  percent: 10 },
    { minQty: 200, percent: 15 },
  ],

  // --- PORTES — catálogo ------------------------------------------------------
  shipping: { flat: 35, freeFrom: 600 },   // gratis a partir de 600 € sin IVA

  // --- FORMAS DE PAGO (el recargo de 60 días llega del ERP) -------------------
  paymentMethods: {
    card:  { label: 'Tarjeta',        surchargePercent: 0 },
    net60: { label: 'Pago a 60 días', surchargePercent: null },   // <- SQLpyme
  },
};

/* --------------------------------------------------------------------------
   Tarifas de emergencia: se aplican SOLO si fetchPreciosSQLpyme() falla
   (ERP caído, sin red...) para que el configurador nunca se quede bloqueado.
   Mismo formato que devuelve la API — ver js/sqlpyme-api.js
   -------------------------------------------------------------------------- */
const FALLBACK_TARIFFS = {
  iva: 0.21,
  coste_preparacion_cnc: 20,
  // €/kg: valores FICTICIOS de demostración (los reales los sirve el ERP)
  precio_kg_acero: 1.00, precio_kg_inox: 3.00, precio_kg_aluminio: 4.00, precio_kg_prelacado: 2.00, precio_kg_galvanizado: 1.50,
  coste_corte_metro_acero: 1.00, coste_corte_metro_inox: 1.50, coste_corte_metro_aluminio: 1.25, coste_corte_metro_prelacado: 1.00, coste_corte_metro_galvanizado: 1.00,
  coste_plegado_ud: 1.00,
  coste_corte_circular_ud: 0.50, coste_corte_rectangular_ud: 0.50, coste_corte_triangular_ud: 0.75,
  recargo_pago_60_dias: 0.02,
};

/* --------------------------------------------------------------------------
   3) INTEGRACIÓN CON EL ERP SQLPYME (tarifas dinámicas)
   Ver js/sqlpyme-api.js -> fetchPreciosSQLpyme(). Aquí solo la URL y timeouts;
   para pasar a producción solo hace falta cambiar `endpoint` por el real.
   -------------------------------------------------------------------------- */
const SQLPYME_CONFIG = {
  mode: 'simulate',                                              // 'simulate' (demo) | 'api' (GET /api/tariffs del servidor)
  endpoint: 'http://localhost:3000/api/tariffs',                 // <- endpoint de TU servidor, no la BD
  apiKeyHeader: 'X-SQLPYME-KEY',
  apiKey: '',                                                    // nunca un secreto real en el navegador
  simulateLatencyMs: 700,       // solo afecta a la simulación; se ignora al conectar el fetch real
  timeoutMs: 8000,
};

/* --------------------------------------------------------------------------
   4) MODO TALLER / EMPLEADO (empleado.html)
   Acceso restringido a Oficina Técnica: única página con descarga de archivos.
   ¡Cambia la contraseña antes de publicar! Para un control real, valida el
   acceso contra tu backend en vez de una contraseña fija en el cliente.
   -------------------------------------------------------------------------- */
const EMPLOYEE_CONFIG = {
  // 'server' -> valida en el backend (POST loginEndpoint). RECOMENDADO.
  // 'demo'   -> compara el SHA-256 de passwordHash en el navegador (solo para
  //             probar la plantilla sin backend: NO es seguridad real).
  authMode: 'demo',
  loginEndpoint: 'http://localhost:3000/api/auth/login',
  // Política de acceso (el servidor la aplica igualmente; aquí solo es UX).
  minPasswordLength: 13,                    // "más de 12 caracteres"
  maxAttempts: 3,                           // bloqueo tras 3 fallos seguidos
  lockoutMs: 15 * 60 * 1000,
  // SHA-256 (hex) de la contraseña de DEMO "USER-Workshop-2026". Cámbiala:
  //   node -e "console.log(require('crypto').createHash('sha256').update('TU_CLAVE').digest('hex'))"
  passwordHash: '7b90ff06e926b924ae02905e37eb3214ed4058deff862103815b1f40f2ffdf69',
  // La sesión vive solo mientras dure la pestaña (sessionStorage).
  sessionKey: 'iwt_employee_session_v3',
};

/* --------------------------------------------------------------------------
   5) ENVÍO DE EMAIL A OFICINA TÉCNICA
   provider:
     'simulate' -> no envía nada, simula la latencia y muestra el payload en consola
     'emailjs'  -> envía desde el navegador con EmailJS (https://www.emailjs.com)
     'rest'     -> POST multipart/form-data a tu backend (ver /server)
   -------------------------------------------------------------------------- */
const EMAIL_CONFIG = {
  provider: 'simulate',

  // Destinatario interno: aquí llega el pedido + la documentación técnica adjunta
  officeEmail: 'engineering@your-company.example',
  officeName: '[YOUR_COMPANY] Engineering Office',

  // Confirmación al cliente (al email que escribe en la facturación)
  sendCustomerConfirmation: true,
  // ¿Adjuntar también los archivos de fabricación al cliente? Normalmente NO.
  attachPlansToCustomer: false,

  emailjs: {
    sdkUrl: 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
    publicKey: 'TU_PUBLIC_KEY',
    serviceId: 'TU_SERVICE_ID',
    templateOffice: 'TU_TEMPLATE_OFICINA',
    templateCustomer: 'TU_TEMPLATE_CLIENTE',
    maxAttachments: 3,          // nº de "Variable Attachments" definidos en la plantilla
  },

  rest: {
    endpoint: 'http://localhost:3000/api/orders',
    headers: {},                // p.ej. { 'X-Api-Key': '...' }  (¡nunca secretos reales en el front!)
  },
};

/* --------------------------------------------------------------------------
   5-bis) WEBHOOK DEL PEDIDO -> CRM / ERP
   Al pulsar "Confirmar pedido" checkout.js hace un POST con un JSON que lleva
   los datos del cliente, el precio, cada pieza (material, pliegues, cortes)
   y sus archivos de fabricación (plano DXF + modelo 3D STL) en Base64.
   Vale cualquier receptor de webhooks: Zapier ("Catch Hook"), Make, n8n,
   Power Automate o tu propio backend. Vacío = modo demo (no se envía nada;
   el JSON completo se muestra en la consola del navegador).
   -------------------------------------------------------------------------- */
const WEBHOOK_URL = '';   // p. ej. 'https://hooks.zapier.com/hooks/catch/0000000/xxxxxxx/'

const WEBHOOK_OPTIONS = {
  timeoutMs: 45000,       // el JSON lleva archivos: dale margen
  headers: {},            // cabeceras extra (p. ej. un token de Make/n8n). ¡Nada secreto en el front!
  // Zapier y algunos receptores no responden al "preflight" CORS que dispara
  // Content-Type: application/json. Con true se envía el MISMO JSON como
  // text/plain (petición "simple", sin preflight) y el receptor lo parsea igual.
  sendAsTextPlain: false,
};

/* --------------------------------------------------------------------------
   6) CAMPOS DEL FORMULARIO DE FACTURACIÓN (checkout.html)
   Se renderizan automáticamente y se incluyen solos en el email.
   Propiedades:
     name         -> clave interna (única, sin espacios)
     label        -> texto visible
     type         -> text | email | tel | textarea | select
     required     -> obligatorio
     span         -> 'full' ocupa las 2 columnas, 'half' una columna
     pattern      -> RegExp (string) de validación
     validate     -> validador especial: 'nif' (NIF/NIE/CIF español)
     options      -> solo para type 'select': [{ value, label }]
     errorMessage -> mensaje si no valida
   -------------------------------------------------------------------------- */
const BILLING_FIELDS = [
  { name: 'fullName',   label: 'Nombre completo',       type: 'text',  required: true, span: 'half', autocomplete: 'name',            placeholder: 'Ana García López' },
  { name: 'company',    label: 'Nombre de la empresa',  type: 'text',  required: true, span: 'half', autocomplete: 'organization',    placeholder: 'Metálicas del Norte S.L.' },
  { name: 'taxId',      label: 'CIF / NIF',             type: 'text',  required: true, span: 'half', validate: 'nif', uppercase: true, placeholder: 'B12345674', errorMessage: 'CIF/NIF/NIE no válido' },
  { name: 'phone',      label: 'Teléfono',              type: 'tel',   required: true, span: 'half', autocomplete: 'tel',             placeholder: '+34 600 000 000', pattern: '^\\+?[0-9\\s]{9,15}$', errorMessage: 'Teléfono no válido' },
  { name: 'address',    label: 'Dirección',             type: 'text',  required: true, span: 'full', autocomplete: 'street-address',  placeholder: 'C/ Industria 24, Nave 3' },
  { name: 'postalCode', label: 'Código postal',         type: 'text',  required: true, span: 'half', autocomplete: 'postal-code',     placeholder: '28001', pattern: '^[0-9]{5}$', errorMessage: '5 dígitos', inputmode: 'numeric' },
  { name: 'email',      label: 'Email',                 type: 'email', required: true, span: 'half', autocomplete: 'email',           placeholder: 'compras@empresa.com', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$', errorMessage: 'Email no válido' },

  // ---- EJEMPLOS: descomenta para añadir más campos -----------------------
  // { name: 'city',     label: 'Ciudad',               type: 'text', required: true,  span: 'half', autocomplete: 'address-level2' },
  // { name: 'poNumber', label: 'Nº pedido interno (PO)', type: 'text', required: false, span: 'half' },
  // { name: 'delivery', label: 'Entrega', type: 'select', required: true, span: 'half',
  //   options: [{ value: 'envio', label: 'Envío a dirección' }, { value: 'recogida', label: 'Recogida en fábrica' }] },
  // { name: 'comments', label: 'Observaciones', type: 'textarea', required: false, span: 'full' },
];

/* Clave de localStorage para el carrito */
const STORAGE_KEYS = {
  cart: 'iwt_cart_v1',
  lastOrder: 'iwt_last_order_v1',
};

/* Exponer también en window (lo usan los módulos ES y la consola) */
window.IWT = Object.freeze({
  COMPANY, MACHINES, PRICING, FALLBACK_TARIFFS, SQLPYME_CONFIG, EMPLOYEE_CONFIG,
  EMAIL_CONFIG, BILLING_FIELDS, STORAGE_KEYS,
});
