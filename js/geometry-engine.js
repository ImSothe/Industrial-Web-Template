/* ==========================================================================
   [YOUR_COMPANY] · Motor de geometría paramétrica (chapa + cadena de pliegues + cortes)
   --------------------------------------------------------------------------
   Este es el ÚNICO sitio donde vive la lógica matemática de la pieza. No usa
   Three.js: es JS puro para poder reutilizarse en:
     - js/pricing.js         (área, perímetro de corte, nº de pliegues/cortes)
     - js/plan-generator.js  (patrón plano / DXF)
     - js/part-mesh-builder.js (malla 3D real, en index.html y empleado.html)

   MODELO DE DATOS DE UNA PIEZA (ver sanitizePartConfig):
     {
       reference, material, thickness, width, length, finish (clave de color;
       solo válida si PRICING.materials[material].colors existe — Aluminio y
       Prelacado; 'none' en caso contrario), quantity, notes,
       bends: [ { parent: 'base'|'bend1'|..., edge: 'left'|'right'|'top'|'bottom',
                  direction: 'up'|'down', angle: 0-180, flangeLength } ... ],
       cuts:  [ { segment: 'base'|'bend1'|..., shape: 'circular'|'rectangular'|'triangular',
                  x, y, rotation, w, h } ... ],
     }

   CADENA DE PLIEGUES: cada pliegue elige un `parent` (la chapa base u OTRO
   pliegue ya creado) y un `edge` de ESE panel. El motor resuelve la posición
   de cada panel encadenando pliegue tras pliegue, tanto en 3D (para el visor)
   como en el patrón plano 2D (para el plano de fabricación): en el patrón
   plano el ángulo no importa (se dibuja siempre "desplegado"); en 3D cada
   panel hijo se pliega el ángulo indicado alrededor de la línea de la
   bisagra, heredando la orientación de su padre — así un pliegue SOBRE otro
   pliegue ya plegado queda representado con exactitud.

   Ejes: X = ancho ("width"), Z = largo ("length") en 3D; en el patrón plano
   2D usamos (x, y) para (X, Z). Y = espesor / normal del panel.
   ========================================================================== */

const GEOMETRY_LIMITS = {
  maxBends: 8,
  minAngle: 0, maxAngle: 180,
  minFlange: 5, maxFlange: 500,
  minCutSize: 1, maxCutSize: 500,
  maxCuts: 200,
};

/* --------------------------------------------------------------------------
   RADIO DE PLEGADO Y DESARROLLO
   Un pliegue real no es una arista viva: la chapa se curva alrededor de un
   radio interior r. Usamos la regla de taller habitual r = espesor, y un
   factor K = 0,33 (posición de la fibra neutra) para el desarrollo en plano.
     - 3D: el tramo curvo es un sector anular de radio interior r y
       exterior r + t, así la esquina es continua y estanca con CUALQUIER
       espesor (0,4 a 25 mm) — sin puntas en el aire ni huecos.
     - Plano: entre el borde del panel padre y el ala se intercala la
       "tira de plegado" de longitud BA = ángulo(rad) × (r + K·t).
   El "Largo del ala" es el tramo recto del ala, después del radio.
   -------------------------------------------------------------------------- */
const BEND_RADIUS_FACTOR = 1;      // r = BEND_RADIUS_FACTOR × t
const BEND_K_FACTOR = 0.33;

function bendInnerRadius(t) { return BEND_RADIUS_FACTOR * t; }
function bendAllowance(t, angleDeg) {
  return (angleDeg * Math.PI / 180) * (bendInnerRadius(t) + BEND_K_FACTOR * t);
}

/** Margen mínimo de material que debe quedar entre un corte y el borde de
 * su panel (ligamento): nunca menos que el espesor ni que 2 mm. */
function cutEdgeMargin(t) { return Math.max(2, t || 0); }

/**
 * Aspecto 3D según material + color, calcado del catálogo de referencia (función
 * `look()`): los materiales sin `colors` (Acero/Inox/Galvanizado) usan su
 * metal natural; Aluminio/Prelacado usan el color elegido, con más brillo
 * metálico si ese color está marcado `metal: true`.
 */
function resolveMaterialLook(cfg) {
  const mat = PRICING.materials[cfg.material];
  if (!mat.colors) return { color: mat.color, metalness: mat.metalness, roughness: mat.roughness };
  const c = mat.colors.find((col) => col.key === cfg.finish) || mat.colors[0];
  return c.metal
    ? { color: c.hex, metalness: 0.6, roughness: 0.38 }
    : { color: c.hex, metalness: 0.18, roughness: 0.58 };
}

/** Etiqueta de acabado para mostrar (carrito, plano, email): el nombre del
 * color elegido, o "Metal natural" si el material no se pinta. */
function materialFinishLabel(cfg) {
  const mat = PRICING.materials[cfg.material];
  if (!mat.colors) return 'Metal natural';
  const c = mat.colors.find((col) => col.key === cfg.finish) || mat.colors[0];
  return c.label;
}

/** Dimensiones (ancho/largo) de la base y de cada pliegue, sin vectores del
 * patrón plano — lo bastante ligero para usarlo también al limitar la
 * posición de los cortes (ver clampCutToPanel). */
function computeSegmentDims(width, length, bends) {
  const dims = { base: { width, length } };
  bends.forEach((b, i) => {
    const parent = dims[b.parent] || dims.base;
    const horizontalEdge = b.edge === 'left' || b.edge === 'right';
    const hingeDim = horizontalEdge ? parent.length : parent.width;
    dims[`bend${i + 1}`] = { width: hingeDim, length: Math.max(1, b.flangeLength) };
  });
  return dims;
}

/** Semiancho/semialto (ya rotados) del hueco que ocupa un corte. */
function cutHalfExtents(cut) {
  if (cut.shape === 'circular') return { hx: cut.w / 2, hy: cut.w / 2 };
  if (cut.shape === 'triangular') {
    const r = cut.w / Math.sqrt(3);          // radio circunscrito: cota segura ante cualquier rotación
    return { hx: r, hy: r };
  }
  const rad = (cut.rotation * Math.PI) / 180;
  const hw = cut.w / 2;
  const hh = cut.h / 2;
  return {
    hx: Math.abs(hw * Math.cos(rad)) + Math.abs(hh * Math.sin(rad)),
    hy: Math.abs(hw * Math.sin(rad)) + Math.abs(hh * Math.cos(rad)),
  };
}

/** Tamaño máximo admisible de un corte en un panel (para el `max` de los
 * inputs): diámetro/lado/ancho/alto nunca mayor que el panel menos el
 * ligamento mínimo a cada lado. */
function maxCutSize(cut, panelWidth, panelLength, t) {
  const m = cutEdgeMargin(t);
  const freeW = Math.max(GEOMETRY_LIMITS.minCutSize, panelWidth - 2 * m);
  const freeL = Math.max(GEOMETRY_LIMITS.minCutSize, panelLength - 2 * m);
  if (cut.shape === 'circular') return { w: Math.min(freeW, freeL), h: Math.min(freeW, freeL) };
  if (cut.shape === 'triangular') {
    const s = (Math.min(freeW, freeL) / 2) * Math.sqrt(3);   // circunscrito <= mitad del hueco libre
    return { w: s, h: s };
  }
  return { w: freeW, h: freeL };
}

/* --------------------------------------------------------------------------
   FUSIÓN BOOLEANA DE CORTES (unión 2D)
   Si dos o más cortes de un mismo panel se solapan (un círculo dentro de un
   rectángulo, dos círculos que se tocan...), NO pueden pasarse por separado
   a THREE.Shape.holes (la triangulación se rompe) ni al plano de corte (el
   láser repasaría material ya cortado). Se unen primero con la librería
   polygon-clipping — la misma que usaba el catálogo de referencia
   (polygonClipping.union) — y se devuelve un único contorno limpio por
   cada grupo de cortes que se tocan.
   -------------------------------------------------------------------------- */
const CUT_CIRCLE_SEGMENTS = 64;

/** Contorno cerrado de un corte, en mm y en coordenadas del propio panel
 * (x = ancho, y = largo), ya girado. */
function cutToRing(cut, segments = CUT_CIRCLE_SEGMENTS) {
  const ring = [];
  if (cut.shape === 'circular') {
    const r = cut.w / 2;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push([cut.x + r * Math.cos(a), cut.y + r * Math.sin(a)]);
    }
  } else {
    const rad = (cut.rotation * Math.PI) / 180;
    const co = Math.cos(rad);
    const si = Math.sin(rad);
    let pts;
    if (cut.shape === 'rectangular') {
      pts = [[-cut.w / 2, -cut.h / 2], [cut.w / 2, -cut.h / 2], [cut.w / 2, cut.h / 2], [-cut.w / 2, cut.h / 2]];
    } else {
      const s = cut.w;
      const h = (Math.sqrt(3) / 2) * s;
      pts = [[-s / 2, -h / 3], [s / 2, -h / 3], [0, (2 * h) / 3]];
    }
    pts.forEach(([px, py]) => ring.push([cut.x + px * co - py * si, cut.y + px * si + py * co]));
  }
  ring.push(ring[0].slice());
  return ring;
}

/**
 * Agujeros definitivos de un panel tras la unión booleana.
 * Devuelve [{ ring: [[x,y],...cerrado], circle: cut|null }]:
 *   - circle != null -> el grupo es UN círculo aislado (se dibuja como arco
 *     exacto en 3D y como entidad CIRCLE en el plano).
 *   - circle == null -> contorno poligonal fusionado.
 * Si varios cortes encierran por completo una isla de material, esa isla se
 * desprende (es retal): solo se conserva el contorno exterior de cada grupo.
 */
function mergeCutOutlines(cuts) {
  if (!cuts.length) return [];
  const rings = cuts.map((c) => cutToRing(c));
  const lib = typeof polygonClipping !== 'undefined' ? polygonClipping : null;
  if (rings.length === 1 || !lib) {
    if (!lib && rings.length > 1) console.warn('[IWT] polygon-clipping no cargada: los cortes solapados no se fusionan.');
    return cuts.map((c, i) => ({ ring: rings[i], circle: c.shape === 'circular' ? c : null }));
  }
  let merged;
  try {
    merged = lib.union(...rings.map((r) => [r]));
  } catch (err) {
    console.error('[IWT] Fallo en la unión booleana de cortes', err);
    return cuts.map((c, i) => ({ ring: rings[i], circle: c.shape === 'circular' ? c : null }));
  }
  return merged.map((poly) => {
    const outer = poly[0];
    const inside = cuts.filter((c) => pointInRing([c.x, c.y], outer));
    const lone = inside.length === 1 && inside[0].shape === 'circular' ? inside[0] : null;
    return { ring: outer, circle: lone };
  });
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Limita un corte para que quepa SIEMPRE dentro del panel que lo aloja:
 *   1) tamaño: diámetro/lado/ancho/alto <= panel − 2·ligamento; si al
 *      rotarlo su huella no cabe, se reduce proporcionalmente.
 *   2) posición: |x| <= ancho/2 − semiancho − ligamento (igual en y).
 * Muta el corte in place: los inputs de la UI "topan" con estos valores.
 */
function clampCutToPanel(cut, panelWidth, panelLength, t) {
  const m = cutEdgeMargin(t);
  const max = maxCutSize(cut, panelWidth, panelLength, t);
  cut.w = Utils.clamp(cut.w, GEOMETRY_LIMITS.minCutSize, max.w);
  cut.h = Utils.clamp(cut.h, GEOMETRY_LIMITS.minCutSize, max.h);
  if (cut.shape === 'circular' || cut.shape === 'triangular') cut.h = cut.w;

  // Un rectángulo girado ocupa más: si su huella no cabe, se escala entero.
  let { hx, hy } = cutHalfExtents(cut);
  const room = Math.min(1, (panelWidth / 2 - m) / (hx || 1), (panelLength / 2 - m) / (hy || 1));
  if (room < 1) {
    cut.w = Math.max(GEOMETRY_LIMITS.minCutSize, Utils.round2(cut.w * room));
    cut.h = Math.max(GEOMETRY_LIMITS.minCutSize, Utils.round2(cut.h * room));
    ({ hx, hy } = cutHalfExtents(cut));
  }

  const maxX = Math.max(0, panelWidth / 2 - hx - m);
  const maxY = Math.max(0, panelLength / 2 - hy - m);
  cut.x = Utils.round2(Utils.clamp(cut.x, -maxX, maxX));
  cut.y = Utils.round2(Utils.clamp(cut.y, -maxY, maxY));
}

const EDGES = ['left', 'right', 'top', 'bottom'];
const EDGE_LABELS = { left: 'Izquierda', right: 'Derecha', top: 'Arriba', bottom: 'Abajo' };
const DIRECTION_LABELS = { up: 'Hacia arriba', down: 'Hacia abajo' };

/* --------------------------------------------------------------------------
   Configuración por defecto: un soporte en U con 5 taladros (mismo aspecto
   que la maqueta original, ahora construido con el motor paramétrico real).
   -------------------------------------------------------------------------- */
function defaultPartConfig() {
  return {
    reference: 'Soporte en U',
    material: 'acero',
    thickness: 2,
    width: 300,           // desarrollo: cruza los pliegues
    length: 480,          // a lo largo de los pliegues (el lado largo de la U)
    finish: 'none',
    quantity: 10,
    notes: '',
    bends: [
      { parent: 'base', edge: 'left', direction: 'up', angle: 90, flangeLength: 60 },
      { parent: 'base', edge: 'right', direction: 'up', angle: 90, flangeLength: 60 },
    ],
    // Sin cortes de inicio: el cliente añade los que necesite con
    // "+ Añadir corte" en vez de tener que borrar los que no quiere.
    cuts: [],
  };
}

/**
 * Bordes que admite un pliegue según sobre qué se apoya.
 *  - Chapa base: sus 4 bordes.
 *  - Otro pliegue: su extremo libre ('top') y sus DOS laterales. El borde
 *    'bottom' de un ala es su propia bisagra (ya unida al padre) y no existe.
 * Los laterales son geométricamente exactos: el ala usa el mismo marco local
 * que la base (X = a lo largo de la bisagra, Z = hacia fuera), así que su
 * lateral es la cara X = ±ancho/2 a lo largo de todo el tramo recto.
 */
function edgeOptionsFor(parentId) {
  if (parentId === 'base' || !parentId) {
    return [['right', 'Derecha'], ['left', 'Izquierda'], ['top', 'Arriba'], ['bottom', 'Abajo']];
  }
  return [['top', 'Extremo del ala'], ['left', 'Lateral izquierdo'], ['right', 'Lateral derecho']];
}

/* --------------------------------------------------------------------------
   REGLA FÍSICA DE LOS SELECTORES: un borde solo admite UN pliegue.
   Funciones de estado de la UI (no intervienen en la geometría): las usan
   js/configurator.js y js/employee.js para deshabilitar en los desplegables
   los bordes ya consumidos y mantener la cadena coherente.
   -------------------------------------------------------------------------- */

/** Bordes del panel `parentId` ya ocupados por OTROS pliegues (no el `exceptIndex`). */
function occupiedEdges(bends, parentId, exceptIndex = -1) {
  const used = new Set();
  bends.forEach((b, j) => { if (j !== exceptIndex && b.parent === parentId) used.add(b.edge); });
  return used;
}

/** Primer borde libre del panel (en el orden del selector), o null si está lleno. */
function firstFreeEdge(bends, parentId, exceptIndex = -1) {
  const used = occupiedEdges(bends, parentId, exceptIndex);
  const free = edgeOptionsFor(parentId).find(([v]) => !used.has(v));
  return free ? free[0] : null;
}

/** Panel + borde libres para un pliegue NUEVO: prioriza el último pliegue
 * (encadenar), luego la chapa base y luego cualquier otro; null si no queda. */
function nextFreeBendSlot(bends) {
  const ids = ['base', ...bends.map((_, j) => `bend${j + 1}`)];
  const order = bends.length ? [ids[ids.length - 1], 'base', ...ids.slice(1, -1)] : ['base'];
  for (const parent of order) {
    const edge = firstFreeEdge(bends, parent);
    if (edge) return { parent, edge };
  }
  return null;
}

/**
 * Elimina el pliegue `index` y, en CASCADA, los que cuelgan de él (un ala no
 * puede quedar flotando). Renumera los `parent` de los pliegues restantes y
 * los paneles de los cortes; los cortes hechos en pliegues eliminados se
 * quitan. Muta `cfg` y devuelve { bends, cuts } eliminados.
 */
function removeBendCascade(cfg, index) {
  const segIndex = (id) => (id === 'base' ? -1 : Number(String(id).replace('bend', '')) - 1);
  const removed = new Set([index]);
  cfg.bends.forEach((b, j) => { if (j > index && removed.has(segIndex(b.parent))) removed.add(j); });
  const newIndex = new Map();
  let k = 0;
  cfg.bends.forEach((_, j) => { if (!removed.has(j)) newIndex.set(j, k++); });
  const remap = (id) => {
    const j = segIndex(id);
    if (j < 0) return 'base';
    return removed.has(j) || !newIndex.has(j) ? null : `bend${newIndex.get(j) + 1}`;
  };
  cfg.bends = cfg.bends.filter((_, j) => !removed.has(j)).map((b) => ({ ...b, parent: remap(b.parent) }));
  const cutsBefore = cfg.cuts.length;
  cfg.cuts = cfg.cuts.filter((c) => remap(c.segment) !== null).map((c) => ({ ...c, segment: remap(c.segment) }));
  return { bends: removed.size, cuts: cutsBefore - cfg.cuts.length };
}

/** Etiqueta legible de un segmento por su id ('base', 'bend1', 'bend2'...). */
function segmentLabel(id) {
  if (id === 'base') return 'Chapa base';
  const n = String(id).replace('bend', '');
  return `Pliegue ${n}`;
}

/* --------------------------------------------------------------------------
   Saneado de la configuración (entrada de usuario o localStorage)
   -------------------------------------------------------------------------- */
function sanitizePartConfig(raw) {
  const d = defaultPartConfig();
  const c = { ...d, ...(raw || {}) };
  const L = PRICING.limits;

  c.reference = String(c.reference || d.reference).trim().slice(0, 60) || d.reference;
  c.material = PRICING.materials[c.material] ? c.material : d.material;
  c.thickness = PRICING.thicknesses.includes(Number(c.thickness)) ? Number(c.thickness) : d.thickness;
  c.width = Utils.clamp(Utils.toFloat(c.width, d.width), L.minWidth, L.maxWidth);
  c.length = Utils.clamp(Utils.toFloat(c.length, d.length), L.minLength, L.maxLength);
  c.quantity = Utils.clamp(Utils.toInt(c.quantity, d.quantity), 1, L.maxQuantity);
  c.notes = String(c.notes || '').slice(0, 1000);

  // --- Color/acabado: SOLO existe si el material se pinta (Aluminio,
  // Prelacado). Acero/Inox/Galvanizado siempre van en su metal natural, sin
  // selector de color — igual que en el catálogo de referencia. ------------------------
  const mat = PRICING.materials[c.material];
  if (mat.colors && mat.colors.length) {
    c.finish = mat.colors.some((col) => col.key === c.finish) ? c.finish : mat.colors[0].key;
  } else {
    c.finish = 'none';
  }

  // --- Cadena de pliegues: cada uno solo puede apoyarse en 'base' o en un
  // pliegue YA VALIDADO anteriormente en la lista (evita ciclos). ---------
  const rawBends = Array.isArray(raw?.bends) ? raw.bends : d.bends;
  const validIds = new Set(['base']);
  c.bends = rawBends.slice(0, GEOMETRY_LIMITS.maxBends).map((b, i) => {
    const id = `bend${i + 1}`;
    const parent = b && validIds.has(b.parent) ? b.parent : (i > 0 ? `bend${i}` : 'base');
    validIds.add(id);
    // En un ala (padre = otro pliegue) el borde 'bottom' es la propia unión
    // con su padre, ya ocupada por el radio de plegado: un pliegue ahí
    // saldría del interior de la pieza. Solo valen el extremo ('top') y los
    // dos laterales ('left'/'right').
    let edge = EDGES.includes(b?.edge) ? b.edge : 'right';
    if (parent !== 'base' && edge === 'bottom') edge = 'top';
    return {
      parent,
      edge,
      direction: b?.direction === 'down' ? 'down' : 'up',
      angle: Utils.clamp(Utils.toFloat(b?.angle, 90), GEOMETRY_LIMITS.minAngle, GEOMETRY_LIMITS.maxAngle),
      flangeLength: Utils.clamp(Utils.toFloat(b?.flangeLength, 40), GEOMETRY_LIMITS.minFlange, GEOMETRY_LIMITS.maxFlange),
    };
  });

  // --- Cortes: cada uno referencia un segmento existente (base o pliegue) -
  const segmentIds = ['base', ...c.bends.map((_, i) => `bend${i + 1}`)];
  const rawCuts = Array.isArray(raw?.cuts) ? raw.cuts : d.cuts;
  c.cuts = rawCuts.slice(0, GEOMETRY_LIMITS.maxCuts).map((k) => ({
    segment: segmentIds.includes(k?.segment) ? k.segment : 'base',
    shape: PRICING.cutouts[k?.shape] ? k.shape : 'circular',
    x: Utils.toFloat(k?.x, 0),
    y: Utils.toFloat(k?.y, 0),
    rotation: Utils.toFloat(k?.rotation, 0),
    w: Utils.clamp(Utils.toFloat(k?.w, 12), GEOMETRY_LIMITS.minCutSize, GEOMETRY_LIMITS.maxCutSize),
    h: Utils.clamp(Utils.toFloat(k?.h, 12), GEOMETRY_LIMITS.minCutSize, GEOMETRY_LIMITS.maxCutSize),
  }));

  // --- Límite físico: ningún corte puede quedar fuera de su panel ---------
  const segDims = computeSegmentDims(c.width, c.length, c.bends);
  c.cuts.forEach((k) => {
    const panel = segDims[k.segment] || segDims.base;
    clampCutToPanel(k, panel.width, panel.length, c.thickness);
  });

  return c;
}

/* --------------------------------------------------------------------------
   resolveGeometry(cfg) -> resuelve la cadena de pliegues
   ------------------------------------------------------------------------
   Devuelve, por cada segmento (la base + cada pliegue), TODO lo necesario
   para dibujarlo tanto en el patrón plano (flatCenter/flatU/flatV, con el
   ángulo ignorado = "desplegado") como en 3D (parentId/edge/angleDeg/
   direction/flangeLength/hingeDim, para construir la cadena de bisagras).
   -------------------------------------------------------------------------- */
function resolveGeometry(cfg) {
  const segMap = new Map();
  segMap.set('base', {
    id: 'base', parentId: null, label: segmentLabel('base'),
    width: cfg.width, length: cfg.length,
    hingeDim: null, flangeLength: null, edge: null, angleDeg: 0, direction: 'up',
    flatCenter: { x: 0, y: 0 }, flatU: { x: 1, y: 0 }, flatV: { x: 0, y: 1 },
  });

  cfg.bends.forEach((b, i) => {
    const parent = segMap.get(b.parent) || segMap.get('base');
    const horizontalEdge = b.edge === 'left' || b.edge === 'right';
    const hingeDim = horizontalEdge ? parent.length : parent.width;
    const width = hingeDim;
    const length = Math.max(1, b.flangeLength);

    // Vector "hacia fuera" (normal saliente del borde elegido) y vector "a lo
    // largo de la bisagra". MISMO convenio en todos los paneles, incluidos
    // los pliegues sobre pliegues: V = hacia fuera, U = V girado −90° (en 3D,
    // U = normal × V). Es exactamente el marco local que usa
    // part-mesh-builder.js, así plano y 3D coinciden punto por punto.
    const sign = (b.edge === 'right' || b.edge === 'top') ? 1 : -1;
    const outwardBase = horizontalEdge ? parent.flatU : parent.flatV;
    const outward = { x: outwardBase.x * sign, y: outwardBase.y * sign };
    const alongHinge = { x: outward.y, y: -outward.x };
    const parentHalf = horizontalEdge ? parent.width / 2 : parent.length / 2;
    const hingeMid = { x: parent.flatCenter.x + outward.x * parentHalf, y: parent.flatCenter.y + outward.y * parentHalf };
    const ba = bendAllowance(cfg.thickness, b.angle);           // tira de plegado (desarrollo del radio)
    const flatCenter = {
      x: hingeMid.x + outward.x * (ba + length / 2),
      y: hingeMid.y + outward.y * (ba + length / 2),
    };

    const id = `bend${i + 1}`;
    segMap.set(id, {
      id, parentId: parent.id, label: segmentLabel(id),
      width, length, hingeDim, flangeLength: length,
      edge: b.edge, angleDeg: b.angle, direction: b.direction,
      flatCenter, flatU: alongHinge, flatV: outward,
      hingeMid, bendAllowance: ba,
    });
  });

  const segments = ['base', ...cfg.bends.map((_, i) => `bend${i + 1}`)].map((id) => segMap.get(id));

  const cuts = cfg.cuts.map((k) => ({ ...k, resolvedSegment: segMap.get(k.segment) || segMap.get('base') }));

  let totalAreaM2 = 0;
  let totalPerimeterM = 0;
  segments.forEach((s) => {
    const ba = s.bendAllowance || 0;
    totalAreaM2 += (s.width * (s.length + ba)) / 1e6;
    totalPerimeterM += s.parentId === null
      ? (2 * (s.width + s.length)) / 1000                 // base: se corta el contorno completo
      : (2 * (s.flangeLength + ba) + s.hingeDim) / 1000;   // pliegue: 3 lados (la bisagra no se corta)
  });

  return {
    segments, cuts, totalAreaM2, totalPerimeterM,
    machineLengthRef: cfg.length,      // dimensión que decide la línea de fabricación (ver MACHINES)
    bendCount: cfg.bends.length,
    cutCount: cfg.cuts.length,
  };
}
