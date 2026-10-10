/* ==========================================================================
   [YOUR_COMPANY] · Visor 3D estático del Panel de Taller (empleado.html)
   --------------------------------------------------------------------------
   A diferencia de index.html (scrollytelling), aquí no hay scroll: la pieza
   refleja la configuración actual y se controla con el ratón (OrbitControls,
   sin auto-rotación por defecto — un giro constante marea y no deja ver el
   detalle). Usa el mismo motor de malla que index.html (js/part-mesh-
   builder.js -> buildPartGroup), así que representa EXACTAMENTE la misma
   cadena de pliegues y cortes que el configurador público y el presupuesto.
   Expone window.EmployeeViewer = { update(cfg), exportSTL(), exportGLB(),
   loadExternalSTL(file), clearExternal(), hasExternal(), setAutoRotate(on),
   toggleAutoRotate(), resize() } para que js/employee.js (script clásico)
   lo use tras autenticar.

   VISOR DE ARCHIVOS EXTERNOS (solo Taller): loadExternalSTL(file) lee un
   .stl con STLLoader, OCULTA la chapa paramétrica y muestra la malla
   importada con un material metálico básico. clearExternal() la elimina y
   vuelve a mostrar la pieza conectada al configurador (que se sigue
   actualizando en segundo plano mientras tanto).
   ========================================================================== */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { buildPartGroup, fitCameraToObject, PART_SCALE, buildDimensionGuides, disposeDimensionGuides } from './part-mesh-builder.js';
import { partToSTL, partToGLB } from './part-export.js';

const MAX_EXTERNAL_MB = 80;             // límite de tamaño del .stl importado

function boot() {
  const canvas = document.getElementById('employeeCanvas');
  if (!canvas) { setTimeout(boot, 50); return; }   // employee.js aún no ha desbloqueado el DOM

  const wrap = canvas.closest('.viewer-3d');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    console.warn('[IWT] WebGL no disponible en el panel de Taller.', err);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = false;          // pieza estática por defecto: gira solo si el usuario arrastra
  controls.autoRotateSpeed = 1.4;
  controls.minDistance = 0.05;

  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(4, 6, 4);
  key.castShadow = true;
  scene.add(key);
  scene.add(key.target);
  scene.add(new THREE.DirectionalLight(0x6eacdf, 0.8).translateX(-4));
  scene.add(new THREE.AmbientLight(0x304050, 0.4));

  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(8, 16, 0x2a2f37, 0x15181d);
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);

  const material = new THREE.MeshPhysicalMaterial({ color: '#9aa1a9', metalness: 1, roughness: 0.4, envMapIntensity: 1 });
  const outer = new THREE.Group();
  scene.add(outer);
  let partGroup = null;
  let dims = null;
  let lastCfg = null;

  // Modelo externo (.stl) cargado por el operario: sustituye VISUALMENTE a la
  // chapa paramétrica, que sigue existiendo (oculta) y conectada a los inputs.
  const externalMaterial = new THREE.MeshStandardMaterial({
    color: '#aeb4bb', metalness: 0.85, roughness: 0.35, side: THREE.DoubleSide,
  });
  let externalMesh = null;

  /** Reconstruye la malla real (cadena de pliegues + cortes) desde la configuración. */
  function build(cfg) {
    if (partGroup) { outer.remove(partGroup); disposeDimensionGuides(dims); disposeGroup(partGroup); }
    const built = buildPartGroup(THREE, cfg, material);
    partGroup = built.group;
    dims = buildDimensionGuides(THREE, cfg, partGroup);   // cotas Ancho / Largo (solo visual)
    partGroup.add(dims);

    partGroup.visible = !externalMesh;
    outer.add(partGroup);
    if (!externalMesh) fitToPart();
  }

  /* ---------------- Visor de archivos externos (.stl) ---------------- */
  function readFileAsArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function removeExternalMesh() {
    if (!externalMesh) return;
    outer.remove(externalMesh);
    externalMesh.geometry.dispose();
    externalMesh = null;
  }

  /**
   * Carga un .stl (binario o ASCII) con STLLoader y lo muestra en lugar de la
   * chapa paramétrica. Tres pasos automáticos en cada carga:
   *   1. Rotación de ejes: −90° en X (Z-arriba del CAD -> Y-arriba de Three.js).
   *   2. Apoyo y centrado: con la caja envolvente YA ROTADA se centra en X/Z
   *      y se baja/sube hasta que su cara inferior quede exactamente en Y = 0,
   *      sobre la rejilla (ni flotando ni hundida).
   *   3. Auto-encuadre: fitCameraToObject() sobre la nueva malla.
   * Unidades: milímetros (lo habitual en CAD), a la misma escala que la chapa.
   * Devuelve { name, triangles, sizeMm: {x, y, z} } (ancho × fondo × alto CAD).
   */
  async function loadExternalSTL(file) {
    if (!file) throw new Error('No se ha seleccionado ningún archivo.');
    if (!/\.stl$/i.test(file.name)) throw new Error('Formato no admitido: selecciona un archivo .stl');
    if (file.size > MAX_EXTERNAL_MB * 1024 * 1024) throw new Error(`El archivo supera ${MAX_EXTERNAL_MB} MB.`);

    const buffer = await readFileAsArrayBuffer(file);
    let geometry;
    try {
      geometry = new STLLoader().parse(buffer);
    } catch (err) {
      throw new Error('El archivo .stl está dañado o no es válido.');
    }
    const count = geometry.getAttribute('position')?.count || 0;
    if (count < 3) { geometry.dispose(); throw new Error('El archivo .stl no contiene triángulos.'); }
    geometry.computeVertexNormals();         // muchos CAD escriben normales 0,0,0: se recalculan siempre
    geometry.computeBoundingBox();
    const sizeMm = geometry.boundingBox.getSize(new THREE.Vector3());   // medidas en ejes CAD

    removeExternalMesh();
    const mesh = new THREE.Mesh(geometry, externalMaterial);
    mesh.name = file.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(PART_SCALE);         // mm -> unidades del visor (misma escala que la chapa)

    // 1. Rotación de ejes: Z-up (CAD) -> Y-up (Three.js)
    mesh.rotation.x = -Math.PI / 2;
    outer.add(mesh);
    mesh.updateMatrixWorld(true);

    // 2. Caja envolvente DESPUÉS de rotar (en el espacio de `outer`, que no
    //    tiene transformación) -> centrado en X/Z y cara inferior en Y = 0.
    const box = new THREE.Box3().setFromObject(mesh, true);
    const center = box.getCenter(new THREE.Vector3());
    mesh.position.set(-center.x, -box.min.y, -center.z);
    mesh.updateMatrixWorld(true);

    externalMesh = mesh;
    if (partGroup) partGroup.visible = false;

    // 3. Auto-encuadre inmediato de la cámara del taller a la nueva pieza
    //    (fitToPart llama a fitCameraToObject y coloca suelo/rejilla en Y = 0).
    fitToPart({ fresh: true });

    return {
      name: file.name,
      triangles: Math.round(count / 3),
      sizeMm: { x: sizeMm.x, y: sizeMm.y, z: sizeMm.z },
    };
  }

  /** Caja del modelo externo en mm (mundo), para QA/diagnóstico. */
  function externalBounds() {
    if (!externalMesh) return null;
    const b = new THREE.Box3().setFromObject(externalMesh, true);
    const mm = (v) => ({ x: +(v.x / PART_SCALE).toFixed(3), y: +(v.y / PART_SCALE).toFixed(3), z: +(v.z / PART_SCALE).toFixed(3) });
    return { min: mm(b.min), max: mm(b.max), floorY: +(floor.position.y / PART_SCALE).toFixed(3) };
  }

  /** Elimina el modelo importado y vuelve a la chapa paramétrica. */
  function clearExternal() {
    removeExternalMesh();
    if (partGroup) partGroup.visible = true;
    fitToPart({ fresh: true });
  }

  /** Encuadre tras CADA cambio de geometría: la pieza siempre completa y
   * centrada (100 mm o 6000 mm), conservando el ángulo de vista si el
   * operario ya había orbitado. El suelo/rejilla/sombras se adaptan al
   * tamaño real para no cortar la pieza ni dejarla flotando. */
  let framedOnce = false;
  function fitToPart({ fresh = false } = {}) {
    const target = externalMesh || partGroup;
    if (!target) return;
    const fit = fitCameraToObject(THREE, camera, controls, target, { keepDirection: framedOnce && !fresh, margin: 1.0 });
    framedOnce = true;
    if (!fit) return;
    const size = fit.box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, fit.radius) * 3;
    floor.scale.setScalar(span / 4);
    grid.scale.setScalar(span / 8);
    // Rejilla EXACTAMENTE en la cara inferior de la pieza (Y = 0 en un modelo
    // externo); el plano de sombras, una fracción ínfima por debajo para no
    // parpadear con esa cara.
    grid.position.set(fit.center.x, fit.box.min.y, fit.center.z);
    floor.position.set(fit.center.x, fit.box.min.y - fit.radius * 1e-4, fit.center.z);
    key.position.copy(fit.center).add(new THREE.Vector3(1, 1.6, 1).multiplyScalar(fit.radius * 2));
    key.target.position.copy(fit.center);
    const sc = key.shadow.camera;
    sc.left = -fit.radius * 1.3; sc.right = fit.radius * 1.3; sc.top = fit.radius * 1.3; sc.bottom = -fit.radius * 1.3;
    sc.near = 0.01; sc.far = fit.radius * 8;
    sc.updateProjectionMatrix();
  }

  function disposeGroup(group) {
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  }

  function resize() {
    const w = wrap.clientWidth || 400;
    const h = wrap.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitToPart();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  function update(cfg) {
    lastCfg = cfg;
    build(cfg);
    const look = resolveMaterialLook(cfg);
    material.color.set(look.color);
    material.roughness = look.roughness;
    material.metalness = look.metalness;
  }

  function tick() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Exportan SIEMPRE la pieza paramétrica (no el modelo importado), a escala
  // real: STL en mm, GLB en metros (ver js/part-export.js).
  async function exportSTL() { return partToSTL(THREE, lastCfg); }
  async function exportGLB() { return partToGLB(THREE, lastCfg); }
  function setAutoRotate(on) {
    controls.autoRotate = !!on;          // OrbitControls sigue enabled: el ratón funciona en ambos estados
    return controls.autoRotate;
  }
  const toggleAutoRotate = () => setAutoRotate(!controls.autoRotate);

  window.EmployeeViewer = {
    update, exportSTL, exportGLB, resize, setAutoRotate, toggleAutoRotate,
    loadExternalSTL, clearExternal, hasExternal: () => !!externalMesh, externalBounds,
  };
  window.dispatchEvent(new CustomEvent('iwt:employee-viewer-ready'));
}

boot();
