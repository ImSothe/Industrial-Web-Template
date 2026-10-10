/* ==========================================================================
   [YOUR_COMPANY] · Constructor de la malla 3D real de la pieza (módulo ES)
   --------------------------------------------------------------------------
   Traduce resolveGeometry(cfg) — ver js/geometry-engine.js — a una jerarquía
   de THREE.Group encadenada por bisagras. Lo usan index.html (configurador
   público) y js/employee-viewer.js (Panel de Taller).

   CONVENIO DE EJES — IDÉNTICO EN TODOS LOS PANELES (base y pliegues):
     local X = ancho del panel ("a lo largo de la bisagra")
     local Z = largo del panel (en un pliegue: "hacia fuera", el ala)
     local Y = normal de la chapa; el plano medio del espesor está en Y = 0
   Como el convenio no cambia, un pliegue apoyado sobre OTRO pliegue lee el
   ancho/largo de su padre en los mismos ejes que si fuera la base, y su
   bisagra cae exactamente en el borde local de ese padre.

   Cada pliegue es una cadena de Object3D anidados dentro del `frame` padre:
     hinge   -> en el borde del padre (plano medio). Solo se orienta con un
                giro en Y para que su Z local apunte "hacia fuera" del borde
                elegido y su X local corra a lo largo de ese borde.
       arc   -> sector anular (radio interior r, exterior r + t) que une
                la cara final del padre con la cara inicial del ala. Esto
                es lo que hace la esquina continua y estanca con cualquier
                espesor: sin puntas en el aire ni huecos.
       bendEnd -> cara final del radio: (0, s·Rm·(1−cosθ), Rm·senθ), girada
                −s·θ en X (Rm = r + t/2, s = +1 arriba / −1 abajo).
         frame -> centro del tramo recto del ala: (0, 0, L/2) en bendEnd.
           mesh -> el ala extruida con sus cortes.
   Three.js compone las transformaciones: no hay matemática manual extra
   por profunda que sea la cadena.

   export buildPartGroup(THREE, cfg, material) -> { group, segments, geometry, scale }
   export fitCameraToObject(THREE, camera, controls, object, opts)
   `resolveGeometry`, `bendInnerRadius`, `mergeCutOutlines` y `PRICING` llegan del scope global
   (scripts clásicos cargados antes: config.js, geometry-engine.js).
   ========================================================================== */

export const PART_SCALE = 1 / 200;          // 200 mm de pieza real = 1 unidad de mundo

/* Orientación de la bisagra por borde del padre (giro en Y del grupo hinge):
   deja su Z local = normal saliente del borde y su X local = a lo largo de
   él, con X × Y = Z (mismo sentido que usa el patrón plano). */
const EDGE_FRAMES = {
  top:    { pos: (pw, pl) => [0, 0, pl / 2],  rotY: 0 },
  bottom: { pos: (pw, pl) => [0, 0, -pl / 2], rotY: Math.PI },
  right:  { pos: (pw) => [pw / 2, 0, 0],      rotY: Math.PI / 2 },
  left:   { pos: (pw) => [-pw / 2, 0, 0],     rotY: -Math.PI / 2 },
};

/** Contorno 2D del panel (x = ancho, y = largo) con sus cortes como agujeros. */
function buildPanelShape(THREE, seg, cuts, scale) {
  const w = seg.width * scale;
  const l = seg.length * scale;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -l / 2);
  shape.lineTo(w / 2, -l / 2);
  shape.lineTo(w / 2, l / 2);
  shape.lineTo(-w / 2, l / 2);
  shape.closePath();

  // Unión booleana previa (ver mergeCutOutlines en geometry-engine.js):
  // cortes solapados -> UN solo agujero limpio; nunca paths superpuestos.
  mergeCutOutlines(cuts.filter((c) => c.segment === seg.id)).forEach(({ ring, circle }) => {
    const path = new THREE.Path();
    if (circle) {
      path.absarc(circle.x * scale, circle.y * scale, (circle.w / 2) * scale, 0, Math.PI * 2, true);
    } else {
      ring.slice(0, -1).forEach(([x, y], i) => {
        if (i === 0) path.moveTo(x * scale, y * scale); else path.lineTo(x * scale, y * scale);
      });
      path.closePath();
    }
    shape.holes.push(path);
  });

  return shape;
}

/** Extruye un contorno de panel: shape x -> X, shape y -> +Z, espesor en Y centrado en 0. */
function extrudePanel(THREE, shape, thickness) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 32 });
  geo.rotateX(Math.PI / 2);            // (x, y, z) -> (x, −z, y)
  geo.translate(0, thickness / 2, 0);  // espesor de −t/2 a +t/2
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sector anular del radio de plegado, en el marco de la bisagra
 * (X = a lo largo del borde, Z = hacia fuera, Y = normal del padre).
 * Centro del radio en (Y = s·(t/2 + r), Z = 0); barre de 0 a θ.
 */
function buildBendArc(THREE, width, t, r, thetaRad, s) {
  const steps = Math.max(6, Math.ceil((thetaRad / Math.PI) * 32));
  const cy = s * (t / 2 + r);
  const pt = (phi, rho) => [rho * Math.sin(phi), cy - s * rho * Math.cos(phi)];   // (z, y)
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {                 // cara interior, 0 -> θ
    const [z, y] = pt((thetaRad * i) / steps, r);
    if (i === 0) shape.moveTo(z, y); else shape.lineTo(z, y);
  }
  for (let i = steps; i >= 0; i--) {                 // cara exterior, θ -> 0
    const [z, y] = pt((thetaRad * i) / steps, r + t);
    shape.lineTo(z, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.rotateY(-Math.PI / 2);           // shape x -> Z, shape y -> Y, profundidad -> −X
  geo.translate(width / 2, 0, 0);      // centrado a lo largo del borde
  geo.computeVertexNormals();
  return geo;
}

export function buildPartGroup(THREE, cfg, material, scale = PART_SCALE) {
  const geo = resolveGeometry(cfg);
  const t = cfg.thickness * scale;                       // espesor REAL (0,4–25 mm), sin mínimos artificiales
  const r = bendInnerRadius(cfg.thickness) * scale;
  const rm = r + t / 2;                                  // radio de la fibra media
  const byId = {};
  const root = new THREE.Group();
  const segments = [];

  const addMesh = (parent, geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  geo.segments.forEach((seg) => {
    const panelGeo = extrudePanel(THREE, buildPanelShape(THREE, seg, geo.cuts, scale), t);

    if (seg.parentId === null) {
      const mesh = addMesh(root, panelGeo);
      byId[seg.id] = { frame: root, seg };
      segments.push({ id: seg.id, frame: root, mesh });
      return;
    }

    const parent = byId[seg.parentId] || byId.base;
    const edge = EDGE_FRAMES[seg.edge] || EDGE_FRAMES.right;
    const hinge = new THREE.Group();
    hinge.position.set(...edge.pos(parent.seg.width * scale, parent.seg.length * scale));
    hinge.rotation.y = edge.rotY;
    parent.frame.add(hinge);

    const s = seg.direction === 'down' ? -1 : 1;
    const theta = (seg.angleDeg * Math.PI) / 180;
    if (theta > 1e-3) addMesh(hinge, buildBendArc(THREE, seg.width * scale, t, r, theta, s));

    const bendEnd = new THREE.Group();
    bendEnd.position.set(0, s * rm * (1 - Math.cos(theta)), rm * Math.sin(theta));
    bendEnd.rotation.x = -s * theta;
    hinge.add(bendEnd);

    const frame = new THREE.Group();
    frame.position.set(0, 0, (seg.length * scale) / 2);
    bendEnd.add(frame);
    const mesh = addMesh(frame, panelGeo);

    byId[seg.id] = { frame, seg };
    segments.push({ id: seg.id, frame, mesh, hinge });
  });

  return { group: root, segments, geometry: geo, scale };
}

/* Vista inicial: misma orientación que el plano (Ancho de izquierda a
   derecha, Largo hacia el fondo = borde "Arriba"), algo girada para ver los
   pliegues y bastante elevada (~37°) para que el Largo no se vea acortado
   por la perspectiva. Así los nombres de borde del selector coinciden con
   lo que se ve: Izquierda/Derecha a los lados, Arriba al fondo. */
export const DEFAULT_VIEW_DIRECTION = (THREE) => new THREE.Vector3(0.5, 0.85, 1);

/* ---------------------------------------------------------------------------
   COTAS 3D: flecha "Ancho" (eje X de la chapa base) y "Largo" (eje Z), con
   su medida en mm, dibujadas en el suelo junto a la pieza. Solo visual: se
   añaden al grupo del visor DESPUÉS de construir la pieza y no forman parte
   de las exportaciones (part-export.js construye su propia malla).
   --------------------------------------------------------------------------- */
const DIM_COLOR = '#6eacdf';               // azul corporativo

function dimLabel(THREE, text, height) {
  const font = 600;
  const px = 64;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${font} ${px}px Inter, system-ui, sans-serif`;
  const padX = 28;
  const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const h = px + 36;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `${font} ${px}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(7, 8, 10, 0.82)';
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = DIM_COLOR;
  ctx.stroke();
  ctx.fillStyle = '#f2f4f7';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padX, h / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, depthTest: false, depthWrite: false, transparent: true, fog: false, toneMapped: false,
  }));
  sprite.scale.set(height * (w / h), height, 1);
  sprite.renderOrder = 20;
  return sprite;
}

/**
 * Cotas de la chapa base para una pieza ya construida con buildPartGroup().
 * `partGroup` debe estar SIN transformar (recién construido): las cotas se
 * colocan en su espacio local, en el suelo (Y mínima) y fuera de su caja.
 */
export function buildDimensionGuides(THREE, cfg, partGroup, scale = PART_SCALE) {
  partGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(partGroup);
  const size = box.getSize(new THREE.Vector3());
  const W = cfg.width * scale;
  const L = cfg.length * scale;
  const span = Math.max(size.x, size.z, 1e-3);
  const gap = span * 0.09;                       // separación cota <-> pieza
  const ext = span * 0.03;                       // las líneas de referencia sobresalen
  const arrow = span * 0.022;                    // tamaño de la punta de flecha
  const y = box.min.y;

  const pts = [];
  const seg = (a, b) => pts.push(new THREE.Vector3(...a), new THREE.Vector3(...b));

  // Cota de ANCHO: a lo largo de X, delante de la pieza (lado "Abajo", hacia la cámara)
  const zA = box.max.z + gap;
  seg([-W / 2, y, zA], [W / 2, y, zA]);
  seg([-W / 2, y, L / 2], [-W / 2, y, zA + ext]);
  seg([W / 2, y, L / 2], [W / 2, y, zA + ext]);
  seg([-W / 2, y, zA], [-W / 2 + arrow, y, zA - arrow * 0.55]);
  seg([-W / 2, y, zA], [-W / 2 + arrow, y, zA + arrow * 0.55]);
  seg([W / 2, y, zA], [W / 2 - arrow, y, zA - arrow * 0.55]);
  seg([W / 2, y, zA], [W / 2 - arrow, y, zA + arrow * 0.55]);

  // Cota de LARGO: a lo largo de Z, a la derecha de la pieza
  const xL = box.max.x + gap;
  seg([xL, y, -L / 2], [xL, y, L / 2]);
  seg([W / 2, y, -L / 2], [xL + ext, y, -L / 2]);
  seg([W / 2, y, L / 2], [xL + ext, y, L / 2]);
  seg([xL, y, -L / 2], [xL - arrow * 0.55, y, -L / 2 + arrow]);
  seg([xL, y, -L / 2], [xL + arrow * 0.55, y, -L / 2 + arrow]);
  seg([xL, y, L / 2], [xL - arrow * 0.55, y, L / 2 - arrow]);
  seg([xL, y, L / 2], [xL + arrow * 0.55, y, L / 2 - arrow]);

  const group = new THREE.Group();
  group.name = 'dimension-guides';
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false, transparent: true, opacity: 0.95, fog: false, toneMapped: false }),
  );
  lines.renderOrder = 19;
  group.add(lines);

  const fmt = (v) => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  const labelH = span * 0.055;
  const ancho = dimLabel(THREE, `Ancho ${fmt(cfg.width)} mm`, labelH);
  ancho.position.set(0, y + labelH * 0.6, zA + labelH * 0.9);
  const largo = dimLabel(THREE, `Largo ${fmt(cfg.length)} mm`, labelH);
  largo.position.set(xL + labelH * 0.4 + largo.scale.x / 2, y + labelH * 0.6, 0);
  group.add(ancho, largo);
  return group;
}

/** Libera geometrías, materiales y texturas de un grupo de cotas. */
export function disposeDimensionGuides(group) {
  group?.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
  });
}

/**
 * Encuadra la cámara para que `object` se vea COMPLETO y centrado, mida
 * 100 mm o 6000 mm. Usa la esfera envolvente del Box3 y el FOV real
 * (el más restrictivo de vertical/horizontal), y ajusta near/far y los
 * límites de zoom de OrbitControls a ese tamaño.
 *   opts.regionFracW / regionFracH: fracción del viewport disponible (si
 *     parte de la pantalla está tapada por un panel — ver setViewOffset).
 *   opts.keepDirection: conserva el ángulo de vista actual del usuario y
 *     solo recoloca distancia y centro.
 *   opts.margin: holgura alrededor de la pieza (1 = justo).
 */
export function fitCameraToObject(THREE, camera, controls, object, opts = {}) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center.clone();
  const radius = Math.max(sphere.radius, 1e-3);

  const margin = opts.margin ?? 1.12;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (opts.regionFracH ?? 1);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect * (opts.regionFracW ?? 1);
  const halfAngle = Math.atan(Math.min(tanV, tanH));
  const distance = (radius * margin) / Math.sin(halfAngle);

  const target = controls ? controls.target : new THREE.Vector3();
  let dir = new THREE.Vector3().subVectors(camera.position, target);
  if (!opts.keepDirection || dir.lengthSq() < 1e-10) dir = (opts.direction || DEFAULT_VIEW_DIRECTION(THREE)).clone();
  dir.normalize();

  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(radius * 0.005, 1e-4);
  camera.far = distance * 5 + radius * 4;
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(center);
    controls.minDistance = radius * 0.4;
    controls.maxDistance = distance * 4;
    controls.update();
  } else {
    camera.lookAt(center);
  }
  return { box, center, radius, distance };
}
